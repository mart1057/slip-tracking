"""สร้างรูปสลิปจำลองสำหรับทดสอบ (ไม่ใช่สลิปจริง ทุกชื่อและเลขบัญชีเป็นข้อมูลสมมติ)"""
import sys, qrcode
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/opentype/tlwg/Loma.otf"
BOLD = "/usr/share/fonts/opentype/tlwg/Loma-Bold.otf"

def crc16(s: str) -> str:
    crc = 0xFFFF
    for b in s.encode():
        crc ^= b << 8
        for _ in range(8):
            crc = ((crc << 1) ^ 0x1021) & 0xFFFF if crc & 0x8000 else (crc << 1) & 0xFFFF
    return f"{crc:04X}"

def tlv(tag, val): return f"{tag}{len(val):02d}{val}"

def mini_qr(bank, ref):
    inner = tlv("00", "000001") + tlv("01", bank) + tlv("02", ref)
    body = tlv("00", inner) + tlv("51", "TH") + "9104"
    return body + crc16(body)

def slip(path, lines, bank, ref, w=720, h=1180, qr=True, bg="white"):
    img = Image.new("RGB", (w, h), bg)
    d = ImageDraw.Draw(img)
    y = 40
    for text, size, bold in lines:
        if text:
            d.text((48, y), text, font=ImageFont.truetype(BOLD if bold else FONT, size), fill=(20, 20, 20))
        y += int(size * 1.75)
    if qr:
        q = qrcode.QRCode(border=2, box_size=4, error_correction=qrcode.constants.ERROR_CORRECT_M)
        q.add_data(mini_qr(bank, ref)); q.make()
        qi = q.make_image().convert("RGB")
        img.paste(qi, (w - qi.width - 40, h - qi.height - 40))
    img.save(path)

# 1) สไตล์ K PLUS: กสิกร -> กสิกร
slip("kplus.png", [
    ("โอนเงินสำเร็จ", 40, True),
    ("8 ต.ค. 69 12:40 น.", 26, False),
    ("", 20, False),
    ("นาย สมชาย ใจดี", 30, True),
    ("ธ.กสิกรไทย", 24, False),
    ("xxx-x-x4321-x", 24, False),
    ("", 20, False),
    ("นาง สมหญิง รักไทย", 30, True),
    ("ธ.กสิกรไทย", 24, False),
    ("xxx-x-x6789-x", 24, False),
    ("", 20, False),
    ("เลขที่รายการ:", 22, False),
    ("016281124012BPM01234", 24, False),
    ("จำนวน:", 22, False),
    ("1,500.00 บาท", 34, True),
    ("ค่าธรรมเนียม:", 22, False),
    ("0.00 บาท", 24, False),
], "004", "016281124012BPM01234")

# 2) สไตล์ SCB: ไทยพาณิชย์ -> กรุงเทพ (ต่างธนาคาร)
slip("scb.png", [
    ("SCB", 44, True),
    ("โอนเงินสำเร็จ", 36, True),
    ("08 ต.ค. 2569 - 09:15", 26, False),
    ("รหัสอ้างอิง: 202610081Abc9XyZ00012", 22, False),
    ("", 20, False),
    ("จาก    นาย วิชัย มั่นคง", 28, False),
    ("        xxx-xxx123-4", 24, False),
    ("ไปยัง   นาง สมหญิง รักไทย", 28, False),
    ("        ธนาคารกรุงเทพ", 24, False),
    ("        xxx-x-x5566-x", 24, False),
    ("", 20, False),
    ("จำนวนเงิน", 24, False),
    ("25,000.00", 40, True),
    ("ค่าธรรมเนียม  0.00", 22, False),
], "014", "202610081Abc9XyZ00012", bg=(248, 244, 252))

# 3) ภาษาอังกฤษ: Krungthai -> KBank, พร้อมเพย์
slip("ktb_en.png", [
    ("Krungthai NEXT", 40, True),
    ("Transfer Completed", 34, True),
    ("Reference No. A1b2C3d4E5f6G7h8", 22, False),
    ("", 20, False),
    ("From   MS. PIMCHANOK S.", 28, False),
    ("       Krungthai Bank", 24, False),
    ("       XXX-X-XX901-2", 24, False),
    ("To     MRS. SOMYING R.", 28, False),
    ("       PromptPay", 24, False),
    ("       xxx-xxx-4455", 24, False),
    ("", 20, False),
    ("Amount   320.50 THB", 30, True),
    ("Fee      0.00 THB", 24, False),
    ("Date     07 Oct 2026 - 18:05", 24, False),
], "006", "A1b2C3d4E5f6G7h8")

# 4) ธนาคารผู้รับไม่ชัด: ไม่มีชื่อธนาคารผู้รับและเลขบัญชีไม่ตรงกับที่ตั้งไว้
slip("unknown_bank.png", [
    ("โอนเงินสำเร็จ", 40, True),
    ("6 ต.ค. 69 08:01 น.", 26, False),
    ("", 20, False),
    ("นาย ธนา พูนผล", 30, True),
    ("xxx-x-x1111-x", 24, False),
    ("", 20, False),
    ("นาง สมหญิง รักไทย", 30, True),
    ("xxx-x-x0000-x", 24, False),
    ("", 20, False),
    ("จำนวน:", 22, False),
    ("750.00 บาท", 34, True),
    ("ค่าธรรมเนียม:", 22, False),
    ("0.00 บาท", 24, False),
], "004", "016279080100BPM09999")

# 5) ไม่มี QR (เช่น รูปถูกครอป)
slip("no_qr.png", [
    ("โอนเงินสำเร็จ", 40, True),
    ("จำนวน: 100.00 บาท", 30, False),
], "004", "X", qr=False, h=400)
print("ok")
