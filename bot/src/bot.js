import { Bot, InlineKeyboard } from 'grammy';
import { BANKS, bankName } from './banks.js';
import { resolveBank } from './slip/parse.js';
import { bangkokYear } from './time.js';
import * as msg from './messages.js';
import { dailyReport, weeklyReport } from './reports.js';

async function downloadFromTelegram(ctx, fileId, token) {
  const file = await ctx.api.getFile(fileId);
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${file.file_path}`);
  if (!res.ok) throw new Error(`ดาวน์โหลดรูปไม่สำเร็จ (${res.status})`);
  return Buffer.from(await res.arrayBuffer());
}

/** แปลงข้อความเป็นยอดเงิน รับ "1500", "1,500.50", "1500 บาท" */
export function parseAmountInput(text) {
  const m = text.replace(/[,\s]|บาท|฿/g, '').match(/^\d+(?:\.\d{1,2})?$/);
  const n = m ? Number(m[0]) : NaN;
  return n > 0 && n < 1e10 ? n : null;
}

export function createBot({ token, allowedUserIds, service, db, download, botInfo }) {
  const bot = new Bot(token, botInfo ? { botInfo } : undefined);
  const fetchFile = download || ((ctx, fileId) => downloadFromTelegram(ctx, fileId, token));

  const actionKeyboard = (id) =>
    new InlineKeyboard()
      .text('แก้ยอดเงิน', `amt:${id}`).text('เปลี่ยนธนาคาร', `bank:${id}`).text('ลบ', `del:${id}`)
      .row().text('แก้สินค้า', `item:${id}`).text('แก้การรับของ', `askful:${id}`);

  const fulfillmentKeyboard = (id) =>
    new InlineKeyboard().text('จัดส่ง', `ful:${id}:delivery`).text('นัดรับ', `ful:${id}:pickup`);

  /** ถามข้อมูลการขายที่ยังขาด: ซื้ออะไรก่อน แล้วจึงถามจัดส่งหรือนัดรับ */
  function askOrder(ctx, slip) {
    if (!slip.item) return ctx.reply(msg.askItemMessage(slip.id), { reply_markup: { force_reply: true } });
    if (!slip.fulfillment) return ctx.reply(msg.askFulfillmentMessage(slip), { reply_markup: fulfillmentKeyboard(slip.id) });
    return undefined;
  }

  async function bankKeyboard(id) {
    const accounts = await db.listAccounts();
    const own = [...new Set(accounts.map((a) => a.bank_code))];
    const codes = own.length ? own : BANKS.map((b) => b.code);
    const kb = new InlineKeyboard();
    codes.forEach((code, i) => {
      kb.text(bankName(code), `setbank:${id}:${code}`);
      if (i % 2 === 1) kb.row();
    });
    return kb;
  }

  /** ตอบผลของการบันทึก/แก้ไขสลิป และถามข้อมูลที่ยังขาด */
  async function replyResult(ctx, result, title, { ask = false } = {}) {
    if (result.kind === 'saved') {
      await ctx.reply(msg.savedMessage(result, title), { reply_markup: actionKeyboard(result.slip.id) });
      return ask ? askOrder(ctx, result.slip) : undefined;
    }
    if (result.missing[0] === 'bank') {
      return ctx.reply(msg.pendingMessage(result), { reply_markup: await bankKeyboard(result.slip.id) });
    }
    await ctx.reply(msg.pendingMessage(result));
    return ctx.reply(msg.askAmountMessage(result.slip.id), { reply_markup: { force_reply: true } });
  }

  // ----- จำกัดผู้ใช้ -----
  bot.use(async (ctx, next) => {
    const id = ctx.from?.id;
    if (id && allowedUserIds.has(id)) return next();
    const text = ctx.message?.text || '';
    if (id && /^\/(start|id)\b/.test(text)) {
      await ctx.reply(`Telegram ID ของคุณคือ ${id}\nใส่เลขนี้ใน ALLOWED_TELEGRAM_USER_IDS ของไฟล์ .env แล้วรีสตาร์ต bot เพื่อเริ่มใช้งาน`);
    }
    // ผู้ใช้อื่น: ไม่ตอบและไม่ประมวลผล
  });

  bot.command(['start', 'help'], (ctx) => ctx.reply(msg.HELP));
  bot.command('id', (ctx) => ctx.reply(`Telegram ID ของคุณคือ ${ctx.from.id}`));

  bot.command('summary', async (ctx) => {
    // /summary = ปีนี้, /summary 2569 = ดูปีที่ระบุ (รับทั้ง พ.ศ. และ ค.ศ.)
    const asked = Number((ctx.match || '').trim());
    const year = asked >= 2400 ? asked - 543 : asked >= 2000 ? asked : bangkokYear(new Date());
    const rows = await service.yearSummary(year);
    if (!rows.length) return ctx.reply(`ปี ${year + 543} ยังไม่มีสลิปที่บันทึก`);
    return ctx.reply(rows.map(msg.summaryBlock).join('\n\n'));
  });

  bot.command('today', async (ctx) => ctx.reply(await dailyReport({ db, service })));
  bot.command('week', async (ctx) => ctx.reply(await weeklyReport({ db, service })));

  // ตั้งยอดรวมของปีนี้จนถึงตอนนี้ ระบบหักสลิปที่มีอยู่ออกแล้วเก็บส่วนที่เหลือเป็นยอดยกมา
  bot.command('settotal', async (ctx) => {
    const [bankArg, countArg, ...amountArgs] = (ctx.match || '').trim().split(/\s+/).filter(Boolean);
    const bank = bankArg && resolveBank(bankArg);
    const total = /^\d{1,6}$/.test((countArg || '').replace(/,/g, '')) ? Number(countArg.replace(/,/g, '')) : null;
    const amount = parseAmountInput(amountArgs.join(''));
    if (!bank || total === null || !amount) {
      return ctx.reply('รูปแบบ: /settotal <ธนาคาร> <จำนวนครั้ง> <ยอดรวม>\nตัวอย่าง: /settotal กสิกร 49 1358842.64\nใส่ยอดรวมของปีนี้จนถึงตอนนี้ โดยรวมสลิปที่อยู่ในระบบแล้ว');
    }
    const result = await service.setCurrentTotal(bank, bangkokYear(new Date()), total, amount);
    if (result.error) return ctx.reply(msg.totalTooLowMessage(result.current));
    return ctx.reply(msg.totalSetMessage(result.summary));
  });

  bot.command('accounts', async (ctx) => {
    const accounts = await db.listAccounts();
    if (!accounts.length) {
      return ctx.reply('ยังไม่ได้ตั้งบัญชีรับเงิน\nเพิ่มด้วย /addaccount <ธนาคาร> <เลขบัญชี> [เบอร์หรือเลขพร้อมเพย์]');
    }
    const lines = accounts.map((a) => {
      const extra = a.identifiers.filter((v) => v !== a.account_no);
      return `${a.id}. ${bankName(a.bank_code)} ${a.account_no}${extra.length ? ` พร้อมเพย์ ${extra.join(', ')}` : ''}`;
    });
    return ctx.reply(['บัญชีรับเงิน', ...lines].join('\n'));
  });

  bot.command('addaccount', async (ctx) => {
    const [bankArg, accountArg, ...rest] = (ctx.match || '').trim().split(/\s+/).filter(Boolean);
    const bank = bankArg && resolveBank(bankArg);
    const accountNo = (accountArg || '').replace(/\D/g, '');
    if (!bank || accountNo.length < 10 || accountNo.length > 15) {
      return ctx.reply('รูปแบบ: /addaccount <ธนาคาร> <เลขบัญชี> [เบอร์หรือเลขพร้อมเพย์]\nตัวอย่าง: /addaccount กสิกร 123-4-56789-0 0812345678');
    }
    const proxies = rest.map((v) => v.replace(/\D/g, '')).filter((v) => v.length >= 10 && v.length <= 15);
    const account = await db.addAccount(bank, accountNo, [...new Set([accountNo, ...proxies])]);
    return ctx.reply(`เพิ่มบัญชีแล้ว: ${account.id}. ${bankName(bank)} ${accountNo}`);
  });

  bot.command('delaccount', async (ctx) => {
    const id = Number((ctx.match || '').trim());
    const removed = Number.isInteger(id) ? await db.deleteAccount(id) : null;
    return ctx.reply(removed ? `ลบบัญชี ${bankName(removed.bank_code)} ${removed.account_no} แล้ว` : 'ไม่พบบัญชีหมายเลขนี้ ดูหมายเลขได้จาก /accounts');
  });

  bot.command('last', async (ctx) => {
    const slip = await db.lastSlip();
    if (!slip) return ctx.reply('ยังไม่มีสลิปที่บันทึก');
    const result = await service.updateSlip(slip.id, {});
    return replyResult(ctx, result, 'สลิปล่าสุด');
  });

  // ----- รับรูปสลิป -----
  async function handleImage(ctx, fileId) {
    let buffer;
    try {
      buffer = await fetchFile(ctx, fileId);
    } catch (err) {
      console.error('download failed', err);
      return ctx.reply('ดาวน์โหลดรูปจาก Telegram ไม่สำเร็จ ลองส่งใหม่อีกครั้ง');
    }
    const result = await service.processSlip({
      buffer,
      telegram: { userId: ctx.from.id, chatId: ctx.chat.id, messageId: ctx.message.message_id },
      // คำบรรยายใต้รูป = สินค้าที่ลูกค้าซื้อ
      item: ctx.message.caption?.trim().slice(0, 300) || null,
    });
    if (result.kind === 'unreadable') return ctx.reply(msg.UNREADABLE);
    if (result.kind === 'duplicate') return ctx.reply(msg.duplicateMessage(result.slip));
    return replyResult(ctx, result, undefined, { ask: true });
  }

  bot.on('message:photo', (ctx) => handleImage(ctx, ctx.message.photo.at(-1).file_id));
  bot.on('message:document', (ctx) => {
    const doc = ctx.message.document;
    if (!doc.mime_type?.startsWith('image/')) return ctx.reply('รับเฉพาะไฟล์รูปภาพของสลิป');
    return handleImage(ctx, doc.file_id);
  });

  // ----- ปุ่มใต้ข้อความ -----
  bot.callbackQuery(/^amt:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return ctx.reply(msg.askAmountMessage(ctx.match[1]), { reply_markup: { force_reply: true } });
  });

  bot.callbackQuery(/^bank:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return ctx.reply(`เลือกธนาคารที่รับเงินของสลิป #${ctx.match[1]}`, { reply_markup: await bankKeyboard(ctx.match[1]) });
  });

  bot.callbackQuery(/^setbank:(\d+):(\d{3})$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, id, code] = ctx.match;
    const accounts = (await db.listAccounts()).filter((a) => a.bank_code === code);
    const before = await db.getSlip(Number(id));
    const result = await service.updateSlip(Number(id), {
      receiverBank: code,
      receiverAccountId: accounts.length === 1 ? accounts[0].id : null,
    });
    if (!result) return ctx.reply(`ไม่พบสลิป #${id}`);
    await ctx.editMessageReplyMarkup().catch(() => {});
    // สลิปที่เพิ่งครบข้อมูล: ถามเรื่องสินค้าต่อ
    return replyResult(ctx, result, 'อัปเดตสลิปแล้ว', { ask: before?.status === 'pending' });
  });

  bot.callbackQuery(/^item:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    return ctx.reply(msg.askItemMessage(ctx.match[1]), { reply_markup: { force_reply: true } });
  });

  bot.callbackQuery(/^askful:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = ctx.match[1];
    return ctx.reply(`สลิป #${id} จัดส่งหรือนัดรับ`, { reply_markup: fulfillmentKeyboard(id) });
  });

  bot.callbackQuery(/^ful:(\d+):(delivery|pickup)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const [, id, fulfillment] = ctx.match;
    const result = await service.updateSlip(Number(id), { fulfillment });
    if (!result) return ctx.reply(`ไม่พบสลิป #${id}`);
    await ctx.editMessageReplyMarkup().catch(() => {});
    return ctx.reply(msg.orderDoneMessage(result.slip));
  });

  bot.callbackQuery(/^del:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const id = ctx.match[1];
    return ctx.reply(`ลบสลิป #${id} ออกจากระบบ? ยอดของสลิปนี้จะไม่ถูกนับ`, {
      reply_markup: new InlineKeyboard().text('ลบสลิป', `delok:${id}`).text('ไม่ลบ', 'cancel'),
    });
  });

  bot.callbackQuery(/^delok:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    const slip = await service.deleteSlip(Number(ctx.match[1]));
    await ctx.editMessageReplyMarkup().catch(() => {});
    return ctx.reply(slip ? `ลบสลิป #${slip.id} แล้ว` : 'ไม่พบสลิปนี้ อาจถูกลบไปแล้ว');
  });

  bot.callbackQuery('cancel', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageReplyMarkup().catch(() => {});
  });

  // ----- ข้อความตอบ: ยอดเงิน หรือสินค้าที่ลูกค้าซื้อ -----
  bot.on('message:text', async (ctx) => {
    const text = ctx.message.text.trim();
    const replied = ctx.message.reply_to_message?.text || '';

    const amountAsk = replied.match(/พิมพ์ยอดเงินของสลิป #(\d+)/);
    if (amountAsk) {
      const id = Number(amountAsk[1]);
      const amount = parseAmountInput(text);
      if (!amount) {
        return ctx.reply(`ยอดเงินไม่ถูกต้อง\n${msg.askAmountMessage(id)}`, { reply_markup: { force_reply: true } });
      }
      const before = await db.getSlip(id);
      const result = await service.updateSlip(id, { amount });
      if (!result) return ctx.reply(`ไม่พบสลิป #${id}`);
      return replyResult(ctx, result, 'อัปเดตสลิปแล้ว', { ask: before?.status === 'pending' });
    }

    const itemAsk = replied.match(/สลิป #(\d+) ลูกค้าซื้ออะไร/);
    let id = itemAsk ? Number(itemAsk[1]) : null;
    if (!id && !text.startsWith('/')) {
      // พิมพ์ตอบโดยไม่ได้กดตอบกลับ: ถือเป็นสินค้าของสลิปล่าสุดที่ยังไม่ระบุ (ภายใน 15 นาที)
      id = (await db.latestAwaitingItem(ctx.chat.id, new Date(Date.now() - 15 * 60_000)))?.id || null;
    }
    if (!id) return ctx.reply('ส่งรูปสลิปเข้ามาได้เลย หรือพิมพ์ /help เพื่อดูคำสั่ง');

    const result = await service.updateSlip(id, { item: text.slice(0, 300) });
    if (!result) return ctx.reply(`ไม่พบสลิป #${id}`);
    if (result.slip.fulfillment) return ctx.reply(msg.orderDoneMessage(result.slip));
    return ctx.reply(msg.askFulfillmentMessage(result.slip), { reply_markup: fulfillmentKeyboard(id) });
  });

  bot.catch((err) => {
    console.error('bot error', err.error || err);
    err.ctx?.reply('เกิดข้อผิดพลาดระหว่างประมวลผล สลิปนี้อาจยังไม่ถูกบันทึก ลองส่งใหม่อีกครั้ง').catch(() => {});
  });

  return bot;
}
