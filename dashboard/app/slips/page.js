import Link from 'next/link';
import { api } from '../../lib/api';
import { baht, whole, thaiDateTime } from '../../lib/format';
import BankBadge from '../components/BankBadge';
import RowActions from './RowActions';

export const metadata = { title: 'รายการสลิป | สมุดสลิป' };

const FULFILLMENT = { delivery: 'จัดส่ง', pickup: 'นัดรับ' };

// ที่มาของวันที่โอน: อ่านจากสลิปได้ครบ หรือระบบต้องใช้ค่าอื่นแทน
const DATE_SOURCE = {
  slip: { label: 'อ่านจากสลิป', tone: 'ok' },
  sent: { label: 'ใช้วันที่ส่งสลิป', tone: 'warn' },
  estimated: { label: 'ประมาณเดือน', tone: 'warn' },
  manual: { label: 'แก้ไขเอง', tone: 'plain' },
};

export default async function Slips({ searchParams }) {
  const params = await searchParams;
  const filters = {
    from: params.from || '', to: params.to || '', bank: params.bank || '', q: params.q || '',
    status: params.status || '', fulfillment: params.fulfillment || '', date_source: params.date_source || '',
    year: params.year || '',
  };
  const page = Math.max(Number(params.page) || 1, 1);
  const query = new URLSearchParams(Object.entries(filters).filter(([, v]) => v));
  const [list, banks] = await Promise.all([api(`/api/slips?${query}&page=${page}`), api('/api/banks')]);
  if (list.error || banks.error) return <p className="notice notice-error">{list.error || banks.error}</p>;

  const { rows, count, amount, limit, year, years } = list.data;
  const pages = Math.max(Math.ceil(count / limit), 1);
  const pageHref = (n) => `/slips?${new URLSearchParams({ ...Object.fromEntries(query), page: n })}`;
  const filtered = query.size > 0;
  const yearLabel = year === 'all' ? 'ทุกปี' : `ปี ${year + 543}`;

  return (
    <>
      <div className="page-head">
        <h1>รายการสลิป {yearLabel}</h1>
        <p className="page-total">
          <span>{whole(count)} ใบ</span>
          <strong>{baht(amount)} <small>บาท</small></strong>
        </p>
      </div>

      <form className="card filters" method="get" action="/slips">
        <label>ปี
          <select name="year" defaultValue={String(year)}>
            {years.map((y) => <option key={y} value={y}>{y + 543}</option>)}
            <option value="all">ทุกปี</option>
          </select>
        </label>
        <label>ตั้งแต่วันที่<input type="date" name="from" defaultValue={filters.from} /></label>
        <label>ถึงวันที่<input type="date" name="to" defaultValue={filters.to} /></label>
        <label>ที่มาของวันที่โอน
          <select name="date_source" defaultValue={filters.date_source}>
            <option value="">ทั้งหมด</option>
            <option value="slip">อ่านจากสลิป</option>
            <option value="sent">อ่านไม่ได้ ใช้วันที่ส่งสลิป</option>
            <option value="estimated">อ่านเดือนไม่ชัด ประมาณเดือน</option>
            <option value="manual">แก้ไขเอง</option>
          </select>
        </label>
        <label>ธนาคารที่รับเงิน
          <select name="bank" defaultValue={filters.bank}>
            <option value="">ทุกธนาคาร</option>
            {banks.data.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
          </select>
        </label>
        <label>สถานะ
          <select name="status" defaultValue={filters.status}>
            <option value="">ทั้งหมด</option>
            <option value="confirmed">นับแล้ว</option>
            <option value="pending">รอระบุ</option>
          </select>
        </label>
        <label>การรับของ
          <select name="fulfillment" defaultValue={filters.fulfillment}>
            <option value="">ทั้งหมด</option>
            <option value="delivery">จัดส่ง</option>
            <option value="pickup">นัดรับ</option>
            <option value="none">ยังไม่ระบุ</option>
          </select>
        </label>
        <label className="grow">ค้นหา<input type="search" name="q" defaultValue={filters.q} placeholder="ชื่อผู้โอน สินค้า หรือเลขอ้างอิง" /></label>
        <div className="filter-actions">
          <button type="submit">กรองรายการ</button>
          {filtered && <Link href="/slips">ล้างตัวกรอง</Link>}
        </div>
      </form>

      {rows.length === 0 ? (
        <p className="empty">
          {filtered
            ? 'ไม่มีสลิปที่ตรงกับตัวกรองนี้ ลองเปลี่ยนปี ขยายช่วงวันที่ หรือล้างตัวกรอง'
            : `${yearLabel}ยังไม่มีสลิป ส่งรูปสลิปเข้า Telegram bot เพื่อเริ่มบันทึก หรือเลือกปีอื่นเพื่อดูข้อมูลเก่า`}
        </p>
      ) : (
        <ul className="card slip-list">
          <li className="slip-head" aria-hidden="true">
            <span>ผู้โอน</span><span>สินค้า</span><span>วันที่โอน</span><span>เข้าธนาคาร</span><span className="num">ยอด (บาท)</span><span>จัดการ</span>
          </li>
          {rows.map((s) => (
            <li key={s.id}>
              <div className="slip-row">
                <span className="slip-who">
                  <Link href={`/slips/${s.id}`}>{s.sender_name || 'ไม่ทราบชื่อ'}</Link>
                  <small>จาก{s.sender_bank_name || 'ธนาคารที่ไม่ทราบ'}</small>
                </span>
                <span className="slip-item">
                  <span className={s.item ? undefined : 'muted'}>{s.item || 'ยังไม่ระบุสินค้า'}</span>
                  {s.fulfillment && <span className={`ful ful-${s.fulfillment}`}>{FULFILLMENT[s.fulfillment]}</span>}
                </span>
                <span className="slip-date">
                  {thaiDateTime(s.transferred_at)}
                  <span className={`src src-${(DATE_SOURCE[s.date_source] || DATE_SOURCE.slip).tone}`}>
                    {(DATE_SOURCE[s.date_source] || DATE_SOURCE.slip).label}
                  </span>
                </span>
                <span className="slip-bank">
                  {s.receiver_bank ? <BankBadge code={s.receiver_bank} name={s.receiver_bank_name} /> : <span className="tag">รอระบุธนาคาร</span>}
                </span>
                <span className="slip-amount num">{s.amount ? baht(s.amount) : <span className="tag">รอระบุยอด</span>}</span>
                <RowActions id={s.id} />
              </div>
            </li>
          ))}
        </ul>
      )}

      {pages > 1 && (
        <nav className="pager" aria-label="หน้า">
          {page > 1 ? <Link href={pageHref(page - 1)}>หน้าก่อน</Link> : <span />}
          <span>หน้า {page} จาก {pages}</span>
          {page < pages ? <Link href={pageHref(page + 1)}>หน้าถัดไป</Link> : <span />}
        </nav>
      )}
    </>
  );
}
