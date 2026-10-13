// ตั้งค่าการเชื่อมข้อมูล
// - API_URL เว้นว่าง ''  = โหมดทดลอง ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น (PIN เจ้าหน้าที่: 1234)
// - ใส่ URL ของ Google Apps Script Web App (ลงท้ายด้วย /exec) = ใช้ข้อมูลพัสดุ/สต็อกจาก Google Sheets ร่วมกันทุกเครื่อง
// - HOSPITAL_NAME = ชื่อหน่วยงาน แสดงบนหน้าเบิกพัสดุและหัวกระดาษใบเบิก (PDF)
// - SHEET_URL (ไม่บังคับ) = ลิงก์ Google Sheet สำหรับหน้า "Google Sheet" ของเจ้าหน้าที่
//   ปกติไม่ต้องใส่ Apps Script เวอร์ชันล่าสุดส่งลิงก์มาให้เอง (เฉพาะคนที่ใส่ PIN)
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyl_jEmWzFDWvubSSnhM0Uiz6ogScqxcKV5x8AwcoNx9eRx2TnXevNcjj6-UMYQXxg5ng/exec',
  HOSPITAL_NAME: 'โรงพยาบาลปากเกร็ด',
};
