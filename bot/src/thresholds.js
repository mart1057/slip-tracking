// เกณฑ์ "ธุรกรรมลักษณะเฉพาะ" ที่ธนาคารต้องส่งข้อมูลให้กรมสรรพากร
// นับต่อปีปฏิทิน ต่อธนาคาร รวมทุกบัญชีในธนาคารเดียวกัน
export const RULES = {
  countOnly: 3000,          // ฝาก/รับโอน 3,000 ครั้งขึ้นไป
  comboCount: 400,          // หรือ 400 ครั้งขึ้นไป
  comboAmount: 2_000_000,   // และยอดรวม 2,000,000 บาทขึ้นไป
};
export const WARN_AT = 0.8;

/** คืนความคืบหน้าเทียบเกณฑ์ (0-1+) และสถานะ ok | near | reached */
export function evaluate(count, amount) {
  const comboCount = count / RULES.comboCount;
  const comboAmount = amount / RULES.comboAmount;
  // เกณฑ์ 400 ครั้ง + 2 ล้านบาท ต้องครบทั้งสองเงื่อนไข ตัวที่น้อยกว่าจึงเป็นตัวกำหนด
  const combo = Math.min(comboCount, comboAmount);
  const countOnly = count / RULES.countOnly;
  const progress = Math.max(combo, countOnly);
  const status = progress >= 1 ? 'reached' : progress >= WARN_AT ? 'near' : 'ok';
  return { comboCount, comboAmount, combo, countOnly, progress, status };
}
