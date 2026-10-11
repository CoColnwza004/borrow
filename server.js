const path = require('node:path');
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'borrow.db');

if (!process.env.APP_SECRET) {
  console.warn('คำเตือน: ยังไม่ได้ตั้งค่า APP_SECRET ผู้ใช้จะต้องเข้าสู่ระบบใหม่ทุกครั้งที่รีสตาร์ทเซิร์ฟเวอร์');
}

const db = openDb(DB_FILE);
const app = createApp(db, { stockApiKey: process.env.STOCK_API_KEY });

app.listen(PORT, () => {
  console.log(`ระบบยืม-คืนอุปกรณ์ทำงานที่ http://localhost:${PORT}`);
});
