// ตั้งค่าการเชื่อมข้อมูล
// - API_URL เว้นว่าง ''  = โหมดทดลอง ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น (PIN เจ้าหน้าที่: 1234)
// - ใส่ URL ของ Google Apps Script Web App (ลงท้ายด้วย /exec) = ใช้ข้อมูลพัสดุ/สต็อกจาก Google Sheets ร่วมกันทุกเครื่อง
// - HOSPITAL_NAME = ชื่อหน่วยงาน แสดงบนหน้าเบิกพัสดุและหัวกระดาษใบเบิก (PDF)
// - STAFF_NAME = ชื่อเจ้าหน้าที่พัสดุ แสดงในวงเล็บใต้ช่องลงชื่อ "เจ้าหน้าที่พัสดุ" ในใบเบิก (PDF)
// - PIN_LENGTH = จำนวนหลักของรหัสเจ้าหน้าที่พัสดุ (ต้องตรงกับ ADMIN_PIN ใน Apps Script) หน้าใส่รหัสตรวจเองเมื่อใส่ครบ
// - TEST_API_URL (ไม่บังคับ) = URL /exec ของ Google Sheet สำเนาสำหรับทดสอบ ใช้เฉพาะเว็บทดสอบ (ลิงก์ preview ของ Cloudflare)
//   เว้นว่าง = เว็บทดสอบใช้โหมดทดลอง (ข้อมูลอยู่ในเบราว์เซอร์ ไม่แตะชีตจริง)
// - SHEET_URL (ไม่บังคับ) = ลิงก์ Google Sheet สำหรับหน้า "Google Sheet" ของเจ้าหน้าที่
//   ปกติไม่ต้องใส่ Apps Script เวอร์ชันล่าสุดส่งลิงก์มาให้เอง (เฉพาะคนที่ใส่ PIN)
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbympkHAvksAQhtFxKcp7J68PXGVbd7bvTZTNFkPDpKEh82g-WEwEuhDXY36lWyc39hb1w/exec',
  HOSPITAL_NAME: 'โรงพยาบาลปากเกร็ด',
  STAFF_NAME: 'เสาวลักษณ์ ถาน้อย',
  PIN_LENGTH: 4,
  // กระดิ่งแจ้งเตือนของเจ้าหน้าที่พัสดุ: เตือนพัสดุที่จะหมดอายุภายในกี่เดือน
  EXPIRY_ALERT_MONTHS: 8,
  TEST_API_URL: '',
};
