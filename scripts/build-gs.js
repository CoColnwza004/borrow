// รวมไฟล์สำหรับ Google Apps Script เป็นไฟล์เดียว: docs/apps-script/AllInOne.gs
// ผู้ใช้วางไฟล์นี้ไฟล์เดียวแทนการวาง Code.gs + Core + SeedData แยกกัน
// รัน: npm run build:gs
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const parts = [
  ['Code.gs (ตัวเชื่อม Google Sheets — แก้ ADMIN_PIN ได้ที่นี่)', 'docs/apps-script/Code.gs'],
  ['Core (กฎการเบิก/ยืมและการตัดสต็อก) — จาก docs/core.js', 'docs/core.js'],
  ['SeedData (รายการพัสดุและแผนกตั้งต้น) — จาก docs/seed-data.js', 'docs/seed-data.js'],
];

function build() {
  const header = `/**
 * ระบบเบิก-ยืมพัสดุ — ไฟล์รวมสำหรับ Google Apps Script (ไฟล์เดียวจบ)
 * ไฟล์นี้สร้างอัตโนมัติด้วย npm run build:gs ห้ามแก้ตรงนี้ ให้แก้ไฟล์ต้นฉบับใน docs/ แล้ว build ใหม่
 *
 * วิธีใช้: ใน Apps Script ให้มีไฟล์ Code.gs ไฟล์เดียว ลบเนื้อหาเดิมทั้งหมด แล้ววางไฟล์นี้ทั้งไฟล์
 * จากนั้นแก้ ADMIN_PIN ด้านล่าง กดบันทึก แล้วเรียกใช้ฟังก์ชัน setup
 */
`;
  const body = parts.map(([title, file]) =>
    `\n// ==================== ${title} ====================\n\n` + fs.readFileSync(path.join(root, file), 'utf8').trimEnd() + '\n').join('');
  return header + body;
}

if (require.main === module) {
  const out = path.join(root, 'docs/apps-script/AllInOne.gs');
  fs.writeFileSync(out, build());
  console.log('wrote', path.relative(root, out), fs.statSync(out).size, 'bytes');
}
module.exports = { build };
