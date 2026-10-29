// ข้อมูลการ build: ไฟล์นี้ใน repo = เว็บจริง
// ตอน build บน Cloudflare จาก branch อื่นที่ไม่ใช่ branch หลัก ไฟล์นี้ถูกเขียนใหม่เป็น test: true (เว็บทดสอบ) ดู scripts/cf-headers.js
// ลิงก์ preview ของ Netlify (deploy-preview-30--ชื่อเว็บ.netlify.app, ชื่อbranch--ชื่อเว็บ.netlify.app)
// และ Vercel (โปรเจกต์-git-ชื่อbranch-….vercel.app, โปรเจกต์-รหัส9ตัว-….vercel.app) ก็เป็นเว็บทดสอบ: ไม่แตะ Google Sheet จริง
window.BUILD_INFO = {
  test: /--[a-z0-9-]+\.netlify\.app$|-git-[a-z0-9-]+\.vercel\.app$|^[a-z0-9-]+?-[a-z0-9]{9}-[a-z0-9-]+\.vercel\.app$/i.test(location.hostname),
};
