const API_URL = process.env.API_URL || 'http://127.0.0.1:4000';

/** เรียก API ของ bot จากฝั่งเซิร์ฟเวอร์ คืน { data } หรือ { error } */
export async function api(path) {
  try {
    const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
    if (res.status === 404) return { notFound: true };
    if (!res.ok) return { error: `API ตอบกลับด้วยสถานะ ${res.status}` };
    return { data: await res.json() };
  } catch {
    return { error: 'เชื่อมต่อ API ไม่ได้ ตรวจว่า bot ทำงานอยู่ (รัน npm start ในโฟลเดอร์ bot)' };
  }
}
