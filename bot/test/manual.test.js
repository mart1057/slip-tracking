import test from 'node:test';
import assert from 'node:assert/strict';
import { createBot, parseTransferInput } from '../src/bot.js';
import { createService } from '../src/service.js';

test('ข้อความธนาคารและยอดเงิน', () => {
  assert.deepEqual(parseTransferInput('กสิกร 1500'), { bank: '004', amount: 1500 });
  assert.deepEqual(parseTransferInput('SCB 1,500.50 บาท'), { bank: '014', amount: 1500.5 });
  assert.deepEqual(parseTransferInput('ซีไอเอ็มบี ไทย 50'), { bank: '022', amount: 50 });
  for (const text of ['กสิกร -5', 'กสิกร 0', 'กสิกร 1.234', 'ไม่รู้จัก 1500', '/summary', 'กสิกร 10000000000']) {
    assert.equal(parseTransferInput(text), null, text);
  }
});

test('บันทึกข้อความใหม่ นับยอด กันข้อความเดิมซ้ำ และลบรายการไม่มีรูป', async () => {
  const rows = [];
  const db = {
    getSlipByRef: async (ref) => rows.find((s) => s.trans_ref === ref),
    listAccounts: async () => [{ id: 7, bank_code: '004' }],
    insertSlip: async (s) => {
      const row = { id: rows.length + 1, trans_ref: s.transRef, receiver_bank: s.receiverBank,
        transferred_at: s.transferredAt, amount: s.amount, image_path: s.imagePath, ...s };
      rows.push(row);
      return row;
    },
    bankTotals: async () => [{ bank: '004', count: rows.length, amount: rows.reduce((n, s) => n + s.amount, 0) }],
    deleteSlip: async (id) => rows.splice(rows.findIndex((s) => s.id === id), 1)[0],
  };
  const now = new Date('2026-10-15T14:00:00Z');
  const service = createService({ db, clock: () => now });
  const input = { bank: '004', amount: 1500, telegram: { chatId: 1, messageId: 2, userId: 1 } };
  const saved = await service.recordTransfer(input);
  assert.equal(saved.kind, 'saved');
  assert.equal(saved.summary.amount, 1500);
  assert.equal(saved.slip.dateSource, 'manual');
  assert.equal(saved.slip.transferred_at, now);
  assert.equal(saved.slip.receiverAccountId, 7);
  assert.equal((await service.recordTransfer(input)).kind, 'duplicate');
  await service.recordTransfer({ ...input, telegram: { chatId: 1, messageId: 3 } });
  assert.equal(rows.length, 2);
  await service.deleteSlip(1);
  assert.equal(rows.length, 1);
  await assert.rejects(service.recordTransfer({ ...input, amount: -1 }));
});

test('bot รับรายการก่อนเดาสินค้าล่าสุด และยังรับคำตอบสินค้าโดยตรง', async () => {
  const calls = [];
  const slip = { id: 9, amount: 1500, receiver_bank: '004', transferred_at: new Date(), date_source: 'manual' };
  const bot = createBot({
    token: 'test', allowedUserIds: new Set([1]),
    botInfo: { id: 2, is_bot: true, first_name: 'bot', username: 'test_bot' },
    db: { latestAwaitingItem: async () => { throw new Error('ต้องรับรายการใหม่ก่อน'); } },
    service: {
      recordTransfer: async (input) => { calls.push(input); return { kind: 'saved', slip, summary: { bank: '004', year: 2026, count: 1, amount: 1500 } }; },
      updateSlip: async (id, patch) => { calls.push({ id, patch }); return { slip: { ...slip, ...patch } }; },
    },
  });
  const replies = [];
  bot.api.config.use(async (_prev, _method, payload) => {
    replies.push(payload.text);
    return { ok: true, result: { message_id: 10, date: 0, chat: { id: 1, type: 'private' }, text: payload.text } };
  });
  const message = { message_id: 3, date: 0, chat: { id: 1, type: 'private' }, from: { id: 1, is_bot: false, first_name: 'u' }, text: 'กสิกร 1500' };
  await bot.handleUpdate({ update_id: 1, message });
  assert.equal(calls[0].amount, 1500);
  assert.match(replies[0], /บันทึกรายการจากข้อความแล้ว/);
  assert.match(replies[1], /ลูกค้าซื้ออะไร/);
  await bot.handleUpdate({ update_id: 2, message: { ...message, message_id: 4,
    reply_to_message: { ...message, from: { id: 2, is_bot: true, first_name: 'bot' }, text: 'สลิป #9 ลูกค้าซื้ออะไร' } } });
  assert.deepEqual(calls[1], { id: 9, patch: { item: 'กสิกร 1500' } });
});
