// สร้างรูป Rich menu ของ LINE OA (2500×1686) → docs/apps-script/richmenu.jpg
// รูปนี้ถูกฝังใน AllInOne.gs (npm run build:gs) แล้วฟังก์ชัน setupRichMenu ใน Apps Script อัปโหลดให้เอง
// รัน: node scripts/build-richmenu.js (ต้องมี playwright + chromium) · ตำแหน่งปุ่มต้องตรงกับ LINE_RICHMENU_AREAS ใน Line.gs
const path = require('node:path');
const fs = require('node:fs');
const { chromium } = require('playwright');

const root = path.join(__dirname, '..');
const font = (w) => `url('file://${path.join(root, 'docs/fonts', `Sarabun-${w}-thai.woff2`)}')`;
const fontL = (w) => `url('file://${path.join(root, 'docs/fonts', `Sarabun-${w}-latin.woff2`)}')`;
const ICON = {
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  hourglass: '<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22"/><path d="M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  down: '<polyline points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>',
  box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.3 7 12 12 20.7 7"/><line x1="12" y1="22" x2="12" y2="12"/><path d="M7.5 4.2 16.5 9.4"/>',
  clock: '<rect x="4" y="3" width="16" height="19" rx="2"/><path d="M9 3h6v3H9z"/><circle cx="12" cy="14" r="4"/><path d="M12 12v2l1.5 1"/>',
  search: '<circle cx="11" cy="11" r="7.5"/><path d="m21 21-4.5-4.5"/>',
};
// [ไอคอน, ป้าย, คำอธิบาย, สีเข้ม, สีอ่อน] เรียงซ้าย→ขวา บน→ล่าง
const TILES = [
  ['bell', 'สรุป', 'ภาพรวมประจำวัน', '#0060c7', '#1a8cff'],
  ['hourglass', 'ใกล้หมดอายุ', 'ล็อตที่ต้องรีบใช้', '#b42318', '#f04438'],
  ['down', 'ใกล้หมด', 'ถึงจุดสั่งซื้อ', '#b54708', '#f79009'],
  ['box', 'เบิกวันนี้', 'ใบเบิกของวันนี้', '#0f766e', '#14b8a6'],
  ['clock', 'ยังไม่รับ', 'ยังไม่เซ็นรับของ', '#5925dc', '#875bf7'],
  ['search', 'เช็คสต็อก', 'พิมพ์ "เช็ค" + ชื่อพัสดุ', '#067647', '#17b26a'],
];

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:S;font-weight:400;src:${font(400)};unicode-range:U+0E00-0E7F}
@font-face{font-family:S;font-weight:400;src:${fontL(400)}}
@font-face{font-family:S;font-weight:700;src:${font(700)};unicode-range:U+0E00-0E7F}
@font-face{font-family:S;font-weight:700;src:${fontL(700)}}
*{margin:0;box-sizing:border-box}
body{width:2500px;height:1686px;background:#f2f4f7;font-family:S,sans-serif;display:grid;grid-template-columns:833px 833px 834px;grid-template-rows:843px 843px;gap:0}
.t{position:relative;margin:14px;border-radius:56px;color:#fff;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;overflow:hidden;box-shadow:0 10px 30px rgba(16,24,40,.12)}
.t::after{content:"";position:absolute;right:-120px;top:-120px;width:420px;height:420px;border-radius:50%;background:rgba(255,255,255,.08)}
.ic{width:300px;height:300px;border-radius:50%;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center;margin-bottom:26px}
.ic svg{width:170px;height:170px;fill:none;stroke:#fff;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
b{font-size:132px;line-height:1.15;font-weight:700}
span{font-size:58px;line-height:1.2;opacity:.9}
</style></head><body>${TILES.map(([ic, label, sub, a, b]) =>
  `<div class="t" style="background:linear-gradient(150deg,${b},${a})"><div class="ic"><svg viewBox="0 0 24 24">${ICON[ic]}</svg></div><b>${label}</b><span>${sub}</span></div>`).join('')}</body></html>`;

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 2500, height: 1686 } });
  await page.setContent(html, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  const out = path.join(root, 'docs/apps-script/richmenu.jpg');
  await page.screenshot({ path: out, type: 'jpeg', quality: 68 });
  await browser.close();
  console.log('wrote', path.relative(root, out), fs.statSync(out).size, 'bytes');
})();
