// แปลงข้อความ OCR ของสลิปเป็นข้อมูล: ยอดเงิน วันเวลา ธนาคารผู้รับ ชื่อผู้โอน
// OCR ภาษาไทยอ่านสระและวรรณยุกต์เพี้ยนบ่อย จึงเทียบคำแบบตัดเครื่องหมายเหล่านั้นออกก่อน
import { BANKS } from '../banks.js';

const MARKS = /[ัิ-ฺ็-๎]/g;

/** ตัดสระบน-ล่าง วรรณยุกต์ และแปลงสระอำเป็นอา เพื่อเทียบคำแบบทนต่อ OCR เพี้ยน */
export function skeleton(s) {
  return s.normalize('NFC').replace(/ำ/g, 'า').replace(MARKS, '').toLowerCase();
}

const toLines = (text) => text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

// ---------- ยอดเงิน ----------
// OCR มักแทรกช่องว่างหรืออ่านจุลภาคหาย เช่น "97 300.00", "97, 300.00", "97.300.00" จึงยอมให้ตัวคั่นหลักพันเป็น , . หรือช่องว่าง
const MONEY = /(?<![\d.,/:])(\d{1,3}(?:(?: ?[,.] ?| )\d{3})+|\d+)[.,](\d{2})(?![\d/:]|[.,]\d|\s*น\.)/g;
const LABELS = [
  ['fee', /คาธรรมเนยม|\bfee\b/],
  ['balance', /คงเหลอ|balance|ใชได/],
  ['amount', /[ก-ฮ]านวน|ยอดเงน|ยอดโอน|\bamount\b/],
];

function labelOf(line) {
  const s = skeleton(line);
  for (const [kind, re] of LABELS) if (re.test(s)) return kind;
  return null;
}

export function parseAmount(text) {
  const lines = toLines(text);
  const found = [];
  lines.forEach((line, i) => {
    const matches = [...line.matchAll(MONEY)];
    if (!matches.length) return;
    let label = labelOf(line);
    // ป้ายกำกับมักอยู่บรรทัดก่อนหน้า เช่น "จำนวน:" แล้วตัวเลขอยู่บรรทัดถัดไป
    if (!label && i > 0 && ![...lines[i - 1].matchAll(MONEY)].length) label = labelOf(lines[i - 1]);
    for (const m of matches) {
      const value = Number(`${m[1].replace(/[., ]/g, '')}.${m[2]}`);
      if (value > 0 || label === 'fee') found.push({ value, label });
    }
  });
  const labelled = found.find((f) => f.label === 'amount' && f.value > 0);
  if (labelled) return labelled.value;
  const rest = found.filter((f) => !f.label && f.value > 0).map((f) => f.value);
  return rest.length ? Math.max(...rest) : null;
}

// ---------- วันเวลา ----------
const M = '[ัิ-ฺ็-๎]*';
const loose = (word) => [...word].join(M); // ยอมให้มีสระ/วรรณยุกต์แทรกระหว่างตัวอักษร
const TH_MONTHS = [
  [`ม${M}กราคม|ม\\.?\\s?ค`, 1], [`${loose('กมภาพนธ')}|ก\\.?\\s?พ`, 2],
  [`${loose('มนาคม')}|ม[ิ-ื]\\.?\\s?ค`, 3], [`${loose('เมษายน')}|เม\\.?\\s?ย`, 4],
  [`${loose('พฤษภาคม')}|พ\\.?\\s?ค`, 5], [`${loose('มถนายน')}|ม[ิ-ื]\\.?\\s?ย`, 6],
  [`${loose('กรกฎาคม')}|ก\\.?\\s?ค`, 7], [`${loose('สงหาคม')}|ส\\.?\\s?ค`, 8],
  [`${loose('กนยายน')}|ก\\.?\\s?ย`, 9], [`${loose('ตลาคม')}|ต\\.?\\s?ค`, 10],
  [`${loose('พฤศจกายน')}|พ\\.?\\s?ย`, 11], [`${loose('ธนวาคม')}|ธ\\.?\\s?ค`, 12],
];
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// เวลาแบบ 12:40 หรือ 12:40:05 และแบบ "12.40 น."
const TIME = /(?<![\d:.,])([01]?\d|2[0-3])(?::([0-5]\d)(?::([0-5]\d))?(?!\d)|\.([0-5]\d)(?=\s*น\.))/;

// เดือนย่อ ม.ค. / มี.ค. / มิ.ย. ต่างกันที่สระบน จึงตัดเฉพาะเครื่องหมายที่ไม่ใช่สระอิ-อือออก
const dateClean = (text) => text.normalize('NFC').replace(/[ัุ-ฺ็-๎]/g, '');

const MONTH_ABBR = ['มค', 'กพ', 'มีค', 'เมย', 'พค', 'มิย', 'กค', 'สค', 'กย', 'ตค', 'พย', 'ธค'];

function editDistance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return row[b.length];
}

/** จับคู่เดือนย่อที่เพี้ยนไม่เกิน 1 ตัวอักษร คืน null ถ้าใกล้เคียงมากกว่าหนึ่งเดือน */
function fuzzyThaiMonth(token) {
  const letters = token.replace(/[^ก-ฮเ\u0E34-\u0E37]/g, '');
  if (letters.length < 2 || letters.length > 4) return null;
  const scored = MONTH_ABBR.map((abbr, i) => ({ month: i + 1, d: editDistance(letters, abbr) })).sort((a, b) => a.d - b.d);
  return scored[0].d <= 1 && scored[1].d > scored[0].d ? scored[0].month : null;
}

function bangkokDate(y, mo, d, h, mi, s) {
  const pad = (n) => String(n).padStart(2, '0');
  const date = new Date(`${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}+07:00`);
  // กันวันที่ที่ไม่มีจริง เช่น 31 ก.พ.
  const check = new Date(date.getTime() + 7 * 3600_000);
  return check.getUTCDate() === d && check.getUTCMonth() + 1 === mo ? date : null;
}

function yearCandidates(raw, kind) {
  const n = Number(raw);
  if (raw.length === 4) return [n >= 2400 ? n - 543 : n];
  const be = 2500 + n - 543;
  const ce = 2000 + n;
  if (kind === 'th') return [be, ce];
  if (kind === 'en') return [ce, be];
  return [be, ce];
}

export function parseDateTime(text, now = new Date()) {
  const clean = dateClean(text);
  const hits = [];
  for (const [src, month] of TH_MONTHS) {
    const re = new RegExp(`(?<!\\d)(\\d{1,2})\\s*(?:${src})[.\\s]*((?:25|20)\\d{2}|\\d{2})(?!\\d)`, 'g');
    for (const m of clean.matchAll(re)) hits.push({ index: m.index, end: m.index + m[0].length, d: +m[1], mo: month, y: m[2], kind: 'th' });
  }
  const en = new RegExp(`(?<!\\d)(\\d{1,2})\\s*(${EN_MONTHS.join('|')})[a-z]*[.,\\s]*((?:25|20)\\d{2}|\\d{2})(?!\\d)`, 'gi');
  for (const m of clean.matchAll(en)) hits.push({ index: m.index, end: m.index + m[0].length, d: +m[1], mo: EN_MONTHS.indexOf(m[2].toLowerCase()) + 1, y: m[3], kind: 'en' });
  for (const m of clean.matchAll(/(?<![\d/-])(\d{1,2})[/-](\d{1,2})[/-]((?:25|20)\d{2}|\d{2})(?![\d/-])/g)) {
    hits.push({ index: m.index, end: m.index + m[0].length, d: +m[1], mo: +m[2], y: m[3], kind: 'num' });
  }
  // เดือนย่อที่ OCR อ่านเพี้ยนเล็กน้อย เช่น "ทก.ย." หรือ "กท.ย." ใช้เมื่อมีปี 4 หลักตามหลังเท่านั้น
  for (const m of clean.matchAll(/(?<!\d)(\d{1,2})\s*([ก-ฮเ\u0E34-\u0E37][ก-ฮ.\u0E34-\u0E37 ]{1,7}?)\s*(25\d{2})(?!\d)/g)) {
    const month = fuzzyThaiMonth(m[2]);
    if (month) hits.push({ index: m.index, end: m.index + m[0].length, d: +m[1], mo: month, y: m[3], kind: 'th' });
  }
  hits.sort((a, b) => a.index - b.index);

  const earliest = now.getTime() - 3 * 365 * 86400_000;
  const latest = now.getTime() + 2 * 86400_000;
  for (const hit of hits) {
    if (hit.mo < 1 || hit.mo > 12 || hit.d < 1 || hit.d > 31) continue;
    // เวลามักอยู่ต่อจากวันที่ ถ้าไม่เจอให้ใช้เวลาแรกที่พบในสลิป
    const after = clean.slice(hit.end, hit.end + 24).match(TIME);
    const t = after || clean.match(TIME);
    const [h, mi, s] = t ? [+t[1], +(t[2] || t[4]), +(t[3] || 0)] : [12, 0, 0];
    for (const y of yearCandidates(hit.y, hit.kind)) {
      const date = bangkokDate(y, hit.mo, hit.d, h, mi, s);
      if (date && date.getTime() >= earliest && date.getTime() <= latest) return date;
    }
  }
  return null;
}

/**
 * อ่านเดือนไม่ออกแต่ได้วัน ปี และเวลา เช่น "21 na. 2569 - 18:03"
 * สลิปมักถูกส่งหลังโอนไม่นาน จึงเลือกเดือนล่าสุดที่วันนั้นยังไม่เกินปัจจุบัน ผลลัพธ์นี้เป็นค่าประมาณ
 */
export function guessDateTime(text, now = new Date()) {
  const m = dateClean(text).match(/(?<!\d)(\d{1,2})\s*[^\d\n]{1,10}?\s*(25\d{2})\s*[-,]?\s*([01]?\d|2[0-3]):([0-5]\d)(?!\d)/);
  if (!m) return null;
  const year = +m[2] - 543;
  for (let month = 12; month >= 1; month--) {
    const date = bangkokDate(year, month, +m[1], +m[3], +m[4], 0);
    if (date && date.getTime() <= now.getTime() + 2 * 86400_000) {
      return date.getTime() >= now.getTime() - 3 * 365 * 86400_000 ? date : null;
    }
  }
  return null;
}

// ---------- เลขบัญชี/พร้อมเพย์ที่ถูกปิดบางหลัก ----------
const MASK_RUN = /[0-9xX×*•]+(?:[- ]?[0-9xX×*•]+)*/g;

export function findMaskedIds(text) {
  const out = [];
  for (const m of text.matchAll(MASK_RUN)) {
    const value = m[0].replace(/[- ]/g, '').replace(/[X×*•]/g, 'x');
    const digits = value.replace(/x/g, '').length;
    if (value.length >= 8 && value.length <= 15 && digits >= 3 && digits < value.length) out.push({ value, index: m.index });
  }
  return out;
}

function maskMatches(mask, id) {
  if (mask.length !== id.length) return false;
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 'x' && mask[i] !== id[i]) return false;
  return true;
}

/** หาบัญชีของเราที่ตรงกับเลขบัญชีในสลิป ผู้รับอยู่ท้ายกว่าผู้โอน จึงเลือกตัวที่เจอหลังสุด */
export function matchAccount(text, accounts) {
  let best = null;
  for (const mask of findMaskedIds(text)) {
    for (const account of accounts) {
      if (account.identifiers.some((id) => maskMatches(mask.value, id))) best = account;
    }
  }
  return best;
}

// ---------- ชื่อธนาคารในข้อความ ----------
// ชื่อแอปบนหัวสลิปไม่ได้บอกว่าเงินเข้าธนาคารไหน ตัดออกก่อนนับ
const APP_NAMES = /krungthai next|k ?plus|scb easy|bualuang m ?banking|krungsri (?:app|mobile)|ttb touch|mymo/g;

export function findBankMentions(text) {
  const s = skeleton(text).replace(APP_NAMES, ' ');
  const hits = [];
  for (const bank of BANKS) {
    const re = new RegExp(bank.pattern.source, 'g');
    for (const m of s.matchAll(re)) hits.push({ code: bank.code, index: m.index });
  }
  return hits.sort((a, b) => a.index - b.index);
}

/** หารหัสธนาคารจากคำที่ผู้ใช้พิมพ์ เช่น "กสิกร", "scb", "004" */
export function resolveBank(input) {
  const raw = input.trim();
  const direct = BANKS.find((b) => b.code === raw || b.short.toLowerCase() === raw.toLowerCase());
  if (direct) return direct.code;
  const s = skeleton(raw);
  const byPattern = BANKS.find((b) => b.pattern.test(s));
  if (byPattern) return byPattern.code;
  return BANKS.find((b) => skeleton(b.name).startsWith(s) && s.length >= 3)?.code || null;
}

/**
 * ระบุธนาคารที่รับเงิน ตามลำดับความมั่นใจ:
 * 1) เลขบัญชี/พร้อมเพย์ในสลิปตรงกับบัญชีที่ตั้งไว้
 * 2) ตั้งบัญชีไว้บัญชีเดียว สลิปที่ส่งเข้ามาคือเงินเข้าบัญชีนั้น
 * 3) ชื่อธนาคารในสลิป: ธนาคารที่ไม่ใช่ของผู้โอน หรือชื่อธนาคารผู้โอนปรากฏสองครั้ง (โอนธนาคารเดียวกัน)
 * ถ้าไม่มั่นใจคืน null ให้ bot ถามผู้ใช้
 */
export function detectReceiver(text, accounts, sendingBank) {
  const account = matchAccount(text, accounts);
  if (account) return { bank: account.bank_code, accountId: account.id, by: 'account' };
  if (accounts.length === 1) return { bank: accounts[0].bank_code, accountId: accounts[0].id, by: 'only-account' };

  const allowed = new Set(accounts.map((a) => a.bank_code));
  const usable = (code) => allowed.size === 0 || allowed.has(code);
  if (/พรอมเพย|promptpay/.test(skeleton(text))) return null; // พร้อมเพย์ไม่บอกธนาคารปลายทาง

  const mentions = findBankMentions(text);
  const others = mentions.filter((m) => m.code !== sendingBank);
  if (others.length) {
    const code = others[others.length - 1].code;
    return usable(code) ? { bank: code, accountId: null, by: 'name' } : null;
  }
  if (mentions.length >= 2 && usable(sendingBank)) return { bank: sendingBank, accountId: null, by: 'name' };
  return null;
}

// ---------- ชื่อผู้โอน/ผู้รับ ----------
const NAME = /(?:^|\s)((?:(?:นาย|นางสาว|นาง|น\.\s?ส\.|ด\.\s?ช\.|ด\.\s?ญ\.|บจก\.|บมจ\.|หจก\.|บริษัท)\s*|(?:mrs?|ms|miss)\.?\s+)\S.{1,58})$/i;
const FROM = /(?:^|\s)(?:จาก|from\b)\s*:?\s*(.*)$/i;
const TO = /(?:^|\s)(?:ไปยัง|ไปที่|to\b)\s*:?\s*(.*)$/i;

const tidyName = (name) => name.replace(/["“”'`]/g, '').replace(/\s*([*xX×]\s*){2,}$/, '***').replace(/\s+/g, ' ').trim();

// ชื่อที่ไม่มีคำนำหน้า: ต้องมีอักษรไทยพอสมควร หรือเป็นตัวพิมพ์ใหญ่แบบสลิปภาษาอังกฤษ ไม่เช่นนั้นถือว่าเป็นเศษจาก OCR
function plausibleName(line) {
  if (/\d{3}/.test(line)) return false;
  return (line.match(/[ก-ฮ]/g) || []).length >= 4 || /\b[A-Z]{3,}\b/.test(line);
}

/**
 * หาชื่อผู้โอนและผู้รับ
 * สลิปที่มีคำว่า "จาก" / "ไปยัง": ชื่อที่อยู่หลัง "ไปยัง" เป็นผู้รับเสมอ ถ้าอ่านชื่อผู้โอนไม่ออกจะคืน null ไม่เดา
 * สลิปที่ไม่มีคำเหล่านี้: ชื่อแรกเป็นผู้โอน ชื่อที่สองเป็นผู้รับ
 */
export function parseNames(text) {
  const lines = toLines(text).map((l) => l.normalize('NFC'));
  let side = null; // ฝั่งที่กำลังอ่านอยู่ตามหลักยึดล่าสุด
  let expect = null; // บรรทัดถัดจาก "จาก"/"ไปยัง" คือชื่อ แม้ไม่มีคำนำหน้า
  let anchored = false;
  const found = { sender: null, receiver: null };
  const loose = [];

  for (const line of lines) {
    const to = line.match(TO);
    const from = to ? null : line.match(FROM);
    const anchor = to || from;
    if (anchor) {
      anchored = true;
      side = to ? 'receiver' : 'sender';
      const rest = anchor[1].trim();
      const titled = rest.match(NAME);
      if (titled) found[side] ||= tidyName(titled[1]);
      else expect = side; // ชื่ออยู่บรรทัดถัดไป (ข้อความที่เหลือในบรรทัดนี้มักเป็นเศษจากโลโก้)
      continue;
    }
    const titled = line.match(NAME);
    if (titled) {
      const name = tidyName(titled[1]);
      if (side) found[side] ||= name;
      else loose.push(name);
    } else if (expect && plausibleName(line) && !findBankMentions(line).length) {
      // ตัดเศษหน้าชื่อออก เช่น "ug สมชาย" ที่ OCR อ่านคำนำหน้าเพี้ยน
      found[expect] ||= tidyName(/[ก-ฮ]/.test(line) ? line.replace(/^[^ก-ฮเ-ไ]+/, '') : line.replace(/^[^A-Za-z]+/, ''));
    }
    expect = null;
  }
  if (anchored) return found;
  return { sender: loose[0] || null, receiver: loose[1] || null };
}

export function parseSlipText(text, { accounts = [], sendingBank = null, now = new Date() } = {}) {
  const names = parseNames(text);
  const exact = parseDateTime(text, now);
  return {
    amount: parseAmount(text),
    transferredAt: exact || guessDateTime(text, now),
    dateGuessed: !exact, // true = ไม่ได้วันที่ หรือได้จากการประมาณเดือน
    receiver: detectReceiver(text, accounts, sendingBank),
    senderName: names.sender,
    receiverName: names.receiver,
  };
}
