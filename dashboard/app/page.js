import Link from 'next/link';
import { api } from '../lib/api';
import { baht, whole, thaiDateTime } from '../lib/format';
import MonthlyChart from './components/MonthlyChart';
import Status from './components/Status';
import BankBadge from './components/BankBadge';

const percent = (ratio) => Math.min(Math.floor(ratio * 100), 100);

/** บอกเป็นภาษาคนว่าขาดอีกเท่าไรจึงถึงเกณฑ์ */
function remaining(b, rules) {
  if (b.status === 'reached') return 'ถึงเกณฑ์แล้ว ธนาคารจะส่งข้อมูลของปีนี้ให้สรรพากร';
  if (b.countOnly > b.combo) return `ขาดอีก ${whole(rules.countOnly - b.count)} ครั้ง ถึงเกณฑ์ ${whole(rules.countOnly)} ครั้ง`;
  const parts = [];
  if (b.count < rules.comboCount) parts.push(`${whole(rules.comboCount - b.count)} ครั้ง`);
  if (b.amount < rules.comboAmount) parts.push(`${baht(rules.comboAmount - b.amount)} บาท`);
  return `ขาดอีก ${parts.join(' และ ')}`;
}

function Line({ label, value, limit, format = whole }) {
  return (
    <div className="line">
      <dt>{label}</dt>
      <dd>
        <span className="line-value">{format(value)} <small>/ {format(limit)}</small></span>
        <span className="mini" aria-hidden="true"><i style={{ width: `${Math.min(value / limit, 1) * 100}%` }} /></span>
      </dd>
    </div>
  );
}

export default async function Overview({ searchParams }) {
  const params = await searchParams;
  const { data, error } = await api(`/api/summary${params.year ? `?year=${encodeURIComponent(params.year)}` : ''}`);
  if (error) return <p className="notice notice-error">{error}</p>;

  const { year, years, rules, total, banks, monthly, senders, pending } = data;
  const be = year + 543;
  const closest = banks[0];
  const topSenders = senders.slice(0, 6);
  const topAmount = topSenders[0]?.amount || 1;

  return (
    <>
      <section className="summary">
        <div className="hero">
          <div className="hero-top">
            <p className="hero-label">ยอดรับโอนปี {be}</p>
            {years.length > 1 && (
              <nav className="years" aria-label="เลือกปี">
                {years.map((y) => (
                  <Link key={y} href={`/?year=${y}`} aria-current={y === year ? 'page' : undefined}>{y + 543}</Link>
                ))}
              </nav>
            )}
          </div>
          <p className="hero-value">{baht(total.amount)} <small>บาท</small></p>
          <p className="hero-sub">
            {total.openingCount > 0
              ? `จาก ${whole(total.count)} ครั้ง คือสลิปในระบบ ${whole(total.slipCount)} ใบ และยอดยกมา ${whole(total.openingCount)} ครั้ง`
              : `จาก ${whole(total.count)} สลิปที่นับแล้ว`}
          </p>
        </div>

        <div className="stat">
          <p className="stat-label">จำนวนครั้งที่รับโอน</p>
          <p className="stat-value">{whole(total.count)} <small>ครั้ง</small></p>
          <p className="stat-sub">เฉลี่ย {baht(total.count ? total.amount / total.count : 0)} บาทต่อครั้ง</p>
        </div>

        <div className="stat">
          <p className="stat-label">ธนาคารที่ใกล้เกณฑ์ที่สุด</p>
          {closest ? (
            <>
              <p className="stat-value">{percent(closest.progress)}<small>%</small></p>
              <p className="stat-sub"><BankBadge code={closest.bank} name={closest.name} /></p>
            </>
          ) : (
            <p className="stat-sub">ยังไม่มีข้อมูล</p>
          )}
        </div>

        <div className="stat">
          <p className="stat-label">สลิปที่รอระบุข้อมูล</p>
          <p className="stat-value">{whole(pending)} <small>ใบ</small></p>
          <p className="stat-sub">
            {pending > 0 ? <Link href="/slips?status=pending&year=all">ระบุธนาคารหรือยอดเงิน</Link> : 'นับครบทุกใบแล้ว'}
          </p>
        </div>
      </section>

      <section aria-labelledby="h-banks">
        <div className="section-head">
          <h2 id="h-banks">เทียบเกณฑ์ส่งข้อมูลสรรพากร</h2>
          <p className="hint">
            ธนาคารส่งข้อมูลเมื่อในปีเดียวกันมีเงินเข้าครบ {whole(rules.comboCount)} ครั้งและ {whole(rules.comboAmount)} บาท
            หรือครบ {whole(rules.countOnly)} ครั้ง นับรวมทุกบัญชีในธนาคารเดียวกัน
          </p>
        </div>
        {banks.length === 0 ? (
          <p className="empty">ปี {be} ยังไม่มีสลิป ส่งรูปสลิปเข้า Telegram bot เพื่อเริ่มบันทึก</p>
        ) : (
          <div className="bank-grid">
            {banks.map((b) => (
              <article key={b.bank} className={`card bank bank-${b.status}`}>
                <header className="bank-head">
                  <BankBadge code={b.bank} size="lg" />
                  <h3>{b.name}</h3>
                  <Status status={b.status} />
                </header>
                <p className="bank-percent">{percent(b.progress)}<small>% ของเกณฑ์</small></p>
                <div
                  className="track"
                  role="meter"
                  aria-label={`ความคืบหน้าเทียบเกณฑ์ของ${b.name}`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={percent(b.progress)}
                >
                  <span className="fill" style={{ width: `${percent(b.progress)}%` }} />
                  <span className="warn-mark" title="80% ของเกณฑ์" />
                </div>
                <p className="bank-remaining">{remaining(b, rules)}</p>
                <dl className="lines">
                  <Line label="จำนวนครั้ง" value={b.count} limit={rules.comboCount} />
                  <Line label="ยอดรวม (บาท)" value={b.amount} limit={rules.comboAmount} format={baht} />
                  <Line label={`เกณฑ์ ${whole(rules.countOnly)} ครั้ง`} value={b.count} limit={rules.countOnly} />
                </dl>
                {(b.openingCount > 0 || b.openingAmount > 0) && (
                  <p className="bank-opening">
                    รวมยอดยกมาก่อนเริ่มระบบ {whole(b.openingCount)} ครั้ง {baht(b.openingAmount)} บาท
                  </p>
                )}
                <Link className="card-link" href={`/slips?bank=${b.bank}&year=${year}`}>
                  ดูสลิปของ{b.name}
                </Link>
              </article>
            ))}
          </div>
        )}
        <p className="footnote">ตัวเลขนี้นับเฉพาะสลิปที่ส่งเข้าระบบ ยอดที่ธนาคารนับจริงอาจสูงกว่า ขีดบนแถบคือ 80% ของเกณฑ์</p>
      </section>

      {total.slipCount > 0 && (
        <section className="split">
          <div className="card" aria-labelledby="h-month">
            <h2 id="h-month">ยอดรับโอนรายเดือน</h2>
            <MonthlyChart monthly={monthly} year={year} />
            {total.openingCount > 0 && <p className="footnote">กราฟนี้แสดงเฉพาะสลิปในระบบ ไม่รวมยอดยกมา</p>}
          </div>

          <div className="card" aria-labelledby="h-senders">
            <h2 id="h-senders">ผู้โอนยอดรวมสูงสุด</h2>
            <ol className="senders">
              {topSenders.map((s) => (
                <li key={`${s.name}-${s.bank}`}>
                  <div className="sender-row">
                    <span className="sender-name">{s.name}</span>
                    <span className="sender-amount">{baht(s.amount)}</span>
                  </div>
                  <div className="sender-row sender-meta">
                    <BankBadge code={s.bank} name={s.bank_name || 'ไม่ทราบธนาคาร'} />
                    <span>{whole(s.count)} ครั้ง ล่าสุด {thaiDateTime(s.last_at)}</span>
                  </div>
                  <span className="mini" aria-hidden="true"><i style={{ width: `${(s.amount / topAmount) * 100}%` }} /></span>
                </li>
              ))}
            </ol>
            <p className="footnote">ชื่ออ่านจากรูปสลิป อาจสะกดเพี้ยน แก้ได้ในหน้ารายละเอียดของสลิป</p>
          </div>
        </section>
      )}
    </>
  );
}
