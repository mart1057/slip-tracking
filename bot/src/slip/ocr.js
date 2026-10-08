// OCR ด้วย tesseract.js ใช้ไฟล์ภาษาไทย/อังกฤษจากแพ็กเกจ npm ในเครื่อง ไม่ต้องต่อเน็ตตอนรัน
import { createWorker } from 'tesseract.js';
import sharp from 'sharp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tessdata = path.join(root, '.tessdata');
const LANGS = ['tha', 'eng'];

function prepareLangData() {
  fs.mkdirSync(tessdata, { recursive: true });
  for (const lang of LANGS) {
    const dest = path.join(tessdata, `${lang}.traineddata.gz`);
    if (fs.existsSync(dest)) continue;
    const src = path.join(root, 'node_modules', '@tesseract.js-data', lang, '4.0.0_best_int', `${lang}.traineddata.gz`);
    fs.copyFileSync(src, dest);
  }
}

let workerPromise = null;
function getWorker() {
  if (!workerPromise) {
    prepareLangData();
    workerPromise = createWorker(LANGS, 1, { langPath: tessdata, cacheMethod: 'none', gzip: true });
  }
  return workerPromise;
}

// OCR ทำทีละรูป เพราะ worker ตัวเดียวรับงานพร้อมกันไม่ได้
let queue = Promise.resolve();

/**
 * อ่านข้อความจากรูปสลิป
 * width: ขยายรูปให้กว้างเท่านี้ก่อนอ่าน (สลิปจาก Telegram ถูกย่อและบีบอัด ขยายแล้วอ่านตัวเลขและภาษาไทยได้แม่นขึ้น)
 * psm: วิธีแบ่งหน้าของ tesseract ('3' = อัตโนมัติ, '6' = ข้อความบล็อกเดียว อ่านทีละบรรทัดเต็มความกว้าง)
 */
export function ocrSlip(buffer, { width = 2000, psm = '3' } = {}) {
  const job = queue.then(async () => {
    const prepared = await sharp(buffer).flatten({ background: '#ffffff' }).greyscale().normalise().resize({ width }).png().toBuffer();
    const worker = await getWorker();
    await worker.setParameters({ tessedit_pageseg_mode: psm });
    const { data } = await worker.recognize(prepared);
    return data.text || '';
  });
  queue = job.catch(() => {});
  return job;
}

export async function closeOcr() {
  if (!workerPromise) return;
  const worker = await workerPromise;
  workerPromise = null;
  await worker.terminate();
}
