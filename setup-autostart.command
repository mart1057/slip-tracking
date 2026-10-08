#!/bin/bash
# ตั้งค่าให้ bot และ dashboard รันค้างด้วย pm2 และเปิดเองหลังรีสตาร์ตเครื่อง
# วิธีใช้: bash ~/Desktop/Private/slip-tracker/setup-autostart.command   (รันซ้ำได้)

ROOT="$(cd "$(dirname "$0")" && pwd)"
API_PORT=4000
WEB_PORT=3210

step() { printf '\n\033[1m▶ %s\033[0m\n' "$1"; }
fail() { printf '\n\033[31m✖ %s\033[0m\n' "$1"; exit 1; }

# ใช้ PATH เดียวกับ Terminal ปกติ เพื่อให้เจอ node ที่ลงผ่าน Homebrew หรือ nvm
if [ -x /bin/zsh ]; then
  USER_PATH="$(/bin/zsh -lic 'print -r -- $PATH' 2>/dev/null | tail -1)"
  [ -n "$USER_PATH" ] && export PATH="$USER_PATH"
fi

step "ตรวจโปรแกรมที่ต้องใช้"
command -v node >/dev/null || fail "ไม่พบ node ใน PATH"
command -v npm >/dev/null || fail "ไม่พบ npm ใน PATH"
[ -f "$ROOT/bot/.env" ] || fail "ไม่พบ bot/.env"
echo "node $(node -v), โปรเจกต์อยู่ที่ $ROOT"

# ปิดตัวที่รันค้างอยู่ใน Terminal (เฉพาะโปรเซสของโปรเจกต์นี้) เพื่อให้ pm2 ใช้พอร์ตได้
step "ปิด bot และ dashboard ที่รันอยู่ใน Terminal"
PM2_PIDS=""
if command -v pm2 >/dev/null; then PM2_PIDS=" $(pm2 pid slip-bot 2>/dev/null) $(pm2 pid slip-dashboard 2>/dev/null) "; fi
for port in $API_PORT $WEB_PORT; do
  for pid in $(lsof -ti "tcp:$port" -sTCP:LISTEN 2>/dev/null); do
    case "$PM2_PIDS" in *" $pid "*) continue ;; esac   # ตัวที่ pm2 ดูแลอยู่แล้ว ให้ pm2 รีสตาร์ตเอง
    cwd="$(lsof -a -p "$pid" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')"
    case "$cwd" in
      "$ROOT"*) echo "ปิดโปรเซส $pid (พอร์ต $port)"; kill "$pid" ;;
      *) fail "พอร์ต $port ถูกใช้โดยโปรแกรมอื่น (pid $pid ที่ ${cwd:-ไม่ทราบ}) ปิดโปรแกรมนั้นก่อนแล้วรันใหม่" ;;
    esac
  done
done
sleep 2

step "อัปเดตฐานข้อมูล"
cd "$ROOT/bot" || fail "ไม่พบโฟลเดอร์ bot"
npm install --no-audit --no-fund || fail "npm install ของ bot ไม่สำเร็จ"
npm run -s db:init || fail "เชื่อมต่อฐานข้อมูลไม่ได้ ตรวจว่าเสียบ SSD และ Postgres ทำงานอยู่ (brew services start postgresql@17)"

step "build หน้าเว็บ"
cd "$ROOT/dashboard" || fail "ไม่พบโฟลเดอร์ dashboard"
npm install --no-audit --no-fund || fail "npm install ของ dashboard ไม่สำเร็จ"
npm run -s build || fail "build หน้าเว็บไม่สำเร็จ"

step "เริ่มระบบด้วย pm2"
if ! command -v pm2 >/dev/null; then
  npm install -g pm2 --no-audit --no-fund || fail "ติดตั้ง pm2 ไม่สำเร็จ"
fi
cd "$ROOT" || exit 1
pm2 startOrRestart ecosystem.config.cjs || fail "pm2 เริ่มระบบไม่สำเร็จ"
pm2 save

step "ตรวจว่าระบบทำงาน"
ok_api=""; ok_web=""
for i in $(seq 1 30); do
  [ -z "$ok_api" ] && curl -fs -m 2 "http://127.0.0.1:$API_PORT/api/health" >/dev/null 2>&1 && ok_api=1
  [ -z "$ok_web" ] && curl -fs -m 2 -o /dev/null "http://127.0.0.1:$WEB_PORT/" 2>/dev/null && ok_web=1
  [ -n "$ok_api" ] && [ -n "$ok_web" ] && break
  sleep 2
done
[ -n "$ok_api" ] && echo "✔ bot และ API ทำงานแล้ว" || echo "✖ bot ยังไม่ขึ้น ดูสาเหตุด้วย: pm2 logs slip-bot --lines 30"
[ -n "$ok_web" ] && echo "✔ หน้าเว็บทำงานแล้ว: http://localhost:$WEB_PORT" || echo "✖ หน้าเว็บยังไม่ขึ้น ดูสาเหตุด้วย: pm2 logs slip-dashboard --lines 30"

if [ -z "$SKIP_STARTUP" ]; then
  step "ตั้งให้เปิดเองหลังรีสตาร์ตเครื่อง"
  STARTUP_CMD="$(pm2 startup 2>/dev/null | grep -E '^sudo ' | tail -1)"
  if [ -n "$STARTUP_CMD" ]; then
    echo "ขั้นนี้ต้องใช้สิทธิ์ผู้ดูแลเครื่อง คำสั่งที่จะรันคือ:"
    echo "  $STARTUP_CMD"
    echo "ใส่รหัสผ่านของเครื่อง Mac แล้วกด Enter (ตอนพิมพ์จะไม่เห็นตัวอักษร)"
    eval "$STARTUP_CMD" && pm2 save && echo "✔ ตั้งค่าเปิดเองเรียบร้อย" || echo "✖ ตั้งค่าเปิดเองไม่สำเร็จ รัน pm2 startup เองแล้วทำตามที่ขึ้น"
  else
    echo "pm2 ไม่ได้แจ้งคำสั่งเพิ่มเติม (อาจตั้งค่าไว้แล้ว) ถ้าไม่แน่ใจ รัน: pm2 startup"
  fi
fi

step "สถานะ"
pm2 status
echo
echo "เสร็จแล้ว ปิดหน้าต่างนี้ได้ ระบบจะรันต่อเบื้องหลัง"
