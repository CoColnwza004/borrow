// สร้าง docs/_headers สำหรับ Cloudflare (Workers / Pages) จาก netlify.toml ให้ส่วนหัวความปลอดภัยและแคชตรงกันเสมอ
// Cloudflare รันสคริปต์นี้เป็น Build command ตอน deploy ไฟล์ที่ได้ไม่ต้อง commit (อยู่ใน .gitignore)
// เพราะ Netlify ก็อ่าน docs/_headers ด้วย ถ้ามีทั้งสองที่จะได้ส่วนหัวซ้ำ
const fs = require('fs');
const path = require('path');

function headersFromToml(toml) {
  const blocks = toml.split(/^\[\[headers\]\]\s*$/m).slice(1);
  return blocks.map((b) => ({
    path: (b.match(/^\s*for\s*=\s*"([^"]+)"/m) || [])[1],
    values: [...b.matchAll(/^\s*([A-Z][A-Za-z-]+)\s*=\s*"(.*)"\s*$/gm)].map((m) => [m[1], m[2]]),
  })).filter((h) => h.path && h.values.length);
}

function build(toml) {
  return '# สร้างอัตโนมัติจาก netlify.toml ด้วย scripts/cf-headers.js ห้ามแก้ไฟล์นี้\n' +
    headersFromToml(toml).map((h) => h.path + '\n' + h.values.map(([k, v]) => `  ${k}: ${v}`).join('\n')).join('\n') + '\n';
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const out = path.join(root, 'docs', '_headers');
  fs.writeFileSync(out, build(fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8')));
  console.log('wrote', path.relative(root, out));
}
module.exports = { build };
