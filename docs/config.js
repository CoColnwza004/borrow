// ตั้งค่าการเชื่อมข้อมูล
// - API_URL เว้นว่าง ''  = โหมดทดลอง ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น (PIN เจ้าหน้าที่: 1234)
// - ใส่ URL ของ Google Apps Script Web App (ลงท้ายด้วย /exec) = ใช้ข้อมูลพัสดุ/สต็อกจาก Google Sheets ร่วมกันทุกเครื่อง
// - HOSPITAL_NAME = ชื่อหน่วยงาน แสดงบนหน้าแรกและหัวกระดาษใบเบิก/ใบยืม (PDF)
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwQ-8uov6vswFmpdK_0ABRTia5vQQclwU-f2SnpYGckQOAFWeBji0qdP_GLmTfaKzNURA/exec',
  HOSPITAL_NAME: 'โรงพยาบาลปากเกร็ด',
};
