import Link from 'next/link';
import { notFound } from 'next/navigation';
import { api } from '../../../lib/api';
import { baht, thaiDateTime, toLocalInput } from '../../../lib/format';
import SlipEditor from './SlipEditor';
import BankBadge from '../../components/BankBadge';

export default async function SlipDetail({ params }) {
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const [slip, banks] = await Promise.all([api(`/api/slips/${id}`), api('/api/banks')]);
  if (slip.notFound) notFound();
  if (slip.error || banks.error) return <p className="notice notice-error">{slip.error || banks.error}</p>;
  const s = slip.data;

  return (
    <>
      <p className="back"><Link href="/slips">กลับไปรายการสลิป</Link></p>
      <div className="page-head">
        <h1>สลิป #{s.id}</h1>
        <p className="page-total">
          <span>{s.status === 'pending' ? 'ยังไม่นับ' : 'นับแล้ว'}</span>
          <strong>{s.amount ? <>{baht(s.amount)} <small>บาท</small></> : 'ยังไม่ระบุยอด'}</strong>
        </p>
      </div>
      {s.status === 'pending' && (
        <p className="notice">สลิปนี้ยังไม่ถูกนับ ใส่ธนาคารที่รับเงินและยอดเงินให้ครบแล้วบันทึก</p>
      )}
      <div className="detail">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img className="slip-image" src={`/backend/api/slips/${s.id}/image`} alt={`รูปสลิป #${s.id}`} />
        <div>
          <dl className="card facts">
            <dt>วันที่โอน</dt>
            <dd>
              {thaiDateTime(s.transferred_at)}
              {' '}
              <span className={`src src-${s.date_source === 'sent' || s.date_source === 'estimated' ? 'warn' : s.date_source === 'manual' ? 'plain' : 'ok'}`}>
                {{ slip: 'อ่านจากสลิป', sent: 'อ่านไม่ได้ ใช้วันที่ส่งสลิป', estimated: 'อ่านเดือนไม่ชัด ประมาณเดือน', manual: 'แก้ไขเอง' }[s.date_source] || 'อ่านจากสลิป'}
              </span>
            </dd>
            <dt>ผู้โอน</dt><dd>{s.sender_name || 'ไม่ทราบชื่อ'} ({s.sender_bank_name || 'ไม่ทราบธนาคาร'})</dd>
            <dt>เข้าธนาคาร</dt>
            <dd>{s.receiver_bank ? <BankBadge code={s.receiver_bank} name={s.receiver_bank_name} /> : 'ยังไม่ระบุ'}</dd>
            <dt>สินค้า</dt><dd>{s.item || 'ยังไม่ระบุ'}</dd>
            <dt>การรับของ</dt><dd>{{ delivery: 'จัดส่ง', pickup: 'นัดรับ' }[s.fulfillment] || 'ยังไม่ระบุ'}</dd>
            <dt>เลขอ้างอิง</dt><dd className="ref">{s.trans_ref}</dd>
            <dt>วันที่ส่งสลิป</dt><dd>{thaiDateTime(s.created_at)}</dd>
          </dl>
          <SlipEditor
            id={s.id}
            banks={banks.data}
            initial={{
              amount: s.amount ?? '',
              receiver_bank: s.receiver_bank || '',
              sender_name: s.sender_name || '',
              item: s.item || '',
              fulfillment: s.fulfillment || '',
              transferred_at: toLocalInput(s.transferred_at),
            }}
          />
          {s.ocr_text && (
            <details className="ocr">
              <summary>ข้อความที่อ่านได้จากรูป</summary>
              <pre>{s.ocr_text}</pre>
            </details>
          )}
        </div>
      </div>
    </>
  );
}
