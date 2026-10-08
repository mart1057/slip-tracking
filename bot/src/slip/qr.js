// อ่าน Mini QR บนสลิปโอนเงิน (มาตรฐาน Slip Verify ของธนาคารไทย)
// payload เป็น TLV: tag 00 = { 00: API ID, 01: รหัสธนาคารผู้โอน, 02: เลขอ้างอิงรายการ }, 51 = ประเทศ, 91 = CRC
import sharp from 'sharp';
import jsQR from 'jsqr';

function parseTlv(str) {
  const out = {};
  let i = 0;
  while (i + 4 <= str.length) {
    const tag = str.slice(i, i + 2);
    const len = Number(str.slice(i + 2, i + 4));
    if (!Number.isInteger(len) || i + 4 + len > str.length) return null;
    out[tag] = str.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return i === str.length ? out : null;
}

export function crc16(str) {
  let crc = 0xffff;
  for (const byte of Buffer.from(str, 'utf8')) {
    crc ^= byte << 8;
    for (let b = 0; b < 8; b++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/** แปลง payload ของ QR เป็นข้อมูลสลิป คืน null ถ้าไม่ใช่ QR ของสลิปโอนเงิน */
export function parseSlipPayload(payload) {
  if (typeof payload !== 'string') return null;
  const text = payload.trim();
  const top = parseTlv(text);
  if (!top || !top['00']) return null;
  const inner = parseTlv(top['00']);
  if (!inner || !inner['01'] || !inner['02']) return null;
  if (!/^\d{3}$/.test(inner['01'])) return null;
  const crcOk = top['91'] ? crc16(text.slice(0, -4)) === top['91'].toUpperCase() : false;
  return { payload: text, sendingBank: inner['01'], transRef: inner['02'], crcOk };
}

async function scan(pipeline) {
  const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const hit = jsQR(new Uint8ClampedArray(data.buffer, data.byteOffset, data.length), info.width, info.height);
  return hit?.data || null;
}

/** หา QR ในรูปสลิป ลองหลายขนาดและหลายส่วนของรูป เพราะ QR บนสลิปมักเล็กและอยู่ครึ่งล่าง */
export async function readSlipQr(buffer) {
  const meta = await sharp(buffer).metadata();
  const { width, height } = meta;
  if (!width || !height) return null;
  const half = Math.floor(height / 2);
  const attempts = [
    () => sharp(buffer),
    () => sharp(buffer).extract({ left: 0, top: half, width, height: height - half }).resize({ width: width * 2 }),
    () => sharp(buffer).resize({ width: Math.min(width * 2, 3000) }),
    () => sharp(buffer).extract({ left: 0, top: 0, width, height: half }).resize({ width: width * 2 }),
    () => sharp(buffer).greyscale().normalise().resize({ width: Math.min(width * 2, 3000) }),
  ];
  for (const make of attempts) {
    try {
      const data = await scan(make());
      const parsed = data && parseSlipPayload(data);
      if (parsed) return parsed;
    } catch {
      // ลองวิธีถัดไป
    }
  }
  return null;
}
