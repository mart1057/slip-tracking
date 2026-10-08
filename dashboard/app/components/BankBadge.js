import { bankStyle } from '../../lib/banks';

/** ป้ายสีประจำธนาคาร size: 'lg' = สี่เหลี่ยมมนพร้อมตัวย่อ, 'sm' = จุดสีหน้าชื่อ */
export default function BankBadge({ code, name, size = 'sm' }) {
  const bank = bankStyle(code);
  if (size === 'lg') {
    return (
      <span className={`bank-mark${bank.dark ? ' is-dark-text' : ''}`} style={{ background: bank.color }} aria-hidden="true">
        {bank.short}
      </span>
    );
  }
  return (
    <span className="bank-chip">
      <i style={{ background: bank.color }} aria-hidden="true" />
      {name}
    </span>
  );
}
