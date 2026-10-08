'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SlipEditor({ id, banks, initial }) {
  const router = useRouter();
  const [form, setForm] = useState(initial);
  const [state, setState] = useState({ busy: false, message: '', error: false });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function call(method, body) {
    setState({ busy: true, message: '', error: false });
    try {
      const res = await fetch(`/backend/api/slips/${id}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        throw new Error(detail.error || `บันทึกไม่สำเร็จ (สถานะ ${res.status})`);
      }
      return true;
    } catch (err) {
      setState({ busy: false, message: err.message, error: true });
      return false;
    }
  }

  async function save(e) {
    e.preventDefault();
    const body = {};
    // ส่งวันที่เฉพาะเมื่อแก้จริง เพราะการแก้วันที่จะเปลี่ยนที่มาเป็น "แก้ไขเอง"
    if (form.transferred_at !== initial.transferred_at) body.transferred_at = `${form.transferred_at}:00+07:00`;
    if (form.amount !== '') body.amount = Number(form.amount);
    if (form.receiver_bank) body.receiver_bank = form.receiver_bank;
    if (form.sender_name.trim()) body.sender_name = form.sender_name.trim();
    if (form.item.trim()) body.item = form.item.trim();
    if (form.fulfillment) body.fulfillment = form.fulfillment;
    if (await call('PATCH', body)) {
      setState({ busy: false, message: 'บันทึกการแก้ไขแล้ว', error: false });
      router.refresh();
    }
  }

  async function remove() {
    if (await call('DELETE')) router.push('/slips');
  }

  return (
    <form className="card editor" onSubmit={save}>
      <h2>แก้ไขข้อมูลสลิป</h2>
      <label>ยอดเงิน (บาท)
        <input type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} />
      </label>
      <label>ธนาคารที่รับเงิน
        <select value={form.receiver_bank} onChange={set('receiver_bank')}>
          <option value="">ยังไม่ระบุ</option>
          {banks.map((b) => <option key={b.code} value={b.code}>{b.name}</option>)}
        </select>
      </label>
      <label>ชื่อผู้โอน
        <input type="text" maxLength={120} value={form.sender_name} onChange={set('sender_name')} />
      </label>
      <label>สินค้าที่ลูกค้าซื้อ
        <input type="text" maxLength={300} value={form.item} onChange={set('item')} />
      </label>
      <label>การรับของ
        <select value={form.fulfillment} onChange={set('fulfillment')}>
          <option value="">ยังไม่ระบุ</option>
          <option value="delivery">จัดส่ง</option>
          <option value="pickup">นัดรับ</option>
        </select>
      </label>
      <label>วันเวลาที่โอน
        <input type="datetime-local" required value={form.transferred_at} onChange={set('transferred_at')} />
      </label>
      <div className="editor-actions">
        <button type="submit" disabled={state.busy}>บันทึกการแก้ไข</button>
        {confirmDelete ? (
          <>
            <button type="button" className="danger" disabled={state.busy} onClick={remove}>ยืนยันลบสลิป</button>
            <button type="button" className="quiet" onClick={() => setConfirmDelete(false)}>ไม่ลบ</button>
          </>
        ) : (
          <button type="button" className="quiet" onClick={() => setConfirmDelete(true)}>ลบสลิป</button>
        )}
      </div>
      {confirmDelete && <p className="hint">ลบแล้วยอดของสลิปนี้จะไม่ถูกนับ และรูปสลิปจะถูกลบออกจากเครื่อง</p>}
      <p className={state.error ? 'form-msg form-error' : 'form-msg'} role="status">{state.message}</p>
    </form>
  );
}
