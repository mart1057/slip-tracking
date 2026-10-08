'use client';

import { useState } from 'react';
import { MONTHS, baht, whole } from '../../lib/format';

// ปัดเพดานแกน y ให้เป็นเลขกลม เช่น 281,543 -> 300,000
function niceMax(value) {
  if (value <= 0) return 1000;
  const pow = 10 ** Math.floor(Math.log10(value));
  const step = [1, 1.5, 2, 3, 4, 5, 6, 8, 10].find((s) => s * pow >= value);
  return step * pow;
}

const compact = (n) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(2)} ล้าน` : n >= 1000 ? `${+(n / 1000).toFixed(1)} พัน` : whole(n));

export default function MonthlyChart({ monthly, year }) {
  const [active, setActive] = useState(null);
  const max = niceMax(Math.max(...monthly.map((m) => m.amount)));
  const peak = monthly.reduce((best, m) => (m.amount > best.amount ? m : best), monthly[0]);
  const shown = monthly[(active || peak.month) - 1];

  return (
    <figure className="chart">
      <p className="readout" role="status">
        <span className="readout-month">{MONTHS[shown.month - 1]} {year + 543}{!active && ' (สูงสุดของปี)'}</span>
        <span className="readout-value">{baht(shown.amount)} <small>บาท</small></span>
        <span className="readout-count">{whole(shown.count)} ครั้ง</span>
      </p>
      <div className="chart-plot">
        <div className="chart-axis" aria-hidden="true">
          {[1, 0.5, 0].map((t) => (
            <span key={t} style={{ bottom: `${t * 100}%` }}>{compact(max * t)}</span>
          ))}
        </div>
        <div className="chart-bars" onMouseLeave={() => setActive(null)}>
          {[0.5, 1].map((t) => <i key={t} className="grid" style={{ bottom: `${t * 100}%` }} />)}
          {monthly.map((m) => (
            <button
              key={m.month}
              type="button"
              className={`col${shown.month === m.month ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(m.month)}
              onFocus={() => setActive(m.month)}
              onBlur={() => setActive(null)}
              aria-label={`${MONTHS[m.month - 1]} ${year + 543}: ${baht(m.amount)} บาท จาก ${whole(m.count)} ครั้ง`}
            >
              <span className="bar" style={{ height: `${(m.amount / max) * 100}%` }} />
            </button>
          ))}
        </div>
      </div>
      <div className="chart-months" aria-hidden="true">
        {MONTHS.map((name, i) => <span key={name} className={shown.month === i + 1 ? 'is-active' : undefined}>{name}</span>)}
      </div>
      <details className="chart-table">
        <summary>ดูเป็นตาราง</summary>
        <table>
          <thead><tr><th>เดือน</th><th className="num">ครั้ง</th><th className="num">บาท</th></tr></thead>
          <tbody>
            {monthly.map((m) => (
              <tr key={m.month}><td>{MONTHS[m.month - 1]}</td><td className="num">{whole(m.count)}</td><td className="num">{baht(m.amount)}</td></tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
