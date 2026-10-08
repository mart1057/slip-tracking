# คำสั่งที่ใช้บ่อย


เริ่มการทำงานทั้งหมด 
`bash ~/Desktop/Private/slip-tracker/setup-autostart.command`

คำสั่ง `pm2` รันจากโฟลเดอร์ไหนก็ได้ ส่วนคำสั่งอื่นให้รันจากโฟลเดอร์ที่ระบุ
## ดูสถานะ

| ต้องการ | คำสั่ง |
|---|---|
| ดูว่าระบบรันอยู่ไหม | `pm2 status` |
| ดู log ของ bot | `pm2 logs slip-bot` |
| ดู log ของหน้าเว็บ | `pm2 logs slip-dashboard` |
| ดู log ย้อนหลัง 50 บรรทัด | `pm2 logs slip-bot --lines 50` |

ออกจากหน้า log ด้วย Ctrl+C (ระบบยังรันต่อ)

## หยุดและเริ่ม

| ต้องการ | คำสั่ง |
|---|---|
| หยุดทั้งหมด | `pm2 stop all` |
| หยุดเฉพาะ bot | `pm2 stop slip-bot` |
| หยุดเฉพาะหน้าเว็บ | `pm2 stop slip-dashboard` |
| เริ่มใหม่ทั้งหมด | `pm2 start all` |
| รีสตาร์ตทั้งหมด | `pm2 restart all` |
| รีสตาร์ตเฉพาะ bot | `pm2 restart slip-bot` |

- `pm2 stop` หยุดชั่วคราว รายการยังอยู่ใน `pm2 status` และสั่ง `pm2 start all` กลับมาได้
- pm2 จำสถานะล่าสุดที่ `pm2 save` ไว้ ถ้าหยุดแล้ว save หลังรีสตาร์ตเครื่องระบบจะไม่เปิดเอง

## หลังแก้ไขหรืออัปเดต

| สิ่งที่เปลี่ยน | คำสั่ง |
|---|---|
| แก้ `bot/.env` หรือโค้ดใน `bot/` | `pm2 restart slip-bot` |
| โค้ดใน `dashboard/` | `cd ~/Desktop/Private/slip-tracker/dashboard && npm run build && pm2 restart slip-dashboard` |
| `db/schema.sql` (มีตารางหรือคอลัมน์ใหม่) | `cd ~/Desktop/Private/slip-tracker/bot && npm run db:init && pm2 restart slip-bot` |
| ไม่แน่ใจว่าเปลี่ยนอะไร | `bash ~/Desktop/Private/slip-tracker/setup-autostart.command` (ทำครบทุกขั้น รันซ้ำได้) |

## ก่อนถอด SSD

ฐานข้อมูลอยู่บน SSD ต้องหยุดตามลำดับนี้ก่อนถอด ไม่เช่นนั้นข้อมูลเสี่ยงเสียหาย

```bash
pm2 stop all
brew services stop postgresql@17
```

เสียบกลับแล้วเริ่มใหม่

```bash
brew services start postgresql@17
pm2 start all
```

## สำรองข้อมูล

```bash
pg_dumpall > ~/pg_backup_$(date +%Y%m%d).sql
```

รูปสลิปอยู่ที่ `bot/data/slips` (หรือ path ใน `SLIP_IMAGE_DIR`) ให้คัดลอกโฟลเดอร์นี้เก็บไว้ด้วย

## ตรวจว่าฐานข้อมูลอยู่บน SSD

```bash
df -h "$(psql -d slip_tracker -Atc 'SHOW data_directory')/"
```

คอลัมน์ Mounted on ต้องขึ้น `/Volumes/SM DATA`

## พอร์ตถูกใช้อยู่

```bash
lsof -i :3210          # ดูว่าโปรแกรมไหนใช้พอร์ตหน้าเว็บ
lsof -i :4000          # ดูว่าโปรแกรมไหนใช้พอร์ต API ของ bot
kill $(lsof -ti :3210) # ปิดโปรแกรมที่ใช้พอร์ตนั้น
```

## เลิกใช้ pm2

```bash
pm2 delete all
pm2 save --force
pm2 unstartup
```

`pm2 unstartup` จะพิมพ์คำสั่ง `sudo ...` อีกบรรทัด ให้คัดลอกไปรัน

หลังจากนั้นถ้าจะรันเองใน Terminal ใช้ `npm start` ในโฟลเดอร์ `bot` และ `dashboard` คนละหน้าต่าง

## คำสั่งใน Telegram

| คำสั่ง | ทำอะไร |
|---|---|
| ส่งรูปสลิป | บันทึกสลิป (พิมพ์ชื่อสินค้าเป็นคำบรรยายใต้รูปได้) |
| `/today` | สรุปของวันนี้ |
| `/week` | สรุป 7 วันล่าสุด |
| `/summary` | สรุปทุกธนาคารของปีนี้ (ดูปีก่อน: `/summary 2569`) |
| `/settotal <ธนาคาร> <จำนวนครั้ง> <ยอดรวม>` | ตั้งยอดรวมของปีนี้จนถึงตอนนี้ เช่น `/settotal กสิกร 49 1358842.64` |
| `/accounts` | ดูบัญชีรับเงินที่ตั้งไว้ |
| `/addaccount <ธนาคาร> <เลขบัญชี> [พร้อมเพย์]` | เพิ่มบัญชีรับเงิน |
| `/delaccount <หมายเลข>` | ลบบัญชีรับเงิน |
| `/last` | ดูสลิปล่าสุด พร้อมปุ่มแก้ไข |
| `/id` | ดู Telegram ID ของคุณ |
| `/help` | ดูคำสั่งทั้งหมด |

## ที่อยู่ของระบบ

| อะไร | ที่ไหน |
|---|---|
| หน้าเว็บ | http://localhost:3210 |
| หน้าเว็บจากเครื่องอื่นใน Wi-Fi เดียวกัน | `http://<IP ของ Mac mini>:3210` (ดู IP ด้วย `ipconfig getifaddr en0`) |
| ตั้งค่า bot | `bot/.env` |
| ฐานข้อมูล | `slip_tracker` ใน Postgres บน SSD |


