// API สำหรับ dashboard (ฟังเฉพาะ 127.0.0.1 โดย dashboard เป็นตัวเรียกต่อ)
import Fastify from 'fastify';
import fs from 'node:fs';
import path from 'node:path';
import { BANKS, bankName } from './banks.js';
import { RULES, WARN_AT } from './thresholds.js';
import { bangkokYear, yearRange } from './time.js';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MIME = { '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

const withBank = (slip) => ({
  ...slip,
  sender_bank_name: slip.sender_bank ? bankName(slip.sender_bank) : null,
  receiver_bank_name: slip.receiver_bank ? bankName(slip.receiver_bank) : null,
});

export function createApi({ db, service, imageDir }) {
  const app = Fastify({ logger: false });

  app.get('/api/health', async () => ({ ok: true }));

  app.get('/api/banks', async () => BANKS.map(({ code, short, name }) => ({ code, short, name })));

  app.get('/api/summary', async (req) => {
    const years = await db.years();
    const current = bangkokYear(new Date());
    const year = Number(req.query.year) || current;
    const banks = (await service.yearSummary(year)).map((b) => ({ ...b, name: bankName(b.bank) }));
    const monthly = await db.monthlyTotals(year);
    const senders = (await db.senderTotals(year)).map((s) => ({ ...s, bank_name: s.bank ? bankName(s.bank) : null }));
    return {
      year,
      years: [...new Set([current, ...years])].sort((a, b) => b - a),
      rules: { ...RULES, warnAt: WARN_AT },
      total: {
        count: banks.reduce((n, b) => n + b.count, 0),
        amount: banks.reduce((n, b) => n + b.amount, 0),
        slipCount: banks.reduce((n, b) => n + b.slipCount, 0),
        openingCount: banks.reduce((n, b) => n + b.openingCount, 0),
        openingAmount: banks.reduce((n, b) => n + b.openingAmount, 0),
      },
      banks,
      monthly: Array.from({ length: 12 }, (_, i) => {
        const row = monthly.find((m) => m.month === i + 1);
        return { month: i + 1, count: row?.count || 0, amount: row?.amount || 0 };
      }),
      senders,
      pending: await db.pendingCount(),
    };
  });

  app.get('/api/slips', async (req, reply) => {
    const { from, to, bank, q, status, fulfillment, date_source: dateSource } = req.query;
    if ((from && !DAY.test(from)) || (to && !DAY.test(to))) return reply.code(400).send({ error: 'วันที่ต้องอยู่ในรูปแบบ YYYY-MM-DD' });
    const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), 200);
    const page = Math.max(Number(req.query.page) || 1, 1);

    // ปีที่แสดง: ไม่ระบุ = ปีปัจจุบัน (ขึ้นปีใหม่แล้วรายการจะเริ่มใหม่เอง) ยกเว้นเมื่อกรองด้วยช่วงวันที่
    const current = bangkokYear(new Date());
    const asked = req.query.year;
    const year = asked === 'all' ? 'all' : /^\d{4}$/.test(asked || '') ? Number(asked) : from || to ? 'all' : current;
    let fromDate = from ? new Date(`${from}T00:00:00+07:00`) : null;
    // "ถึงวันที่" รวมทั้งวันนั้น
    let toDate = to ? new Date(new Date(`${to}T00:00:00+07:00`).getTime() + 86400_000) : null;
    if (year !== 'all') {
      const [start, end] = yearRange(year);
      if (!fromDate || fromDate < start) fromDate = start;
      if (!toDate || toDate > end) toDate = end;
    }
    const result = await db.searchSlips({
      from: fromDate,
      to: toDate,
      bank: bank || null,
      q: q?.trim() || null,
      status: status === 'pending' || status === 'confirmed' ? status : null,
      fulfillment: ['delivery', 'pickup', 'none'].includes(fulfillment) ? fulfillment : null,
      dateSource: ['slip', 'sent', 'estimated', 'manual'].includes(dateSource) ? dateSource : null,
      limit,
      offset: (page - 1) * limit,
    });
    const years = [...new Set([current, ...(await db.years())])].sort((a, b) => b - a);
    return { ...result, rows: result.rows.map(withBank), page, limit, year, years };
  });

  app.get('/api/slips/:id', async (req, reply) => {
    const slip = await db.getSlip(Number(req.params.id));
    return slip ? withBank(slip) : reply.code(404).send({ error: 'ไม่พบสลิป' });
  });

  app.get('/api/slips/:id/image', async (req, reply) => {
    const slip = await db.getSlip(Number(req.params.id));
    if (!slip) return reply.code(404).send({ error: 'ไม่พบสลิป' });
    const file = path.resolve(imageDir, slip.image_path);
    if (!file.startsWith(path.resolve(imageDir) + path.sep) || !fs.existsSync(file)) {
      return reply.code(404).send({ error: 'ไม่พบไฟล์รูปสลิป' });
    }
    return reply.type(MIME[path.extname(file)] || 'application/octet-stream').send(fs.createReadStream(file));
  });

  app.patch('/api/slips/:id', async (req, reply) => {
    const body = req.body || {};
    const patch = {};
    if (body.amount !== undefined) {
      const amount = Math.round(Number(body.amount) * 100) / 100;
      if (!(amount >= 0.01 && amount < 1e10)) return reply.code(400).send({ error: 'ยอดเงินต้องมากกว่า 0' });
      patch.amount = amount;
    }
    if (body.receiver_bank !== undefined) {
      if (!BANKS.some((b) => b.code === body.receiver_bank)) return reply.code(400).send({ error: 'ไม่รู้จักรหัสธนาคารนี้' });
      patch.receiverBank = body.receiver_bank;
      const accounts = (await db.listAccounts()).filter((a) => a.bank_code === body.receiver_bank);
      patch.receiverAccountId = accounts.length === 1 ? accounts[0].id : null;
    }
    if (typeof body.sender_name === 'string' && body.sender_name.trim()) patch.senderName = body.sender_name.trim().slice(0, 120);
    if (typeof body.item === 'string' && body.item.trim()) patch.item = body.item.trim().slice(0, 300);
    if (body.fulfillment !== undefined && body.fulfillment !== '') {
      if (!['delivery', 'pickup'].includes(body.fulfillment)) return reply.code(400).send({ error: 'การรับของต้องเป็นจัดส่งหรือนัดรับ' });
      patch.fulfillment = body.fulfillment;
    }
    if (body.transferred_at !== undefined) {
      const date = new Date(body.transferred_at);
      if (Number.isNaN(date.getTime())) return reply.code(400).send({ error: 'วันเวลาไม่ถูกต้อง' });
      patch.transferredAt = date;
    }
    const result = await service.updateSlip(Number(req.params.id), patch);
    return result ? withBank(result.slip) : reply.code(404).send({ error: 'ไม่พบสลิป' });
  });

  app.delete('/api/slips/:id', async (req, reply) => {
    const slip = await service.deleteSlip(Number(req.params.id));
    return slip ? { deleted: slip.id } : reply.code(404).send({ error: 'ไม่พบสลิป' });
  });

  return app;
}
