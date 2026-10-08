'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

/** ปุ่มในคอลัมน์จัดการ: แก้ไข และลบแบบถามยืนยันก่อน */
export default function RowActions({ id }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function remove() {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/backend/api/slips/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 404) throw new Error(`ลบไม่สำเร็จ (สถานะ ${res.status})`);
      router.refresh();
    } catch (err) {
      setError(err.message || 'ลบไม่สำเร็จ ลองอีกครั้ง');
      setBusy(false);
    }
  }

  if (confirming) {
    return (
      <span className="row-actions">
        <button type="button" className="small danger" disabled={busy} onClick={remove}>ยืนยันลบ</button>
        <button type="button" className="small quiet" disabled={busy} onClick={() => setConfirming(false)}>ไม่ลบ</button>
        {error && <span className="row-error" role="alert">{error}</span>}
      </span>
    );
  }
  return (
    <span className="row-actions">
      <Link className="small-link" href={`/slips/${id}`}>แก้ไข</Link>
      <button type="button" className="small quiet" onClick={() => setConfirming(true)} aria-label={`ลบสลิป #${id}`}>ลบ</button>
    </span>
  );
}
