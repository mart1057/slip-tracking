// ข้อความตอบกลับของ bot
import { bankName } from './banks.js';
import { RULES } from './thresholds.js';
import { formatBaht, formatThai } from './time.js';

export const FULFILLMENT = { delivery: 'จัดส่ง', pickup: 'นัดรับ' };

const DATE_NOTE = {
  sent: ' (อ่านวันที่ในสลิปไม่ได้ ใช้วันที่ส่งสลิป)',
  estimated: ' (อ่านเดือนในสลิปไม่ชัด เป็นค่าประมาณ ตรวจอีกครั้ง)',
};

const millions = (n) => (n / 1_000_000).toFixed(2);
const count = (n) => n.toLocaleString('en-US');

export function summaryBlock(s) {
  const lines = [
    `สรุป ${bankName(s.bank)} ปี ${s.year + 543}`,
    `รับเงินแล้ว: ${count(s.count)} ครั้ง`,
    `ยอดรวม: ${formatBaht(s.amount)} บาท`,
    `เทียบเกณฑ์: ${count(s.count)}/${RULES.comboCount} ครั้ง, ${millions(s.amount)}/2 ล้านบาท`,
  ];
  if (s.openingCount || s.openingAmount) {
    lines.push(`(รวมยอดยกมาก่อนเริ่มระบบ ${count(s.openingCount)} ครั้ง ${formatBaht(s.openingAmount)} บาท)`);
  }
  if (s.status === 'reached') {
    lines.push('🚨 ถึงเกณฑ์ที่ธนาคารต้องส่งข้อมูลให้สรรพากรแล้ว');
  } else if (s.status === 'near') {
    const which = s.countOnly > s.combo
      ? `${count(s.count)}/${count(RULES.countOnly)} ครั้ง`
      : `${Math.floor(s.combo * 100)}% ของเกณฑ์ 400 ครั้งและ 2 ล้านบาท`;
    lines.push(`⚠️ ใกล้ถึงเกณฑ์ส่งข้อมูลสรรพากร (${which})`);
  }
  return lines.join('\n');
}

function slipLines(slip) {
  const lines = [];
  lines.push(`ยอด: ${slip.amount ? `${formatBaht(slip.amount)} บาท` : 'อ่านไม่ได้'}`);
  lines.push(`โอนเข้า: ${slip.receiver_bank ? bankName(slip.receiver_bank) : 'ยังไม่ระบุ'}`);
  const from = [slip.sender_name || 'อ่านชื่อไม่ได้', slip.sender_bank && `(${bankName(slip.sender_bank)})`].filter(Boolean).join(' ');
  lines.push(`จาก: ${from}`);
  lines.push(`วันที่: ${formatThai(slip.transferred_at)}${DATE_NOTE[slip.date_source] || ''}`);
  if (slip.item) lines.push(`สินค้า: ${slip.item}`);
  if (slip.fulfillment) lines.push(`การรับของ: ${FULFILLMENT[slip.fulfillment]}`);
  return lines;
}

export function savedMessage({ slip, summary, amountAlt }, title = 'บันทึกสลิปแล้ว') {
  const lines = [`✅ ${title} (สลิป #${slip.id})`, ...slipLines(slip)];
  if (amountAlt) {
    lines.push(`⚠️ อ่านยอดเงินได้สองค่า คือ ${formatBaht(slip.amount)} และ ${formatBaht(amountAlt)} ตรวจกับสลิป ถ้าไม่ถูกให้กด "แก้ยอดเงิน"`);
  }
  return [...lines, '', summaryBlock(summary)].join('\n');
}

export function duplicateMessage(slip) {
  return [`♻️ สลิปนี้บันทึกไปแล้ว ไม่นับเพิ่ม (สลิป #${slip.id})`, ...slipLines(slip)].join('\n');
}

export function pendingMessage({ slip, missing }) {
  const ask = missing[0] === 'bank'
    ? 'ระบุธนาคารที่รับเงินไม่ได้ เลือกธนาคารด้านล่าง'
    : 'อ่านยอดเงินไม่ได้';
  return [`📝 รับสลิปแล้ว ยังไม่นับยอด (สลิป #${slip.id})`, ...slipLines(slip), '', ask].join('\n');
}

export const askAmountMessage = (id) => `พิมพ์ยอดเงินของสลิป #${id} โดยตอบกลับข้อความนี้ เช่น 1500 หรือ 1,500.50`;

export function totalSetMessage(s) {
  return [
    `✅ ตั้งยอดของ${bankName(s.bank)} ปี ${s.year + 543} แล้ว`,
    `สลิปในระบบ: ${count(s.slipCount)} ครั้ง ${formatBaht(s.slipAmount)} บาท`,
    `ยอดยกมาก่อนเริ่มระบบ: ${count(s.openingCount)} ครั้ง ${formatBaht(s.openingAmount)} บาท`,
    '',
    summaryBlock(s),
  ].join('\n');
}

export function totalTooLowMessage(s) {
  return [
    `ตั้งยอดไม่ได้ เพราะสลิปของ${bankName(s.bank)}ในระบบมีมากกว่ายอดรวมที่ใส่มา`,
    `สลิปในระบบตอนนี้: ${count(s.slipCount)} ครั้ง ${formatBaht(s.slipAmount)} บาท`,
    'ใส่ยอดรวมของทั้งปีจนถึงตอนนี้ ซึ่งต้องรวมสลิปที่อยู่ในระบบแล้ว',
  ].join('\n');
}

export const askItemMessage = (id) => `สลิป #${id} ลูกค้าซื้ออะไร พิมพ์ตอบกลับข้อความนี้ได้เลย`;

export const askFulfillmentMessage = (slip) => `สลิป #${slip.id} สินค้า: ${slip.item}\nจัดส่งหรือนัดรับ`;

export const orderDoneMessage = (slip) =>
  [`✅ บันทึกรายการของสลิป #${slip.id} แล้ว`, `สินค้า: ${slip.item || 'ยังไม่ระบุ'}`, `การรับของ: ${FULFILLMENT[slip.fulfillment]}`].join('\n');

export const UNREADABLE = [
  '❌ อ่าน QR บนสลิปไม่ได้ จึงยังไม่บันทึก',
  'ส่งใหม่โดยให้เห็นสลิปเต็มใบรวม QR ถ้ายังไม่ได้ ลองส่งแบบไฟล์ (ไม่บีบอัด)',
].join('\n');

export const HELP = [
  'ส่งรูปสลิปโอนเงินเข้ามาได้เลย ระบบจะบันทึกและสรุปยอดของธนาคารที่รับเงิน',
  'จากนั้นจะถามว่าลูกค้าซื้ออะไร และจัดส่งหรือนัดรับ (พิมพ์ชื่อสินค้าเป็นคำบรรยายใต้รูปตอนส่งสลิปก็ได้)',
  '',
  'คำสั่ง',
  '/summary  สรุปทุกธนาคารของปีนี้ (ดูปีก่อนได้ เช่น /summary 2569)',
  '/today  สรุปของวันนี้',
  '/week  สรุป 7 วันล่าสุด',
  '/settotal <ธนาคาร> <จำนวนครั้ง> <ยอดรวม>  ตั้งยอดรวมของปีนี้จนถึงตอนนี้ (รวมเงินเข้าก่อนเริ่มใช้ระบบ)',
  '/accounts  ดูบัญชีรับเงินที่ตั้งไว้',
  '/addaccount <ธนาคาร> <เลขบัญชี> [เบอร์หรือเลขพร้อมเพย์]  เพิ่มบัญชีรับเงิน',
  '/delaccount <หมายเลข>  ลบบัญชีรับเงิน',
  '/last  ดูสลิปล่าสุด',
  '/id  ดู Telegram ID ของคุณ',
  '',
  'ตัวอย่าง: /addaccount กสิกร 123-4-56789-0 0812345678',
  'ตัวอย่าง: /settotal กสิกร 49 1358842.64',
].join('\n');
