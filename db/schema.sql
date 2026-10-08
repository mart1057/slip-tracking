-- Slip Tracker: โครงสร้างฐานข้อมูล (PostgreSQL 14+)
-- รันซ้ำได้ ไม่ลบข้อมูลเดิม

CREATE TABLE IF NOT EXISTS accounts (
  id          serial PRIMARY KEY,
  bank_code   text NOT NULL,                 -- รหัสธนาคาร 3 หลัก เช่น 004 = กสิกรไทย
  account_no  text NOT NULL,                 -- เลขบัญชี ตัวเลขล้วน
  identifiers text[] NOT NULL DEFAULT '{}',  -- เลขที่ใช้จับคู่กับสลิป: เลขบัญชี + เบอร์/เลขพร้อมเพย์
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (bank_code, account_no)
);

CREATE TABLE IF NOT EXISTS slips (
  id                  bigserial PRIMARY KEY,
  trans_ref           text NOT NULL UNIQUE,  -- เลขอ้างอิงรายการจาก QR ใช้กันสลิปซ้ำ
  status              text NOT NULL CHECK (status IN ('confirmed', 'pending')),
  transferred_at      timestamptz NOT NULL,  -- วันเวลาโอนตามสลิป
  date_estimated      boolean NOT NULL DEFAULT false, -- true = วันที่ไม่ได้อ่านจากสลิปครบ (date_source เป็น sent หรือ estimated)
  -- ที่มาของวันที่โอน: slip = อ่านจากสลิป, sent = อ่านไม่ได้ ใช้วันที่ส่งสลิป,
  -- estimated = อ่านเดือนไม่ออก ประมาณเดือน, manual = ผู้ใช้แก้เอง
  date_source         text NOT NULL DEFAULT 'slip' CHECK (date_source IN ('slip', 'sent', 'estimated', 'manual')),
  amount              numeric(14,2),
  sender_bank         text,                  -- รหัสธนาคารผู้โอน จาก QR
  sender_name         text,
  receiver_bank       text,                  -- รหัสธนาคารที่รับเงิน
  receiver_account_id integer REFERENCES accounts(id) ON DELETE SET NULL,
  receiver_name       text,
  image_path          text NOT NULL,         -- path ของรูป เทียบกับ SLIP_IMAGE_DIR
  file_hash           text NOT NULL,
  ocr_text            text,
  item                text,                  -- ลูกค้าซื้ออะไร (ผู้ใช้พิมพ์ตอบ bot)
  fulfillment         text CHECK (fulfillment IN ('delivery', 'pickup')), -- จัดส่ง / นัดรับ
  telegram_user_id    bigint,
  telegram_chat_id    bigint,
  telegram_message_id bigint,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  -- สลิปที่ยืนยันแล้วต้องมียอดเงินและธนาคารผู้รับครบ
  CHECK (status = 'pending' OR (amount IS NOT NULL AND amount > 0 AND receiver_bank IS NOT NULL))
);

-- ยอดยกมา: เงินเข้าของแต่ละธนาคารในปีนั้นก่อนเริ่มใช้ระบบ (ไม่มีสลิป) นำไปรวมตอนเทียบเกณฑ์
CREATE TABLE IF NOT EXISTS opening_balances (
  year       integer NOT NULL,              -- ปี ค.ศ.
  bank_code  text NOT NULL,
  count      integer NOT NULL CHECK (count >= 0),
  amount     numeric(14,2) NOT NULL CHECK (amount >= 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (year, bank_code)
);

-- บันทึกว่าส่งสรุปประจำวัน/สัปดาห์ของวันไหนไปแล้ว กันส่งซ้ำเมื่อ bot รีสตาร์ต
CREATE TABLE IF NOT EXISTS report_log (
  kind    text NOT NULL CHECK (kind IN ('daily', 'weekly')),
  period  date NOT NULL,                    -- วันที่ของสรุป (วันสุดท้ายของช่วง) ตามเวลาไทย
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (kind, period)
);

CREATE INDEX IF NOT EXISTS slips_bank_time_idx ON slips (receiver_bank, transferred_at) WHERE status = 'confirmed';
CREATE INDEX IF NOT EXISTS slips_time_idx ON slips (transferred_at DESC);
CREATE INDEX IF NOT EXISTS slips_created_idx ON slips (created_at);

-- ฐานข้อมูลที่สร้างไว้ก่อนมีคอลัมน์สินค้าและการรับของ
-- ฐานข้อมูลที่สร้างไว้ก่อนมีคอลัมน์ที่มาของวันที่: สลิปที่เคยติดธง date_estimated ถือว่าใช้วันที่ส่ง
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'slips' AND column_name = 'date_source') THEN
    ALTER TABLE slips ADD COLUMN date_source text NOT NULL DEFAULT 'slip'
      CHECK (date_source IN ('slip', 'sent', 'estimated', 'manual'));
    UPDATE slips SET date_source = 'sent' WHERE date_estimated;
  END IF;
END $$;

ALTER TABLE slips ADD COLUMN IF NOT EXISTS item text;
ALTER TABLE slips ADD COLUMN IF NOT EXISTS fulfillment text CHECK (fulfillment IN ('delivery', 'pickup'));
