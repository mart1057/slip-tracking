import test from 'node:test';
import assert from 'node:assert/strict';
import { limitLines, summaryBlock } from '../src/messages.js';
import { evaluate } from '../src/thresholds.js';
import { dailyReport, weeklyReport } from '../src/reports.js';
import { createBot } from '../src/bot.js';

const bank = (count, amount) => ({ bank: '004', year: 2026, count, amount, ...evaluate(count, amount) });

test('แสดงเฉพาะ % เกณฑ์รวม รวมถึงค่าต่ำและเกินเกณฑ์', () => {
  const text = summaryBlock(bank(49, 1358842.64));
  assert.match(text, /เกณฑ์รวม: 12.25%/);
  assert.doesNotMatch(text, /\/400|\/3,000|ต้องครบทั้งคู่|เทียบเกณฑ์:/);
  assert.deepEqual(limitLines(bank(49, 1358842.64)), ['เกณฑ์รวม: 12.25%']);
  assert.match(limitLines(bank(1, 1500)).join('\n'), /เกณฑ์รวม: 0.08%/);
  assert.match(limitLines(bank(3300, 0)).join('\n'), /เกณฑ์รวม: 110.00%/);
  assert.match(limitLines(bank(0, 0)).join('\n'), /เกณฑ์รวม: 0.00%/);
});

test('สรุปรายวันและสัปดาห์แสดง % สะสมทั้งปีทุกธนาคารแม้วันนั้นไม่มีรายการ', async () => {
  const banks = [bank(49, 1358842.64), { ...bank(3000, 100), bank: '006' }];
  const deps = { db: { activity: async () => [], pendingCount: async () => 0 }, service: { yearSummary: async () => banks } };
  for (const report of [dailyReport, weeklyReport]) {
    const text = await report(deps, '2026-10-15');
    assert.match(text, /กสิกรไทย/);
    assert.match(text, /กรุงไทย/);
    for (const b of banks) for (const line of limitLines(b)) assert.ok(text.includes(line));
  }
});

test('/sumary และ /summary รองรับปีที่ระบุเหมือนกัน', async () => {
  const replies = [];
  const years = [];
  const bot = createBot({ token: 'test', allowedUserIds: new Set([1]), db: {},
    botInfo: { id: 2, is_bot: true, first_name: 'bot', username: 'test_bot' },
    service: { yearSummary: async (year) => { years.push(year); return [bank(49, 1358842.64)]; } },
  });
  bot.api.config.use(async (_prev, _method, payload) => {
    replies.push(payload.text);
    return { ok: true, result: { message_id: 10, date: 0, chat: { id: 1, type: 'private' }, text: payload.text } };
  });
  for (const [i, command] of ['summary', 'sumary'].entries()) {
    await bot.handleUpdate({ update_id: i + 1, message: { message_id: i + 1, date: 0,
      chat: { id: 1, type: 'private' }, from: { id: 1, is_bot: false, first_name: 'u' },
      text: `/${command} 2569`, entities: [{ type: 'bot_command', offset: 0, length: command.length + 1 }],
    } });
  }
  assert.deepEqual(years, [2026, 2026]);
  assert.equal(replies[0], replies[1]);
  assert.match(replies[1], /เกณฑ์รวม: 12.25%/);
});
