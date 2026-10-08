// ทุกอย่างคิดตามเวลาไทย (UTC+7 ไม่มี DST)
const OFFSET = 7 * 3600_000;
const pad = (n) => String(n).padStart(2, '0');
const shift = (date) => new Date(new Date(date).getTime() + OFFSET);

export const bangkokYear = (date) => shift(date).getUTCFullYear();

/** ช่วงเวลาของปีปฏิทิน (ค.ศ.) ตามเวลาไทย: [start, end) */
export function yearRange(year) {
  return [new Date(`${year}-01-01T00:00:00+07:00`), new Date(`${year + 1}-01-01T00:00:00+07:00`)];
}

/** 08/10/2569 12:40 */
export function formatThai(date) {
  const d = shift(date);
  return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear() + 543} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** วันและเวลาปัจจุบันตามเวลาไทย: dateKey = 'YYYY-MM-DD', minutes = นาทีนับจากเที่ยงคืน, dow = 0 (อาทิตย์) ถึง 6 */
export function bangkokNow(date = new Date()) {
  const d = shift(date);
  return {
    dateKey: d.toISOString().slice(0, 10),
    minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    dow: d.getUTCDay(),
  };
}

/** เลื่อนวัน: addDays('2026-10-08', -6) = '2026-10-02' */
export function addDays(dateKey, n) {
  return new Date(Date.parse(`${dateKey}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
}

/** ช่วงเวลาของวัน (ตามเวลาไทย) ตั้งแต่ fromKey ถึงสิ้นวัน toKey: [start, end) */
export function dayRange(fromKey, toKey = fromKey) {
  return [new Date(`${fromKey}T00:00:00+07:00`), new Date(Date.parse(`${toKey}T00:00:00+07:00`) + 86400_000)];
}

/** '2026-10-08' -> '8 ต.ค. 2569' */
export function formatThaiDay(dateKey, { year = true } = {}) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}${year ? ` ${y + 543}` : ''}`;
}

export const formatBaht = (n) =>
  Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
