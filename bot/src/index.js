import fs from 'node:fs';
import { config } from './config.js';
import { createDb } from './db.js';
import { createService } from './service.js';
import { createBot } from './bot.js';
import { createApi } from './api.js';
import { readSlipQr } from './slip/qr.js';
import { ocrSlip, closeOcr } from './slip/ocr.js';
import { startReportScheduler } from './reports.js';

if (!config.telegramToken) {
  console.error('ยังไม่ได้ตั้ง TELEGRAM_BOT_TOKEN ในไฟล์ bot/.env');
  process.exit(1);
}

fs.mkdirSync(config.imageDir, { recursive: true });
const db = createDb(config.databaseUrl);

// หลังเปิดเครื่อง Postgres หรือ SSD อาจยังไม่พร้อม จึงรอและลองใหม่ทุก 5 วินาที นานสุด 10 นาที
async function waitForDatabase() {
  const deadline = Date.now() + 10 * 60_000;
  for (let attempt = 1; ; attempt++) {
    try {
      await db.pool.query('SELECT 1 FROM slips LIMIT 1');
      return;
    } catch (err) {
      if (err.code === '42P01') {
        console.error('ยังไม่มีตาราง slips ในฐานข้อมูล รัน npm run db:init ก่อน');
        process.exit(1);
      }
      if (Date.now() > deadline) {
        console.error(`เชื่อมต่อฐานข้อมูลไม่ได้: ${err.message}\nตรวจว่าเสียบ SSD และ Postgres ทำงานอยู่ (brew services start postgresql@17)`);
        process.exit(1);
      }
      if (attempt === 1 || attempt % 6 === 0) console.warn(`รอฐานข้อมูล... (${err.message})`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}
await waitForDatabase();

const service = createService({ db, imageDir: config.imageDir, readSlipQr, ocrSlip });
const api = createApi({ db, service, imageDir: config.imageDir });
await api.listen({ host: config.apiHost, port: config.apiPort });
console.log(`API พร้อมที่ http://${config.apiHost}:${config.apiPort}`);

if (!config.allowedUserIds.size) {
  console.warn('ยังไม่ได้ตั้ง ALLOWED_TELEGRAM_USER_IDS: bot จะยังไม่รับสลิปจากใคร ส่ง /id ให้ bot เพื่อดู ID ของคุณ');
}
let stopping = false;
const bot = createBot({ token: config.telegramToken, allowedUserIds: config.allowedUserIds, service, db });
bot.start({ onStart: (me) => console.log(`Telegram bot @${me.username} เริ่มทำงานแล้ว (long polling)`) }).catch((err) => {
  if (stopping) return;
  console.error(`เริ่ม Telegram bot ไม่สำเร็จ: ${err.message}\nตรวจ TELEGRAM_BOT_TOKEN และการเชื่อมต่ออินเทอร์เน็ต`);
  process.exit(1);
});

// สรุปประจำวัน/สัปดาห์: ส่งให้ทุกคนใน ALLOWED_TELEGRAM_USER_IDS
const scheduler = startReportScheduler({
  db,
  service,
  send: (chatId, text) => bot.api.sendMessage(chatId, text),
  recipients: [...config.allowedUserIds],
  settings: config.reports,
});

async function shutdown() {
  stopping = true;
  scheduler.stop();
  await bot.stop().catch(() => {});
  await api.close();
  await closeOcr();
  await db.close();
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
