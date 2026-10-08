import test from 'node:test';
import assert from 'node:assert/strict';
import { guessDateTime, parseSlipText, parseAmount, parseDateTime, findMaskedIds, matchAccount, detectReceiver, parseNames, resolveBank, findBankMentions } from '../src/slip/parse.js';
import { parseSlipPayload, crc16 } from '../src/slip/qr.js';
import { evaluate } from '../src/thresholds.js';
import { parseAmountInput } from '../src/bot.js';
import { dueReports } from '../src/reports.js';
import { parseTime, parseDay } from '../src/config.js';

const NOW = new Date('2026-10-08T13:00:00+07:00');
const iso = (d) => d && new Date(d.getTime() + 7 * 3600_000).toISOString().slice(0, 16);

test('ยอดเงิน: ป้ายอยู่บรรทัดก่อนหน้า และไม่หยิบค่าธรรมเนียม', () => {
  assert.equal(parseAmount('จํานวน:\n1,500.00 un\nค่าธรรมเนียม:\n0.00 บาท'), 1500);
  assert.equal(parseAmount('จ้านวนเงิน\n25,000.00\nค่าธรรมเนียม 0.00'), 25000);
  assert.equal(parseAmount('Amount 320.50 THB\nFee 0.00 THB'), 320.5);
  assert.equal(parseAmount('ค่าธรรมเนียม 10.00\nยอดเงินคงเหลือ 99,999.99\n1,234,567.89 บาท'), 1234567.89);
});

test('ยอดเงิน: ไม่สับสนกับเวลา วันที่ และเลขอ้างอิง', () => {
  assert.equal(parseAmount('8 ต.ค. 69 12.40 น.\n016281124012BPM01234\n08.10.2569'), null);
  assert.equal(parseAmount('โอนเงินสำเร็จ'), null);
});

test('ยอดเงิน: OCR แทรกช่องว่างหรืออ่านจุลภาคเพี้ยน (สลิปจริงที่ถูก Telegram บีบอัด)', () => {
  assert.equal(parseAmount('จํานวนเงิน 97 300.00 บาท\nค่าธรรมเนียม 0.00 บาท'), 97300);
  assert.equal(parseAmount('97, 300.00 บาท'), 97300);
  assert.equal(parseAmount('Ru 97.300.00 บาท\nค่าธรรมเนียม 0.00 บาท'), 97300);
  assert.equal(parseAmount('ขํานวนเงิน 1 234 567.00 un'), 1234567);
  assert.equal(parseAmount('อํานวนเงิน 97,300.00 บาท\n1,000,000.00'), 97300); // ป้ายที่ตัวแรกเพี้ยนยังนับเป็นป้ายยอดเงิน
  assert.equal(parseAmount('วันที่ 21 ก.ย. 2569 300.00'), 300); // ปี 4 หลักไม่ถูกรวมเข้ากับยอด
});

test('วันเวลา: เดือนย่อที่อ่านเพี้ยน', () => {
  for (const month of ['ก.ย.', 'ก.ุย.', 'กุย.', 'ทก.ย.', 'กท.ย.']) {
    assert.equal(iso(parseDateTime(`วันที่ทํารายการ 21 ${month} 2569 - 18:03`, NOW)), '2026-09-21T18:03', month);
  }
  assert.equal(parseDateTime('21 กฮ. 2569 - 18:03', NOW), null); // ใกล้เคียงหลายเดือน ไม่เดา
  // อ่านเดือนไม่ออกเลย: ประมาณเป็นเดือนล่าสุดที่วันนั้นผ่านมาแล้ว
  assert.equal(parseDateTime('21 na. 2569 - 18:03', NOW), null);
  assert.equal(iso(guessDateTime('วันที่ทํารายการ 21 na. 2569 - 18:03', NOW)), '2026-09-21T18:03');
  assert.equal(iso(guessDateTime('3 na. 2569 - 09:00', NOW)), '2026-10-03T09:00');
  assert.equal(iso(guessDateTime('21 na. 2569 - 18:03', new Date('2026-09-10T12:00:00+07:00'))), '2026-08-21T18:03');
  const parsed = parseSlipText('จํานวนเงิน 500.00 บาท\n21 na. 2569 - 18:03', { now: NOW });
  assert.deepEqual([iso(parsed.transferredAt), parsed.dateGuessed], ['2026-09-21T18:03', true]);
});

test('วันเวลา: ปี พ.ศ. แบบ 2 หลักและ 4 หลัก', () => {
  assert.equal(iso(parseDateTime('8 ต.ค. 69 12:40 น.', NOW)), '2026-10-08T12:40');
  assert.equal(iso(parseDateTime('08 ต.ค. 2569 - 09:15', NOW)), '2026-10-08T09:15');
  assert.equal(iso(parseDateTime('6 ต.ุค. 69 08:01 wu.', NOW)), '2026-10-06T08:01'); // OCR แทรกสระ
  assert.equal(iso(parseDateTime('วันที่ 1 ตุลาคม 2569 เวลา 07:30:15', NOW)), '2026-10-01T07:30');
  assert.equal(iso(parseDateTime('5 ก.ย. 69 12.40 น.', NOW)), '2026-09-05T12:40');
});

test('วันเวลา: แยก ม.ค. / มี.ค. / มิ.ย. / เม.ย. ได้', () => {
  assert.equal(iso(parseDateTime('15 ม.ค. 69 10:00', NOW)), '2026-01-15T10:00');
  assert.equal(iso(parseDateTime('15 มี.ค. 69 10:00', NOW)), '2026-03-15T10:00');
  assert.equal(iso(parseDateTime('15 มิ.ย. 69 10:00', NOW)), '2026-06-15T10:00');
  assert.equal(iso(parseDateTime('15 เม.ย. 69 10:00', NOW)), '2026-04-15T10:00');
});

test('วันเวลา: ภาษาอังกฤษ ตัวเลขล้วน และค่าที่เป็นไปไม่ได้', () => {
  assert.equal(iso(parseDateTime('Date 07 Oct 2026 - 18:05', NOW)), '2026-10-07T18:05');
  assert.equal(iso(parseDateTime('7 Oct 26, 18:05', NOW)), '2026-10-07T18:05');
  assert.equal(iso(parseDateTime('07/10/2569 18:05:44', NOW)), '2026-10-07T18:05');
  assert.equal(iso(parseDateTime('07/10/69 18:05', NOW)), '2026-10-07T18:05');
  assert.equal(iso(parseDateTime('07/10/26 18:05', NOW)), '2026-10-07T18:05');
  assert.equal(parseDateTime('31 ก.พ. 69 10:00', NOW), null);
  assert.equal(parseDateTime('9 ต.ค. 70 10:00', NOW), null); // อนาคต
  assert.equal(parseDateTime('ไม่มีวันที่', NOW), null);
});

const accounts = [
  { id: 1, bank_code: '004', identifiers: ['1234567890', '0812344455'] },
  { id: 2, bank_code: '002', identifiers: ['1112055663'] },
];

test('เลขบัญชีที่ปิดบางหลัก: จับคู่กับบัญชีที่ตั้งไว้', () => {
  assert.deepEqual(findMaskedIds('XXX-X-X6789-x\n016281124012BPM01234').map((m) => m.value), ['xxxxx6789x']);
  assert.equal(matchAccount('xxx-x-x4321-x\nXXX-X-X6789-x', accounts).id, 1);
  assert.equal(matchAccount('XXX-XXX123-4\nXXX-X-X5566-X', accounts).id, 2);
  assert.equal(matchAccount('PromptPay\nxxx-xxx-4455', accounts).id, 1);
  assert.equal(matchAccount('xxx-x-x0000-x', accounts), null);
});

test('ธนาคารผู้รับ: ลำดับความมั่นใจ', () => {
  const kplus = 'นาย ก\nธ.กสิกรไทย\nxxx-x-x4321-x\nนาง ข\nธ.กสิกรไทย\nxxx-x-x0000-x';
  // ไม่มีบัญชีที่ตั้งไว้: ชื่อธนาคารผู้โอนขึ้นสองครั้ง = โอนธนาคารเดียวกัน
  assert.deepEqual(detectReceiver(kplus, [], '004'), { bank: '004', accountId: null, by: 'name' });
  // ต่างธนาคาร: เลือกธนาคารที่ไม่ใช่ของผู้โอน
  assert.equal(detectReceiver('จาก นาย ก\nไปยัง นาง ข\nธนาคารกรุงเทพ', [], '014').bank, '002');
  // ชื่อธนาคารขึ้นครั้งเดียวและเป็นของผู้โอน: ไม่เดา
  assert.equal(detectReceiver('นาย ก\nธ.กสิกรไทย\nนาง ข', [], '004'), null);
  // พร้อมเพย์และเลขไม่ตรงบัญชีไหน: ไม่เดา
  assert.equal(detectReceiver('Krungthai NEXT\nKrungthai Bank\nPromptPay\nxxx-xxx-9999', accounts, '006'), null);
  // ชื่อแอปบนหัวสลิปไม่นับเป็นชื่อธนาคาร
  assert.deepEqual(findBankMentions('Krungthai NEXT\nK PLUS\nSCB EASY').length, 0);
  // ธนาคารที่อ่านได้ไม่อยู่ในบัญชีที่ตั้งไว้: ไม่เดา
  assert.equal(detectReceiver('ธนาคารออมสิน', accounts, '014'), null);
  // ตั้งไว้บัญชีเดียว: ใช้บัญชีนั้น
  assert.equal(detectReceiver('อ่านอะไรไม่ออก', [accounts[1]], '004').bank, '002');
  // เลขบัญชีตรง ชนะทุกอย่าง
  assert.deepEqual(detectReceiver(`${kplus}\nXXX-X-X5566-X`, accounts, '004'), { bank: '002', accountId: 2, by: 'account' });
});

test('ชื่อผู้โอนและผู้รับ', () => {
  assert.deepEqual(parseNames('โอนเงินสำเร็จ\nนาย สมชาย ใจดี\nธ.กสิกรไทย\nนาง สมหญิง รักไทย'), { sender: 'นาย สมชาย ใจดี', receiver: 'นาง สมหญิง รักไทย' });
  assert.deepEqual(parseNames('From MS. PIMCHANOK S.\nTo    MRS. SOMYING R.'), { sender: 'MS. PIMCHANOK S.', receiver: 'MRS. SOMYING R.' });
  assert.equal(parseNames('จาก นางสาว ใจดี มีสุข').sender, 'นางสาว ใจดี มีสุข');
  // สลิปแบบ "จาก / ไปยัง" คนละบรรทัดกับชื่อ และชื่อผู้โอนถูกปิดบางส่วน
  assert.deepEqual(
    parseNames('© จาก\nน.ส.สมศรี จ"***\nกรุงไทย\nXXX-X-XX038-0\n๑ ไปยัง\nนาย สมชาย ใจดี\nกรุงศรี\nXXX-X-XX770-8'),
    { sender: 'น.ส.สมศรี จ***', receiver: 'นาย สมชาย ใจดี' },
  );
  // อ่านชื่อผู้โอนไม่ออก: ชื่อหลัง "ไปยัง" ต้องไม่ถูกนับเป็นผู้โอน
  assert.deepEqual(parseNames('รหัสอ้างอิง Ac80\n๑ ไปยัง\nนาย สมชาย ใจดี\nกรุงศรี'), { sender: null, receiver: 'นาย สมชาย ใจดี' });
  assert.deepEqual(parseNames('จาก Op Lp ย\n7 uanduwsd***\nกรุงไทย\nไปยัง\nug สมชาย ใจดี'), { sender: null, receiver: 'สมชาย ใจดี' });
});

test('ชื่อธนาคารที่ผู้ใช้พิมพ์', () => {
  assert.equal(resolveBank('กสิกร'), '004');
  assert.equal(resolveBank('SCB'), '014');
  assert.equal(resolveBank('กรุงเทพ'), '002');
  assert.equal(resolveBank('ออมสิน'), '030');
  assert.equal(resolveBank('006'), '006');
  assert.equal(resolveBank('ธนาคารอะไรไม่รู้'), null);
});

test('QR ของสลิป', () => {
  const body = '0041000600000101030040220016281124012BPM012345102TH9104';
  const parsed = parseSlipPayload(body + crc16(body));
  assert.deepEqual({ ...parsed, payload: undefined }, { payload: undefined, sendingBank: '004', transRef: '016281124012BPM01234', crcOk: true });
  assert.equal(parseSlipPayload('https://example.com'), null);
  assert.equal(parseSlipPayload('00020101021129370016A000000677010111'), null); // QR พร้อมเพย์สำหรับจ่ายเงิน ไม่ใช่สลิป
});

test('เกณฑ์สรรพากร', () => {
  assert.equal(evaluate(127, 385_200).status, 'ok');
  assert.equal(evaluate(390, 100_000).status, 'ok');        // ครั้งใกล้ครบแต่ยอดยังห่าง
  assert.equal(evaluate(100, 5_000_000).status, 'ok');      // ยอดเกินแต่ครั้งยังห่าง
  assert.equal(evaluate(320, 1_600_000).status, 'near');    // 80% ทั้งคู่
  assert.equal(evaluate(400, 2_000_000).status, 'reached');
  assert.equal(evaluate(399, 2_500_000).status, 'near');
  assert.equal(evaluate(2400, 50_000).status, 'near');      // เกณฑ์ 3,000 ครั้ง
  assert.equal(evaluate(3000, 1).status, 'reached');
});

test('ยอดเงินที่ผู้ใช้พิมพ์', () => {
  assert.equal(parseAmountInput('1,500.50'), 1500.5);
  assert.equal(parseAmountInput('2000 บาท'), 2000);
  assert.equal(parseAmountInput('0'), null);
  assert.equal(parseAmountInput('พันห้า'), null);
  assert.equal(parseAmountInput('1.234'), null);
});

test('เวลาส่งสรุป', () => {
  assert.equal(parseTime('20:00'), 1200);
  assert.equal(parseTime('7:05'), 425);
  assert.equal(parseTime('off'), null);
  assert.equal(parseTime('25:00'), null);
  assert.deepEqual(['sun', 'Monday', '6', 'อะไร'].map(parseDay), [0, 1, 6, 0]);

  const settings = { dailyAt: 1200, weeklyAt: 1200, weeklyDay: 0 };
  const at = (iso) => dueReports(new Date(iso), settings).map((r) => `${r.kind}:${r.period}`);
  assert.deepEqual(at('2026-10-08T19:59:59+07:00'), []);
  assert.deepEqual(at('2026-10-08T20:00:00+07:00'), ['daily:2026-10-08']);
  assert.deepEqual(at('2026-10-11T20:00:00+07:00'), ['daily:2026-10-11', 'weekly:2026-10-11']); // วันอาทิตย์
  assert.deepEqual(at('2026-10-11T16:30:00Z'), ['daily:2026-10-11', 'weekly:2026-10-11']);      // 23:30 เวลาไทย
  assert.deepEqual(at('2026-10-11T17:30:00Z'), []);                                             // 00:30 วันจันทร์ เวลาไทย
  assert.deepEqual(dueReports(new Date('2026-10-11T21:00:00+07:00'), { dailyAt: null, weeklyAt: null, weeklyDay: 0 }), []);
});
