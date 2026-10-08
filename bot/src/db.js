import pg from 'pg';
import { yearRange } from './time.js';

// numeric -> number (ยอดเงินระดับนี้ไม่เกินความละเอียดของ float64)
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// bigint -> number (id ของสลิปและ Telegram ID อยู่ในช่วงที่ number เก็บได้ครบ)
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

export function createDb(connectionString) {
  const pool = new pg.Pool({ connectionString, max: 5 });
  const q = (text, params) => pool.query(text, params);
  const one = async (text, params) => (await q(text, params)).rows[0] || null;
  const all = async (text, params) => (await q(text, params)).rows;

  return {
    pool,
    close: () => pool.end(),

    // ----- บัญชีรับเงิน -----
    listAccounts: () => all('SELECT * FROM accounts ORDER BY id'),
    addAccount: (bankCode, accountNo, identifiers) =>
      one(
        `INSERT INTO accounts (bank_code, account_no, identifiers) VALUES ($1, $2, $3)
         ON CONFLICT (bank_code, account_no) DO UPDATE SET identifiers = EXCLUDED.identifiers
         RETURNING *`,
        [bankCode, accountNo, identifiers],
      ),
    deleteAccount: (id) => one('DELETE FROM accounts WHERE id = $1 RETURNING *', [id]),

    // ----- สลิป -----
    getSlip: (id) => one('SELECT * FROM slips WHERE id = $1', [id]),
    getSlipByRef: (ref) => one('SELECT * FROM slips WHERE trans_ref = $1', [ref]),
    lastSlip: () => one('SELECT * FROM slips ORDER BY id DESC LIMIT 1'),
    deleteSlip: (id) => one('DELETE FROM slips WHERE id = $1 RETURNING *', [id]),
    /** สลิปล่าสุดของแชตนี้ที่ยังไม่ได้ระบุสินค้า (ใช้เมื่อผู้ใช้พิมพ์ตอบโดยไม่ได้กดตอบกลับ) */
    latestAwaitingItem: (chatId, since) =>
      one(
        `SELECT * FROM slips WHERE telegram_chat_id = $1 AND item IS NULL AND created_at >= $2
         ORDER BY id DESC LIMIT 1`,
        [chatId, since],
      ),

    /** คืน null ถ้าเลขอ้างอิงซ้ำ (มีสลิปนี้อยู่แล้ว) */
    insertSlip: (s) =>
      one(
        `INSERT INTO slips (trans_ref, status, transferred_at, date_estimated, amount, sender_bank, sender_name,
           receiver_bank, receiver_account_id, receiver_name, image_path, file_hash, ocr_text,
           telegram_user_id, telegram_chat_id, telegram_message_id, item, date_source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (trans_ref) DO NOTHING
         RETURNING *`,
        [s.transRef, s.status, s.transferredAt, s.dateEstimated, s.amount, s.senderBank, s.senderName,
          s.receiverBank, s.receiverAccountId, s.receiverName, s.imagePath, s.fileHash, s.ocrText,
          s.telegramUserId, s.telegramChatId, s.telegramMessageId, s.item ?? null, s.dateSource || 'slip'],
      ),

    /** แก้ไขข้อมูลสลิป สถานะเป็น confirmed อัตโนมัติเมื่อมียอดเงินและธนาคารผู้รับครบ */
    updateSlip: (id, patch) =>
      one(
        `UPDATE slips SET
           amount = COALESCE($2, amount),
           receiver_bank = COALESCE($3, receiver_bank),
           receiver_account_id = CASE WHEN $3::text IS NULL THEN receiver_account_id ELSE $4 END,
           sender_name = COALESCE($5, sender_name),
           transferred_at = COALESCE($6, transferred_at),
           date_estimated = CASE WHEN $6::timestamptz IS NULL THEN date_estimated ELSE false END,
           date_source = CASE WHEN $6::timestamptz IS NULL THEN date_source ELSE 'manual' END,
           item = COALESCE($7, item),
           fulfillment = COALESCE($8, fulfillment),
           status = CASE WHEN COALESCE($2, amount) > 0 AND COALESCE($3, receiver_bank) IS NOT NULL
                         THEN 'confirmed' ELSE 'pending' END,
           updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, patch.amount ?? null, patch.receiverBank ?? null, patch.receiverAccountId ?? null,
          patch.senderName ?? null, patch.transferredAt ?? null, patch.item ?? null, patch.fulfillment ?? null],
      ),

    // ----- สรุปยอด (นับเฉพาะสลิปที่ยืนยันแล้ว) -----
    /** ยอดต่อธนาคารของปี = สลิปที่นับแล้ว + ยอดยกมา */
    bankTotals: async (year) => {
      const [from, to] = yearRange(year);
      return all(
        `WITH s AS (
           SELECT receiver_bank AS bank, count(*)::int AS count, sum(amount) AS amount, max(transferred_at) AS last_at
           FROM slips WHERE status = 'confirmed' AND transferred_at >= $1 AND transferred_at < $2
           GROUP BY receiver_bank
         ), o AS (
           SELECT bank_code AS bank, count, amount FROM opening_balances WHERE year = $3
         )
         SELECT COALESCE(s.bank, o.bank) AS bank,
                COALESCE(s.count, 0) + COALESCE(o.count, 0) AS count,
                COALESCE(s.amount, 0) + COALESCE(o.amount, 0) AS amount,
                COALESCE(s.count, 0) AS slip_count, COALESCE(s.amount, 0) AS slip_amount,
                COALESCE(o.count, 0) AS opening_count, COALESCE(o.amount, 0) AS opening_amount,
                s.last_at
         FROM s FULL JOIN o USING (bank)
         ORDER BY 3 DESC`,
        [from, to, year],
      );
    },
    /** สลิปที่ส่งเข้าระบบในช่วงเวลา (ตามเวลาที่บันทึก) แยกตามธนาคารที่รับเงิน */
    activity: (from, to) =>
      all(
        `SELECT receiver_bank AS bank, count(*)::int AS count, sum(amount) AS amount,
                count(*) FILTER (WHERE fulfillment = 'delivery')::int AS delivery,
                count(*) FILTER (WHERE fulfillment = 'pickup')::int AS pickup,
                count(*) FILTER (WHERE fulfillment IS NULL)::int AS unspecified
         FROM slips WHERE status = 'confirmed' AND created_at >= $1 AND created_at < $2
         GROUP BY receiver_bank ORDER BY sum(amount) DESC`,
        [from, to],
      ),
    reportSent: async (kind, period) => Boolean(await one('SELECT 1 FROM report_log WHERE kind = $1 AND period = $2', [kind, period])),
    markReportSent: (kind, period) =>
      q('INSERT INTO report_log (kind, period) VALUES ($1, $2) ON CONFLICT DO NOTHING', [kind, period]),
    setOpeningBalance: (year, bankCode, count, amount) =>
      one(
        `INSERT INTO opening_balances (year, bank_code, count, amount) VALUES ($1, $2, $3, $4)
         ON CONFLICT (year, bank_code) DO UPDATE SET count = EXCLUDED.count, amount = EXCLUDED.amount, updated_at = now()
         RETURNING *`,
        [year, bankCode, count, amount],
      ),
    monthlyTotals: async (year) => {
      const [from, to] = yearRange(year);
      return all(
        `SELECT extract(month FROM transferred_at AT TIME ZONE 'Asia/Bangkok')::int AS month,
                count(*)::int AS count, sum(amount) AS amount
         FROM slips WHERE status = 'confirmed' AND transferred_at >= $1 AND transferred_at < $2
         GROUP BY 1 ORDER BY 1`,
        [from, to],
      );
    },
    senderTotals: async (year, limit = 20) => {
      const [from, to] = yearRange(year);
      return all(
        `SELECT COALESCE(NULLIF(sender_name, ''), 'ไม่ทราบชื่อ') AS name, sender_bank AS bank,
                count(*)::int AS count, sum(amount) AS amount, max(transferred_at) AS last_at
         FROM slips WHERE status = 'confirmed' AND transferred_at >= $1 AND transferred_at < $2
         GROUP BY 1, 2 ORDER BY sum(amount) DESC LIMIT $3`,
        [from, to, limit],
      );
    },
    years: async () =>
      (await all(
        `SELECT extract(year FROM transferred_at AT TIME ZONE 'Asia/Bangkok')::int AS year FROM slips
         UNION SELECT year FROM opening_balances
         ORDER BY 1 DESC`,
      )).map((r) => r.year),
    pendingCount: async () => (await one(`SELECT count(*)::int AS n FROM slips WHERE status = 'pending'`)).n,

    /** รายการสลิปตามตัวกรอง พร้อมยอดรวมของชุดที่กรองได้ */
    searchSlips: async ({ from, to, bank, q: text, status, fulfillment, dateSource, limit = 50, offset = 0 }) => {
      const where = [];
      const params = [];
      const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };
      if (from) add('transferred_at >= ?', from);
      if (to) add('transferred_at < ?', to);
      if (bank) add('receiver_bank = ?', bank);
      if (status) add('status = ?', status);
      if (dateSource) add('date_source = ?', dateSource);
      if (fulfillment === 'none') where.push('fulfillment IS NULL');
      else if (fulfillment) add('fulfillment = ?', fulfillment);
      if (text) {
        const n = params.length + 1;
        add(`(sender_name ILIKE ? OR trans_ref ILIKE $${n} OR item ILIKE $${n})`, `%${text}%`);
      }
      const cond = where.length ? `WHERE ${where.join(' AND ')}` : '';
      const totals = await one(
        `SELECT count(*)::int AS count, COALESCE(sum(amount) FILTER (WHERE status = 'confirmed'), 0) AS amount
         FROM slips ${cond}`,
        params,
      );
      const rows = await all(
        `SELECT id, trans_ref, status, transferred_at, date_estimated, date_source, amount, sender_bank, sender_name,
                receiver_bank, receiver_name, item, fulfillment, created_at
         FROM slips ${cond} ORDER BY transferred_at DESC, id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );
      return { ...totals, rows };
    },
  };
}
