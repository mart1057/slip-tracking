// รัน bot และ dashboard ค้างไว้ด้วย pm2:  pm2 start ecosystem.config.cjs
module.exports = {
  apps: [
    {
      name: 'slip-bot',
      cwd: './bot',
      script: 'src/index.js',
      time: true,            // ใส่วันเวลาในบรรทัด log
      restart_delay: 10000,  // ล้มแล้วรอ 10 วินาทีก่อนเริ่มใหม่
    },
    {
      name: 'slip-dashboard',
      cwd: './dashboard',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -H 0.0.0.0 -p 3210',
      time: true,
      restart_delay: 10000,
    },
  ],
};
