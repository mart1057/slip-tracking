const OFFSET = 7 * 3600_000; // เวลาไทย
const pad = (n) => String(n).padStart(2, '0');
const shift = (iso) => new Date(new Date(iso).getTime() + OFFSET);

export const MONTHS = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

export const baht = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const whole = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 });

/** 8 ต.ค. 2569 12:40 */
export function thaiDateTime(iso) {
  const d = shift(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear() + 543} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** ค่าสำหรับ <input type="datetime-local"> ตามเวลาไทย */
export function toLocalInput(iso) {
  return shift(iso).toISOString().slice(0, 16);
}
