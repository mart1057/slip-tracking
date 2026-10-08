import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, '.env'), quiet: true });

const ids = (process.env.ALLOWED_TELEGRAM_USER_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean).map(Number).filter(Number.isFinite);

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** 'HH:MM' -> นาทีนับจากเที่ยงคืน, 'off' หรือค่าที่อ่านไม่ได้ -> null (ปิด) */
export function parseTime(value) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec((value || '').trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** 'sun'..'sat' หรือ 0..6 -> 0..6 */
export function parseDay(value) {
  const v = (value || '').trim().toLowerCase();
  const byName = DAYS.indexOf(v.slice(0, 3));
  if (byName >= 0) return byName;
  return /^[0-6]$/.test(v) ? Number(v) : 0;
}

export const config = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || '',
  allowedUserIds: new Set(ids),
  databaseUrl: process.env.DATABASE_URL || 'postgres://localhost:5432/slip_tracker',
  imageDir: path.resolve(root, process.env.SLIP_IMAGE_DIR || './data/slips'),
  apiHost: process.env.API_HOST || '127.0.0.1',
  apiPort: Number(process.env.API_PORT || 4000),
  reports: {
    dailyAt: parseTime(process.env.DAILY_SUMMARY_TIME ?? '20:00'),
    weeklyAt: parseTime(process.env.WEEKLY_SUMMARY_TIME ?? '20:00'),
    weeklyDay: parseDay(process.env.WEEKLY_SUMMARY_DAY ?? 'sun'),
  },
};
