// สถานะเทียบเกณฑ์: ใช้ไอคอน + ข้อความเสมอ ไม่พึ่งสีอย่างเดียว
const STATES = {
  ok: { label: 'ยังห่างเกณฑ์', path: 'M5.5 10.5l3 3 6-7' },
  near: { label: 'ใกล้ถึงเกณฑ์', path: 'M10 5.5v5.5m0 3v.2' },
  reached: { label: 'ถึงเกณฑ์แล้ว', path: 'M6.5 6.5l7 7m0-7l-7 7' },
};

export default function Status({ status }) {
  const s = STATES[status] || STATES.ok;
  return (
    <span className={`status status-${status}`}>
      <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
        <path d={s.path} />
      </svg>
      {s.label}
    </span>
  );
}
