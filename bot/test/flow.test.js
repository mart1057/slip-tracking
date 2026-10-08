// ทดสอบทั้งเส้นทาง: รูปสลิปจำลอง -> bot -> Postgres -> ข้อความตอบกลับ -> API
// ต้องมี Postgres สำหรับทดสอบ: TEST_DATABASE_URL=postgres://... npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDb } from '../src/db.js';
import { createService } from '../src/service.js';
import { createBot } from '../src/bot.js';
import { createApi } from '../src/api.js';
import { readSlipQr } from '../src/slip/qr.js';
import { ocrSlip, closeOcr } from '../src/slip/ocr.js';
import { dailyReport, weeklyReport, startReportScheduler } from '../src/reports.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.TEST_DATABASE_URL;
const OWNER = 111;

test('ระบบสลิปทั้งเส้นทาง', { skip: !url && 'ไม่ได้ตั้ง TEST_DATABASE_URL' }, async (t) => {
  const db = createDb(url);
  await db.pool.query('DROP TABLE IF EXISTS slips, accounts, opening_balances CASCADE');
  await db.pool.query(fs.readFileSync(path.join(here, '../../db/schema.sql'), 'utf8'));
  const imageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'slips-'));
  const service = createService({ db, imageDir, readSlipQr, ocrSlip, clock: () => new Date('2026-10-08T13:00:00+07:00') });

  const sent = [];
  const bot = createBot({
    token: 'test',
    allowedUserIds: new Set([OWNER]),
    service,
    db,
    download: async (_ctx, fileId) => fs.readFileSync(path.join(here, 'fixtures', `${fileId}.png`)),
    botInfo: { id: 1, is_bot: true, first_name: 'slip', username: 'slip_test_bot', can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false },
  });
  let messageId = 1000;
  bot.api.config.use(async (_prev, method, payload) => {
    sent.push({ method, ...payload });
    return { ok: true, result: method === 'sendMessage' ? { message_id: ++messageId, date: 0, chat: { id: OWNER, type: 'private' }, text: payload.text } : true };
  });

  let updateId = 0;
  const from = (id) => ({ id, is_bot: false, first_name: 'u' });
  const base = (id) => ({ message_id: ++messageId, date: 0, chat: { id, type: 'private' }, from: from(id) });
  const send = async (update) => { sent.length = 0; await bot.handleUpdate({ update_id: ++updateId, ...update }); return sent.filter((s) => s.method === 'sendMessage'); };
  const photo = (file, id = OWNER, caption) => send({
    message: { ...base(id), photo: [{ file_id: file, file_unique_id: file, width: 720, height: 1180 }], ...(caption ? { caption } : {}) },
  });
  const botMessage = (body) => ({ reply_to_message: { ...base(OWNER), from: { id: 1, is_bot: true, first_name: 'slip' }, text: body } });
  const text = (body, id = OWNER, extra = {}) => send({
    message: { ...base(id), text: body, ...(body.startsWith('/') ? { entities: [{ type: 'bot_command', offset: 0, length: body.split(' ')[0].length }] } : {}), ...extra },
  });
  const press = (data) => send({ callback_query: { id: String(++updateId), from: from(OWNER), chat_instance: 'x', data, message: { ...base(OWNER), text: 'x' } } });
  const buttons = (m) => m.reply_markup.inline_keyboard.flat().map((b) => b.callback_data);

  await t.test('คนอื่นส่งสลิป: ไม่ตอบ ไม่บันทึก', async () => {
    assert.equal((await photo('kplus', 999)).length, 0);
    assert.match((await text('/id', 999))[0].text, /999/);
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM slips')).rows[0].n, 0);
  });

  await t.test('สลิปโอนธนาคารเดียวกัน: บันทึกและสรุปยอด', async () => {
    const [m, ask] = await photo('kplus');
    assert.match(ask.text, /สลิป #1 ลูกค้าซื้ออะไร/);
    assert.equal(ask.reply_markup.force_reply, true);
    assert.match(m.text, /✅ บันทึกสลิปแล้ว \(สลิป #1\)/);
    assert.match(m.text, /ยอด: 1,500\.00 บาท/);
    assert.match(m.text, /โอนเข้า: กสิกรไทย/);
    assert.match(m.text, /วันที่: 08\/10\/2569 12:40/);
    assert.match(m.text, /สรุป กสิกรไทย ปี 2569\nรับเงินแล้ว: 1 ครั้ง\nยอดรวม: 1,500\.00 บาท\nเทียบเกณฑ์: 1\/400 ครั้ง, 0\.00\/2 ล้านบาท/);
    assert.deepEqual(buttons(m), ['amt:1', 'bank:1', 'del:1', 'item:1', 'askful:1']);
    const slip = await db.getSlip(1);
    assert.equal(slip.date_source, 'slip');
    assert.equal(slip.sender_bank, '004');
    assert.equal(slip.trans_ref, '016281124012BPM01234');
    assert.ok(fs.existsSync(path.join(imageDir, slip.image_path)));
  });

  await t.test('ส่งสลิปซ้ำ: ไม่นับเพิ่ม', async () => {
    const replies = await photo('kplus');
    const [m] = replies;
    assert.equal(replies.length, 1); // ไม่ถามเรื่องสินค้าซ้ำ
    assert.match(m.text, /สลิปนี้บันทึกไปแล้ว ไม่นับเพิ่ม \(สลิป #1\)/);
    assert.equal((await service.bankSummary('004', 2026)).count, 1);
  });

  await t.test('สลิปต่างธนาคาร: นับเข้าธนาคารผู้รับ', async () => {
    const [m] = await photo('scb');
    assert.match(m.text, /ยอด: 25,000\.00 บาท/);
    assert.match(m.text, /โอนเข้า: กรุงเทพ/);
    assert.match(m.text, /\(ไทยพาณิชย์\)/);
    assert.match(m.text, /วันที่: 08\/10\/2569 09:15/);
    assert.match(m.text, /สรุป กรุงเทพ ปี 2569\nรับเงินแล้ว: 1 ครั้ง/);
  });

  await t.test('ถามว่าลูกค้าซื้ออะไร แล้วถามจัดส่งหรือนัดรับ', async () => {
    // ตอบกลับข้อความถามของสลิป #1
    const [askFul] = await text('เสื้อยืด 2 ตัว', OWNER, botMessage('สลิป #1 ลูกค้าซื้ออะไร พิมพ์ตอบกลับข้อความนี้ได้เลย'));
    assert.match(askFul.text, /สลิป #1 สินค้า: เสื้อยืด 2 ตัว\nจัดส่งหรือนัดรับ/);
    assert.deepEqual(buttons(askFul), ['ful:1:delivery', 'ful:1:pickup']);
    const [done] = await press('ful:1:delivery');
    assert.match(done.text, /บันทึกรายการของสลิป #1 แล้ว\nสินค้า: เสื้อยืด 2 ตัว\nการรับของ: จัดส่ง/);
    assert.deepEqual([(await db.getSlip(1)).item, (await db.getSlip(1)).fulfillment], ['เสื้อยืด 2 ตัว', 'delivery']);

    // พิมพ์เฉย ๆ โดยไม่กดตอบกลับ: เป็นสินค้าของสลิปล่าสุดที่ยังไม่ระบุ (#2)
    const [askFul2] = await text('กางเกง 1 ตัว');
    assert.match(askFul2.text, /สลิป #2 สินค้า: กางเกง 1 ตัว/);
    assert.match((await press('ful:2:pickup'))[0].text, /การรับของ: นัดรับ/);

    // ไม่มีสลิปที่รอระบุสินค้าแล้ว: ข้อความทั่วไปไม่ถูกบันทึกเป็นสินค้า
    assert.match((await text('สวัสดี'))[0].text, /ส่งรูปสลิปเข้ามาได้เลย/);
    assert.equal((await db.getSlip(2)).item, 'กางเกง 1 ตัว');

    // แก้สินค้าภายหลัง: การรับของมีอยู่แล้ว จึงไม่ถามซ้ำ
    assert.match((await press('item:1'))[0].text, /สลิป #1 ลูกค้าซื้ออะไร/);
    const [edited] = await text('เสื้อยืด 3 ตัว', OWNER, botMessage('สลิป #1 ลูกค้าซื้ออะไร พิมพ์ตอบกลับข้อความนี้ได้เลย'));
    assert.match(edited.text, /สินค้า: เสื้อยืด 3 ตัว\nการรับของ: จัดส่ง/);
    assert.deepEqual(buttons((await press('askful:1'))[0]), ['ful:1:delivery', 'ful:1:pickup']);
  });

  await t.test('รูปไม่มี QR: ไม่บันทึก', async () => {
    const [m] = await photo('no_qr');
    assert.match(m.text, /อ่าน QR บนสลิปไม่ได้/);
    assert.equal((await db.pool.query('SELECT count(*)::int n FROM slips')).rows[0].n, 2);
  });

  await t.test('ตั้งบัญชีรับเงิน', async () => {
    assert.match((await text('/addaccount กสิกร 123-4-56789-0 081-234-4455'))[0].text, /เพิ่มบัญชีแล้ว: 1\. กสิกรไทย 1234567890/);
    assert.match((await text('/addaccount bbl 1112055663'))[0].text, /กรุงเทพ 1112055663/);
    assert.match((await text('/addaccount ธนาคารมั่ว 123'))[0].text, /รูปแบบ/);
    const [m] = await text('/accounts');
    assert.match(m.text, /1\. กสิกรไทย 1234567890 พร้อมเพย์ 0812344455\n2\. กรุงเทพ 1112055663/);
  });

  await t.test('สลิปพร้อมเพย์: จับคู่จากเบอร์ที่ตั้งไว้', async () => {
    // ใส่ชื่อสินค้าเป็นคำบรรยายใต้รูป: ข้ามคำถามแรก ถามแค่จัดส่งหรือนัดรับ
    const [m, askFul] = await photo('ktb_en', OWNER, 'หมวก 3 ใบ');
    assert.match(m.text, /สินค้า: หมวก 3 ใบ/);
    assert.match(askFul.text, /สลิป #3 สินค้า: หมวก 3 ใบ\nจัดส่งหรือนัดรับ/);
    assert.match(m.text, /ยอด: 320\.50 บาท/);
    assert.match(m.text, /โอนเข้า: กสิกรไทย/);
    assert.match(m.text, /วันที่: 07\/10\/2569 18:05/);
    assert.match(m.text, /รับเงินแล้ว: 2 ครั้ง\nยอดรวม: 1,820\.50 บาท/);
    assert.equal((await db.getSlip(3)).receiver_account_id, 1);
  });

  await t.test('ระบุธนาคารไม่ได้: ถาม แล้วนับหลังเลือก', async () => {
    const [m] = await photo('unknown_bank');
    assert.match(m.text, /ยังไม่นับยอด \(สลิป #4\)/);
    assert.match(m.text, /ยอด: 750\.00 บาท/);
    assert.deepEqual(buttons(m), ['setbank:4:004', 'setbank:4:002']);
    assert.equal((await service.bankSummary('002', 2026)).count, 1); // ยังไม่ถูกนับ
    const [done, ask] = await press('setbank:4:002');
    assert.match(ask.text, /สลิป #4 ลูกค้าซื้ออะไร/); // ครบแล้วจึงถามเรื่องสินค้า
    assert.match(done.text, /✅ อัปเดตสลิปแล้ว \(สลิป #4\)/);
    assert.match(done.text, /สรุป กรุงเทพ ปี 2569\nรับเงินแล้ว: 2 ครั้ง\nยอดรวม: 25,750\.00 บาท/);
  });

  await t.test('แก้ยอดเงินด้วยการตอบกลับ', async () => {
    const [ask] = await press('amt:1');
    assert.match(ask.text, /พิมพ์ยอดเงินของสลิป #1/);
    assert.equal(ask.reply_markup.force_reply, true);
    const reply = botMessage(ask.text);
    assert.match((await text('พันห้า', OWNER, reply))[0].text, /ยอดเงินไม่ถูกต้อง/);
    const replies = await text('2,000', OWNER, reply);
    const [m] = replies;
    assert.equal(replies.length, 1); // สลิปที่นับไปแล้ว แก้ยอดอย่างเดียว ไม่ถามสินค้าซ้ำ
    assert.match(m.text, /ยอด: 2,000\.00 บาท/);
    assert.match(m.text, /รับเงินแล้ว: 2 ครั้ง\nยอดรวม: 2,320\.50 บาท/);
  });

  await t.test('/summary เรียงตามความใกล้เกณฑ์ และเตือนเมื่อใกล้ถึง', async () => {
    // เติมสลิปจำลองให้กรุงเทพใกล้เกณฑ์ 400 ครั้ง + 2 ล้านบาท
    await db.pool.query(
      `INSERT INTO slips (trans_ref, status, transferred_at, amount, receiver_bank, image_path, file_hash)
       SELECT 'SEED' || g, 'confirmed', '2026-03-01T10:00:00+07', 5500, '002', 'x', 'x' FROM generate_series(1, 340) g`,
    );
    const [m] = await text('/summary');
    assert.match(m.text, /^สรุป กรุงเทพ ปี 2569\nรับเงินแล้ว: 342 ครั้ง\nยอดรวม: 1,895,750\.00 บาท\nเทียบเกณฑ์: 342\/400 ครั้ง, 1\.90\/2 ล้านบาท\n⚠️ ใกล้ถึงเกณฑ์ส่งข้อมูลสรรพากร \(85% ของเกณฑ์ 400 ครั้งและ 2 ล้านบาท\)\n\nสรุป กสิกรไทย/);
    assert.doesNotMatch(m.text.split('\n\n')[1], /⚠️|🚨/);
  });

  await t.test('ลบสลิป: ถามยืนยันก่อน แล้วยอดลดลง', async () => {
    const [confirm] = await press('del:3');
    assert.deepEqual(buttons(confirm), ['delok:3', 'cancel']);
    assert.equal((await service.bankSummary('004', 2026)).count, 2);
    assert.match((await press('delok:3'))[0].text, /ลบสลิป #3 แล้ว/);
    assert.equal((await service.bankSummary('004', 2026)).count, 1);
    assert.equal(fs.readdirSync(path.join(imageDir, '2026')).length, 3);
  });

  await t.test('API สำหรับ dashboard', async () => {
    const api = createApi({ db, service, imageDir });
    // ข้อมูลทดสอบอยู่ในปี 2026 จึงระบุปีเสมอ (ถ้าไม่ระบุ API จะใช้ปีปัจจุบัน)
    const get = async (u) => (await api.inject({ method: 'GET', url: u.startsWith('/api/slips') ? `${u}${u.includes('?') ? '&' : '?'}year=2026` : u })).json();
    const summary = await get('/api/summary?year=2026');
    assert.equal(summary.total.count, 343);
    assert.equal(summary.total.amount, 1_897_750);
    assert.deepEqual(summary.banks.map((b) => [b.name, b.count, b.status]), [['กรุงเทพ', 342, 'near'], ['กสิกรไทย', 1, 'ok']]);
    assert.equal(summary.monthly[2].count, 340);
    assert.equal(summary.monthly[9].amount, 27_750);
    assert.equal(summary.senders[0].name, 'ไม่ทราบชื่อ');

    const oct = await get('/api/slips?from=2026-10-08&to=2026-10-08');
    assert.equal(oct.count, 2);
    assert.equal(oct.amount, 27_000);
    assert.equal((await get('/api/slips?bank=004')).count, 1);
    assert.equal((await get(`/api/slips?q=${encodeURIComponent('วิชัย')}`)).rows[0].amount, 25000);
    assert.equal((await api.inject({ url: '/api/slips?from=bad' })).statusCode, 400);
    assert.deepEqual((await get('/api/slips?fulfillment=delivery')).rows.map((r) => [r.id, r.item]), [[1, 'เสื้อยืด 3 ตัว']]);
    assert.equal((await get('/api/slips?fulfillment=pickup')).count, 1);
    assert.equal((await get('/api/slips?fulfillment=none')).count, 341);
    assert.equal((await get(`/api/slips?q=${encodeURIComponent('กางเกง')}`)).rows[0].id, 2);
    const order = await api.inject({ method: 'PATCH', url: '/api/slips/4', payload: { item: 'รองเท้า', fulfillment: 'pickup' } });
    assert.deepEqual([order.json().item, order.json().fulfillment], ['รองเท้า', 'pickup']);
    assert.equal((await api.inject({ method: 'PATCH', url: '/api/slips/4', payload: { fulfillment: 'drone' } })).statusCode, 400);

    const img = await api.inject({ url: '/api/slips/1/image' });
    assert.equal(img.statusCode, 200);
    assert.equal(img.headers['content-type'], 'image/png');

    const patched = await api.inject({ method: 'PATCH', url: '/api/slips/1', payload: { amount: 1500, sender_name: 'นาย สมชาย ใจดี' } });
    assert.equal(patched.json().amount, 1500);
    assert.equal((await api.inject({ method: 'PATCH', url: '/api/slips/1', payload: { amount: -5 } })).statusCode, 400);
    assert.equal((await api.inject({ method: 'PATCH', url: '/api/slips/1', payload: { amount: 0.001 } })).statusCode, 400);
    assert.equal((await api.inject({ method: 'PATCH', url: '/api/slips/1', payload: { receiver_bank: '999' } })).statusCode, 400);
    assert.equal((await api.inject({ method: 'DELETE', url: '/api/slips/4' })).json().deleted, 4);
    assert.equal((await api.inject({ url: '/api/slips/4' })).statusCode, 404);
    // ----- ที่มาของวันที่โอน -----
    assert.equal((await get('/api/slips?date_source=slip')).count, 342);
    assert.equal((await get('/api/slips?date_source=sent')).count, 0);
    // สลิปที่อ่านวันที่ไม่ได้: ใช้วันที่ส่ง / อ่านเดือนไม่ออก: ประมาณเดือน
    const png = fs.readFileSync(path.join(here, 'fixtures', 'no_qr.png'));
    const reader = (ref, ocr) => createService({
      db, imageDir, clock: () => new Date('2026-10-08T13:00:00+07:00'),
      readSlipQr: async () => ({ transRef: ref, sendingBank: '006' }), ocrSlip: async () => ocr,
    }).processSlip({ buffer: png });
    const noDate = await reader('NODATE1', 'จำนวนเงิน 100.00 บาท');
    const noMonth = await reader('NOMONTH1', 'จำนวนเงิน 200.00 บาท\nวันที่ทำรายการ 21 na. 2569 - 18:03');
    assert.deepEqual([noDate.slip.date_source, noDate.slip.transferred_at.toISOString()], ['sent', '2026-10-08T06:00:00.000Z']);
    assert.deepEqual([noMonth.slip.date_source, noMonth.slip.transferred_at.toISOString()], ['estimated', '2026-09-21T11:03:00.000Z']);
    assert.deepEqual((await get('/api/slips?date_source=sent')).rows.map((r) => r.trans_ref), ['NODATE1']);
    assert.deepEqual((await get('/api/slips?date_source=estimated')).rows.map((r) => [r.trans_ref, r.date_source]), [['NOMONTH1', 'estimated']]);
    // แก้วันที่เองใน dashboard: เปลี่ยนเป็น "แก้ไขเอง"
    const fixed = await api.inject({ method: 'PATCH', url: `/api/slips/${noDate.slip.id}`, payload: { transferred_at: '2026-10-01T09:30:00+07:00' } });
    assert.deepEqual([fixed.json().date_source, fixed.json().date_estimated], ['manual', false]);
    // แก้อย่างอื่นโดยไม่แตะวันที่: ที่มาของวันที่ไม่เปลี่ยน
    const kept = await api.inject({ method: 'PATCH', url: `/api/slips/${noMonth.slip.id}`, payload: { item: 'ปากกา' } });
    assert.equal(kept.json().date_source, 'estimated');
    await api.close();
  });

  await t.test('ตั้งยอดรวมปัจจุบัน: หักสลิปในระบบออก ที่เหลือเป็นยอดยกมา', async () => {
    const year = new Date().getUTCFullYear(); // คำสั่งใช้ปีปัจจุบัน
    await db.pool.query('DELETE FROM slips');
    await db.pool.query(
      `INSERT INTO slips (trans_ref, status, transferred_at, amount, receiver_bank, image_path, file_hash)
       SELECT 'NOW' || g, 'confirmed', now(), 1000.50, '004', 'x', 'x' FROM generate_series(1, 3) g`,
    );
    const [m] = await text('/settotal กสิกร 49 1,358,842.64');
    assert.match(m.text, /ตั้งยอดของกสิกรไทย ปี \d{4} แล้ว\nสลิปในระบบ: 3 ครั้ง 3,001\.50 บาท\nยอดยกมาก่อนเริ่มระบบ: 46 ครั้ง 1,355,841\.14 บาท/);
    assert.match(m.text, /รับเงินแล้ว: 49 ครั้ง\nยอดรวม: 1,358,842\.64 บาท\nเทียบเกณฑ์: 49\/400 ครั้ง, 1\.36\/2 ล้านบาท\n\(รวมยอดยกมาก่อนเริ่มระบบ 46 ครั้ง 1,355,841\.14 บาท\)/);
    // ธนาคารที่ยังไม่มีสลิปในระบบเลย
    assert.match((await text('/settotal กรุงไทย 290 924,488'))[0].text, /ยอดยกมาก่อนเริ่มระบบ: 290 ครั้ง 924,488\.00 บาท/);
    // สลิปใหม่บวกต่อจากยอดยกมา
    await db.pool.query(
      `INSERT INTO slips (trans_ref, status, transferred_at, amount, receiver_bank, image_path, file_hash)
       VALUES ('NOW4', 'confirmed', now(), 500, '004', 'x', 'x')`,
    );
    const kbank = await service.bankSummary('004', year);
    assert.deepEqual([kbank.count, kbank.amount, kbank.openingCount], [50, 1359342.64, 46]);
    // ตั้งซ้ำได้ และยอดรวมที่น้อยกว่าสลิปในระบบถูกปฏิเสธ
    assert.match((await text('/settotal กสิกร 60 2000000'))[0].text, /ยอดยกมาก่อนเริ่มระบบ: 56 ครั้ง 1,996,498\.50 บาท/);
    assert.match((await text('/settotal กสิกร 2 100'))[0].text, /ตั้งยอดไม่ได้/);
    assert.match((await text('/settotal กสิกร'))[0].text, /รูปแบบ: \/settotal/);
    assert.match((await text('/summary'))[0].text, /^สรุป กรุงไทย ปี \d{4}\nรับเงินแล้ว: 290 ครั้ง[\s\S]*สรุป กสิกรไทย/);

    // ----- ขึ้นปีใหม่: ทุกอย่างแยกตามปี ไม่ต้อง reset -----
    await db.pool.query(
      `INSERT INTO slips (trans_ref, status, transferred_at, amount, receiver_bank, image_path, file_hash)
       VALUES ('OLD1', 'confirmed', make_timestamptz($1, 12, 31, 23, 59, 0, 'Asia/Bangkok'), 7000, '004', 'x', 'x')`,
      [year - 1],
    );
    await db.setOpeningBalance(year - 2, '014', 10, 5000);
    assert.match((await text(`/summary ${year - 1 + 543}`))[0].text, new RegExp(`^สรุป กสิกรไทย ปี ${year - 1 + 543}\\nรับเงินแล้ว: 1 ครั้ง\\nยอดรวม: 7,000\\.00 บาท`));
    assert.match((await text(`/summary ${year + 1}`))[0].text, /ยังไม่มีสลิปที่บันทึก/);
    const api = createApi({ db, service, imageDir });
    const json = async (u) => (await api.inject({ url: u })).json();
    // ไม่ระบุปี = ปีปัจจุบัน สลิปของปีก่อนไม่ปน
    const now = await json('/api/summary');
    assert.deepEqual([now.year, now.banks.find((b) => b.bank === '004').count], [year, 60]);
    assert.deepEqual(now.years, [year, year - 1, year - 2]);
    assert.deepEqual([(await json('/api/slips')).count, (await json('/api/slips')).year], [4, year]);
    // ปีก่อนยังดูได้ครบ
    const last = await json(`/api/summary?year=${year - 1}`);
    assert.deepEqual(last.banks.map((b) => [b.name, b.count, b.amount, b.openingCount]), [['กสิกรไทย', 1, 7000, 0]]);
    assert.deepEqual((await json(`/api/slips?year=${year - 1}`)).rows.map((r) => r.trans_ref), ['OLD1']);
    assert.equal((await json(`/api/summary?year=${year - 2}`)).banks[0].openingCount, 10);
    assert.equal((await json('/api/slips?year=all')).count, 5);
    // กรองด้วยช่วงวันที่ข้ามปีได้โดยไม่ต้องเลือกปี
    assert.deepEqual([(await json(`/api/slips?from=${year - 1}-12-01`)).count, (await json(`/api/slips?from=${year - 1}-12-01`)).year], [5, 'all']);

    const summary = (await api.inject({ url: `/api/summary?year=${year}` })).json();
    assert.deepEqual(summary.banks.map((b) => [b.name, b.count, b.slipCount, b.openingCount]), [['กรุงไทย', 290, 0, 290], ['กสิกรไทย', 60, 4, 56]]);
    assert.deepEqual([summary.total.count, summary.total.slipCount, summary.total.openingCount], [350, 4, 346]);
    await api.close();
  });

  await t.test('สรุปประจำวันและประจำสัปดาห์', async () => {
    await db.pool.query('TRUNCATE slips, opening_balances, report_log');
    const add = (ref, day, bank, amount, fulfillment, status = 'confirmed') => db.pool.query(
      `INSERT INTO slips (trans_ref, status, transferred_at, created_at, amount, receiver_bank, fulfillment, image_path, file_hash)
       VALUES ($1, $6, $2::timestamptz, $2::timestamptz, $3, $4, $5, 'x', 'x')`,
      [ref, `${day}T15:00:00+07:00`, amount, bank, fulfillment, status],
    );
    await add('R1', '2026-10-08', '004', 1000, 'delivery');
    await add('R2', '2026-10-08', '004', 1000, 'pickup');
    await add('R3', '2026-10-08', '006', 500, null);
    await add('R4', '2026-10-05', '004', 2000, 'delivery');
    await add('R5', '2026-09-30', '004', 1750, 'delivery'); // สัปดาห์ก่อนหน้า
    await add('R6', '2026-10-08', null, 300, null, 'pending');

    assert.equal(await dailyReport({ db, service }, '2026-10-08'), [
      '📊 สรุปประจำวัน 8 ต.ค. 2569',
      'สลิปที่ส่งเข้า: 3 ใบ รวม 2,500.00 บาท',
      '• กสิกรไทย 2 ใบ 2,000.00 บาท',
      '• กรุงไทย 1 ใบ 500.00 บาท',
      'การรับของ: จัดส่ง 1, นัดรับ 1, ยังไม่ระบุ 1',
      '',
      '⏳ มีสลิปรอระบุธนาคารหรือยอดเงิน 1 ใบ (ยังไม่ถูกนับ)',
      '',
      'เทียบเกณฑ์สรรพากร ปี 2569',
      '• กสิกรไทย 0% (4/400 ครั้ง, 0.01/2 ล้านบาท)',
      '• กรุงไทย 0% (1/400 ครั้ง, 0.00/2 ล้านบาท)',
    ].join('\n'));
    assert.match(await dailyReport({ db, service }, '2026-10-07'), /^📊 สรุปประจำวัน 7 ต.ค. 2569\nวันนี้ไม่มีสลิปส่งเข้า\n/);

    const weekly = await weeklyReport({ db, service }, '2026-10-08');
    assert.match(weekly, /^📅 สรุปประจำสัปดาห์ 2 ต.ค. ถึง 8 ต.ค. 2569\nสลิปที่ส่งเข้า: 4 ใบ รวม 4,500.00 บาท\n• กสิกรไทย 3 ใบ 4,000.00 บาท\n• กรุงไทย 1 ใบ 500.00 บาท\nสัปดาห์ก่อนหน้า: 1 ใบ 1,750.00 บาท \(ยอดเงินเพิ่มขึ้น 157%\)\nการรับของ: จัดส่ง 2, นัดรับ 1, ยังไม่ระบุ 1\n/);
    assert.match(await weeklyReport({ db, service }, '2026-01-03'), /^📅 สรุปประจำสัปดาห์ 28 ธ.ค. 2568 ถึง 3 ม.ค. 2569\nสัปดาห์นี้ไม่มีสลิปส่งเข้า/);

    // ใกล้เกณฑ์: ขึ้นเครื่องหมายเตือนในสรุป
    await db.setOpeningBalance(2026, '006', 340, 1_900_000);
    assert.match(await dailyReport({ db, service }, '2026-10-08'), /⚠️ กรุงไทย 85% \(341\/400 ครั้ง, 1\.90\/2 ล้านบาท\) ใกล้ถึงเกณฑ์\n• กสิกรไทย 0%/);

    // ตัวตั้งเวลา: ส่งเมื่อถึงเวลา ไม่ส่งซ้ำ และส่งทั้งรายวันกับรายสัปดาห์ในวันอาทิตย์
    let now = new Date('2026-10-08T19:59:00+07:00');
    const out = [];
    const scheduler = startReportScheduler({
      db, service, recipients: [OWNER], clock: () => now, intervalMs: 3_600_000,
      send: async (id, body) => { out.push([id, body.split('\n')[0]]); },
      settings: { dailyAt: 20 * 60, weeklyAt: 20 * 60, weeklyDay: 0 },
    });
    await scheduler.ready;
    assert.deepEqual(out, []); // ยังไม่ถึงเวลา
    now = new Date('2026-10-08T20:00:20+07:00');
    await scheduler.tick();
    await scheduler.tick();
    assert.deepEqual(out, [[OWNER, '📊 สรุปประจำวัน 8 ต.ค. 2569']]);
    now = new Date('2026-10-11T23:30:00+07:00'); // วันอาทิตย์ bot เพิ่งกลับมาทำงานตอนดึก
    await scheduler.tick();
    await scheduler.tick();
    assert.deepEqual(out.slice(1), [[OWNER, '📊 สรุปประจำวัน 11 ต.ค. 2569'], [OWNER, '📅 สรุปประจำสัปดาห์ 5 ต.ค. ถึง 11 ต.ค. 2569']]);
    scheduler.stop();

    // ส่งไม่สำเร็จ: ไม่บันทึกว่าส่งแล้ว
    now = new Date('2026-10-12T20:00:00+07:00');
    const failing = startReportScheduler({
      db, service, recipients: [OWNER], clock: () => now, intervalMs: 3_600_000,
      send: async () => { throw new Error('network down'); },
      settings: { dailyAt: 20 * 60, weeklyAt: null, weeklyDay: 0 },
    });
    await failing.ready;
    failing.stop();
    assert.equal(await db.reportSent('daily', '2026-10-12'), false);
    assert.equal(await db.reportSent('daily', '2026-10-11'), true);

    assert.match((await text('/today'))[0].text, /^📊 สรุปประจำวัน/);
    assert.match((await text('/week'))[0].text, /^📅 สรุปประจำสัปดาห์/);
  });

  await closeOcr();
  await db.close();
  fs.rmSync(imageDir, { recursive: true, force: true });
});
