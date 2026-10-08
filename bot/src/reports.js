// สรุปประจำวันและประจำสัปดาห์ที่ bot ส่งให้เอง
import { bankName } from './banks.js';
import { RULES } from './thresholds.js';
import { addDays, bangkokNow, dayRange, formatBaht, formatThaiDay } from './time.js';

const n = (v) => Number(v).toLocaleString('en-US');
const millions = (v) => (v / 1_000_000).toFixed(2);
const sum = (rows, key) => rows.reduce((total, r) => total + Number(r[key] || 0), 0);

function bankLines(rows) {
  return rows.map((r) => `• ${bankName(r.bank)} ${n(r.count)} ใบ ${formatBaht(r.amount)} บาท`);
}

/** สถานะเทียบเกณฑ์ของทุกธนาคารในปีนั้น เรียงจากใกล้เกณฑ์ที่สุด */
async function thresholdLines(service, year) {
  const banks = await service.yearSummary(year);
  if (!banks.length) return [];
  const lines = [`เทียบเกณฑ์สรรพากร ปี ${year + 543}`];
  for (const b of banks) {
    const mark = b.status === 'reached' ? '🚨' : b.status === 'near' ? '⚠️' : '•';
    const note = b.status === 'reached' ? ' ถึงเกณฑ์แล้ว' : b.status === 'near' ? ' ใกล้ถึงเกณฑ์' : '';
    // แสดงเทียบเกณฑ์ 400 ครั้ง + 2 ล้านบาทเป็นหลัก เปลี่ยนเป็นเกณฑ์ 3,000 ครั้งเมื่อเกณฑ์นั้นใกล้กว่าและเกินครึ่งทางแล้ว
    const detail = b.countOnly > b.combo && b.countOnly >= 0.5
      ? `${n(b.count)}/${n(RULES.countOnly)} ครั้ง`
      : `${n(b.count)}/${RULES.comboCount} ครั้ง, ${millions(b.amount)}/2 ล้านบาท`;
    lines.push(`${mark} ${bankName(b.bank)} ${Math.min(Math.floor(b.progress * 100), 100)}% (${detail})${note}`);
  }
  return lines;
}

async function pendingLine(db) {
  const pending = await db.pendingCount();
  return pending ? [`⏳ มีสลิปรอระบุธนาคารหรือยอดเงิน ${n(pending)} ใบ (ยังไม่ถูกนับ)`] : [];
}

/** สรุปของวัน dateKey ('YYYY-MM-DD' ตามเวลาไทย) */
export async function dailyReport({ db, service }, dateKey = bangkokNow().dateKey) {
  const rows = await db.activity(...dayRange(dateKey));
  const lines = [`📊 สรุปประจำวัน ${formatThaiDay(dateKey)}`];
  if (!rows.length) {
    lines.push('วันนี้ไม่มีสลิปส่งเข้า');
  } else {
    lines.push(`สลิปที่ส่งเข้า: ${n(sum(rows, 'count'))} ใบ รวม ${formatBaht(sum(rows, 'amount'))} บาท`, ...bankLines(rows));
    lines.push(`การรับของ: จัดส่ง ${n(sum(rows, 'delivery'))}, นัดรับ ${n(sum(rows, 'pickup'))}, ยังไม่ระบุ ${n(sum(rows, 'unspecified'))}`);
  }
  const pending = await pendingLine(db);
  if (pending.length) lines.push('', ...pending);
  const thresholds = await thresholdLines(service, Number(dateKey.slice(0, 4)));
  if (thresholds.length) lines.push('', ...thresholds);
  return lines.join('\n');
}

/** สรุป 7 วันที่สิ้นสุดวัน dateKey เทียบกับ 7 วันก่อนหน้า */
export async function weeklyReport({ db, service }, dateKey = bangkokNow().dateKey) {
  const start = addDays(dateKey, -6);
  const rows = await db.activity(...dayRange(start, dateKey));
  const before = await db.activity(...dayRange(addDays(start, -7), addDays(start, -1)));
  const sameYear = start.slice(0, 4) === dateKey.slice(0, 4);
  const lines = [`📅 สรุปประจำสัปดาห์ ${formatThaiDay(start, { year: !sameYear })} ถึง ${formatThaiDay(dateKey)}`];

  const amount = sum(rows, 'amount');
  const previous = sum(before, 'amount');
  if (!rows.length) lines.push('สัปดาห์นี้ไม่มีสลิปส่งเข้า');
  else lines.push(`สลิปที่ส่งเข้า: ${n(sum(rows, 'count'))} ใบ รวม ${formatBaht(amount)} บาท`, ...bankLines(rows));
  if (before.length) {
    const change = Math.round(((amount - previous) / previous) * 100);
    const trend = change > 0 ? `เพิ่มขึ้น ${change}%` : change < 0 ? `ลดลง ${Math.abs(change)}%` : 'เท่าเดิม';
    lines.push(`สัปดาห์ก่อนหน้า: ${n(sum(before, 'count'))} ใบ ${formatBaht(previous)} บาท (ยอดเงิน${trend})`);
  }
  if (rows.length) {
    lines.push(`การรับของ: จัดส่ง ${n(sum(rows, 'delivery'))}, นัดรับ ${n(sum(rows, 'pickup'))}, ยังไม่ระบุ ${n(sum(rows, 'unspecified'))}`);
  }
  const pending = await pendingLine(db);
  if (pending.length) lines.push('', ...pending);
  const thresholds = await thresholdLines(service, Number(dateKey.slice(0, 4)));
  if (thresholds.length) lines.push('', ...thresholds);
  return lines.join('\n');
}

/** สรุปที่ถึงเวลาส่งแล้วของวันนี้ (ยังไม่ดูว่าส่งไปแล้วหรือยัง) */
export function dueReports(now, { dailyAt, weeklyAt, weeklyDay }) {
  const { dateKey, minutes, dow } = bangkokNow(now);
  const due = [];
  if (dailyAt !== null && minutes >= dailyAt) due.push({ kind: 'daily', period: dateKey });
  if (weeklyAt !== null && dow === weeklyDay && minutes >= weeklyAt) due.push({ kind: 'weekly', period: dateKey });
  return due;
}

/**
 * ตรวจทุก 30 วินาทีว่าถึงเวลาส่งสรุปหรือยัง
 * ถ้า bot ดับตอนถึงเวลา จะส่งตามหลังเมื่อกลับมาทำงานภายในวันเดียวกัน และไม่ส่งซ้ำเมื่อรีสตาร์ต
 */
export function startReportScheduler({ db, service, send, recipients, settings, clock = () => new Date(), intervalMs = 30_000 }) {
  const build = { daily: dailyReport, weekly: weeklyReport };
  let running = false;
  let retryAfter = 0;

  async function tick() {
    if (running || !recipients.length || Date.now() < retryAfter) return;
    running = true;
    try {
      for (const { kind, period } of dueReports(clock(), settings)) {
        if (await db.reportSent(kind, period)) continue;
        const text = await build[kind]({ db, service }, period);
        const results = await Promise.allSettled(recipients.map((id) => send(id, text)));
        if (results.some((r) => r.status === 'fulfilled')) await db.markReportSent(kind, period);
        else throw results[0].reason;
      }
    } catch (err) {
      console.error('ส่งสรุปไม่สำเร็จ จะลองใหม่ใน 5 นาที:', err?.message || err);
      retryAfter = Date.now() + 5 * 60_000;
    } finally {
      running = false;
    }
  }

  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { tick, ready: tick(), stop: () => clearInterval(timer) };
}
