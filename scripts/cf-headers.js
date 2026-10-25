// สร้าง docs/_headers สำหรับ Cloudflare (Workers / Pages) จาก netlify.toml ให้ส่วนหัวความปลอดภัยและแคชตรงกันเสมอ
// Cloudflare รันสคริปต์นี้เป็น Build command ตอน deploy ไฟล์ที่ได้ไม่ต้อง commit (อยู่ใน .gitignore)
// เพราะ Netlify ก็อ่าน docs/_headers ด้วย ถ้ามีทั้งสองที่จะได้ส่วนหัวซ้ำ
//
// และเขียน docs/build-info.js บอกว่าเว็บนี้ build จาก branch ไหน: branch หลัก = เว็บจริง
// branch อื่น (ลิงก์ preview ของ Cloudflare) = เว็บทดสอบ ไม่แตะ Google Sheet จริง (ดู app.js)
// เขียนเฉพาะตอน build บน Cloudflare (มีตัวแปร WORKERS_CI_BRANCH / CF_PAGES_BRANCH) ที่อื่นใช้ไฟล์ตั้งต้นใน repo = เว็บจริง
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

// branch ที่ Cloudflare ใช้ทำเว็บจริง (Production branch)
const PRODUCTION_BRANCH = 'claude/magical-hamilton-g35q6e';

function buildInfo(env, now = new Date()) {
  const branch = env.WORKERS_CI_BRANCH || env.CF_PAGES_BRANCH || '';
  if (!branch) return null;
  const commit = (env.WORKERS_CI_COMMIT_SHA || env.CF_PAGES_COMMIT_SHA || '').slice(0, 7);
  const info = { branch, commit, builtAt: now.toISOString(), test: branch !== PRODUCTION_BRANCH };
  return '// สร้างอัตโนมัติตอน build บน Cloudflare ด้วย scripts/cf-headers.js\nwindow.BUILD_INFO = ' + JSON.stringify(info) + ';\n';
}

if (require.main === module) {
  const root = path.join(__dirname, '..');
  const out = path.join(root, 'docs', '_headers');
  fs.writeFileSync(out, build(fs.readFileSync(path.join(root, 'netlify.toml'), 'utf8')));
  console.log('wrote', path.relative(root, out));
  const info = buildInfo(process.env);
  if (info) {
    fs.writeFileSync(path.join(root, 'docs', 'build-info.js'), info);
    console.log('wrote docs/build-info.js', info.trim().split('\n').pop());
  }
}
module.exports = { build, buildInfo };
