// ขั้นตอนหลักของระบบ: รับรูปสลิป -> อ่าน QR -> กันซ้ำ -> OCR -> บันทึก -> สรุปยอด
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { parseSlipText } from './slip/parse.js';
import { evaluate } from './thresholds.js';
import { bangkokYear } from './time.js';

export function createService({ db, imageDir, readSlipQr, ocrSlip, clock = () => new Date() }) {
  /** สรุปยอดของธนาคารหนึ่งในปีหนึ่ง พร้อมสถานะเทียบเกณฑ์ */
  async function bankSummary(bank, year) {
    const row = (await db.bankTotals(year)).find((r) => r.bank === bank);
    const count = row?.count || 0;
    const amount = row?.amount || 0;
    return {
      bank, year, count, amount,
      slipCount: row?.slip_count || 0, slipAmount: row?.slip_amount || 0,
      openingCount: row?.opening_count || 0, openingAmount: row?.opening_amount || 0,
      ...evaluate(count, amount),
    };
  }

  const summaryFor = (slip) => bankSummary(slip.receiver_bank, bangkokYear(slip.transferred_at));

  async function saveImage(buffer, transRef, year) {
    const meta = await sharp(buffer).metadata();
    const ext = meta.format === 'png' ? 'png' : meta.format === 'webp' ? 'webp' : 'jpg';
    const name = `${transRef.replace(/[^A-Za-z0-9_-]/g, '_')}.${ext}`;
    const rel = path.join(String(year), name);
    await fs.mkdir(path.join(imageDir, String(year)), { recursive: true });
    await fs.writeFile(path.join(imageDir, rel), buffer);
    return rel;
  }

  /**
   * ผลลัพธ์:
   *  { kind: 'unreadable' }                      อ่าน QR ไม่ได้ ไม่บันทึก
   *  { kind: 'duplicate', slip }                 มีสลิปนี้อยู่แล้ว ไม่นับเพิ่ม
   *  { kind: 'saved', slip, summary }            บันทึกและนับแล้ว
   *  { kind: 'pending', slip, missing: [...] }   บันทึกแล้วแต่ยังไม่นับ รอผู้ใช้ระบุ 'bank' / 'amount'
   */
  async function processSlip({ buffer, telegram = {}, item = null, now = clock() }) {
    const qr = await readSlipQr(buffer);
    if (!qr) return { kind: 'unreadable' };

    const existing = await db.getSlipByRef(qr.transRef);
    if (existing) return { kind: 'duplicate', slip: existing };

    // อ่านสองรอบด้วยการตั้งค่าต่างกัน: รอบแรกเป็นหลัก รอบสองใช้เติมข้อมูลที่ขาดและตรวจทานยอดเงิน
    const accounts = await db.listAccounts();
    const options = { accounts, sendingBank: qr.sendingBank, now };
    const first = await ocrSlip(buffer);
    const second = await ocrSlip(buffer, { width: 1400, psm: '6' });
    const a = parseSlipText(first, options);
    const b = parseSlipText(second, options);
    const text = `${first.trim()}\n\n----- อ่านรอบที่ 2 -----\n${second.trim()}`;
    const date = !a.dateGuessed ? a : !b.dateGuessed ? b : a.transferredAt ? a : b;
    const parsed = {
      amount: a.amount || b.amount,
      // สองรอบอ่านยอดได้ไม่ตรงกัน: เก็บค่าที่สองไว้เตือนผู้ใช้
      amountAlt: a.amount && b.amount && a.amount !== b.amount ? b.amount : null,
      transferredAt: date.transferredAt,
      dateGuessed: date.dateGuessed,
      receiver: a.receiver || b.receiver,
      senderName: a.senderName || b.senderName,
      receiverName: a.receiverName || b.receiverName,
    };
    const transferredAt = parsed.transferredAt || now;
    const missing = [];
    if (!parsed.receiver) missing.push('bank');
    if (!parsed.amount) missing.push('amount');

    const imagePath = await saveImage(buffer, qr.transRef, bangkokYear(transferredAt));
    const slip = await db.insertSlip({
      transRef: qr.transRef,
      status: missing.length ? 'pending' : 'confirmed',
      transferredAt,
      dateEstimated: parsed.dateGuessed,
      // sent = อ่านวันที่ไม่ได้เลย ใช้เวลาที่ส่งสลิป, estimated = ได้วัน ปี เวลา แต่ต้องประมาณเดือน
      dateSource: !parsed.transferredAt ? 'sent' : parsed.dateGuessed ? 'estimated' : 'slip',
      amount: parsed.amount,
      senderBank: qr.sendingBank,
      senderName: parsed.senderName,
      receiverBank: parsed.receiver?.bank || null,
      receiverAccountId: parsed.receiver?.accountId || null,
      receiverName: parsed.receiverName,
      imagePath,
      fileHash: crypto.createHash('sha256').update(buffer).digest('hex'),
      ocrText: text,
      telegramUserId: telegram.userId ?? null,
      telegramChatId: telegram.chatId ?? null,
      telegramMessageId: telegram.messageId ?? null,
      item,
    });
    // ส่งสลิปเดียวกันสองครั้งพร้อมกัน: unique ที่ฐานข้อมูลกันไว้ให้
    if (!slip) return { kind: 'duplicate', slip: await db.getSlipByRef(qr.transRef) };
    if (missing.length) return { kind: 'pending', slip, missing };
    return { kind: 'saved', slip, summary: await summaryFor(slip), amountAlt: parsed.amountAlt };
  }

  /** แก้ยอดเงิน/ธนาคาร/ชื่อ/วันที่/สินค้า/การรับของ ถ้ายอดและธนาคารครบจะนับรวมทันที */
  async function updateSlip(id, patch) {
    const slip = await db.updateSlip(id, patch);
    if (!slip) return null;
    const missing = [];
    if (!slip.receiver_bank) missing.push('bank');
    if (!slip.amount) missing.push('amount');
    if (missing.length) return { kind: 'pending', slip, missing };
    return { kind: 'saved', slip, summary: await summaryFor(slip) };
  }

  async function deleteSlip(id) {
    const slip = await db.deleteSlip(id);
    if (slip) await fs.rm(path.join(imageDir, slip.image_path), { force: true });
    return slip;
  }

  /** สรุปทุกธนาคารของปี เรียงตามความใกล้เกณฑ์ */
  async function yearSummary(year) {
    const rows = await db.bankTotals(year);
    return rows
      .map((r) => ({
        bank: r.bank, year, count: r.count, amount: r.amount, lastAt: r.last_at,
        slipCount: r.slip_count, slipAmount: r.slip_amount,
        openingCount: r.opening_count, openingAmount: r.opening_amount,
        ...evaluate(r.count, r.amount),
      }))
      .sort((a, b) => b.progress - a.progress);
  }

  /**
   * ตั้งยอดยกมาจาก "ยอดรวมปัจจุบัน" ที่ผู้ใช้รู้ (เช่น จากแอปธนาคาร) ซึ่งรวมสลิปที่อยู่ในระบบแล้ว
   * ยอดยกมา = ยอดรวมปัจจุบัน - สลิปที่นับแล้วในระบบ  คืน { error } ถ้ายอดรวมน้อยกว่าที่ระบบมีอยู่
   */
  async function setCurrentTotal(bank, year, totalCount, totalAmount) {
    const current = await bankSummary(bank, year);
    const count = totalCount - current.slipCount;
    const amount = Math.round((totalAmount - current.slipAmount) * 100) / 100;
    if (count < 0 || amount < 0) return { error: 'less-than-slips', current };
    await db.setOpeningBalance(year, bank, count, amount);
    return { summary: await bankSummary(bank, year) };
  }

  return { processSlip, updateSlip, deleteSlip, bankSummary, yearSummary, setCurrentTotal };
}
