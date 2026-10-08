import Link from 'next/link';

export default function NotFound() {
  return (
    <>
      <h1>ไม่พบหน้านี้</h1>
      <p className="empty">สลิปอาจถูกลบไปแล้ว <Link href="/slips">กลับไปรายการสลิป</Link></p>
    </>
  );
}
