/**
 * ระบบเบิก-ยืมพัสดุ — ไฟล์รวมสำหรับ Google Apps Script (ไฟล์เดียวจบ)
 * ไฟล์นี้สร้างอัตโนมัติด้วย npm run build:gs ห้ามแก้ตรงนี้ ให้แก้ไฟล์ต้นฉบับใน docs/ แล้ว build ใหม่
 *
 * วิธีใช้: ใน Apps Script ให้มีไฟล์ Code.gs ไฟล์เดียว ลบเนื้อหาเดิมทั้งหมด แล้ววางไฟล์นี้ทั้งไฟล์
 * จากนั้นแก้ ADMIN_PIN ด้านล่าง (หรือตั้งใน คุณสมบัติของสคริปต์) กดบันทึก แล้วเรียกใช้ฟังก์ชัน setup
 */

// ==================== Code.gs (ตัวเชื่อม Google Sheets — แก้ ADMIN_PIN ได้ที่นี่) ====================

/**
 * ตัวเชื่อม Google Sheets สำหรับระบบเบิกพัสดุ
 * วิธีติดตั้งอยู่ใน README.md หัวข้อ "ขั้นที่ 2: เชื่อม Google Sheets"
 *
 * วิธีง่ายสุด: วาง docs/apps-script/AllInOne.gs (รวมทุกไฟล์ไว้แล้ว) ลงใน Code.gs ไฟล์เดียว
 * หรือแยกเป็น 3 ไฟล์:
 *   Core.gs      = คัดลอกเนื้อหาทั้งหมดจาก docs/core.js
 *   SeedData.gs  = คัดลอกเนื้อหาทั้งหมดจาก docs/seed-data.js (รายการพัสดุ/ยอดคงเหลือ และรายชื่อแผนกตั้งต้น)
 *   Code.gs      = ไฟล์นี้
 */

// *** เปลี่ยนรหัส PIN สำหรับเจ้าหน้าที่พัสดุ (ใช้ดูประวัติเบิก / จัดการสต็อก) ***
// แนะนำ: ตั้งใน ตั้งค่าโปรเจ็กต์ (⚙) → คุณสมบัติของสคริปต์ → ADMIN_PIN = รหัสของคุณ ครั้งเดียว
// แล้ววางโค้ดเวอร์ชันใหม่ทับได้เลยโดยไม่ต้องแก้บรรทัดนี้ (ค่าในคุณสมบัติของสคริปต์ใช้ก่อน)
var ADMIN_PIN = '1234';
function adminPin_() {
  try { return PropertiesService.getScriptProperties().getProperty('ADMIN_PIN') || ADMIN_PIN; } catch (e) { return ADMIN_PIN; }
}

// ชื่อแท็บคงไว้ตามเวอร์ชันก่อน เพื่อให้ชีตที่ใช้งานอยู่แล้วอ่านต่อได้
var SHEET_NAMES = {
  items: 'อุปกรณ์',
  requests: 'ประวัติการเบิก',
  request_items: 'รายการในคำขอ',
  movements: 'ประวัติสต็อก',
  departments: 'หน่วยงาน',
  categories: 'หมวดหมู่',
  suppliers: 'บริษัท', // บริษัทผู้จำหน่าย (เลือกตอนรับเข้า/เพิ่มพัสดุ) สร้างให้เองตอนบันทึกครั้งแรก
  units: 'หน่วยนับ', // ตัวเลือกหน่วยนับ (ชิ้น กล่อง ขวด ม้วน โหล ...) เพิ่มในชีตหรือในเว็บก็ได้
  locations: 'สถานที่เก็บ', // ตัวเลือกสถานที่เก็บพัสดุ
  budgets: 'งบประมาณแผนก', // งบประมาณแต่ละแผนกต่อปีงบประมาณ (ตั้ง/ปรับในหน้า งบประมาณ ของเว็บ) ใบเบิกตัดงบอัตโนมัติ
  // แท็บนี้สร้างใหม่ทุกครั้ง ไว้ดูอย่างเดียว ระบบไม่อ่านกลับ (สร้างครั้งแรกจะย้ายไปไว้หน้าสุด)
  log: 'รายการเบิก',
};

// ชื่อแท็บเดิม: ชีตที่ใช้งานอยู่แล้วจะถูกเปลี่ยนชื่อให้อัตโนมัติ (ข้อมูลเดิมอยู่ครบ)
var LEGACY_NAMES = { requests: ['คำขอยืม'], log: ['รายการเบิก-ยืม'] };
// แท็บของระบบยืมเดิม (เลิกใช้แล้ว) ลบทิ้งให้อัตโนมัติตอนบันทึกครั้งถัดไป
var OBSOLETE_SHEETS = ['พัสดุที่ถูกยืมอยู่'];

function sheet_(ss, t) {
  var sh = ss.getSheetByName(SHEET_NAMES[t]);
  if (sh) return sh;
  var old = (LEGACY_NAMES[t] || []).map(function (n) { return ss.getSheetByName(n); }).filter(Boolean)[0];
  if (old) old.setName(SHEET_NAMES[t]);
  return old || null;
}

/**
 * รันจากหน้า Apps Script เพื่อสร้างแท็บและใส่รายการพัสดุ/แผนกจาก SeedData
 * รันซ้ำได้จนกว่าจะเริ่มมีการเบิกจริง (จะเขียนทับรายการพัสดุ แผนก และประวัติสต็อกทั้งหมด)
 */
function setup() {
  if (typeof SEED_DATA === 'undefined') throw new Error('ไม่พบไฟล์ SeedData กรุณาคัดลอก docs/seed-data.js มาเป็นไฟล์ SeedData ก่อน');
  var sh = sheet_(SpreadsheetApp.getActiveSpreadsheet(), 'requests');
  if (sh && sh.getLastRow() > 1) {
    throw new Error('มีรายการเบิกในชีตแล้ว ไม่ได้เขียนทับ — ถ้าจะเพิ่มแท็บ/คอลัมน์ใหม่หลังอัปเดตโค้ด ให้รัน updateSheet แทน');
  }
  saveDb_(BorrowCore.seed(new Date(), SEED_DATA));
  removeAutoReturnTrigger_();
}

/**
 * หลังวางโค้ดเวอร์ชันใหม่: รันฟังก์ชันนี้ได้ทุกเมื่อ (เลือก updateSheet แล้วกด เรียกใช้) ข้อมูลเดิมอยู่ครบ
 * สร้างแท็บที่ยังไม่มี (เช่น บริษัท) เพิ่มคอลัมน์ใหม่ และลบแท็บของระบบยืมเดิม · ปกติระบบทำให้เองตอนบันทึกครั้งแรกอยู่แล้ว
 */
function updateSheet() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var missing = Object.keys(SHEET_NAMES).filter(function (t) { return !sheet_(ss, t); })
      .map(function (t) { return SHEET_NAMES[t]; });
    var db = loadDb_();
    saveDb_(db);
    removeAutoReturnTrigger_();
    Logger.log('อัปเดตชีตเรียบร้อย' + (missing.length ? ': สร้างแท็บ ' + missing.join(', ') : ' (มีแท็บครบแล้ว)') +
      ' · พัสดุ ' + db.items.length + ' รายการ, ใบเบิก ' + db.requests.length + ' ใบ อยู่ครบ');
  } finally {
    lock.releaseLock();
  }
}

/**
 * ปรับตามรายงานบัญชีวัสดุ 2569 (ข้อมูลใน REPORT_2569 ท้ายไฟล์นี้) — ทำ 2 ขั้น:
 * 1) previewReport2569: ดูก่อนว่าจะเปลี่ยนอะไร (ยังไม่แก้ข้อมูล) ผลอยู่ในแท็บ "ปรับตามรายงาน 2569"
 * 2) applyReport2569: ปรับจริง — ราคาต่อหน่วยตามคอลัมน์ N, รายการที่ยอดคงเหลือในรายงานเป็น "-" ปรับจำนวนเป็น 0,
 *    เพิ่มรายชื่อบริษัทที่ยังไม่มี · ไม่แตะยอดคงเหลือรายการอื่น · รันซ้ำได้ · ย้อนกลับได้ที่ ไฟล์ → ประวัติเวอร์ชัน
 */
function previewReport2569() { reportRun_(false); }
function applyReport2569() { reportRun_(true); }
function reportRun_(apply) {
  if (typeof REPORT_2569 === 'undefined') throw new Error('ไม่พบข้อมูล REPORT_2569 กรุณาวางไฟล์ AllInOne.gs ให้ครบทั้งไฟล์');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = loadDb_();
    var res = BorrowCore.applyReport(db, REPORT_2569);
    if (apply) saveDb_(db);
    var rows = [['สถานะ', apply ? 'ปรับแล้ว ' + Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm') : 'ตัวอย่าง (ยังไม่ได้ปรับ) — รัน applyReport2569 เพื่อปรับจริง', '', '', '']];
    rows.push(['สรุป', 'ปรับราคา ' + res.priced.length + ' รายการ', 'ปรับจำนวนเป็น 0: ' + res.zeroed.length + ' รายการ', 'เพิ่มบริษัท ' + res.suppliers.length + ' ราย', 'ตรงอยู่แล้ว ' + res.same + ' รายการ']);
    rows.push(['', '', '', '', '']);
    rows.push(['ประเภท', 'รหัส', 'ชื่อพัสดุ / บริษัท', 'เดิม', 'ใหม่']);
    res.priced.forEach(function (x) { rows.push(['ราคาต่อหน่วย', x.code, x.name, x.from, x.to]); });
    res.zeroed.forEach(function (x) { rows.push(['จำนวนคงเหลือ → 0', x.code, x.name, x.from, 0]); });
    res.suppliers.forEach(function (n) { rows.push(['เพิ่มบริษัท', '', n, '', '']); });
    res.mismatch.forEach(function (x) { rows.push(['ข้าม: ชื่อไม่ตรง', x.code, x.name, 'ในรายงาน: ' + x.expected, '']); });
    res.missing.forEach(function (x) { rows.push(['ข้าม: ไม่พบรหัสนี้ในระบบ', x.code, x.name, x.report, '']); });
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var name = 'ปรับตามรายงาน 2569';
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    sh.clear();
    sh.getRange(1, 1, rows.length, 5).setNumberFormat('@').setValues(rows.map(function (r) { return r.map(String); }));
    sh.getRange(4, 1, 1, 5).setFontWeight('bold').setBackground('#e8f0fe');
    sh.setFrozenRows(4);
    sh.autoResizeColumns(1, 5);
    Logger.log((apply ? 'ปรับแล้ว: ' : 'ตัวอย่าง: ') + rows[1].slice(1).join(' · ') + ' · ดูรายละเอียดในแท็บ "' + name + '"');
  } finally {
    lock.releaseLock();
  }
}

// ระบบยืมเดิมตั้งเวลา "คืนอัตโนมัติ" ไว้ทุกวัน ตอนนี้เลิกใช้แล้ว: ลบตัวตั้งเวลานั้นออก
function removeAutoReturnTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoReturnDaily') ScriptApp.deleteTrigger(t);
  });
}

/**
 * ก่อนเปิดใช้งานจริง: รันฟังก์ชันนี้ 1 ครั้งจากหน้า Apps Script (เลือก resetForLaunch แล้วกด เรียกใช้)
 * ล้างประวัติการเบิก รายการในคำขอ และประวัติสต็อกทั้งหมด แล้วตั้งยอดคงเหลือทุกรายการเป็น 0
 * รายชื่อพัสดุ รายชื่อแผนก และหมวดหมู่อยู่ครบ · ถ้ารันผิด ย้อนกลับได้ที่ Google Sheet → ไฟล์ → ประวัติเวอร์ชัน
 */
function resetForLaunch() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = loadDb_();
    var n = BorrowCore.resetForLaunch(db);
    saveDb_(db);
    Logger.log('รีเซ็ตเรียบร้อย: ลบใบเบิก ' + n.requests + ' ใบ, ประวัติสต็อก ' + n.movements + ' รายการ, ตั้งยอด ' +
      db.items.length + ' รายการเป็น 0 (เก็บแผนก ' + db.departments.length + ' แผนกไว้)');
  } finally {
    lock.releaseLock();
  }
}

/**
 * ล้างสต็อกเดิมทั้งหมด แล้วใส่รายการพัสดุและยอดคงเหลือตามไฟล์ Stock ล่าสุด (SEED_DATA ในไฟล์นี้)
 * รัน 1 ครั้งจากหน้า Apps Script (เลือก loadNewStock แล้วกด เรียกใช้)
 * ล้างประวัติการเบิกและประวัติสต็อกด้วย · รายชื่อแผนกอยู่ครบ · ย้อนกลับได้ที่ ไฟล์ → ประวัติเวอร์ชัน
 */
function loadNewStock() {
  if (typeof SEED_DATA === 'undefined') throw new Error('ไม่พบข้อมูล SEED_DATA กรุณาวางไฟล์ AllInOne.gs ให้ครบทั้งไฟล์');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = loadDb_();
    var before = BorrowCore.replaceStock(db, SEED_DATA, new Date());
    saveDb_(db);
    Logger.log('ใส่สต็อกใหม่เรียบร้อย: ' + db.items.length + ' รายการ (เดิม ' + before.items + ' รายการ, ลบใบเบิก ' + before.requests +
      ' ใบ) จาก ' + SEED_DATA.source + ' · แผนก ' + db.departments.length + ' แผนกอยู่ครบ');
  } finally {
    lock.releaseLock();
  }
}

/** ตัวตั้งเวลารายวันของระบบยืมเดิมอาจยังเรียกฟังก์ชันนี้อยู่: ไม่ทำอะไรนอกจากลบตัวตั้งเวลานั้นทิ้ง */
function autoReturnDaily() {
  removeAutoReturnTrigger_();
}

function doGet() {
  return handle_({ action: 'load' });
}

// ยอดสต็อกสำหรับผู้ใช้ทั่วไป (ไม่มีชื่อผู้เบิก) เก็บไว้ในแคช 20 วินาที: คนเปิดเว็บพร้อมกันหลายคน / หน้าพัสดุคงเหลือที่ดึงยอดทุก 45 วินาที
// ไม่ต้องอ่านชีตทั้งไฟล์และไม่ต้องรอคิวกัน · บันทึกผ่านเว็บแล้วแคชอัปเดตทันที · แก้ในชีตเองเห็นบนเว็บภายใน 20 วินาที
var PUBLIC_CACHE_KEY = 'public-state-v2';
var PUBLIC_CACHE_SEC = 20;
function cache_() {
  try { return typeof CacheService === 'undefined' ? null : CacheService.getScriptCache(); } catch (e) { return null; }
}
function cachePublic_(db) {
  var c = cache_();
  if (!c) return;
  var s = JSON.stringify(BorrowCore.publicView(db, 0));
  try { if (s.length < 95000) c.put(PUBLIC_CACHE_KEY, s, PUBLIC_CACHE_SEC); else c.remove(PUBLIC_CACHE_KEY); } catch (e) { /* แคชเต็ม/ใช้ไม่ได้ อ่านจากชีตตามปกติ */ }
}

function doPost(e) {
  var body;
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'คำขอไม่ถูกต้อง' });
  }
  // Webhook จาก LINE OA (มี events) — ดู Line.gs
  if (body && Array.isArray(body.events) && body.destination !== undefined) {
    return typeof lineWebhook_ === 'function' ? lineWebhook_(body) : json_({ ok: true });
  }
  return handle_(body);
}

function handle_(body) {
  var isAdmin = String(body.pin || '') === adminPin_();
  if (body.action === 'load' && !isAdmin) {
    var c = cache_();
    var hit = c && c.get(PUBLIC_CACHE_KEY);
    if (hit) return ContentService.createTextOutput('{"ok":true,"result":null,"state":' + hit + '}').setMimeType(ContentService.MimeType.JSON);
  }
  // อ่านอย่างเดียว (โหลดข้อมูล / ตรวจรหัส) ไม่ต้องรอคิว — หลายเครื่องเปิดพร้อมกัน (รวม Live board) ไม่ต้องรอกัน
  // ส่วนการบันทึกยังเข้าคิวทีละคำขอ (อ่านชีตล่าสุดภายในคิว) ข้อมูลไม่ทับกัน
  var readOnly = body.action === 'load' || body.action === 'checkPin';
  var lock = readOnly ? null : LockService.getScriptLock();
  if (lock) lock.waitLock(20000);
  try {
    var db = loadDb_();
    var result = null;
    if (!readOnly) {
      result = BorrowCore.run(db, body.action, body.payload, { isAdmin: isAdmin });
      saveDb_(db);
      // แจ้งเตือน LINE OA (ถ้าตั้งไว้ · ติดตั้งแบบแยกไฟล์โดยไม่มี Line.gs = ข้ามไป)
      if (body.action === 'createRequest' && typeof lineOnRequest_ === 'function') lineOnRequest_(db, result);
    } else if (body.action === 'checkPin') {
      result = BorrowCore.run(db, 'checkPin', null, { isAdmin: isAdmin });
    } else {
      cachePublic_(db);
    }
    // ประวัติการเบิกส่งให้เฉพาะเจ้าหน้าที่ (มี PIN) ผู้ใช้ทั่วไปได้เฉพาะสต็อกและใบที่เพิ่งส่ง
    var state = isAdmin ? db : BorrowCore.publicView(db, body.action === 'createRequest' ? result : 0);
    var out = { ok: true, result: result, state: state };
    // ลิงก์ชีตให้เจ้าหน้าที่เท่านั้น (หน้า Google Sheet บนเว็บ)
    if (isAdmin) {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      out.sheet = { url: ss.getUrl(), name: ss.getName() };
      try { if (typeof lineStatus_ === 'function') out.line = lineStatus_(); } catch (e) { /* ยังไม่อนุญาตสิทธิ์ใหม่ */ }
    }
    return json_(out);
  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    if (lock) lock.releaseLock();
  }
}

// แท็บประวัติการเบิก: หัวคอลัมน์อ่านง่ายสีเขียวอ่อน ข้อมูลระบบท้ายตารางสีเทา รายการพัสดุขึ้นบรรทัดใหม่ทีละชิ้น
function formatReadable_(sh, d, nRows) {
  var n = d.header.length;
  sh.setFrozenColumns(1);
  sh.getRange(1, 1, 1, d.front).setBackground('#e6f4ea');
  sh.getRange(1, d.front + 1, 1, d.sys).setBackground('#f1f3f4').setFontColor('#80868b').setFontWeight('normal');
  sh.getRange(1, 1, Math.max(nRows, 2), n).setVerticalAlignment('top');
  sh.autoResizeColumns(1, d.front);
  sh.setColumnWidth(d.wide, 340);
  sh.getRange(1, d.wide, Math.max(nRows, 2), 1).setWrap(true);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ค่าในชีตตอนอ่าน (เป็นข้อความ) ใช้เทียบตอนบันทึก แท็บที่ไม่เปลี่ยนจะไม่ถูกเขียนใหม่ บันทึกเร็วขึ้นมาก
var RAW_ = {};

// เขียนเฉพาะส่วนที่เปลี่ยน (หัวตารางเหมือนเดิม): คืน true ถ้าเขียนแล้ว
// - แถวใหม่ต่อท้าย (ประวัติสต็อก, รายการในคำขอ) → เขียนเฉพาะแถวใหม่
// - แถวใหม่อยู่บนสุด (ประวัติการเบิก, รายการเบิก เรียงล่าสุดอยู่บน) → แทรกแถวใต้หัวตาราง
// - จำนวนแถวเท่าเดิม แก้ไม่กี่แถว (ยอดคงเหลือในแท็บพัสดุ) → เขียนเฉพาะแถวที่เปลี่ยน
// ข้อมูลยิ่งเยอะ ยิ่งประหยัดเวลากว่าเขียนใหม่ทั้งแท็บ
function writeChanged_(sh, cur, rows, d) {
  var n = rows[0].length;
  var key = function (r) { return JSON.stringify(r); };
  var same = function (a, from, b, bFrom, count) {
    for (var i = 0; i < count; i++) if (key(a[from + i]) !== key(b[bFrom + i])) return false;
    return true;
  };
  var put = function (row, values) {
    var r = sh.getRange(row, 1, values.length, n);
    r.setNumberFormat('@');
    r.setValues(values);
    return r;
  };
  var k = rows.length - cur.length;
  var old = cur.length - 1;
  if (k > 0 && same(cur, 1, rows, 1, old)) { put(cur.length + 1, rows.slice(cur.length)); return true; }
  if (k > 0 && same(cur, 1, rows, 1 + k, old)) {
    sh.insertRowsAfter(1, k);
    // แถวที่แทรกใต้หัวตารางได้รูปแบบของหัวตารางมาด้วย ล้างเป็นแบบแถวข้อมูล
    var r = put(2, rows.slice(1, 1 + k)).setFontWeight('normal').setBackground(null).setFontColor(null);
    if (d.wide) { r.setVerticalAlignment('top'); sh.getRange(2, d.wide, k, 1).setWrap(true); }
    return true;
  }
  if (k === 0) {
    var changed = [];
    for (var i = 1; i < rows.length; i++) if (key(cur[i]) !== key(rows[i])) changed.push(i);
    if (changed.length <= 20) { changed.forEach(function (i) { put(i + 1, [rows[i]]); }); return true; }
  }
  return false;
}

function loadDb_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var db = BorrowCore.emptyDb();
  RAW_ = {};
  Object.keys(BorrowCore.TABLES).forEach(function (t) {
    var sh = sheet_(ss, t);
    if (!sh || sh.getLastRow() < 2) return;
    var values = sh.getDataRange().getValues();
    RAW_[t] = values.map(function (r) { return r.map(String); });
    // หัวคอลัมน์ภาษาไทย (เช่น เลขที่, แผนก) แปลงกลับเป็นชื่อช่องในระบบ คอลัมน์ที่ระบบสร้างไว้อ่านอย่างเดียวข้ามไป
    var cols = BorrowCore.TABLES[t];
    var header = values.shift().map(function (h) { return BorrowCore.fieldOf(t, String(h)); });
    db[t] = values.map(function (row) {
      var o = {};
      header.forEach(function (h, i) {
        if (cols.indexOf(h) < 0) return;
        var v = row[i];
        // ถ้ามีคนพิมพ์วันที่ลงในชีตเอง Sheets จะแปลงเป็น Date ให้แปลงกลับเป็นข้อความ
        if (v instanceof Date) v = Utilities.formatDate(v, tz, /_at$/.test(h) ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
        o[h] = v;
      });
      return o;
    });
  });
  return BorrowCore.normalize(db);
}

function saveDb_(db) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var data = BorrowCore.sheetData(db);
  OBSOLETE_SHEETS.forEach(function (n) { var old = ss.getSheetByName(n); if (old) ss.deleteSheet(old); });
  Object.keys(data).forEach(function (t) {
    var d = data[t];
    var n = d.header.length;
    var rows = [d.header].concat(d.rows).map(function (r) { return r.map(String); });
    var sh = sheet_(ss, t);
    var cur = null;
    if (!sh) {
      sh = ss.insertSheet(SHEET_NAMES[t]);
      var front = { log: 1 };
      if (front[t]) { ss.setActiveSheet(sh); ss.moveActiveSheet(front[t]); }
    } else {
      cur = RAW_[t] || sh.getDataRange().getValues().map(function (r) { return r.map(String); });
      if (JSON.stringify(cur) === JSON.stringify(rows)) return; // แท็บนี้ไม่มีอะไรเปลี่ยน
    }
    var newHeader = !cur || JSON.stringify(cur[0]) !== JSON.stringify(rows[0]);
    if (cur && !newHeader && writeChanged_(sh, cur, rows, d)) return;
    // หัวคอลัมน์เปลี่ยน (เช่น ตัดคอลัมน์ระบบยืมเดิมออก) ล้างทั้งข้อมูลและสีหัวตารางเดิม
    // ไม่งั้นล้างเฉพาะเมื่อข้อมูลเดิมยาว/กว้างกว่าของใหม่ (ไม่งั้นเขียนทับได้เลย)
    if (cur && newHeader) sh.clear();
    else if (cur && (cur.length > rows.length || (cur[0] || []).length > n)) sh.clearContents();
    var range = sh.getRange(1, 1, rows.length, n);
    range.setNumberFormat('@'); // เก็บเป็นข้อความ ป้องกัน Sheets แปลงวันที่/รหัสเอง
    range.setValues(rows);
    // จัดหัวตารางเฉพาะแท็บใหม่ หรือเมื่อหัวคอลัมน์เปลี่ยน
    if (newHeader) {
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground(null).setFontColor(null);
      // คอลัมน์ภาษาไทยที่ระบบเขียนให้อัตโนมัติ (แก้ในชีตไม่มีผล) ทำหัวคอลัมน์สีฟ้าอ่อนไว้
      if (d.extra) sh.getRange(1, n - d.extra + 1, 1, d.extra).setBackground('#e8f0fe');
      if (d.front) formatReadable_(sh, d, rows.length);
    }
  });
  cachePublic_(db);
}

// ==================== Line.gs (แจ้งเตือนผ่าน LINE OA) ====================

/**
 * แจ้งเตือนผ่าน LINE Official Account (Messaging API)
 * - มีผู้เบิกพัสดุ: แจ้งทันที (หรือสรุปทุกชั่วโมง ประหยัดโควตา)
 * - ทุกเช้า: ล็อตใกล้หมดอายุ และของใกล้หมดสต็อก (ไม่มีอะไรต้องแจ้ง = ไม่ส่ง)
 *
 * ตั้งค่า (ทำครั้งเดียว) — วิธีละเอียดอยู่ใน README หัวข้อ "แจ้งเตือนผ่าน LINE OA"
 * 1. Apps Script → ตั้งค่าโปรเจ็กต์ (⚙) → คุณสมบัติของสคริปต์ → เพิ่ม LINE_TOKEN = Channel access token (long-lived)
 * 2. ตั้ง Webhook URL ของ LINE OA เป็นลิงก์ /exec ของเว็บแอปนี้ แล้วเปิด Use webhook
 * 3. เพิ่ม LINE OA เป็นเพื่อน (หรือเชิญเข้ากลุ่ม LINE ของเจ้าหน้าที่) แล้วพิมพ์ "เชื่อมต่อ <รหัส PIN>"
 * 4. เลือกฟังก์ชัน setupLine แล้วกด เรียกใช้ (ตั้งเวลาส่งสรุปทุกเช้า) · ทดสอบด้วย testLine
 * 5. (ไม่บังคับ) เลือกฟังก์ชัน setupRichMenu แล้วกด เรียกใช้ = ใส่เมนูปุ่มลัด 6 ปุ่มด้านล่างแชต OA (ลบออกด้วย removeRichMenu)
 *
 * คุณสมบัติของสคริปต์ที่ปรับได้ (ไม่ใส่ = ค่าตั้งต้น):
 *   LINE_NOTIFY_REQUESTS = instant (แจ้งทันทีทุกใบ) | hourly (สรุปทุกชั่วโมง) | off (ไม่แจ้ง)
 *   LINE_DAILY_HOUR = 8 (ส่งสรุปประจำวันราว 8 โมงเช้า) · LINE_EXPIRY_MONTHS = 8 (เตือนก่อนหมดอายุกี่เดือน)
 *   LINE_STYLE = flex (ข้อความแบบการ์ด อ่านง่าย — ค่าตั้งต้น) | text (ข้อความล้วนแบบเดิม)
 * โควตา LINE OA แบบฟรีนับ 1 ข้อความต่อผู้รับ 1 คน (ส่งเข้ากลุ่ม = นับตามจำนวนสมาชิก) ดูยอดที่ใช้ได้ใน LINE OA Manager
 */
var LINE_API = 'https://api.line.me/v2/bot/message/';

function lineProps_() { return PropertiesService.getScriptProperties(); }
function lineTargets_() {
  try { return JSON.parse(lineProps_().getProperty('LINE_TARGETS') || '[]'); } catch (e) { return []; }
}
function lineSaveTargets_(list) { lineProps_().setProperty('LINE_TARGETS', JSON.stringify(list)); }
function lineMode_() { return lineProps_().getProperty('LINE_NOTIFY_REQUESTS') || 'instant'; }

// สถานะสำหรับหน้าเว็บของเจ้าหน้าที่ (ไม่ส่ง token หรือรหัสผู้รับ)
function lineStatus_() {
  var p = lineProps_();
  return { configured: !!p.getProperty('LINE_TOKEN'), targets: lineTargets_().length, mode: lineMode_(),
    daily_hour: Number(p.getProperty('LINE_DAILY_HOUR') || 8), daily_on: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'lineDailySummary'; }) };
}

// เรียก LINE API · payload = object (ส่งเป็น JSON) หรือ { bytes, type } (อัปโหลดรูป) · ไม่มี payload = GET
function lineFetch_(url, method, payload) {
  var token = lineProps_().getProperty('LINE_TOKEN');
  if (!token) return { ok: false, error: 'ยังไม่ได้ตั้ง LINE_TOKEN' };
  var opt = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token } };
  if (payload && payload.bytes) { opt.contentType = payload.type; opt.payload = payload.bytes; }
  else if (payload) { opt.contentType = 'application/json'; opt.payload = JSON.stringify(payload); }
  var res = UrlFetchApp.fetch(url, opt);
  var code = res.getResponseCode();
  var body = res.getContentText();
  var data = {};
  try { data = JSON.parse(body || '{}'); } catch (e) {}
  return code === 200 ? { ok: true, data: data } : { ok: false, error: 'LINE ' + code + ': ' + String(body).slice(0, 300) };
}
function lineCall_(kind, payload) { return lineFetch_(LINE_API + kind, 'post', payload); }

// ข้อความแบบการ์ด (Flex) เมื่อเปิดใช้ · ไม่มีการ์ด/ตั้ง LINE_STYLE = text → ข้อความล้วน (ยาวเกินตัดท้าย LINE รับได้ 5,000 ตัวอักษร)
function lineMessage_(text, flex, quick) {
  var msg = flex && lineProps_().getProperty('LINE_STYLE') !== 'text' ? flex : { type: 'text', text: String(text).slice(0, 4900) };
  if (quick) msg.quickReply = lineQuickReply_();
  return msg;
}
// ส่ง 1 ข้อความ · การ์ดถูกปฏิเสธ (เช่น LINE เปลี่ยนรูปแบบ) → ส่งเป็นข้อความล้วนแทน ไม่ให้แจ้งเตือนหาย
function lineSend_(kind, base, text, flex, quick) {
  var msg = lineMessage_(text, flex, quick);
  base.messages = [msg];
  var r = lineCall_(kind, base);
  if (!r.ok && msg.type === 'flex') {
    Logger.log('ส่งแบบการ์ดไม่สำเร็จ ส่งเป็นข้อความแทน: ' + r.error);
    base.messages = [lineMessage_(text, null, quick)];
    r = lineCall_(kind, base);
  }
  return r;
}

// ส่งถึงผู้รับทุกคน/ทุกกลุ่มที่เชื่อมต่อไว้
function linePush_(text, flex) {
  if (!text) return 0;
  var sent = 0;
  lineTargets_().forEach(function (t) {
    var r = lineSend_('push', { to: t.id }, text, flex);
    if (r.ok) sent++; else Logger.log('ส่ง LINE ไม่สำเร็จ (' + t.name + '): ' + r.error);
  });
  return sent;
}

// ปุ่มลัดใต้ข้อความตอบกลับ (กดแล้วส่งคำสั่งให้เอง)
function lineQuickReply_() {
  return { items: BorrowCore.LINE_MENU.map(function (t) { return { type: 'action', action: { type: 'message', label: t, text: t } }; }) };
}
function lineToday_() {
  return Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

// Webhook จาก LINE: พิมพ์ "เชื่อมต่อ <PIN>" = รับแจ้งเตือน · "ยกเลิกแจ้งเตือน" · "สถานะ"
// แชตที่เชื่อมต่อแล้วพิมพ์ค้นหาได้: เมนู · เช็ค <ชื่อ> · สรุป · ใกล้หมดอายุ · ใกล้หมด · เบิกวันนี้ · ยังไม่รับ
// (Apps Script อ่าน header X-Line-Signature ไม่ได้ จึงใช้ PIN เป็นตัวยืนยันก่อนเพิ่มผู้รับ · แชตที่ยังไม่เชื่อมต่อค้นหาข้อมูลไม่ได้)
function lineWebhook_(body) {
  (body.events || []).forEach(function (ev) {
    if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
    var src = ev.source || {};
    var id = src.groupId || src.roomId || src.userId;
    if (!id) return;
    var text = String(ev.message.text || '').trim();
    var list = lineTargets_();
    var has = list.some(function (t) { return t.id === id; });
    var reply = '';
    var flex = null;
    var quick = false;
    var m = /^(เชื่อมต่อ|connect)\s*(\S+)$/i.exec(text);
    if (m) {
      if (m[2] !== adminPin_()) reply = 'รหัสไม่ถูกต้อง';
      else {
        if (!has) list.push({ id: id, type: src.type || 'user', name: src.type === 'group' ? 'กลุ่ม' : src.type === 'room' ? 'ห้องแชต' : 'ผู้ใช้', at: new Date().toISOString() });
        lineSaveTargets_(list);
        reply = 'เชื่อมต่อแล้ว ✅ จะได้รับแจ้งเตือนเมื่อมีผู้เบิกพัสดุ และสรุปของใกล้หมดอายุ/ใกล้หมดสต็อกทุกเช้า\n' +
          'พิมพ์ "เมนู" เพื่อดูคำสั่งค้นหา เช่น "เช็ค ถุงมือ" · พิมพ์ "ยกเลิกแจ้งเตือน" เพื่อหยุดรับ';
        quick = true;
      }
    } else if (/^ยกเลิกแจ้งเตือน$/.test(text) && has) {
      lineSaveTargets_(list.filter(function (t) { return t.id !== id; }));
      reply = 'หยุดส่งแจ้งเตือนมาที่นี่แล้ว';
    } else if (/^สถานะ$/.test(text) && has) {
      var s = lineStatus_();
      reply = 'รับแจ้งเตือนอยู่ · ผู้รับทั้งหมด ' + s.targets + ' · ใบเบิก: ' + ({ instant: 'แจ้งทันที', hourly: 'สรุปทุกชั่วโมง', off: 'ปิด' }[s.mode] || s.mode) +
        ' · สรุปประจำวัน: ' + (s.daily_on ? 'ราว ' + s.daily_hour + ':00 น.' : 'ยังไม่ได้ตั้ง (เรียกใช้ setupLine)') + '\nพิมพ์ "เมนู" เพื่อดูคำสั่งค้นหา';
      quick = true;
    } else if (has) {
      try {
        var q = BorrowCore.lineQuery(loadDb_(), text, lineToday_(), Number(lineProps_().getProperty('LINE_EXPIRY_MONTHS') || 8));
        if (q) { reply = q.text; flex = q.flex; }
      } catch (e) { reply = 'ค้นหาไม่สำเร็จ: ' + e.message; }
      quick = !!reply;
    } else if (/^(เมนู|ช่วย|help|menu)$/i.test(text)) {
      reply = 'แชตนี้ยังไม่ได้เชื่อมต่อ พิมพ์ "เชื่อมต่อ <รหัส PIN เจ้าหน้าที่>" ก่อน แล้วจึงค้นหาพัสดุได้';
    }
    // ตอบกลับ (reply) ไม่นับโควตาข้อความ
    if (reply && ev.replyToken) lineSend_('reply', { replyToken: ev.replyToken }, reply, flex, quick);
  });
  return json_({ ok: true });
}

// หลังบันทึกใบเบิก: ส่งทันที หรือเก็บไว้รอสรุปทุกชั่วโมง · ส่งไม่สำเร็จไม่กระทบการเบิก
function lineOnRequest_(db, requestId) {
  try {
    if (!lineTargets_().length) return;
    var mode = lineMode_();
    if (mode === 'instant') linePush_(BorrowCore.lineRequestText(db, requestId), BorrowCore.lineRequestFlex(db, requestId));
    else if (mode === 'hourly') {
      var p = lineProps_();
      var pending = JSON.parse(p.getProperty('LINE_PENDING') || '[]');
      pending.push(requestId);
      p.setProperty('LINE_PENDING', JSON.stringify(pending));
    }
  } catch (e) { Logger.log('แจ้งเตือน LINE ไม่สำเร็จ: ' + e.message); }
}

// ทริกเกอร์ทุกชั่วโมง (โหมด hourly): รวมใบเบิกที่รอไว้เป็นข้อความเดียว
function lineHourly() {
  var p = lineProps_();
  var pending = JSON.parse(p.getProperty('LINE_PENDING') || '[]');
  if (!pending.length) return;
  p.setProperty('LINE_PENDING', '[]');
  var db = loadDb_();
  linePush_(BorrowCore.lineRequestsDigest(db, pending), BorrowCore.lineDigestFlex(db, pending));
}

// ทริกเกอร์ทุกเช้า: ล็อตใกล้หมดอายุ + ของใกล้หมดสต็อก
function lineDailySummary() {
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var months = Number(lineProps_().getProperty('LINE_EXPIRY_MONTHS') || 8);
  var db = loadDb_();
  var text = BorrowCore.lineDailyText(db, today, months);
  if (text) linePush_(text, BorrowCore.lineDailyFlex(db, today, months));
}

// เรียกใช้ครั้งเดียวหลังตั้ง LINE_TOKEN: ตั้งเวลาส่งสรุปทุกเช้า (และทุกชั่วโมงถ้าเลือกโหมด hourly) แล้วบอกสถานะ
function setupLine() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['lineDailySummary', 'lineHourly'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  var hour = Number(lineProps_().getProperty('LINE_DAILY_HOUR') || 8);
  ScriptApp.newTrigger('lineDailySummary').timeBased().everyDays(1).atHour(hour).create();
  if (lineMode_() === 'hourly') ScriptApp.newTrigger('lineHourly').timeBased().everyHours(1).create();
  var s = lineStatus_();
  Logger.log((s.configured ? 'ตั้ง LINE_TOKEN แล้ว' : 'ยังไม่ได้ตั้ง LINE_TOKEN (คุณสมบัติของสคริปต์)') + ' · ผู้รับที่เชื่อมต่อ ' + s.targets +
    ' · ใบเบิก: ' + s.mode + ' · สรุปประจำวันราว ' + hour + ':00 น.' + (s.targets ? '' : ' — เพิ่ม LINE OA เป็นเพื่อน/เชิญเข้ากลุ่ม แล้วพิมพ์ "เชื่อมต่อ <PIN>"'));
}

// ทดสอบส่งข้อความ + สรุปประจำวันตอนนี้
function testLine() {
  var n = linePush_('ทดสอบแจ้งเตือนจากระบบเบิกพัสดุ ✅');
  Logger.log('ส่งถึง ' + n + ' จาก ' + lineTargets_().length + ' ผู้รับ');
  lineDailySummary();
}

// ---------- Rich menu: เมนูปุ่มลัด 6 ปุ่มด้านล่างแชต 1:1 กับ OA (กลุ่ม LINE ไม่แสดง rich menu ใช้ปุ่มลัดใต้ข้อความแทน) ----------
// รูป 2500×1686 (LINE_RICHMENU_JPG ฝังไว้ท้ายไฟล์ AllInOne.gs) แบ่ง 3 คอลัมน์ × 2 แถว · กดแล้วส่งคำสั่งเหมือนพิมพ์เอง
var LINE_RICHMENU_NAME = 'เมนูพัสดุ';
var LINE_RICHMENU_AREAS = [['สรุป', 'สรุป'], ['ใกล้หมดอายุ', 'ใกล้หมดอายุ'], ['ใกล้หมด', 'ใกล้หมด'],
  ['เบิกวันนี้', 'เบิกวันนี้'], ['ยังไม่รับ', 'ยังไม่รับ'], ['เช็คสต็อก', 'เช็ค']];
function lineRemoveRichMenus_() {
  var list = lineFetch_('https://api.line.me/v2/bot/richmenu/list', 'get');
  if (!list.ok) return list;
  var n = 0;
  (list.data.richmenus || []).forEach(function (m) {
    if (m.name === LINE_RICHMENU_NAME && lineFetch_('https://api.line.me/v2/bot/richmenu/' + m.richMenuId, 'delete').ok) n++;
  });
  return { ok: true, removed: n };
}
// เรียกใช้ครั้งเดียว (ทำซ้ำได้ เมนูเดิมถูกแทนที่) · ต้องตั้ง LINE_TOKEN ก่อน
function setupRichMenu() {
  if (typeof LINE_RICHMENU_JPG === 'undefined') throw new Error('ไม่พบรูปเมนู — วางไฟล์ AllInOne.gs ทั้งไฟล์ (รูปอยู่ท้ายไฟล์)');
  var old = lineRemoveRichMenus_();
  if (!old.ok) throw new Error(old.error);
  var W = [833, 833, 834];
  var X = [0, 833, 1666];
  var made = lineFetch_('https://api.line.me/v2/bot/richmenu', 'post', {
    size: { width: 2500, height: 1686 }, selected: true, name: LINE_RICHMENU_NAME, chatBarText: 'เมนูพัสดุ',
    areas: LINE_RICHMENU_AREAS.map(function (a, i) {
      return { bounds: { x: X[i % 3], y: i < 3 ? 0 : 843, width: W[i % 3], height: 843 }, action: { type: 'message', label: a[0], text: a[1] } };
    }),
  });
  if (!made.ok) throw new Error('สร้างเมนูไม่สำเร็จ: ' + made.error);
  var id = made.data.richMenuId;
  var img = lineFetch_('https://api-data.line.me/v2/bot/richmenu/' + id + '/content', 'post',
    { bytes: Utilities.base64Decode(LINE_RICHMENU_JPG.join('')), type: 'image/jpeg' });
  if (!img.ok) throw new Error('อัปโหลดรูปเมนูไม่สำเร็จ: ' + img.error);
  var def = lineFetch_('https://api.line.me/v2/bot/user/all/richmenu/' + id, 'post');
  if (!def.ok) throw new Error('ตั้งเป็นเมนูหลักไม่สำเร็จ: ' + def.error);
  Logger.log('ใส่เมนูพัสดุแล้ว ✅ (ลบเมนูเดิม ' + old.removed + ') · เปิดแชต OA ในมือถือ จะเห็นปุ่ม "เมนูพัสดุ" ด้านล่าง (ถ้ายังไม่เห็น ปิดแล้วเปิดแชตใหม่)');
}
// เอาเมนูออก (กลับไปใช้เมนูที่ตั้งใน LINE OA Manager ถ้ามี)
function removeRichMenu() {
  var r = lineRemoveRichMenus_();
  if (!r.ok) throw new Error(r.error);
  Logger.log('ลบเมนูพัสดุแล้ว ' + r.removed + ' เมนู');
}

// ==================== Core (กฎการเบิก/ยืมและการตัดสต็อก) — จาก docs/core.js ====================

/*
 * BorrowCore — กฎการเบิกพัสดุและการตัดสต็อก
 * ไฟล์เดียวกันนี้ใช้ทั้งในเบราว์เซอร์ (โหมดทดลอง) และใน Google Apps Script (คัดลอกไปเป็น Core.gs)
 * ข้อมูลทั้งหมดอยู่ในอ็อบเจกต์ db = { items, requests, request_items, movements, departments, categories, suppliers, units, locations }
 */
var BorrowCore = (function () {
  // ระบบเบิกอย่างเดียว (ของออกจากคลังถาวร ไม่ต้องคืน) ใบเบิกทุกใบมีสถานะ "เบิกแล้ว"
  var STATUS = { issued: 'เบิกแล้ว' };
  var MOVE = { receive: 'รับเข้า', withdraw: 'เบิกจ่าย', adjust: 'ปรับปรุงยอด', lost: 'ชำรุด/สูญหาย', cancel: 'คืนจากใบเบิก (ลบ/แก้ไข)' };

  // คอลัมน์ที่ระบบอ่าน/เขียน · ชีตเวอร์ชันก่อนที่มีคอลัมน์ของระบบยืม (total_qty, kind, due_date ฯลฯ) อ่านได้ ระบบข้ามคอลัมน์นั้นไป
  var TABLES = {
    // price = ราคาต่อ 1 หน่วยนับ (บาท)
    // ขนาดบรรจุ: 1 unit = pack_qty pack_unit (เช่น 1 กล่อง = 100 ชิ้น) ใช้แสดงให้ผู้เบิกเห็น · สต็อกและราคายังนับเป็น unit
    // pack_qty ว่าง = ยังไม่ได้ตั้ง (ระบบเดาจากชื่อให้) · 0 = ไม่มีขนาดบรรจุ
    items: ['id', 'code', 'name', 'category', 'unit', 'available_qty', 'min_qty', 'location', 'active', 'price', 'pack_qty', 'pack_unit'],
    // edited_at = แก้ไขใบเบิกล่าสุดเมื่อ (ว่าง = ไม่เคยแก้)
    // received_at = เจ้าหน้าที่ติ๊กว่าผู้เบิกรับของ/เซ็นเอกสารแล้วเมื่อ (ว่าง = ยังไม่รับ)
    requests: ['id', 'request_no', 'borrower_name', 'phone', 'department', 'purpose', 'status', 'created_at', 'note', 'edited_at', 'received_at'],
    // price = ราคาต่อหน่วย ณ วันที่เบิก (ราคาพัสดุเปลี่ยนภายหลัง ใบเบิกเดิมไม่เปลี่ยน)
    request_items: ['request_id', 'item_id', 'qty', 'price'],
    // รับเข้า: บริษัทผู้จำหน่าย วันหมดอายุ (YYYY-MM-DD) และเลขใบส่งของ ของล็อตนั้น
    // price = ราคาต่อหน่วยของล็อตที่รับเข้า (บาท) ใช้สรุปมูลค่ารับเข้า
    movements: ['id', 'created_at', 'item_id', 'type', 'qty', 'available_after', 'request_no', 'note', 'supplier', 'expiry_date', 'delivery_no', 'price'],
    departments: ['name', 'full_name'],
    categories: ['name'],
    // บริษัทผู้จำหน่าย: ชื่อ ผู้ติดต่อ เบอร์โทร อีเมล หมายเหตุ
    suppliers: ['name', 'contact', 'phone', 'email', 'note'],
    units: ['name'],
    locations: ['name'],
    // งบประมาณแผนก (ปีงบประมาณ พ.ศ. ต.ค.–ก.ย.): 1 แถว = ตั้ง/เพิ่ม/ลดงบ 1 ครั้ง (amount ติดลบ = ลดงบ) · งบของแผนก = ผลรวมทุกแถวของปีนั้น
    // ทุกใบเบิกของแผนกในปีงบนั้นตัดจากงบอัตโนมัติ (มูลค่าตามราคา ณ วันที่เบิก)
    budgets: ['id', 'department', 'fiscal_year', 'amount', 'note', 'created_at'],
  };
  // หน่วยนับตั้งต้น (แท็บหน่วยนับยังว่าง) + หน่วยที่พัสดุใช้อยู่แล้ว
  var DEFAULT_UNITS = ['ชิ้น', 'กล่อง', 'ขวด', 'ม้วน', 'โหล'];
  // หัวคอลัมน์ภาษาไทยในแท็บประวัติการเบิก ที่เป็นข้อมูลจริง (อ่านกลับเข้าระบบ) · ชื่อหัวเดิมยังอ่านได้
  var LABELS = { requests: { request_no: 'เลขที่', borrower_name: 'ผู้เบิก', department: 'แผนก', note: 'หมายเหตุ' } };
  var OLD_LABELS = { requests: { borrower_name: ['ผู้เบิก/ผู้ยืม'] } };
  function fieldOf(table, header) {
    var m = LABELS[table];
    var old = OLD_LABELS[table] || {};
    if (m) for (var k in m) if (m[k] === header || (old[k] || []).indexOf(header) >= 0) return k;
    return header;
  }
  var NUMERIC = ['id', 'available_qty', 'min_qty', 'active', 'request_id', 'item_id', 'qty', 'available_after'];
  // ราคา (บาท) ทศนิยม 2 ตำแหน่ง · รับค่าที่พิมพ์ในชีตแบบ 1,250.50 หรือ ฿25 ได้
  // จำนวนเงินที่ติดลบได้ (ลดงบ)
  function signedMoney(v, label) {
    var s = str(v).replace(/[,\s฿]/g, '').replace(/บาท$/, '');
    if (s === '') return 0;
    var n = Number(s);
    if (!isFinite(n)) { if (label) fail(label + ' ต้องเป็นตัวเลข'); return 0; }
    return Math.round(n * 100) / 100;
  }
  function money(v, label) {
    var s = str(v).replace(/[,\s฿]/g, '').replace(/บาท$/, '');
    if (s === '') return 0;
    var n = Number(s);
    if (!isFinite(n) || n < 0) { if (label) fail(label + ' ต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป'); return 0; }
    return Math.round(n * 100) / 100;
  }

  function fail(msg) { throw new Error(msg); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  // วันเวลาที่บันทึก ละเอียดถึงวินาที เช่น 2026-10-24 09:15:42
  function stamp(d) { return ymd(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function str(v) { return v === undefined || v === null ? '' : String(v).trim(); }
  function req(v, label) { var s = str(v); if (!s) fail('กรุณาระบุ' + label); return s; }
  function int(v, label, min) {
    var n = Number(v);
    if (min === undefined) min = 0;
    if (!isFinite(n) || Math.floor(n) !== n || n < min) fail(label + ' ต้องเป็นจำนวนเต็มตั้งแต่ ' + min + ' ขึ้นไป');
    return n;
  }
  function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s || ''); }
  // วันที่มีจริง (ไม่ใช่ 30 ก.พ. / 31 เม.ย.)
  function realDate(s) { if (!isDate(s)) return false; var d = new Date(s + 'T00:00:00'); return !isNaN(d) && ymd(d) === s; }
  function nextId(rows) { var m = 0; rows.forEach(function (r) { if (r.id > m) m = r.id; }); return m + 1; }
  // รหัสพัสดุถัดไป: ตามรูปแบบที่ใช้มากที่สุด เช่น NSO-301 → NSO-302 (จำนวนหลักเท่าเดิม) · ยังไม่มีพัสดุ = NSO-001
  function nextItemCode(items) {
    var count = {}, max = {}, width = {};
    items.forEach(function (i) {
      var m = /^(.*?)(\d+)$/.exec(str(i.code));
      if (!m) return;
      count[m[1]] = (count[m[1]] || 0) + 1;
      max[m[1]] = Math.max(max[m[1]] || 0, Number(m[2]));
      width[m[1]] = Math.max(width[m[1]] || 0, m[2].length);
    });
    var prefix = Object.keys(count).sort(function (a, b) { return count[b] - count[a]; })[0];
    if (prefix === undefined) return 'NSO-001';
    var n = String(max[prefix] + 1);
    while (n.length < width[prefix]) n = '0' + n;
    return prefix + n;
  }
  function find(rows, pred) { for (var i = 0; i < rows.length; i++) if (pred(rows[i])) return rows[i]; return null; }
  // ดัชนีค้นหาเร็ว (ข้อมูลหลายพันแถว): สร้างใหม่เมื่อตารางเปลี่ยน (เพิ่ม/ลบแถว หรือแทนทั้งตาราง)
  var INDEX = typeof WeakMap === 'function' ? new WeakMap() : null;
  function indexOf(rows, key) {
    if (!INDEX) return null;
    var c = INDEX.get(rows);
    if (!c || c.n !== rows.length || c.key !== key) {
      var map = {};
      rows.forEach(function (r) {
        var k = r[key];
        if (key === 'id') { if (!(k in map)) map[k] = r; } else (map[k] || (map[k] = [])).push(r);
      });
      c = { n: rows.length, key: key, map: map };
      INDEX.set(rows, c);
    }
    return c.map;
  }
  function byId(rows, id) {
    id = Number(id);
    var m = indexOf(rows, 'id');
    if (m) { var r = m[id]; if (r && r.id === id) return r; }
    return find(rows, function (x) { return x.id === id; });
  }

  function emptyDb() {
    var db = {};
    Object.keys(TABLES).forEach(function (t) { db[t] = []; });
    return db;
  }

  // แปลงค่าที่อ่านจาก Sheet / JSON ให้เป็นชนิดที่ถูกต้อง
  function normalize(db) {
    Object.keys(TABLES).forEach(function (t) {
      db[t] = (db[t] || []).filter(function (r) { return TABLES[t].some(function (c) { return str(r[c]) !== ''; }); })
        .map(function (r) {
          var o = {};
          TABLES[t].forEach(function (c) {
            // แถวที่เพิ่มในชีตเองแล้วเว้นช่อง active ไว้ = เปิดใช้งาน
            if (c === 'active' && str(r[c]) === '') { o[c] = 1; return; }
            if (c === 'pack_qty') { o[c] = str(r[c]) === '' ? '' : Math.max(0, Math.floor(Number(r[c]) || 0)); return; }
            o[c] = c === 'price' ? money(r[c]) : c === 'amount' ? signedMoney(r[c]) : NUMERIC.indexOf(c) >= 0 ? Number(r[c] || 0) : str(r[c]);
          });
          return o;
        });
    });
    // พัสดุที่เพิ่มเป็นแถวใหม่ในชีตโดยตรง: ไม่ต้องใส่ id เอง (ว่าง/ซ้ำ = ระบบตั้งเลขถัดไปให้ และเขียนกลับตอนบันทึกครั้งถัดไป)
    var seen = {};
    var maxId = 0;
    db.items.forEach(function (i) { if (i.id > maxId) maxId = i.id; });
    db.items.forEach(function (i) {
      if (!(i.id > 0) || i.id % 1 || seen[i.id]) i.id = ++maxId;
      seen[i.id] = true;
      if (!i.code) i.code = nextItemCode(db.items); // แถวที่พิมพ์ในชีตเองโดยไม่ใส่รหัส
      if (!i.name) i.name = i.code || 'พัสดุ #' + i.id;
      if (!i.unit) i.unit = 'ชิ้น';
      // ขนาดบรรจุที่ยังไม่ได้ตั้ง: เดาจากชื่อ (เช่น "(100ชิ้น/กล่อง)") บันทึกลงชีตตอนบันทึกครั้งถัดไป
      if (i.pack_qty === '') { var g = guessPack(i); if (g) { i.pack_qty = g.qty; i.pack_unit = g.unit; } }
      if (!(i.pack_qty > 0)) i.pack_unit = i.pack_qty === '' ? '' : str(i.pack_unit);
    });
    // ตัวเลือกหน่วยนับ / สถานที่เก็บ: แท็บยังว่าง (ชีตก่อนมีแท็บนี้) ตั้งจากค่าที่พัสดุใช้อยู่ บันทึกครั้งถัดไปจะลงชีตให้
    if (!db.units.length) addNames(db, 'units', DEFAULT_UNITS.concat(db.items.map(function (i) { return i.unit; })));
    if (!db.locations.length) addNames(db, 'locations', db.items.map(function (i) { return i.location; }));
    // ใบเบิกทุกใบ = เบิกแล้ว (ใบที่ค้างจากระบบยืมเดิมแสดงเป็นใบเบิกในประวัติ)
    db.requests.forEach(function (r) { r.status = 'issued'; });
    // คงเหลือติดลบได้ (เบิกของที่หมด = ค้างจ่าย) รับเข้าครั้งถัดไปจะหักล้างเอง
    return db;
  }

  // เดาขนาดบรรจุจากชื่อพัสดุ: "(100ชิ้น/กล่อง)" "1 โหล/กล่อง" (= 12 ชิ้น) หรือหน่วยนับ "โหล" (= 12 ชิ้น)
  // ใช้เฉพาะเมื่อหน่วยใหญ่ในชื่อตรงกับหน่วยนับของพัสดุ (พัสดุที่นับเป็นชิ้นอยู่แล้วไม่ต้องมี)
  // ชื่อในไฟล์สต็อกมีทั้งภาษาอังกฤษ (100ชิ้น/Pack) และพิมพ์ผิด (100ขิ้น/กล่อง)
  var PACK_RE = /(\d+)\s*(โหล|ชิ้น|ขิ้น|อัน|ซอง|ม้วน|คู่|แผ่น|ขวด|เส้น|ตัว|หลอด|ก้อน|ชุด|แท่ง)\s*\/\s*1?\s*(กล่อง|ห่อ|แพ็ค|แพค|โหล|ลัง|ถุง|pack|box)/i;
  var PACK_BIG = { pack: 'แพ็ค', box: 'กล่อง', 'แพค': 'แพ็ค' };
  function guessPack(item) {
    var m = PACK_RE.exec(str(item.name));
    var big = m && (PACK_BIG[m[3].toLowerCase()] || m[3]);
    var unit = item.unit === 'แพค' ? 'แพ็ค' : item.unit;
    if (m && big === unit && m[2] !== item.unit) {
      var n = Number(m[1]);
      return m[2] === 'โหล' ? { qty: n * 12, unit: 'ชิ้น' } : { qty: n, unit: m[2] === 'ขิ้น' ? 'ชิ้น' : m[2] };
    }
    // "25pc/box" "6pc/pack" "10 pc (กล่อง)" = ชิ้น ต่อหน่วยนับ
    var pc = /(\d+)\s*pcs?\b/i.exec(str(item.name));
    if (pc && ['กล่อง', 'แพ็ค', 'แพค', 'ห่อ', 'ลัง', 'ถุง'].indexOf(item.unit) >= 0 && Number(pc[1]) > 0) return { qty: Number(pc[1]), unit: 'ชิ้น' };
    if (item.unit === 'โหล') return { qty: 12, unit: 'ชิ้น' };
    return null;
  }
  function packFields(p) {
    var q = str(p.pack_qty) === '' ? 0 : int(p.pack_qty, 'ขนาดบรรจุ', 0);
    return { pack_qty: q, pack_unit: q ? str(p.pack_unit) || 'ชิ้น' : '' };
  }

  // เพิ่มชื่อลงรายการตัวเลือก (หน่วยนับ สถานที่เก็บ ฯลฯ) เฉพาะที่ยังไม่มี
  function addNames(db, table, names) {
    names.forEach(function (n) {
      n = str(n);
      if (n && !find(db[table], function (r) { return r.name === n; })) db[table].push({ name: n });
    });
  }

  // ราคาต่อหน่วยของรายการในใบเบิก: ใบที่เบิกก่อนมีการใส่ราคา (ราคา 0) ใช้ราคาปัจจุบันของพัสดุ
  function linePrice(db, l) {
    if (l.price > 0) return l.price;
    var item = byId(db.items, l.item_id);
    return item ? item.price || 0 : 0;
  }
  function lineValue(db, l) { return Math.round(l.qty * linePrice(db, l) * 100) / 100; }
  function requestValue(db, requestId) {
    return Math.round(lines(db, requestId).reduce(function (s, l) { return s + lineValue(db, l); }, 0) * 100) / 100;
  }

  // ปรับยอดคงเหลือ delta (+ เข้า / − ออก) และบันทึกประวัติสต็อก
  function moveStock(db, ctx, o) {
    var item = byId(db.items, o.item_id) || fail('ไม่พบรายการพัสดุ');
    var available = item.available_qty + o.delta;
    // ห้ามลดจนติดลบ ยกเว้นการเบิก (allowNegative) ส่วนการรับเข้าสต็อกที่ติดลบอยู่ทำได้เสมอ
    if (!o.allowNegative && o.delta < 0 && available < 0) fail('"' + item.name + '" คงเหลือไม่พอ (คงเหลือ ' + item.available_qty + ' ' + item.unit + ')');
    item.available_qty = available;
    db.movements.push({
      id: nextId(db.movements), created_at: o.at ? atDate(o.at, ctx) : stamp(ctx.now), item_id: item.id, type: o.type, qty: o.delta,
      available_after: available, request_no: o.request_no || '', note: str(o.note),
      supplier: str(o.supplier), expiry_date: str(o.expiry_date), delivery_no: str(o.delivery_no),
      price: o.type === 'receive' ? (o.price === undefined || str(o.price) === '' ? item.price || 0 : money(o.price, 'ราคาต่อหน่วย')) : 0,
    });
  }

  // วันที่รับเข้าที่เลือกเอง (YYYY-MM-DD) + เวลาปัจจุบัน · ห้ามเป็นวันในอนาคต
  function receiveDate(v, ctx) {
    var d = str(v);
    if (!d) return '';
    if (!realDate(d)) fail('วันที่รับเข้าไม่ถูกต้อง (วว/ดด/ปปปป)');
    if (d > ymd(ctx.now)) fail('วันที่รับเข้าต้องไม่เกินวันนี้');
    return d;
  }
  function atDate(d, ctx) { return d + stamp(ctx.now).slice(10); }

  function lines(db, requestId) {
    var m = indexOf(db.request_items, 'request_id');
    if (m) return (m[requestId] || []).filter(function (l) { return l.request_id === requestId; });
    return db.request_items.filter(function (l) { return l.request_id === requestId; });
  }
  // ยอดยกมาตอนตั้งระบบ / ใส่ไฟล์สต็อกใหม่ (ไม่นับเป็นการรับเข้าในรายงาน)
  var OPENING = 'ยอดยกมาเริ่มต้น';
  function isReceipt(m) { return m.type === 'receive' && m.note !== OPENING; }
  // มูลค่ารับเข้าของรายการ: ราคาของล็อตนั้น (ไม่ได้ใส่ = ราคาปัจจุบันของพัสดุ)
  function movePrice(db, m) {
    if (m.price > 0) return m.price;
    var item = byId(db.items, m.item_id);
    return item ? item.price || 0 : 0;
  }

  var MASTERS = { departments: 1, categories: 1, suppliers: 1, units: 1, locations: 1 };
  var ADMIN_ACTIONS = ['checkPin', 'saveItem', 'stock', 'addMaster', 'removeMaster', 'deleteRequest', 'saveSupplier', 'setStock', 'editRequest', 'addBudget', 'setBudgets', 'removeBudget', 'receiveBatch', 'editReceipt', 'setPacks', 'convertToPieces', 'markReceived'];

  // ข้อมูลล็อตที่รับเข้า (ไม่บังคับ): บริษัท วันหมดอายุ เลขใบส่งของ
  function lot(p) {
    var expiry = str(p.expiry_date);
    if (expiry && !realDate(expiry)) fail('วันหมดอายุไม่ถูกต้อง (วว/ดด/ปปปป)');
    return { supplier: str(p.supplier), expiry_date: expiry, delivery_no: str(p.delivery_no) };
  }
  function withLot(o, p) { var l = lot(p); o.supplier = l.supplier; o.expiry_date = l.expiry_date; o.delivery_no = l.delivery_no; return o; }

  function masterTable(t) {
    if (!t) return 'departments'; // เว็บเวอร์ชันก่อนไม่ส่งชื่อตารางมาเมื่อเพิ่มแผนก
    return MASTERS[t] ? t : fail('ไม่รู้จักรายการ ' + t);
  }

  var actions = {
    checkPin: function () { return true; },

    // ส่งใบเบิก: ตัดสต็อกทันที ไม่ต้องรออนุมัติ เบิกได้แม้ของหมด (ยอดติดลบ)
    createRequest: function (db, p, ctx) {
      var name = req(p.borrower_name, 'ชื่อผู้เบิก');
      var dept = req(p.department, 'แผนก');
      if (!find(db.departments, function (d) { return d.name === dept; })) fail('กรุณาเลือกแผนกจากรายการ');
      if (!p.items || !p.items.length) fail('กรุณาเลือกพัสดุอย่างน้อย 1 รายการ');
      var merged = {};
      p.items.forEach(function (l) {
        var id = int(l.item_id, 'รหัสพัสดุ', 1);
        merged[id] = (merged[id] || 0) + int(l.qty, 'จำนวน', 1);
      });
      Object.keys(merged).forEach(function (id) {
        var item = byId(db.items, id);
        if (!item || !item.active) fail('มีพัสดุที่ไม่พบหรือถูกปิดใช้งาน');
      });
      // เลขที่เอกสาร เช่น WD69-001 = WD + ปี พ.ศ. 2 หลัก + ลำดับในปีนั้น (เกิน 999 เป็น 4 หลักอัตโนมัติ)
      var be = String(ctx.now.getFullYear() + 543).slice(2);
      var prefix = 'WD' + be + '-';
      var seq = 0;
      // นับจากประวัติสต็อกด้วย: ใบที่ถูกลบไปแล้วจะไม่ถูกนำเลขกลับมาใช้ซ้ำ (เลขบน PDF ที่ออกไปแล้วไม่ชนกัน)
      db.requests.concat(db.movements).forEach(function (r) {
        var no = str(r.request_no);
        if (no.indexOf(prefix) === 0) seq = Math.max(seq, Number(no.slice(prefix.length)) || 0);
      });
      var r = {
        id: nextId(db.requests), request_no: prefix + (seq + 1 < 1000 ? ('00' + (seq + 1)).slice(-3) : String(seq + 1)), borrower_name: name, phone: str(p.phone),
        department: dept, purpose: str(p.purpose), status: 'issued', created_at: stamp(ctx.now), note: str(p.note), edited_at: '', received_at: '',
      };
      db.requests.push(r);
      Object.keys(merged).forEach(function (id) {
        var q = merged[id];
        db.request_items.push({ request_id: r.id, item_id: Number(id), qty: q, price: byId(db.items, id).price || 0 });
        moveStock(db, ctx, { item_id: id, type: 'withdraw', delta: -q, request_no: r.request_no, allowNegative: true });
      });
      return r.id;
    },

    // เพิ่มพัสดุใหม่: ไม่ส่งรหัสมา = ระบบตั้งรหัสถัดไปให้เอง
    saveItem: function (db, p, ctx) {
      var code = str(p.code) || (p.id ? req(p.code, 'รหัสพัสดุ') : nextItemCode(db.items));
      var dup = find(db.items, function (i) { return i.code === code && i.id !== Number(p.id || 0); });
      if (dup) fail('รหัสพัสดุนี้มีอยู่แล้ว');
      var fields = {
        code: code, name: req(p.name, 'ชื่อพัสดุ'), category: str(p.category), unit: str(p.unit) || 'ชิ้น',
        min_qty: int(p.min_qty || 0, 'จุดสั่งซื้อขั้นต่ำ'), location: str(p.location), active: p.active === false ? 0 : 1,
        price: money(p.price, 'ราคาต่อหน่วย'),
      };
      // ส่งขนาดบรรจุมาเท่านั้นจึงแก้ (เว็บเวอร์ชันก่อนไม่ส่ง = คงค่าเดิม)
      if (p.pack_qty !== undefined) { var pk = packFields(p); fields.pack_qty = pk.pack_qty; fields.pack_unit = pk.pack_unit; }
      // หน่วยนับ / สถานที่เก็บใหม่ เพิ่มลงรายการตัวเลือกให้ด้วย
      addNames(db, 'units', [fields.unit]);
      addNames(db, 'locations', [fields.location]);
      var item;
      if (p.id) {
        item = byId(db.items, p.id) || fail('ไม่พบรายการพัสดุ');
        Object.keys(fields).forEach(function (k) { item[k] = fields[k]; });
        // แก้ยอดคงเหลือได้จากฟอร์มแก้ไขพัสดุ (บันทึกเป็น "ปรับปรุงยอด" ในประวัติสต็อก)
        if (str(p.available_qty) !== '') {
          var diff = int(p.available_qty, 'จำนวนคงเหลือ', -1e9) - item.available_qty;
          if (diff) moveStock(db, ctx, { item_id: item.id, type: 'adjust', delta: diff, allowNegative: true, note: str(p.adjust_note) || 'แก้ไขยอดคงเหลือ' });
        }
      } else {
        item = fields;
        if (item.pack_qty === undefined) { var g = guessPack(item); item.pack_qty = g ? g.qty : ''; item.pack_unit = g ? g.unit : ''; }
        item.id = nextId(db.items);
        item.available_qty = 0;
        db.items.push(item);
        var qty = int(p.initial_qty || 0, 'จำนวนเริ่มต้น');
        if (qty) moveStock(db, ctx, withLot({ item_id: item.id, type: 'receive', delta: qty, note: str(p.note) || 'รับเข้าครั้งแรก', price: p.receive_price }, p));
        else lot(p);
      }
      return item.id;
    },

    // type: receive (รับเข้า) | lost (ตัดชำรุด) | adjust (ระบุยอดที่นับได้จริง)
    stock: function (db, p, ctx) {
      var item = byId(db.items, p.item_id) || fail('ไม่พบรายการพัสดุ');
      var q;
      if (p.type === 'receive') {
        q = int(p.qty, 'จำนวน', 1);
        moveStock(db, ctx, withLot({ item_id: item.id, type: 'receive', delta: q, note: p.note, price: p.price, at: receiveDate(p.date, ctx) }, p));
      } else if (p.type === 'lost') {
        q = int(p.qty, 'จำนวน', 1);
        // ตัดชำรุดได้เกินยอดในระบบ (ยอดติดลบ = ต้องตรวจนับ/รับเข้าเพิ่ม)
        moveStock(db, ctx, { item_id: item.id, type: 'lost', delta: -q, note: p.note, allowNegative: true });
      } else if (p.type === 'adjust') {
        var diff = int(p.counted_qty, 'ยอดที่นับได้', -1e9) - item.available_qty;
        if (diff) moveStock(db, ctx, { item_id: item.id, type: 'adjust', delta: diff, allowNegative: true, note: p.note || 'ปรับยอดตามการตรวจนับ' });
      } else {
        fail('ประเภทการปรับสต็อกไม่ถูกต้อง');
      }
      return item.id;
    },

    // เจ้าหน้าที่ติ๊ก/ยกเลิกเครื่องหมาย "รับของ/เซ็นเอกสารแล้ว" ของใบเบิก · ids = หลายใบพร้อมกันได้
    markReceived: function (db, p, ctx) {
      var ids = (p.ids || [p.id]).map(Number);
      var rs = ids.map(function (id) { return byId(db.requests, id) || fail('ไม่พบใบเบิกนี้ (อาจถูกลบไปแล้ว)'); });
      var at = p.received === false ? '' : stamp(ctx.now);
      rs.forEach(function (r) { if (!at || !r.received_at) r.received_at = at; });
      return rs.length;
    },

    // รับเข้าหลายรายการตามใบส่งของ 1 ใบ: บริษัท เลขใบส่งของ วันที่รับ ใช้ร่วมกัน · items = [{ item_id, qty, price, expiry_date }]
    // set_price = ตั้งราคาต่อหน่วยของพัสดุเป็นราคาล็อตนี้ด้วย
    receiveBatch: function (db, p, ctx) {
      if (!p.items || !p.items.length) fail('กรุณาเพิ่มพัสดุอย่างน้อย 1 รายการ');
      var at = receiveDate(p.date, ctx);
      var head = { supplier: p.supplier, delivery_no: p.delivery_no };
      lot(head);
      var rows = p.items.map(function (x) {
        var item = byId(db.items, x.item_id) || fail('ไม่พบรายการพัสดุ');
        var price = str(x.price) === '' ? '' : money(x.price, 'ราคาต่อหน่วยของ "' + item.name + '"');
        lot({ expiry_date: x.expiry_date });
        return { item: item, qty: int(x.qty, 'จำนวนของ "' + item.name + '"', 1), price: price, expiry_date: str(x.expiry_date) };
      });
      rows.forEach(function (r) {
        moveStock(db, ctx, withLot({ item_id: r.item.id, type: 'receive', delta: r.qty, note: p.note, price: r.price, at: at },
          { supplier: head.supplier, delivery_no: head.delivery_no, expiry_date: r.expiry_date }));
        if (p.set_price && r.price !== '' && r.price > 0) r.item.price = r.price;
      });
      return rows.length;
    },

    // แก้ข้อมูลล็อตที่รับเข้าแล้ว: ราคาต่อหน่วยของล็อต วันที่รับ วันหมดอายุ บริษัท เลขใบส่งของ (จำนวนแก้ด้วย "แก้ยอด / ตรวจนับ")
    editReceipt: function (db, p, ctx) {
      var m = byId(db.movements, p.id) || fail('ไม่พบรายการรับเข้านี้');
      if (m.type !== 'receive') fail('แก้ได้เฉพาะรายการรับเข้า');
      var l = lot(p);
      if (str(p.price) !== '') m.price = money(p.price, 'ราคาต่อหน่วย');
      var d = receiveDate(p.date, ctx);
      if (d) m.created_at = d + (m.created_at.slice(10) || ' 00:00:00');
      m.supplier = l.supplier;
      m.expiry_date = l.expiry_date;
      m.delivery_no = l.delivery_no;
      if (p.note !== undefined) m.note = str(p.note);
      var item = byId(db.items, m.item_id);
      if (p.set_price && item && m.price > 0) item.price = m.price;
      return m.id;
    },

    // ตั้งขนาดบรรจุหลายรายการพร้อมกัน: items = [{ item_id, pack_qty, pack_unit }] (pack_qty 0 = ไม่มีขนาดบรรจุ)
    setPacks: function (db, p) {
      if (!p.items || !p.items.length) fail('ยังไม่ได้ใส่ขนาดบรรจุรายการใด');
      var rows = p.items.map(function (x) {
        var item = byId(db.items, x.item_id) || fail('ไม่พบรายการพัสดุ');
        return { item: item, pk: packFields(x) };
      });
      rows.forEach(function (r) { r.item.pack_qty = r.pk.pack_qty; r.item.pack_unit = r.pk.pack_unit; });
      return rows.length;
    },

    // เปลี่ยนพัสดุให้นับเป็นหน่วยย่อยทั้งรายการ (เช่น กล่อง → ชิ้น ×100): ยอดคงเหลือ จุดสั่งซื้อ ประวัติสต็อก และใบเบิกเดิมคูณตาม
    // ราคาต่อหน่วย (พัสดุ ล็อตที่รับ และราคาในใบเบิก) หารตาม · บันทึกในประวัติสต็อกว่าเปลี่ยนหน่วยนับเมื่อไร
    convertToPieces: function (db, p, ctx) {
      var item = byId(db.items, p.item_id) || fail('ไม่พบรายการพัสดุ');
      var n = item.pack_qty;
      if (!(n > 1)) fail('ต้องตั้งขนาดบรรจุมากกว่า 1 ก่อน (เช่น 1 กล่อง = 100 ชิ้น)');
      var from = item.unit, to = item.pack_unit || 'ชิ้น';
      var per = function (v) { return Math.round((v / n) * 100) / 100; };
      item.available_qty *= n;
      item.min_qty *= n;
      item.price = per(item.price || 0);
      db.movements.forEach(function (m) {
        if (m.item_id !== item.id) return;
        m.qty *= n; m.available_after *= n;
        if (m.price > 0) m.price = per(m.price);
      });
      db.request_items.forEach(function (l) {
        if (l.item_id !== item.id) return;
        l.qty *= n;
        if (l.price > 0) l.price = per(l.price);
      });
      item.unit = to;
      item.pack_qty = 0;
      item.pack_unit = '';
      addNames(db, 'units', [to]);
      moveStock(db, ctx, { item_id: item.id, type: 'adjust', delta: 0, allowNegative: true, note: 'เปลี่ยนหน่วยนับ ' + from + ' → ' + to + ' (1 ' + from + ' = ' + n + ' ' + to + ')' });
      return item.id;
    },

    // ลบใบเบิก (เจ้าหน้าที่): restock = คืนจำนวนพัสดุในใบนั้นเข้าสต็อก (บันทึกในประวัติสต็อกว่า "คืนจากใบเบิกที่ลบ")
    // แก้ใบเบิก (เจ้าหน้าที่): ชื่อ แผนก หมายเหตุ และรายการ items = [{ item_id, qty }] (ไม่อยู่ในรายการ = ลบออก)
    // เพิ่มจำนวน = ตัดสต็อกเพิ่ม · ลดจำนวน/ลบรายการ = คืนเข้าสต็อก · รายการเดิมคงราคา ณ วันที่เบิก รายการใหม่ใช้ราคาปัจจุบัน
    editRequest: function (db, p, ctx) {
      var r = byId(db.requests, p.id) || fail('ไม่พบใบเบิกนี้ (อาจถูกลบไปแล้ว)');
      var name = req(p.borrower_name, 'ชื่อผู้เบิก');
      var dept = req(p.department, 'แผนก');
      if (dept !== r.department && !find(db.departments, function (d) { return d.name === dept; })) fail('กรุณาเลือกแผนกจากรายการ');
      if (!p.items || !p.items.length) fail('ใบเบิกต้องมีพัสดุอย่างน้อย 1 รายการ (ถ้าต้องการยกเลิกทั้งใบ ให้ลบใบเบิก)');
      var want = {};
      p.items.forEach(function (l) {
        var id = int(l.item_id, 'รหัสพัสดุ', 1);
        want[id] = (want[id] || 0) + int(l.qty, 'จำนวน', 1);
      });
      var old = {};
      lines(db, r.id).forEach(function (l) { old[l.item_id] = l; });
      Object.keys(want).forEach(function (id) {
        if (!old[id] && !byId(db.items, id)) fail('มีพัสดุที่ไม่พบในระบบ');
      });
      var tag = 'แก้ไขใบเบิก ' + r.request_no;
      // คืนสต็อกของที่ลด/ลบออก และตัดสต็อกของที่เพิ่ม
      var ids = Object.keys(old).concat(Object.keys(want).filter(function (id) { return !old[id]; }));
      ids.forEach(function (id) {
        var before = old[id] ? old[id].qty : 0;
        var after = want[id] || 0;
        var d = after - before;
        if (!d || !byId(db.items, id)) return;
        if (d > 0) moveStock(db, ctx, { item_id: id, type: 'withdraw', delta: -d, request_no: r.request_no, allowNegative: true, note: tag });
        else moveStock(db, ctx, { item_id: id, type: 'cancel', delta: -d, request_no: r.request_no, note: tag });
      });
      db.request_items = db.request_items.filter(function (l) { return l.request_id !== r.id || want[l.item_id]; });
      Object.keys(want).forEach(function (id) {
        if (old[id]) old[id].qty = want[id];
        else db.request_items.push({ request_id: r.id, item_id: Number(id), qty: want[id], price: byId(db.items, id).price || 0 });
      });
      r.borrower_name = name;
      r.department = dept;
      r.note = str(p.note);
      r.edited_at = stamp(ctx.now);
      return r.id;
    },

    deleteRequest: function (db, p, ctx) {
      var r = byId(db.requests, p.id) || fail('ไม่พบใบเบิกนี้ (อาจถูกลบไปแล้ว)');
      if (p.restock) {
        lines(db, r.id).forEach(function (l) {
          if (byId(db.items, l.item_id)) moveStock(db, ctx, { item_id: l.item_id, type: 'cancel', delta: l.qty, request_no: r.request_no, note: 'ลบใบเบิก ' + r.request_no });
        });
      }
      db.requests = db.requests.filter(function (x) { return x.id !== r.id; });
      db.request_items = db.request_items.filter(function (l) { return l.request_id !== r.id; });
      return r.request_no;
    },

    // table: departments (แผนก) | categories (หมวดหมู่) | suppliers (บริษัท) | units (หน่วยนับ) | locations (สถานที่เก็บ)
    addMaster: function (db, p) {
      var key = masterTable(p.table);
      var name = req(p.name, 'ชื่อ');
      if (find(db[key], function (r) { return r.name === name; })) fail('มีชื่อนี้อยู่แล้ว');
      db[key].push(key === 'departments' ? { name: name, full_name: str(p.full_name) } : { name: name });
      return name;
    },

    // แก้ยอดคงเหลือหลายรายการพร้อมกัน: items = [{ item_id, qty }] (qty = ยอดใหม่ ติดลบได้) บันทึกเป็น "ปรับปรุงยอด"
    setStock: function (db, p, ctx) {
      if (!p.items || !p.items.length) fail('ยังไม่ได้แก้ยอดรายการใด');
      var note = str(p.note) || 'แก้ไขยอดคงเหลือ';
      var changed = 0;
      p.items.forEach(function (x) {
        var item = byId(db.items, x.item_id) || fail('ไม่พบรายการพัสดุ');
        var diff = int(x.qty, 'จำนวนคงเหลือของ "' + item.name + '"', -1e9) - item.available_qty;
        if (!diff) return;
        moveStock(db, ctx, { item_id: item.id, type: 'adjust', delta: diff, allowNegative: true, note: note });
        changed++;
      });
      return changed;
    },

    // เพิ่ม/แก้ข้อมูลบริษัท · old_name = ชื่อเดิม (แก้ชื่อแล้วประวัติรับเข้าเดิมเปลี่ยนตามด้วย)
    saveSupplier: function (db, p) {
      var name = req(p.name, 'ชื่อบริษัท');
      var old = str(p.old_name);
      var row = old ? find(db.suppliers, function (s) { return s.name === old; }) : null;
      if (old && !row && !find(db.movements, function (m) { return m.supplier === old; })) fail('ไม่พบบริษัทนี้ (อาจถูกลบไปแล้ว)');
      if (name !== old && find(db.suppliers, function (s) { return s.name === name; })) fail('มีชื่อบริษัทนี้อยู่แล้ว');
      if (!row) { row = { name: name }; db.suppliers.push(row); }
      row.name = name;
      row.contact = str(p.contact);
      row.phone = str(p.phone);
      row.email = str(p.email);
      row.note = str(p.note);
      if (old && old !== name) db.movements.forEach(function (m) { if (m.supplier === old) m.supplier = name; });
      return name;
    },

    // ตั้ง/เพิ่ม/ลดงบประมาณของแผนก 1 ครั้ง: amount บวก = เพิ่มงบ, ติดลบ = ลดงบ
    addBudget: function (db, p, ctx) {
      var dept = budgetDept(db, p.department);
      var fy = fiscalYearOf(p.fiscal_year);
      var amount = signedMoney(p.amount, 'จำนวนเงิน');
      if (!amount) fail('กรุณาระบุจำนวนเงิน (ติดลบ = ลดงบ)');
      var row = { id: nextId(db.budgets), department: dept, fiscal_year: fy, amount: amount, note: str(p.note), created_at: stamp(ctx.now) };
      db.budgets.push(row);
      return row.id;
    },

    // ตั้งงบหลายแผนกพร้อมกัน: items = [{ department, amount }] (amount = งบทั้งปีที่ต้องการ) บันทึกเฉพาะส่วนต่างจากงบเดิม
    setBudgets: function (db, p, ctx) {
      var fy = fiscalYearOf(p.fiscal_year);
      if (!p.items || !p.items.length) fail('ยังไม่ได้ระบุงบประมาณ');
      var changed = 0;
      p.items.forEach(function (x) {
        var dept = budgetDept(db, x.department);
        var want = money(x.amount, 'งบประมาณของ ' + dept);
        var diff = Math.round((want - budgetOf(db, dept, fy)) * 100) / 100;
        if (!diff) return;
        db.budgets.push({ id: nextId(db.budgets), department: dept, fiscal_year: fy, amount: diff,
          note: str(p.note) || (budgetOf(db, dept, fy) ? 'ปรับงบประมาณ' : 'ตั้งงบประมาณ'), created_at: stamp(ctx.now) });
        changed++;
      });
      return changed;
    },

    removeBudget: function (db, p) {
      var row = byId(db.budgets, p.id) || fail('ไม่พบรายการงบนี้ (อาจถูกลบไปแล้ว)');
      db.budgets = db.budgets.filter(function (b) { return b.id !== row.id; });
      return row.id;
    },

    removeMaster: function (db, p) {
      var key = masterTable(p.table);
      db[key] = db[key].filter(function (r) { return r.name !== p.name; });
      return p.name;
    },
  };

  // ---------- งบประมาณแผนก ----------
  // ปีงบประมาณ พ.ศ. X = 1 ต.ค. (X−1) – 30 ก.ย. X (ค.ศ. = พ.ศ. − 543)
  function fiscalYearOf(v) {
    var fy = Number(str(v));
    if (!(fy >= 2500 && fy <= 2800) || fy % 1) fail('ปีงบประมาณไม่ถูกต้อง (ใช้ปี พ.ศ. เช่น 2570)');
    return String(fy);
  }
  function fiscalRange(fy) { var y = Number(fy) - 543; return { start: (y - 1) + '-10-01', end: y + '-09-30' }; }
  // ปีงบประมาณของวันที่ 'YYYY-MM-DD' (ต.ค.–ธ.ค. นับเป็นปีงบถัดไป)
  function fiscalYear(ymdStr) { var y = Number(ymdStr.slice(0, 4)) + 543; return String(Number(ymdStr.slice(5, 7)) >= 10 ? y + 1 : y); }
  function budgetDept(db, v) {
    var d = req(v, 'แผนก');
    if (!find(db.departments, function (x) { return x.name === d; })) fail('ไม่พบแผนก "' + d + '" ในรายการแผนก');
    return d;
  }
  function budgetOf(db, dept, fy) {
    var t = 0;
    db.budgets.forEach(function (b) { if (b.department === dept && b.fiscal_year === fy) t += b.amount; });
    return Math.round(t * 100) / 100;
  }
  // สรุปงบประมาณแผนกของปีงบ fy: งบ ใช้ไป คงเหลือ และประวัติทีละรอบ (ตั้งงบ + ทุกใบเบิกที่ตัดงบ) พร้อมยอดคงเหลือหลังแต่ละรอบ
  // แต่ละใบเบิกบอกว่าตัดจากงบแผนกไหน และแยกมูลค่าตามหมวดหมู่พัสดุ
  function budgetSummary(db, fy) {
    fy = String(fy);
    var range = fiscalRange(fy);
    var round = function (x) { return Math.round(x * 100) / 100; };
    var map = {};
    var get = function (name) {
      if (!map[name]) {
        var d = find(db.departments, function (x) { return x.name === name; });
        map[name] = { name: name, full_name: d ? d.full_name : '', budget: 0, used: 0, remaining: 0, docs: 0, categories: {}, history: [] };
      }
      return map[name];
    };
    db.departments.forEach(function (d) { get(d.name); });
    db.budgets.forEach(function (b) {
      if (b.fiscal_year !== fy) return;
      var d = get(b.department);
      d.budget = round(d.budget + b.amount);
      d.history.push({ kind: 'budget', id: b.id, date: b.created_at, amount: b.amount, note: b.note });
    });
    db.requests.forEach(function (r) {
      var day = r.created_at.slice(0, 10);
      if (day < range.start || day > range.end) return;
      var d = get(r.department);
      var cats = {}, value = 0, qty = 0;
      lines(db, r.id).forEach(function (l) {
        var it = byId(db.items, l.item_id);
        var c = (it && it.category) || 'ไม่ระบุหมวดหมู่';
        var v = lineValue(db, l);
        cats[c] = round((cats[c] || 0) + v);
        d.categories[c] = round((d.categories[c] || 0) + v);
        value += v; qty += l.qty;
      });
      value = round(value);
      d.used = round(d.used + value);
      d.docs++;
      d.history.push({ kind: 'cut', request_id: r.id, request_no: r.request_no, date: r.created_at, edited_at: r.edited_at, borrower_name: r.borrower_name,
        amount: -value, qty: qty, lines: lines(db, r.id).length,
        categories: Object.keys(cats).map(function (k) { return { name: k, value: cats[k] }; }).sort(function (a, b) { return b.value - a.value; }) });
    });
    var t = { budget: 0, used: 0, remaining: 0, departments: 0, over: 0 };
    var list = Object.keys(map).map(function (k) {
      var d = map[k];
      // เรียงตามเวลา · งบเป็นงบทั้งปี (ตั้งงบช้ากว่าใบเบิกแรกได้) ใบเบิกแต่ละใบจึงบอก คงเหลือ = งบทั้งปี − ยอดตัดสะสมถึงใบนั้น
      // แถวตั้ง/ปรับงบบอก total = งบทั้งปีรวมหลังรายการนั้น
      d.history.sort(function (a, b) { return a.date.localeCompare(b.date) || (a.kind === b.kind ? 0 : a.kind === 'budget' ? -1 : 1); });
      var used = 0, total = 0;
      d.history.forEach(function (h) {
        if (h.kind === 'cut') { used = round(used - h.amount); h.balance = round(d.budget - used); }
        else { total = round(total + h.amount); h.total = total; }
      });
      d.remaining = round(d.budget - d.used);
      d.percent = d.budget > 0 ? Math.round((d.used / d.budget) * 1000) / 10 : null;
      d.categories = Object.keys(d.categories).map(function (c) { return { name: c, value: d.categories[c] }; }).sort(function (a, b) { return b.value - a.value; });
      t.budget = round(t.budget + d.budget);
      t.used = round(t.used + d.used);
      if (d.budget) t.departments++;
      if (d.budget && d.remaining < 0) t.over++;
      return d;
    }).sort(function (a, b) { return (b.budget ? 1 : 0) - (a.budget ? 1 : 0) || b.used - a.used || a.name.localeCompare(b.name); });
    t.remaining = round(t.budget - t.used);
    return { fiscal_year: fy, start: range.start, end: range.end, departments: list, totals: t };
  }

  // จุดเรียกใช้งานเดียว: ตรวจสิทธิ์แล้วรัน action บน db (แก้ไข db โดยตรง)
  function run(db, action, payload, ctx) {
    if (!actions[action]) fail('ไม่รู้จักคำสั่ง ' + action);
    if (ADMIN_ACTIONS.indexOf(action) >= 0 && !ctx.isAdmin) fail('รหัส PIN เจ้าหน้าที่ไม่ถูกต้อง');
    return actions[action](db, payload || {}, { now: ctx.now || new Date() });
  }

  // ---------- ตารางสำหรับเขียนลง Google Sheets ----------
  // คอลัมน์ตาม TABLES (ระบบอ่านกลับ) + คอลัมน์ภาษาไทยต่อท้ายให้คนอ่านง่าย (ระบบไม่อ่านกลับ เขียนใหม่ทุกครั้ง)
  function sheetData(db) {
    var itemOf = function (id) { return byId(db.items, id) || { code: '', name: '(ลบแล้ว)', unit: '' }; };
    var reqOf = function (id) { return byId(db.requests, id) || { request_no: '' }; };
    var withdrawn = {};
    db.request_items.forEach(function (l) { withdrawn[l.item_id] = (withdrawn[l.item_id] || 0) + l.qty; });
    var extra = {
      items: [['เบิกไปแล้วรวม', function (i) { return withdrawn[i.id] || 0; }]],
      request_items: [
        ['เลขที่', function (l) { return reqOf(l.request_id).request_no; }],
        ['รหัสพัสดุ', function (l) { return itemOf(l.item_id).code; }],
        ['ชื่อพัสดุ', function (l) { return itemOf(l.item_id).name; }],
        ['หน่วย', function (l) { return itemOf(l.item_id).unit; }],
        ['รวมเงิน (บาท)', function (l) { return lineValue(db, l); }],
      ],
      movements: [
        ['รายการ', function (m) { return MOVE[m.type] || m.type; }],
        ['รหัสพัสดุ', function (m) { return itemOf(m.item_id).code; }],
        ['ชื่อพัสดุ', function (m) { return itemOf(m.item_id).name; }],
      ],
    };
    var out = {};
    Object.keys(TABLES).forEach(function (t) {
      if (t === 'requests') return; // แท็บประวัติการเบิกจัดรูปแบบอ่านง่ายด้านล่าง
      var cols = TABLES[t];
      var ex = extra[t] || [];
      out[t] = {
        header: cols.concat(ex.map(function (e) { return e[0]; })),
        extra: ex.length,
        rows: db[t].map(function (r) {
          return cols.map(function (c) { return r[c] === undefined ? '' : r[c]; }).concat(ex.map(function (e) { return e[1](r); }));
        }),
      };
    });
    // แท็บ "ประวัติการเบิก": คอลัมน์อ่านง่ายอยู่หน้า (ล่าสุดอยู่บน) ข้อมูลระบบครบทุกช่องอยู่ท้ายตาราง
    // คอลัมน์ เลขที่/ผู้เบิก/แผนก/หมายเหตุ เป็นข้อมูลจริงที่ระบบอ่านกลับ (ชื่อหัวภาษาไทยแปลงกลับด้วย fieldOf)
    var reqFront = [
      ['เลขที่', function (r) { return r.request_no; }],
      ['วันที่เวลาที่เบิก', function (r) { return thaiStamp(r.created_at); }],
      [LABELS.requests.borrower_name, function (r) { return r.borrower_name; }],
      ['แผนก', function (r) { return r.department; }],
      ['รายการพัสดุ', function (r) {
        return lines(db, r.id).map(function (l) { var it = itemOf(l.item_id); return it.name + ' ×' + l.qty + ' ' + it.unit; }).join('\n');
      }],
      ['จำนวนรวม', function (r) { return lines(db, r.id).reduce(function (n, l) { return n + l.qty; }, 0); }],
      ['รวมเงิน (บาท)', function (r) { return requestValue(db, r.id); }],
      ['หมายเหตุ', function (r) { return r.note; }],
      ['รับของ/เซ็นแล้ว', function (r) { return r.received_at ? '✓ ' + thaiStamp(r.received_at) : ''; }],
    ];
    var reqSys = TABLES.requests.filter(function (c) { return !LABELS.requests[c]; });
    out.requests = {
      header: reqFront.map(function (e) { return e[0]; }).concat(reqSys),
      front: reqFront.length, sys: reqSys.length, wide: 5,
      rows: db.requests.slice().sort(function (a, b) { return b.id - a.id; }).map(function (r) {
        return reqFront.map(function (e) { var v = e[1](r); return v === undefined ? '' : v; })
          .concat(reqSys.map(function (c) { return r[c] === undefined ? '' : r[c]; }));
      }),
    };
    // แท็บ log: 1 แถวต่อพัสดุ 1 รายการ ล่าสุดอยู่บน อ่านง่าย ใช้กรอง/Pivot ในชีตได้
    var log = [];
    db.requests.slice().sort(function (a, b) { return b.id - a.id; }).forEach(function (r) {
      lines(db, r.id).forEach(function (l) {
        var it = itemOf(l.item_id);
        log.push([thaiStamp(r.created_at), r.request_no, r.borrower_name, r.department, it.code, it.name, l.qty, it.unit, linePrice(db, l), lineValue(db, l)]);
      });
    });
    out.log = {
      header: ['วันที่เวลาที่เบิก', 'เลขที่', 'ผู้เบิก', 'แผนก', 'รหัสพัสดุ', 'ชื่อพัสดุ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'รวมเงิน (บาท)'],
      extra: 10, rows: log,
    };
    return out;
  }
  // วันที่แบบไทยสำหรับคนอ่าน เช่น 12/10/2569 09:15:42 (ข้อมูลเก่าไม่มีวินาทีแสดง 09:15)
  function thaiStamp(v) {
    var m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}(?::\d{2})?))?/.exec(v || '');
    return m ? Number(m[3]) + '/' + Number(m[2]) + '/' + (Number(m[1]) + 543) + (m[4] ? ' ' + m[4] : '') : '';
  }

  // ข้อมูลที่ส่งให้ผู้ใช้ทั่วไป (ไม่มี PIN): สต็อก แผนก หมวดหมู่ และเฉพาะใบที่เพิ่งส่ง (ใช้ทำ PDF)
  // ประวัติการเบิกทั้งหมด (ชื่อผู้เบิก ฯลฯ) ส่งให้เฉพาะเจ้าหน้าที่
  function publicView(db, keepRequestId) {
    var keep = Number(keepRequestId || 0);
    return {
      items: db.items, departments: db.departments, categories: db.categories,
      requests: db.requests.filter(function (r) { return r.id === keep; }),
      request_items: db.request_items.filter(function (l) { return l.request_id === keep; }),
      movements: [],
    };
  }

  // สรุปการเบิก period = 'YYYY-MM' (รายเดือน) หรือ 'YYYY' (รายปี) · department = เฉพาะแผนกนั้น (ไม่ระบุ = ทุกแผนก)
  // มูลค่า = จำนวน × ราคาต่อหน่วย ณ วันที่เบิก (บาท)
  function monthlySummary(db, period, department) {
    period = str(period);
    var dept = str(department);
    var round = function (n) { return Math.round(n * 100) / 100; };
    var reqs = db.requests.filter(function (r) {
      return r.created_at.slice(0, period.length) === period && (!dept || r.department === dept);
    }).sort(function (a, b) { return a.id - b.id; });
    var t = { withdraw_docs: 0, withdraw_qty: 0, withdraw_value: 0 };
    var withdrawn = {}, depts = {}, values = {};
    var months = {};
    if (period.length === 4) for (var m = 1; m <= 12; m++) months[period + '-' + pad(m)] = { month: period + '-' + pad(m), withdraw_docs: 0, withdraw_qty: 0, withdraw_value: 0 };
    reqs.forEach(function (r) {
      var d = depts[r.department] || (depts[r.department] = { name: r.department, withdraw_docs: 0, withdraw_qty: 0, withdraw_value: 0 });
      var mo = months[r.created_at.slice(0, 7)];
      var ls = lines(db, r.id);
      var qty = 0, value = 0;
      ls.forEach(function (l) {
        var v = lineValue(db, l);
        qty += l.qty; value += v;
        if (!withdrawn[l.item_id]) {
          var it = byId(db.items, l.item_id) || { code: '', name: '(ลบแล้ว)', unit: '' };
          withdrawn[l.item_id] = { item_id: l.item_id, code: it.code, name: it.name, unit: it.unit, qty: 0, times: 0, value: 0 };
        }
        var w = withdrawn[l.item_id];
        w.qty += l.qty; w.times++; w.value = round(w.value + v);
      });
      value = round(value);
      values[r.id] = value;
      [t, d, mo].forEach(function (x) {
        if (!x) return;
        x.withdraw_docs++; x.withdraw_qty += qty; x.withdraw_value = round(x.withdraw_value + value);
      });
    });
    function list(map) { return Object.keys(map).map(function (k) { return map[k]; }); }
    return {
      month: period, period: period, yearly: period.length === 4, department: dept, totals: t, requests: reqs, values: values,
      // ราคาเฉลี่ยต่อหน่วย (ถ้าราคาเปลี่ยนระหว่างช่วง) = มูลค่ารวม ÷ จำนวน
      withdrawn: list(withdrawn).map(function (w) { w.price = w.qty ? round(w.value / w.qty) : 0; return w; })
        .sort(function (a, b) { return b.qty - a.qty || a.code.localeCompare(b.code); }),
      departments: list(depts).sort(function (a, b) { return b.withdraw_qty - a.withdraw_qty || a.name.localeCompare(b.name); }),
      months: list(months),
    };
  }

  // รายงานพัสดุคงเหลือ period = 'YYYY-MM' (รายเดือน) หรือ 'YYYY' (รายปี)
  // จ่ายออก = ใบเบิกในงวด (มูลค่าตามราคา ณ วันที่เบิก) · รับเข้า = การรับเข้าในงวด
  // คงเหลือ ณ สิ้นงวด = คงเหลือปัจจุบัน − การเคลื่อนไหวหลังสิ้นงวด · มูลค่าคงเหลือ = คงเหลือ × ราคาปัจจุบัน
  function stockSummary(db, period) {
    period = str(period);
    var n = period.length;
    var round = function (x) { return Math.round(x * 100) / 100; };
    var rows = {};
    db.items.forEach(function (i) {
      rows[i.id] = { item_id: i.id, code: i.code, name: i.name, unit: i.unit, category: i.category, price: i.price || 0, active: i.active,
        received: 0, issued: 0, issued_value: 0, balance: i.available_qty, balance_value: 0, moved: false };
    });
    db.movements.forEach(function (m) {
      var r = rows[m.item_id];
      if (!r) return;
      var p = m.created_at.slice(0, n);
      if (p > period) { r.balance -= m.qty; r.moved = true; } else if (p === period) { r.moved = true; if (isReceipt(m)) r.received += m.qty; }
    });
    db.requests.forEach(function (rq) {
      if (rq.created_at.slice(0, n) !== period) return;
      lines(db, rq.id).forEach(function (l) {
        var r = rows[l.item_id];
        if (!r) return;
        r.issued += l.qty;
        r.issued_value = round(r.issued_value + lineValue(db, l));
      });
    });
    var t = { items: 0, issued_items: 0, issued_qty: 0, issued_value: 0, received_qty: 0, balance_qty: 0, balance_value: 0 };
    var list = Object.keys(rows).map(function (k) { return rows[k]; })
      // พัสดุที่ปิดใช้งาน ไม่มีความเคลื่อนไหว และไม่มีของเหลือ ไม่ต้องแสดง
      .filter(function (r) { return r.active || r.moved || r.issued || r.balance; })
      .sort(function (a, b) { return a.code.localeCompare(b.code); });
    list.forEach(function (r) {
      r.balance_value = r.balance > 0 ? round(r.balance * r.price) : 0;
      delete r.moved;
      t.items++;
      if (r.issued) t.issued_items++;
      t.issued_qty += r.issued;
      t.issued_value = round(t.issued_value + r.issued_value);
      t.received_qty += r.received;
      if (r.balance > 0) t.balance_qty += r.balance;
      t.balance_value = round(t.balance_value + r.balance_value);
    });
    return {
      period: period, yearly: n === 4, totals: t, items: list,
      issued: list.filter(function (r) { return r.issued; }).sort(function (a, b) { return b.issued - a.issued || a.code.localeCompare(b.code); }),
    };
  }

  // สรุปมูลค่ารับเข้า / จ่ายออก period = 'YYYY-MM' หรือ 'YYYY'
  // รับเข้า = การรับเข้าสต็อกในงวด (ไม่นับยอดยกมาเริ่มต้น) มูลค่าตามราคาของล็อต · จ่ายออก = ใบเบิกในงวด มูลค่าตามราคา ณ วันที่เบิก
  function flowSummary(db, period) {
    period = str(period);
    var n = period.length;
    var round = function (x) { return Math.round(x * 100) / 100; };
    var rows = {}, months = {};
    var t = { in_qty: 0, in_value: 0, in_items: 0, in_count: 0, out_qty: 0, out_value: 0, out_items: 0, out_count: 0 };
    if (n === 4) for (var mo = 1; mo <= 12; mo++) months[period + '-' + pad(mo)] = { month: period + '-' + pad(mo), in_qty: 0, in_value: 0, out_qty: 0, out_value: 0 };
    var row = function (id) {
      if (!rows[id]) {
        var it = byId(db.items, id) || { code: '', name: '(ลบแล้ว)', unit: '' };
        rows[id] = { item_id: id, code: it.code, name: it.name, unit: it.unit, in_qty: 0, in_value: 0, out_qty: 0, out_value: 0 };
      }
      return rows[id];
    };
    var receipts = [];
    db.movements.forEach(function (m) {
      if (!isReceipt(m) || m.created_at.slice(0, n) !== period) return;
      var price = movePrice(db, m);
      var v = round(m.qty * price);
      var r = row(m.item_id);
      r.in_qty += m.qty; r.in_value = round(r.in_value + v);
      t.in_qty += m.qty; t.in_value = round(t.in_value + v); t.in_count++;
      var x = months[m.created_at.slice(0, 7)];
      if (x) { x.in_qty += m.qty; x.in_value = round(x.in_value + v); }
      receipts.push({ id: m.id, created_at: m.created_at, item_id: m.item_id, code: r.code, name: r.name, unit: r.unit, qty: m.qty, price: price, value: v,
        supplier: m.supplier, delivery_no: m.delivery_no, expiry_date: m.expiry_date });
    });
    db.requests.forEach(function (rq) {
      if (rq.created_at.slice(0, n) !== period) return;
      t.out_count++;
      var x = months[rq.created_at.slice(0, 7)];
      lines(db, rq.id).forEach(function (l) {
        var v = lineValue(db, l);
        var r = row(l.item_id);
        r.out_qty += l.qty; r.out_value = round(r.out_value + v);
        t.out_qty += l.qty; t.out_value = round(t.out_value + v);
        if (x) { x.out_qty += l.qty; x.out_value = round(x.out_value + v); }
      });
    });
    var list = Object.keys(rows).map(function (k) { return rows[k]; }).sort(function (a, b) { return a.code.localeCompare(b.code); });
    list.forEach(function (r) { if (r.in_qty) t.in_items++; if (r.out_qty) t.out_items++; });
    return {
      period: period, yearly: n === 4, totals: t, items: list,
      receipts: receipts.sort(function (a, b) { return a.created_at.localeCompare(b.created_at) || a.id - b.id; }),
      months: Object.keys(months).map(function (k) { return months[k]; }),
    };
  }

  // ล็อตที่ใกล้หมดอายุ (วันหมดอายุภายใน months เดือนจาก today 'YYYY-MM-DD') รวมล็อตที่หมดอายุแล้ว
  // ยอดคงเหลือของแต่ละล็อตประมาณแบบเข้าก่อนออกก่อน: ของที่ยังเหลือในคลังเป็นของล็อตที่รับเข้าล่าสุด ล็อตเก่าที่ถูกใช้หมดแล้วไม่ต้องเตือน
  function expiryAlerts(db, today, months) {
    var d = new Date(today + 'T00:00:00');
    var limit = ymd(new Date(d.getFullYear(), d.getMonth() + Number(months || 0), d.getDate()));
    var byItem = {};
    db.movements.forEach(function (m) { if (m.type === 'receive' && m.qty > 0) (byItem[m.item_id] || (byItem[m.item_id] = [])).push(m); });
    var out = [];
    Object.keys(byItem).forEach(function (id) {
      var item = byId(db.items, id);
      if (!item || !item.active) return;
      var left = Math.max(0, item.available_qty);
      byItem[id].sort(function (a, b) { return b.created_at.localeCompare(a.created_at) || b.id - a.id; }).forEach(function (m) {
        var q = Math.min(m.qty, left);
        left -= q;
        if (q > 0 && isDate(m.expiry_date) && m.expiry_date <= limit) {
          out.push({ item_id: item.id, code: item.code, name: item.name, unit: item.unit, qty: q, expiry_date: m.expiry_date,
            days: Math.round((new Date(m.expiry_date + 'T00:00:00') - d) / 864e5), expired: m.expiry_date < today,
            supplier: m.supplier, delivery_no: m.delivery_no, received_at: m.created_at });
        }
      });
    });
    return out.sort(function (a, b) { return a.expiry_date.localeCompare(b.expiry_date) || a.code.localeCompare(b.code); });
  }

  // ---------- ข้อความแจ้งเตือน LINE (ข้อความล้วน ไม่เกิน 5,000 ตัวอักษร) ----------
  function commas(s) { return String(s).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }
  function baht(n) { var p = (Math.round(n * 100) / 100).toFixed(2).split('.'); return commas(p[0]) + '.' + p[1]; }
  function thDay(ymdStr) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymdStr || ''); return m ? Number(m[3]) + '/' + Number(m[2]) + '/' + (Number(m[1]) + 543) : ''; }
  function packNote(item, q) { return item && item.pack_qty > 0 ? ' (' + commas(q * item.pack_qty) + ' ' + (item.pack_unit || 'ชิ้น') + ')' : ''; }
  // ใบเบิกใหม่: เลขที่ ผู้เบิก แผนก รายการ ยอดเงิน และของที่ยอดติดลบ (เบิกของที่หมด)
  function lineRequestText(db, requestId) {
    var r = byId(db.requests, requestId);
    if (!r) return '';
    var dept = find(db.departments, function (d) { return d.name === r.department; });
    var ls = lines(db, r.id);
    var out = ['📦 มีผู้เบิกพัสดุ ' + r.request_no, 'ผู้เบิก: ' + r.borrower_name + ' · ' + (dept && dept.full_name ? dept.full_name + ' (' + r.department + ')' : r.department),
      'เวลา: ' + thaiStamp(r.created_at) + ' น.'];
    ls.slice(0, 15).forEach(function (l) {
      var it = byId(db.items, l.item_id) || { name: '(ลบแล้ว)', unit: '' };
      out.push('• ' + it.name + ' ×' + commas(l.qty) + ' ' + it.unit + packNote(it, l.qty));
    });
    if (ls.length > 15) out.push('และอีก ' + (ls.length - 15) + ' รายการ');
    out.push('รวม ' + ls.length + ' รายการ · ' + baht(requestValue(db, r.id)) + ' บาท');
    var short = ls.map(function (l) { return byId(db.items, l.item_id); }).filter(function (i) { return i && i.available_qty < 0; });
    if (short.length) out.push('⚠️ ของไม่พอ (ยอดติดลบ): ' + short.map(function (i) { return i.name + ' ' + commas(i.available_qty) + ' ' + i.unit; }).join(', '));
    if (r.note) out.push('หมายเหตุ: ' + r.note);
    return out.join('\n');
  }
  // สรุปประจำวัน: ล็อตใกล้หมดอายุ (ภายใน months เดือน) และของใกล้หมดสต็อก · ไม่มีอะไรต้องแจ้ง = ข้อความว่าง (ไม่ส่ง)
  function lineDailyText(db, today, months) {
    var exp = expiryAlerts(db, today, months);
    var urgent = exp.filter(function (x) { return x.days <= 30; });
    var later = exp.filter(function (x) { return x.days > 30; });
    // ไม่นับของที่ไม่ได้ตั้งจุดสั่งซื้อและยอดเป็น 0 (มีเป็นร้อยรายการ)
    var low = lowStock(db);
    if (!exp.length && !low.length) return '';
    var lot = function (x) {
      var when = x.expired ? 'หมดอายุแล้ว' : x.days === 0 ? 'หมดอายุวันนี้' : 'อีก ' + commas(x.days) + ' วัน';
      return '• ' + x.name + ' ~' + commas(x.qty) + ' ' + x.unit + ' · ' + thDay(x.expiry_date) + ' (' + when + ')';
    };
    var out = ['🔔 สรุปพัสดุประจำวันที่ ' + thDay(today)];
    if (urgent.length) {
      out.push('', '⛔ หมดอายุแล้ว / ภายใน 30 วัน: ' + urgent.length + ' ล็อต');
      urgent.slice(0, 10).forEach(function (x) { out.push(lot(x)); });
      if (urgent.length > 10) out.push('และอีก ' + (urgent.length - 10) + ' ล็อต');
    }
    if (later.length) {
      out.push('', '⏳ ใกล้หมดอายุ (ภายใน ' + months + ' เดือน): ' + later.length + ' ล็อต');
      later.slice(0, 5).forEach(function (x) { out.push(lot(x)); });
      if (later.length > 5) out.push('และอีก ' + (later.length - 5) + ' ล็อต');
    }
    if (low.length) {
      out.push('', '📉 ใกล้หมดสต็อก: ' + low.length + ' รายการ');
      low.slice(0, 10).forEach(function (i) {
        out.push('• ' + i.name + ' เหลือ ' + commas(i.available_qty) + ' ' + i.unit + (i.min_qty ? ' (ขั้นต่ำ ' + commas(i.min_qty) + ')' : ''));
      });
      if (low.length > 10) out.push('และอีก ' + (low.length - 10) + ' รายการ');
    }
    out.push('', 'ดูทั้งหมดได้ที่กระดิ่งแจ้งเตือนในเว็บ (โหมดเจ้าหน้าที่)');
    return out.join('\n');
  }
  // ใบเบิกหลายใบรวมเป็นข้อความเดียว (โหมดสรุปทุกชั่วโมง ประหยัดโควตาข้อความ)
  function lineRequestsDigest(db, ids) {
    var rs = ids.map(function (id) { return byId(db.requests, id); }).filter(Boolean);
    if (!rs.length) return '';
    var total = 0;
    var out = ['📦 มีผู้เบิกพัสดุ ' + rs.length + ' ใบ'];
    rs.slice(0, 20).forEach(function (r) {
      var v = requestValue(db, r.id);
      total += v;
      out.push('• ' + r.request_no + ' ' + r.borrower_name + ' (' + r.department + ') ' + lines(db, r.id).length + ' รายการ · ' + baht(v) + ' บาท');
    });
    if (rs.length > 20) out.push('และอีก ' + (rs.length - 20) + ' ใบ');
    out.push('รวม ' + baht(total) + ' บาท');
    return out.join('\n');
  }

  // คำสั่งค้นหาในแชต LINE (ตอบกลับฟรี ไม่นับโควตา) · ไม่ใช่คำสั่ง = null (ไม่ตอบ)
  var LINE_MENU = ['เมนู', 'สรุป', 'ใกล้หมดอายุ', 'ใกล้หมด', 'เบิกวันนี้', 'ยังไม่รับ'];
  function lineCommand(text) {
    text = str(text).replace(/\s+/g, ' ');
    if (/^(เมนู|ช่วย|ช่วยเหลือ|คำสั่ง|help|menu|\?)$/i.test(text)) return { cmd: 'menu' };
    if (/^(สรุป|สรุปวันนี้)$/.test(text)) return { cmd: 'daily' };
    if (/^(ใกล้หมดอายุ|หมดอายุ|วันหมดอายุ)$/.test(text)) return { cmd: 'expiry' };
    if (/^(ใกล้หมด|ใกล้หมดสต็อก|ของใกล้หมด|ของหมด|หมดสต็อก)$/.test(text)) return { cmd: 'low' };
    if (/^(เบิกวันนี้|วันนี้|ใบเบิกวันนี้)$/.test(text)) return { cmd: 'today' };
    if (/^(ยังไม่รับ|ยังไม่เซ็น|ค้างรับ)$/.test(text)) return { cmd: 'pending' };
    var m = /^(เช็ค|เช็ก|เชค|ค้นหา|หา|สต็อก|สต๊อก|ยอด|stock|check)\s*(.*)$/i.exec(text);
    return m ? { cmd: 'search', q: m[2] } : null;
  }
  // ใกล้หมด = ถึงจุดสั่งซื้อที่ตั้งไว้ หรือยอดติดลบ (เบิกของที่หมด)
  function lowStock(db) {
    return db.items.filter(function (i) { return i.active && (i.available_qty < 0 || (i.min_qty > 0 && i.available_qty <= i.min_qty)); })
      .sort(function (a, b) { return a.available_qty - b.available_qty || a.code.localeCompare(b.code); });
  }
  function searchItems(db, q) {
    q = str(q).toLowerCase();
    var words = q.split(' ');
    return db.items.filter(function (i) {
      var hay = (i.code + ' ' + i.name + ' ' + i.category).toLowerCase();
      return i.active && words.every(function (w) { return hay.indexOf(w) >= 0; });
    }).sort(function (a, b) { return (b.code.toLowerCase() === q) - (a.code.toLowerCase() === q) || a.name.length - b.name.length || a.code.localeCompare(b.code); });
  }
  function expiryWhen(x) { return x.expired ? 'หมดอายุแล้ว' : x.days === 0 ? 'หมดอายุวันนี้' : 'อีก ' + commas(x.days) + ' วัน'; }
  function todayRequests(db, today) { return db.requests.filter(function (r) { return r.created_at.slice(0, 10) === today; }); }
  function pendingRequests(db) {
    return db.requests.filter(function (r) { return !r.received_at; }).sort(function (a, b) { return b.created_at.localeCompare(a.created_at); });
  }
  function stockFlag(i) {
    return i.available_qty < 0 ? 'neg' : i.available_qty === 0 ? 'out' : (i.min_qty > 0 && i.available_qty <= i.min_qty) ? 'low' : 'ok';
  }

  function lineMenuText() {
    return ['📋 คำสั่งที่พิมพ์ได้', '• เช็ค <ชื่อหรือรหัส> — ดูยอดคงเหลือ เช่น "เช็ค ถุงมือ"', '• สรุป — ใกล้หมดอายุ + ใกล้หมดสต็อก',
      '• ใกล้หมดอายุ — ล็อตที่หมดอายุภายในช่วงที่ตั้งไว้', '• ใกล้หมด — ของที่ถึงจุดสั่งซื้อหรือยอดติดลบ', '• เบิกวันนี้ — ใบเบิกของวันนี้',
      '• ยังไม่รับ — ใบเบิกที่ยังไม่ติ๊กรับของ/เซ็น', '• สถานะ — การตั้งค่าแจ้งเตือน', '• ยกเลิกแจ้งเตือน — หยุดรับที่แชตนี้', '', 'หรือกดปุ่มด้านล่างได้เลย'].join('\n');
  }
  function lineQueryText(db, text, today, months) {
    var c = lineCommand(text);
    if (!c) return '';
    var more = function (out, n, shown, unit) { if (n > shown) out.push('และอีก ' + commas(n - shown) + ' ' + unit + ' (ดูทั้งหมดในเว็บ)'); };
    if (c.cmd === 'menu') return lineMenuText();
    if (c.cmd === 'daily') return lineDailyText(db, today, months) || '✅ ไม่มีของใกล้หมดอายุหรือใกล้หมดสต็อก';
    if (c.cmd === 'expiry') {
      var exp = expiryAlerts(db, today, months);
      if (!exp.length) return '✅ ไม่มีล็อตที่จะหมดอายุภายใน ' + months + ' เดือน';
      var o1 = ['⏳ ล็อตหมดอายุ/ใกล้หมดอายุ (ภายใน ' + months + ' เดือน): ' + exp.length + ' ล็อต'];
      exp.slice(0, 30).forEach(function (x) {
        o1.push((x.days <= 30 ? '⛔ ' : '• ') + x.name + ' ~' + commas(x.qty) + ' ' + x.unit + ' · ' + thDay(x.expiry_date) + ' (' + expiryWhen(x) + ')');
      });
      more(o1, exp.length, 30, 'ล็อต');
      return o1.join('\n');
    }
    if (c.cmd === 'low') {
      var low = lowStock(db);
      if (!low.length) return '✅ ไม่มีของที่ถึงจุดสั่งซื้อ (เฉพาะรายการที่ตั้งขั้นต่ำไว้)';
      var o2 = ['📉 ใกล้หมดสต็อก: ' + low.length + ' รายการ'];
      low.slice(0, 30).forEach(function (i) {
        o2.push('• ' + i.name + ' เหลือ ' + commas(i.available_qty) + ' ' + i.unit + (i.min_qty ? ' (ขั้นต่ำ ' + commas(i.min_qty) + ')' : ''));
      });
      more(o2, low.length, 30, 'รายการ');
      return o2.join('\n');
    }
    if (c.cmd === 'today') {
      var rs = todayRequests(db, today);
      if (!rs.length) return 'วันนี้ (' + thDay(today) + ') ยังไม่มีผู้เบิก';
      return lineRequestsDigest(db, rs.map(function (r) { return r.id; })).replace(/^📦 มีผู้เบิกพัสดุ/, '📦 วันนี้ ' + thDay(today) + ' เบิกแล้ว') +
        '\n✓ รับของ/เซ็นแล้ว ' + rs.filter(function (r) { return r.received_at; }).length + ' ใบ';
    }
    if (c.cmd === 'pending') {
      var wait = pendingRequests(db);
      if (!wait.length) return '✅ ทุกใบเบิกติ๊กรับของ/เซ็นแล้ว';
      var o3 = ['📝 ยังไม่ติ๊กรับของ/เซ็น: ' + wait.length + ' ใบ (ล่าสุดก่อน)'];
      wait.slice(0, 20).forEach(function (r) { o3.push('• ' + r.request_no + ' ' + r.borrower_name + ' (' + r.department + ') · ' + thaiStamp(r.created_at).slice(0, -3) + ' น.'); });
      more(o3, wait.length, 20, 'ใบ');
      return o3.join('\n');
    }
    if (!c.q) return 'พิมพ์ชื่อหรือรหัสพัสดุต่อท้าย เช่น "เช็ค ถุงมือ" หรือ "เช็ค MD-005"';
    var hit = searchItems(db, c.q);
    if (!hit.length) return 'ไม่พบพัสดุ "' + c.q + '" ลองพิมพ์คำสั้นลง เช่น ชื่อบางส่วน หรือรหัสพัสดุ';
    var exps = expiryAlerts(db, today, months);
    var o4 = ['🔎 ผลค้นหา "' + c.q + '": ' + hit.length + ' รายการ'];
    hit.slice(0, 10).forEach(function (i) {
      var flag = { neg: '⚠️ ติดลบ ', out: '⛔ หมด ', low: '📉 ใกล้หมด ', ok: '' }[stockFlag(i)];
      o4.push('', '• ' + i.name + ' [' + i.code + ']', '  คงเหลือ ' + flag + commas(i.available_qty) + ' ' + i.unit + packNote(i, i.available_qty) +
        (i.min_qty ? ' · ขั้นต่ำ ' + commas(i.min_qty) : '') + (i.location ? ' · ที่เก็บ ' + i.location : ''));
      var e = exps.filter(function (x) { return x.item_id === i.id; })[0];
      if (e) o4.push('  ⏳ ล็อตใกล้หมดอายุ ' + thDay(e.expiry_date) + (e.expired ? ' (หมดอายุแล้ว)' : ' (อีก ' + commas(e.days) + ' วัน)'));
    });
    more(o4, hit.length, 10, 'รายการ — พิมพ์คำให้ละเอียดขึ้น');
    return o4.join('\n');
  }

  // ---------- ข้อความแบบการ์ด (LINE Flex Message) อ่านง่ายกว่าข้อความล้วน ----------
  // คืน { type: 'flex', altText, contents } · altText = ข้อความที่เห็นในการแจ้งเตือนบนมือถือ (ไม่เกิน 400 ตัวอักษร)
  var FX = { blue: '#0071e3', teal: '#0f766e', red: '#d92d20', amber: '#b54708', orange: '#c4320a', green: '#067647', gray: '#667085', ink: '#1d2939', line: '#eaecf0' };
  function fxExt(x, o) { for (var k in o || {}) if (o[k] !== undefined) x[k] = o[k]; return x; }
  function fxText(t, o) { return fxExt({ type: 'text', text: str(t) || '-', wrap: true, size: 'sm', color: FX.ink }, o); }
  function fxBox(layout, contents, o) { return fxExt({ type: 'box', layout: layout, contents: contents }, o); }
  function fxSep(margin) { return { type: 'separator', margin: margin || 'md', color: FX.line }; }
  // แถว: ชื่อ (ตัวหนา) + บรรทัดรอง (สีเทา) ด้านซ้าย · ค่าเด่นชิดขวา
  function fxRow(left, sub, right, color) {
    var l = [fxText(left, { weight: 'bold' })];
    if (sub) l.push(fxText(sub, { size: 'xs', color: FX.gray }));
    return fxBox('horizontal', [fxBox('vertical', l, { flex: 7 }),
      fxText(right, { flex: 4, align: 'end', gravity: 'center', weight: 'bold', color: color || FX.ink })], { spacing: 'md', margin: 'md' });
  }
  function fxKV(k, v, color) {
    return fxBox('horizontal', [fxText(k, { flex: 3, color: FX.gray }), fxText(v, { flex: 7, color: color || FX.ink })], { spacing: 'md' });
  }
  function fxHead(t, color) { return fxText(t, { weight: 'bold', color: color, margin: 'xl' }); }
  function fxMore(n, shown, unit) { return n > shown ? [fxText('และอีก ' + commas(n - shown) + ' ' + unit + ' (ดูทั้งหมดในเว็บ)', { size: 'xs', color: FX.gray, margin: 'md' })] : []; }
  function fxStat(n, label, color) {
    return fxBox('vertical', [fxText(commas(n), { size: 'xl', weight: 'bold', color: color, align: 'center' }), fxText(label, { size: 'xxs', color: FX.gray, align: 'center' })],
      { flex: 1, backgroundColor: color + '14', cornerRadius: 'md', paddingAll: '8px' });
  }
  function fxBubble(title, sub, color, body, foot, size) {
    var head = [fxText(title, { color: '#ffffff', weight: 'bold', size: 'md' })];
    if (sub) head.push(fxText(sub, { color: '#ffffffd9', size: 'xs' }));
    var b = { type: 'bubble', size: size || 'mega', header: fxBox('vertical', head, { backgroundColor: color, paddingAll: '16px', spacing: 'xs' }),
      body: fxBox('vertical', body, { paddingAll: '16px' }) };
    if (foot) b.footer = fxBox('vertical', [fxText(foot, { size: 'xxs', color: FX.gray, align: 'center' })], { paddingAll: '10px' });
    return b;
  }
  function fxMsg(alt, contents) { return { type: 'flex', altText: str(alt).slice(0, 400) || 'แจ้งเตือนพัสดุ', contents: contents }; }

  function fxLot(x) {
    return fxRow(x.name, '~' + commas(x.qty) + ' ' + x.unit + ' · หมดอายุ ' + thDay(x.expiry_date), expiryWhen(x), x.days <= 30 ? FX.red : FX.amber);
  }
  function fxLow(i) {
    return fxRow(i.name, i.code + (i.min_qty ? ' · ขั้นต่ำ ' + commas(i.min_qty) : ''), 'เหลือ ' + commas(i.available_qty) + ' ' + i.unit, i.available_qty <= 0 ? FX.red : FX.amber);
  }
  // การ์ดแจ้งเตือนของใกล้หมดอายุ/ใกล้หมดสต็อก · lim = จำนวนแถวสูงสุดของแต่ละหมวด
  function fxAlerts(db, today, months, title, lim, opt) {
    var exp = opt.exp ? expiryAlerts(db, today, months) : [];
    var urgent = exp.filter(function (x) { return x.days <= 30; });
    var later = exp.filter(function (x) { return x.days > 30; });
    var low = opt.low ? lowStock(db) : [];
    if (!exp.length && !low.length) return null;
    var stats = [];
    if (opt.exp) stats.push(fxStat(urgent.length, 'หมดอายุ ≤30 วัน', FX.red), fxStat(later.length, 'ใกล้หมดอายุ', FX.amber));
    if (opt.low) stats.push(fxStat(low.length, 'ใกล้หมดสต็อก', FX.orange));
    var body = [fxBox('horizontal', stats, { spacing: 'sm' })];
    if (urgent.length) body = body.concat([fxHead('⛔ หมดอายุแล้ว / ภายใน 30 วัน', FX.red)], urgent.slice(0, lim[0]).map(fxLot), fxMore(urgent.length, lim[0], 'ล็อต'));
    if (later.length) body = body.concat([fxHead('⏳ ใกล้หมดอายุ (ภายใน ' + months + ' เดือน)', FX.amber)], later.slice(0, lim[1]).map(fxLot), fxMore(later.length, lim[1], 'ล็อต'));
    if (low.length) body = body.concat([fxHead('📉 ใกล้หมดสต็อก', FX.orange)], low.slice(0, lim[2]).map(fxLow), fxMore(low.length, lim[2], 'รายการ'));
    return fxBubble(title, 'ประจำวันที่ ' + thDay(today), urgent.length ? FX.red : FX.amber, body, 'ดูทั้งหมดได้ที่กระดิ่งแจ้งเตือนในเว็บ (โหมดเจ้าหน้าที่)');
  }
  function fxRequests(db, rs, title, sub, color, withStats) {
    var total = 0;
    var rows = rs.slice(0, 20).map(function (r) {
      var v = requestValue(db, r.id);
      return fxRow(r.request_no + ' ' + r.borrower_name, r.department + ' · ' + lines(db, r.id).length + ' รายการ' + (r.received_at ? ' · ✓ รับแล้ว' : ''),
        baht(v) + ' ฿', r.received_at ? FX.green : FX.ink);
    });
    rs.forEach(function (r) { total += requestValue(db, r.id); });
    var body = [];
    if (withStats) {
      var got = rs.filter(function (r) { return r.received_at; }).length;
      body.push(fxBox('horizontal', [fxStat(rs.length, 'ใบเบิก', FX.teal), fxStat(got, 'รับของ/เซ็นแล้ว', FX.green), fxStat(rs.length - got, 'ยังไม่รับ', FX.amber)], { spacing: 'sm', margin: 'none' }));
    }
    body = body.concat(rows, fxMore(rs.length, 20, 'ใบ'), [fxSep('lg'),
      fxBox('horizontal', [fxText('รวมทั้งหมด', { weight: 'bold' }), fxText(baht(total) + ' บาท', { weight: 'bold', align: 'end', color: FX.teal })], { margin: 'md' })]);
    return fxBubble(title, sub, color, body);
  }
  function fxItem(db, i, exps) {
    var f = stockFlag(i);
    var color = { neg: FX.red, out: FX.red, low: FX.amber, ok: FX.green }[f];
    var label = { neg: '⚠️ ยอดติดลบ', out: '⛔ หมด', low: '📉 ใกล้หมด', ok: '✅ พร้อมเบิก' }[f];
    var body = [fxText('คงเหลือ', { size: 'xs', color: FX.gray }),
      fxText(commas(i.available_qty) + ' ' + i.unit, { size: 'xxl', weight: 'bold', color: color }),
      fxText(label + (i.pack_qty > 0 ? ' · ' + packNote(i, i.available_qty).replace(/^ \(|\)$/g, '') : ''), { size: 'xs', color: color }),
      fxSep('lg'), fxBox('vertical', [fxKV('ขั้นต่ำ', i.min_qty ? commas(i.min_qty) + ' ' + i.unit : 'ไม่ได้ตั้ง'), fxKV('ที่เก็บ', i.location || '-'), fxKV('หมวด', i.category || '-')],
        { spacing: 'sm', margin: 'lg' })];
    var e = exps.filter(function (x) { return x.item_id === i.id; })[0];
    if (e) body.push(fxBox('vertical', [fxKV('หมดอายุ', thDay(e.expiry_date) + ' (' + expiryWhen(e) + ')', e.days <= 30 ? FX.red : FX.amber)], { margin: 'sm' }));
    return fxBubble(i.name, i.code, color, body, null, 'kilo');
  }
  function fxMenu() {
    var btn = function (t, i) {
      var b = { type: 'button', style: i ? 'secondary' : 'primary', height: 'sm', action: { type: 'message', label: t, text: t } };
      if (!i) b.color = FX.blue;
      return b;
    };
    var body = [fxText('🔎 ค้นหาพัสดุ: พิมพ์ "เช็ค" ตามด้วยชื่อหรือรหัส', { weight: 'bold' }), fxText('เช่น เช็ค ถุงมือ · เช็ค MD-005', { size: 'xs', color: FX.gray }),
      fxBox('vertical', ['สรุป', 'ใกล้หมดอายุ', 'ใกล้หมด', 'เบิกวันนี้', 'ยังไม่รับ', 'สถานะ'].map(btn), { spacing: 'sm', margin: 'lg' })];
    return fxBubble('📋 เมนูค้นหาพัสดุ', 'กดปุ่ม หรือพิมพ์คำสั่งในแชตนี้', FX.blue, body, 'หยุดรับแจ้งเตือน: พิมพ์ "ยกเลิกแจ้งเตือน"');
  }
  // ผลคำสั่งค้นหา: { text, flex } · ไม่ใช่คำสั่ง = null · flex = null เมื่อตอบเป็นข้อความสั้นก็พอ (เช่น ไม่พบ)
  function lineQuery(db, text, today, months) {
    var t = lineQueryText(db, text, today, months);
    if (!t) return null;
    var c = lineCommand(text);
    var x = null;
    if (c.cmd === 'menu') x = fxMenu();
    else if (c.cmd === 'daily') x = fxAlerts(db, today, months, '🔔 สรุปพัสดุ', [10, 5, 10], { exp: true, low: true });
    else if (c.cmd === 'expiry') x = fxAlerts(db, today, months, '⏳ ล็อตหมดอายุ/ใกล้หมดอายุ', [15, 15, 0], { exp: true });
    else if (c.cmd === 'low') x = fxAlerts(db, today, months, '📉 ใกล้หมดสต็อก', [0, 0, 30], { low: true });
    else if (c.cmd === 'today') {
      var rs = todayRequests(db, today);
      if (rs.length) x = fxRequests(db, rs, '📦 ใบเบิกวันนี้', thDay(today), FX.teal, true);
    } else if (c.cmd === 'pending') {
      var wait = pendingRequests(db);
      if (wait.length) {
        x = fxBubble('📝 ยังไม่ติ๊กรับของ/เซ็น', wait.length + ' ใบ (ล่าสุดก่อน)', FX.amber,
          wait.slice(0, 20).map(function (r) { return fxRow(r.request_no + ' ' + r.borrower_name, r.department, thaiStamp(r.created_at).slice(0, -3) + ' น.', FX.gray); })
            .concat(fxMore(wait.length, 20, 'ใบ')));
      }
    } else if (c.q) {
      var hit = searchItems(db, c.q);
      if (hit.length) {
        var exps = expiryAlerts(db, today, months);
        var cards = hit.slice(0, 10).map(function (i) { return fxItem(db, i, exps); });
        if (hit.length > 10) cards.push(fxBubble('และอีก ' + commas(hit.length - 10) + ' รายการ', null, FX.gray, [fxText('พิมพ์คำค้นให้ละเอียดขึ้น เช่น ใส่ขนาดหรือรหัสพัสดุ')], null, 'kilo'));
        x = cards.length === 1 ? cards[0] : { type: 'carousel', contents: cards };
      }
    }
    return { text: t, flex: x ? fxMsg(t, x) : null };
  }
  // การ์ดแจ้งเตือน (push): ใบเบิกใหม่ · สรุปหลายใบ · สรุปประจำวัน — ไม่มีข้อมูล = null
  function lineRequestFlex(db, requestId) {
    var r = byId(db.requests, requestId);
    if (!r) return null;
    var dept = find(db.departments, function (d) { return d.name === r.department; });
    var ls = lines(db, r.id);
    var body = [fxBox('vertical', [fxKV('ผู้เบิก', r.borrower_name), fxKV('แผนก', dept && dept.full_name ? dept.full_name + ' (' + r.department + ')' : r.department),
      fxKV('เวลา', thaiStamp(r.created_at) + ' น.')], { spacing: 'sm' }), fxHead('รายการ (' + ls.length + ')', FX.teal)];
    ls.slice(0, 15).forEach(function (l) {
      var it = byId(db.items, l.item_id) || { name: '(ลบแล้ว)', unit: '' };
      body.push(fxRow(it.name, packNote(it, l.qty).replace(/^ \(|\)$/g, ''), '×' + commas(l.qty) + ' ' + it.unit));
    });
    body = body.concat(fxMore(ls.length, 15, 'รายการ'), [fxSep('lg'),
      fxBox('horizontal', [fxText('รวม', { weight: 'bold' }), fxText(baht(requestValue(db, r.id)) + ' บาท', { weight: 'bold', align: 'end', color: FX.teal })], { margin: 'md' })]);
    var short = ls.map(function (l) { return byId(db.items, l.item_id); }).filter(function (i) { return i && i.available_qty < 0; });
    if (short.length) {
      body.push(fxBox('vertical', [fxText('⚠️ ของไม่พอ (ยอดติดลบ)', { weight: 'bold', color: FX.red })].concat(short.map(function (i) {
        return fxText(i.name + ' ' + commas(i.available_qty) + ' ' + i.unit, { size: 'xs', color: FX.red });
      })), { backgroundColor: FX.red + '14', cornerRadius: 'md', paddingAll: '10px', margin: 'lg' }));
    }
    if (r.note) body.push(fxBox('vertical', [fxKV('หมายเหตุ', r.note)], { margin: 'lg' }));
    return fxMsg(lineRequestText(db, requestId), fxBubble('📦 มีผู้เบิกพัสดุ', r.request_no, FX.teal, body));
  }
  function lineDigestFlex(db, ids) {
    var rs = ids.map(function (id) { return byId(db.requests, id); }).filter(Boolean);
    return rs.length ? fxMsg(lineRequestsDigest(db, ids), fxRequests(db, rs, '📦 มีผู้เบิกพัสดุ ' + rs.length + ' ใบ', 'สรุปรวมรอบล่าสุด', FX.teal)) : null;
  }
  function lineDailyFlex(db, today, months) {
    var x = fxAlerts(db, today, months, '🔔 สรุปพัสดุประจำวัน', [10, 5, 10], { exp: true, low: true });
    return x ? fxMsg(lineDailyText(db, today, months), x) : null;
  }

  // ข้อมูลบริษัทผู้จำหน่าย: การส่งของ (รับเข้าที่ระบุบริษัท ไม่นับยอดยกมา) มูลค่ารวม มูลค่าในปี year พัสดุที่ส่ง และประวัติแยกตามใบส่งของ
  function supplierSummary(db, year) {
    year = str(year);
    var round = function (x) { return Math.round(x * 100) / 100; };
    var out = {};
    var get = function (name) {
      if (!out[name]) {
        var s = find(db.suppliers, function (x) { return x.name === name; });
        out[name] = { name: name, contact: s ? s.contact : '', phone: s ? s.phone : '', email: s ? s.email : '', note: s ? s.note : '', listed: !!s,
          receipts: 0, qty: 0, value: 0, year_value: 0, last_date: '', items: {}, docs: {} };
      }
      return out[name];
    };
    db.suppliers.forEach(function (s) { get(s.name); });
    db.movements.forEach(function (m) {
      if (!isReceipt(m) || !str(m.supplier)) return;
      var s = get(m.supplier);
      var item = byId(db.items, m.item_id) || { code: '', name: '(ลบแล้ว)', unit: '' };
      var price = movePrice(db, m);
      var v = round(m.qty * price);
      s.receipts++; s.qty += m.qty; s.value = round(s.value + v);
      if (year && m.created_at.slice(0, 4) === year) s.year_value = round(s.year_value + v);
      if (m.created_at > s.last_date) s.last_date = m.created_at;
      var it = s.items[m.item_id] || (s.items[m.item_id] = { item_id: m.item_id, code: item.code, name: item.name, unit: item.unit, qty: 0, value: 0, times: 0, last_price: 0, last_date: '' });
      it.qty += m.qty; it.value = round(it.value + v); it.times++;
      if (m.created_at >= it.last_date) { it.last_date = m.created_at; it.last_price = price; }
      // ใบส่งของ 1 ใบ = 1 ครั้งที่ส่งของ (ไม่มีเลขใบส่งของ: นับตามวันที่)
      var key = str(m.delivery_no) || m.created_at.slice(0, 10);
      var d = s.docs[key] || (s.docs[key] = { delivery_no: str(m.delivery_no), date: m.created_at, lines: [], qty: 0, value: 0 });
      if (m.created_at < d.date) d.date = m.created_at;
      d.lines.push({ id: m.id, item_id: item.id, code: item.code, name: item.name, unit: item.unit, qty: m.qty, price: price, value: v, expiry_date: m.expiry_date, date: m.created_at });
      d.qty += m.qty; d.value = round(d.value + v);
    });
    return Object.keys(out).map(function (k) {
      var s = out[k];
      s.items = Object.keys(s.items).map(function (i) { return s.items[i]; }).sort(function (a, b) { return b.value - a.value || b.qty - a.qty; });
      s.docs = Object.keys(s.docs).map(function (i) { return s.docs[i]; }).sort(function (a, b) { return b.date.localeCompare(a.date); });
      s.deliveries = s.docs.length;
      return s;
    }).sort(function (a, b) { return b.value - a.value || a.name.localeCompare(b.name); });
  }

  // รายงานบัญชีวัสดุประจำปี (แบบฟอร์มตรวจสอบพัสดุ) ช่วง start..end ('YYYY-MM-DD' เช่น ปีงบประมาณ 1 ต.ค. – 30 ก.ย.)
  // ยกมา = ยอด ณ ต้นงวด · จ่าย (ใช้ไป) = ใบเบิกในงวด · คงเหลือ = ยอด ณ สิ้นงวด · รับ = คงเหลือ + จ่าย − ยกมา (ตามสูตรในแบบฟอร์ม)
  // ยอดยกมาเริ่มต้นตอนตั้งระบบนับเป็นยอดยกมา · มูลค่าทุกช่อง = จำนวน × ราคาต่อหน่วยปัจจุบัน
  function ledgerSummary(db, start, end) {
    var round = function (x) { return Math.round(x * 100) / 100; };
    var rows = {};
    db.items.forEach(function (i) {
      rows[i.id] = { item_id: i.id, code: i.code, name: i.name, unit: i.unit, price: i.price || 0, active: i.active,
        open_qty: i.available_qty, close_qty: i.available_qty, out_qty: 0, moved: false };
    });
    db.movements.forEach(function (m) {
      var r = rows[m.item_id];
      if (!r) return;
      var d = m.created_at.slice(0, 10);
      // ยอดตั้งต้นของระบบ และการปรับตามรายงานบัญชีวัสดุ (แก้ยอดยกมา) นับเป็นยอดยกมา ไม่ใช่ยอดรับ
      if ((m.type === 'receive' && m.note === OPENING) || /^ปรับตามรายงานบัญชีวัสดุ/.test(m.note)) return;
      if (d >= start) r.open_qty -= m.qty;
      if (d > end) r.close_qty -= m.qty;
      if (d >= start && d <= end) r.moved = true;
    });
    db.requests.forEach(function (rq) {
      var d = rq.created_at.slice(0, 10);
      if (d < start || d > end) return;
      lines(db, rq.id).forEach(function (l) { if (rows[l.item_id]) rows[l.item_id].out_qty += l.qty; });
    });
    var t = { open_value: 0, in_value: 0, out_value: 0, close_value: 0 };
    var list = Object.keys(rows).map(function (k) { return rows[k]; })
      .filter(function (r) { return r.active || r.moved || r.open_qty || r.close_qty; })
      .sort(function (a, b) { return a.code.localeCompare(b.code); });
    list.forEach(function (r) {
      r.in_qty = r.close_qty + r.out_qty - r.open_qty;
      ['open', 'in', 'out', 'close'].forEach(function (k) {
        r[k + '_value'] = round(r[k + '_qty'] * r.price);
        t[k + '_value'] = round(t[k + '_value'] + r[k + '_value']);
      });
      delete r.moved;
    });
    return { start: start, end: end, items: list, totals: t };
  }

  // ปรับราคา/ยอดตามรายงานบัญชีวัสดุ (เช่น REPORT_2569) และเพิ่มรายชื่อบริษัท — รันซ้ำได้ (รายการที่ตรงแล้วไม่เปลี่ยน)
  // data.items = [[รหัสในระบบ, รหัสในรายงาน, ชื่อ, ราคาต่อหน่วย, 1 = ปรับจำนวนเป็น 0]] · ชื่อในระบบต้องคล้ายชื่อในข้อมูล (กันจับผิดรายการ)
  function supplierKey(s) {
    return str(s).toLowerCase().replace(/บริษัท|จำกัด|\(มหาชน\)|มหาชน|หจก\.?|co\.?,?\s*ltd\.?|ltd\.?|[\s.,()\-\/]/g, '');
  }
  function similar(a, b) {
    var grams = function (s) { s = s.toLowerCase().replace(/\*\*|\([^)]*\)|[\s.,\-_/"'*]/g, ''); var g = {}; for (var i = 0; i < s.length - 1; i++) g[s.substr(i, 2)] = (g[s.substr(i, 2)] || 0) + 1; return g; };
    var A = grams(a), B = grams(b), na = 0, nb = 0, both = 0;
    Object.keys(A).forEach(function (k) { na += A[k]; if (B[k]) both += Math.min(A[k], B[k]); });
    Object.keys(B).forEach(function (k) { nb += B[k]; });
    return na + nb ? (2 * both) / (na + nb) : 1;
  }
  function applyReport(db, data, opts) {
    opts = opts || {};
    var ctx = { now: opts.now || new Date() };
    var res = { priced: [], zeroed: [], suppliers: [], missing: [], mismatch: [], same: 0 };
    data.items.forEach(function (x) {
      var item = find(db.items, function (i) { return i.code === x[0]; });
      if (!item) { res.missing.push({ code: x[0], report: x[1], name: x[2] }); return; }
      if (similar(item.name, x[2]) < 0.5) { res.mismatch.push({ code: x[0], report: x[1], name: item.name, expected: x[2] }); return; }
      var price = money(x[3]);
      var changed = false;
      if ((item.price || 0) !== price) { res.priced.push({ code: item.code, name: item.name, from: item.price || 0, to: price }); item.price = price; changed = true; }
      if (x[4] && item.available_qty !== 0) {
        res.zeroed.push({ code: item.code, name: item.name, from: item.available_qty });
        moveStock(db, ctx, { item_id: item.id, type: 'adjust', delta: -item.available_qty, allowNegative: true, note: data.note });
        changed = true;
      }
      if (!changed) res.same++;
    });
    var keys = {};
    db.suppliers.forEach(function (s) { keys[supplierKey(s.name)] = true; });
    (data.suppliers || []).forEach(function (n) {
      var k = supplierKey(n);
      if (!k || keys[k]) return;
      keys[k] = true;
      db.suppliers.push({ name: str(n), contact: '', phone: '', email: '', note: '' });
      res.suppliers.push(str(n));
    });
    return res;
  }

  // สร้างฐานข้อมูลตั้งต้นจาก SEED_DATA (ไฟล์ seed-data.js / SeedData.gs)
  function seed(now, data) {
    if (!data) data = typeof SEED_DATA !== 'undefined' ? SEED_DATA : { departments: [], categories: [], items: [] };
    var db = emptyDb();
    data.departments.forEach(function (d) { db.departments.push({ name: d[0], full_name: d[1] || '' }); });
    data.categories.forEach(function (n) { db.categories.push({ name: n }); });
    addNames(db, 'units', DEFAULT_UNITS);
    var ctx = { now: now || new Date(), isAdmin: true };
    data.items.forEach(function (x) {
      run(db, 'saveItem', { code: x[0], name: x[1], category: x[2], unit: x[3], initial_qty: x[4], min_qty: x[5], location: x[6], note: OPENING }, ctx);
    });
    return db;
  }

  // เริ่มใช้งานจริง: ล้างใบเบิกและประวัติสต็อกทั้งหมด ตั้งยอดทุกรายการเป็น 0
  // เก็บรายชื่อพัสดุ (ชื่อ รหัส หน่วย หมวดหมู่ ที่เก็บ จุดเตือน) รายชื่อแผนก และหมวดหมู่ไว้เหมือนเดิม
  function resetForLaunch(db) {
    var cleared = { requests: db.requests.length, movements: db.movements.length };
    db.requests = [];
    db.request_items = [];
    db.movements = [];
    db.items.forEach(function (i) { i.available_qty = 0; });
    return cleared;
  }

  // แทนที่รายการพัสดุทั้งหมดด้วยไฟล์ Stock ใหม่ (SEED_DATA): ล้างใบเบิกและประวัติสต็อก
  // พัสดุและยอดคงเหลือเป็นไปตามไฟล์ (บันทึกเป็น "รับเข้า ยอดยกมาเริ่มต้น") เก็บรายชื่อแผนกเดิมไว้
  function replaceStock(db, data, now) {
    var fresh = seed(now, { departments: [], categories: [], items: data.items });
    var before = { items: db.items.length, requests: db.requests.length };
    db.items = fresh.items;
    db.movements = fresh.movements;
    db.requests = [];
    db.request_items = [];
    addNames(db, 'units', fresh.units.map(function (u) { return u.name; }));
    addNames(db, 'locations', fresh.locations.map(function (u) { return u.name; }));
    (data.categories || []).forEach(function (n) {
      if (!find(db.categories, function (c) { return c.name === n; })) db.categories.push({ name: n });
    });
    return before;
  }

  return { lineQuery: lineQuery, lineRequestFlex: lineRequestFlex, lineDigestFlex: lineDigestFlex, lineDailyFlex: lineDailyFlex, lineQueryText: lineQueryText, LINE_MENU: LINE_MENU, lineRequestText: lineRequestText, lineDailyText: lineDailyText, lineRequestsDigest: lineRequestsDigest, guessPack: guessPack, budgetSummary: budgetSummary, fiscalYear: fiscalYear, fiscalRange: fiscalRange, ledgerSummary: ledgerSummary, applyReport: applyReport, supplierSummary: supplierSummary, expiryAlerts: expiryAlerts, byId: byId, lines: lines, flowSummary: flowSummary, movePrice: movePrice, OPENING: OPENING, stockSummary: stockSummary, linePrice: linePrice, requestValue: requestValue, nextItemCode: nextItemCode, replaceStock: replaceStock, resetForLaunch: resetForLaunch, TABLES: TABLES, STATUS: STATUS, MOVE: MOVE, publicView: publicView, monthlySummary: monthlySummary, sheetData: sheetData, thaiStamp: thaiStamp, run: run, seed: seed, normalize: normalize, fieldOf: fieldOf, emptyDb: emptyDb, ymd: ymd };
})();

if (typeof module !== 'undefined') module.exports = BorrowCore;

// ==================== SeedData (รายการพัสดุและแผนกตั้งต้น) — จาก docs/seed-data.js ====================

/*
 * ข้อมูลตั้งต้นของระบบ (ใช้ตอนรัน setup() ใน Apps Script และในโหมดทดลอง)
 * - departments: [ชื่อย่อแผนก, ชื่อเต็ม]
 * - items: [รหัส, ชื่อพัสดุ, หมวดหมู่, หน่วย, คงเหลือ, จุดสั่งซื้อขั้นต่ำ, สถานที่เก็บ, ประเภท]
 *   ชื่อพัสดุและคงเหลือ = ไฟล์ Stock ที่ส่งมาเมื่อ 21 ตุลาคม 2569 (301 รายการ เรียงตามไฟล์ รหัส NSO-001 ถึง NSO-301)
 *   รายการที่มีอยู่เดิมใช้หน่วย/จุดเตือนเดิม รายการใหม่เดาหน่วยจากชื่อ (ไม่พบ = ชิ้น)
 *   จุดสั่งซื้อขั้นต่ำ = ปริมาณจ่าย 6 เดือน ÷ 6 (ปัดขึ้น) คือเตือนเมื่อเหลือไม่พอใช้ราว 1 เดือน
 *   ประเภท: withdraw = เบิกได้อย่างเดียว, borrow = ยืมได้อย่างเดียว, both = เบิกและยืมได้
 * ใน Apps Script ให้คัดลอกไฟล์นี้ไปเป็นไฟล์ชื่อ SeedData
 */
var SEED_DATA = {
  source: 'ไฟล์ Stock 21 ตุลาคม 2569',
  categories: ['เวชภัณฑ์มิใช่ยา'],
  departments: [
    ["ICU", "งานการพยาบาลผู้ป่วยหนัก"],
    ["ER", "งานการพยาบาลอุบัติเหตุฉุกเฉินและนิติเวช"],
    ["OR", "งานการพยาบาลผู้ป่วยผ่าตัดและวิสัญญี(วิสัญญี)"],
    ["Anaes", "งานการพยาบาลผู้ป่วยผ่าตัดและวิสัญญี"],
    ["LR", "งานการพยาบาลผู้คลอด"],
    ["IPD5", "งานการพยาบาลผู้ป่วยในชั้น5"],
    ["IPD6", "งานการพยาบาลผู้ป่วยในชั้น6"],
    ["OPD1", "งานการพยาบาลผู้ป่วยนอก1"],
    ["OPD2", "งานการพยาบาลผู้ป่วยนอก2"],
    ["Lab", "กลุ่มงานชันสูตร"],
    ["X-ray", "X-ray"],
    ["CSSD", "หน่วยควบคุมติดเชื้อและงานจ่ายกลาง"],
    ["PHAR", "งานเภสัชกรรม"],
    ["Dent1", "งานทันตกรรม1"],
    ["Dent2", "งานทันตกรรม2"],
    ["เวชปฏิบัติ1", "กลุ่มงานปฐมภูมิและองค์รวม1"],
    ["เวชปฏิบัติ2", "กลุ่มงานปฐมภูมิและองค์รวม2"],
    ["แพทย์ทางเลือก1", "กลุ่มงานการแพทย์แผนไทยและการแพทย์ทางเลือก1"],
    ["แพทย์ทางเลือก2", "กลุ่มงานการแพทย์แผนไทยและการแพทย์ทางเลือก2"],
    ["กายภาพบำบัด1", "กลุ่มงานกายภาพบำบัด1"],
    ["กายภาพบำบัด2", "กลุ่มงานกายภาพบำบัด2"],
    ["จิตเวช", "งานยาเสพติดและจิตเวช"],
  ],
  items: [
    ["NSO-001", "3 -ways", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 50, 425, "คลัง NSO", "both"],
    ["NSO-002", "350 ml water humidifier", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 200, "คลัง NSO", "both"],
    ["NSO-003", "7Fr,2.4mm(OD)Triple Lumen(set C-Line)(ICU,Anaes)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-004", "Airway 100mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 7, "คลัง NSO", "both"],
    ["NSO-005", "Airway 40 mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 19, 0, "คลัง NSO", "both"],
    ["NSO-006", "Airway 50 mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 48, 1, "คลัง NSO", "both"],
    ["NSO-007", "Airway 60 mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 2, "คลัง NSO", "both"],
    ["NSO-008", "Airway 70 mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 53, 1, "คลัง NSO", "both"],
    ["NSO-009", "Airway 80 mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 37, 12, "คลัง NSO", "both"],
    ["NSO-010", "Airway 90 mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 2, 20, "คลัง NSO", "both"],
    ["NSO-011", "Alcohol Hand Rub gel 1000ml(ขวด)", "เวชภัณฑ์มิใช่ยา", "ขวด", 0, 14, "คลัง NSO", "both"],
    ["NSO-012", "Avagard bottle", "เวชภัณฑ์มิใช่ยา", "ขวด", 0, 1, "คลัง NSO", "both"],
    ["NSO-013", "Becterial Fillter(Heppa)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 50, 30, "คลัง NSO", "both"],
    ["NSO-014", "Becterial Fillter(HME)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 25, "คลัง NSO", "both"],
    ["NSO-015", "Becterial Fillter(ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 100, 46, "คลัง NSO", "both"],
    ["NSO-016", "Becterial Fillter Baby(ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 50, 13, "คลัง NSO", "both"],
    ["NSO-017", "Bag Suction Liner (1500 ml)(ER,ICU)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1350, 0, "คลัง NSO", "both"],
    ["NSO-018", "Blade No10 (100ชิ้น/กล่อง)TR", "เวชภัณฑ์มิใช่ยา", "กล่อง", 2, 1, "คลัง NSO", "both"],
    ["NSO-019", "Blade No11 (100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 29, 3, "คลัง NSO", "both"],
    ["NSO-020", "Blade No 12 (100ชิ้น/กล่อง)( ห้องฟัน)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 6, 1, "คลัง NSO", "both"],
    ["NSO-021", "Blade no 15 (100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 17, 1, "คลัง NSO", "both"],
    ["NSO-022", "Blade no 15c (100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 6, 1, "คลัง NSO", "both"],
    ["NSO-023", "Blade no21 (100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 11, 1, "คลัง NSO", "both"],
    ["NSO-024", "Bluribbon gel 15 gm(1 หลอด/กล่อง) (OR)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1, 0, "คลัง NSO", "both"],
    ["NSO-025", "Bluribbon1x20cm. (20 ชิ้น/กล่อง)(OR)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1, 0, "คลัง NSO", "both"],
    ["NSO-026", "Bluribbon3x5cm (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-027", "BP print (ม้วน)", "เวชภัณฑ์มิใช่ยา", "ม้วน", 187, 42, "คลัง NSO", "both"],
    ["NSO-028", "Caps-CHG(ICU)(กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 0, "คลัง NSO", "both"],
    ["NSO-029", "Carrifix 10*10cm(กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 78, 0, "คลัง NSO", "both"],
    ["NSO-030", "Carrifix 5*10cm(กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 86, 0, "คลัง NSO", "both"],
    ["NSO-031", "CathereeplusRollNo.1010(1ม้วน/กล่อง10cm)(OR)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 1, "คลัง NSO", "both"],
    ["NSO-032", "Certrofix trio 720 (สายcentral line)Set", "เวชภัณฑ์มิใช่ยา", "ชุด", 0, 0, "คลัง NSO", "both"],
    ["NSO-033", "Chromic 2/0 C2037T (กล่อง) 1 โหล/กล่อง", "เวชภัณฑ์มิใช่ยา", "กล่อง", 2, 0, "คลัง NSO", "both"],
    ["NSO-034", "Chromic 1 c140G (1โหล/กล่อง", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 2, "คลัง NSO", "both"],
    ["NSO-035", "Chromic 2/0 C2040T-90", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1, 0, "คลัง NSO", "both"],
    ["NSO-036", "Chromic 2/0C2026(1 โหล/1กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 12, 0, "คลัง NSO", "both"],
    ["NSO-037", "Chromic 4/0(C4017)17mm1/2round", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 2, 1, "คลัง NSO", "both"],
    ["NSO-038", "Chromic C3026 (กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 2, 1, "คลัง NSO", "both"],
    ["NSO-039", "Chronos ขนาด2.8*5.6mm (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1, "คลัง NSO", "both"],
    ["NSO-040", "Circruit Simple smooth bone (22mm)(ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1, "คลัง NSO", "both"],
    ["NSO-041", "Close suction (tycare exel cather) 10ชิ้น/กล่อง(ICU)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 70, 17, "คลัง NSO", "both"],
    ["NSO-042", "Clotest (prontro Dry)(OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1, 0, "คลัง NSO", "both"],
    ["NSO-043", "Coban 1\"(5หลา)(30ม้วน/กล่อง)**", "เวชภัณฑ์มิใช่ยา", "กล่อง", 2, 0, "คลัง NSO", "both"],
    ["NSO-044", "Cord Clamp(100ชิ้น/กล่อง)( LR)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 6, 1, "คลัง NSO", "both"],
    ["NSO-045", "Cuff Bp Manaul เด็กโต (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 0, "คลัง NSO", "both"],
    ["NSO-046", "Cuff Manaul ผู้ใหญ่ (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 0, "คลัง NSO", "both"],
    ["NSO-047", "Cuff BP อัตโนมัติเด็กโต (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 2, "คลัง NSO", "both"],
    ["NSO-048", "Cuff BP อัตโนมัติเด็กเล็ก (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 2, 1, "คลัง NSO", "both"],
    ["NSO-049", "Cuff BP อัตโนมัติผู้ใหญ๋ (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 5, "คลัง NSO", "both"],
    ["NSO-050", "Cuff BP อัตโนมัติ ยาวพิเศษ(ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 9, 2, "คลัง NSO", "both"],
    ["NSO-051", "Cutting No 21 โค้ง3/8 (โหล)(ฟัน)", "เวชภัณฑ์มิใช่ยา", "โหล", 0, 0, "คลัง NSO", "both"],
    ["NSO-052", "Cutting No 24 โค้ง3/8 (โหล)**", "เวชภัณฑ์มิใช่ยา", "โหล", 2, 0, "คลัง NSO", "both"],
    ["NSO-053", "Cutting No 28 โค้ง3/8 (โหล)**", "เวชภัณฑ์มิใช่ยา", "โหล", 5, 0, "คลัง NSO", "both"],
    ["NSO-054", "Cutting No 32 โค้ง1/2(โหล)(ICU)", "เวชภัณฑ์มิใช่ยา", "โหล", 0, 1, "คลัง NSO", "both"],
    ["NSO-055", "Dafib Print(zoll)**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 25, 0, "คลัง NSO", "both"],
    ["NSO-056", "Defib Print Thermal 50*20**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 22, 0, "คลัง NSO", "both"],
    ["NSO-057", "Delta cut biopsy(Needle biopsy)(ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 80, 4, "คลัง NSO", "both"],
    ["NSO-058", "DetroFoam(สเปรย์โฟมทำความสะอาดเครื่อง..)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-059", "Disposable Bladeless Crown Trocal 12.5x110", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 0, "คลัง NSO", "both"],
    ["NSO-060", "Disposable Bladeless Crown Trocal 5.5x100", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 6, 0, "คลัง NSO", "both"],
    ["NSO-061", "EKG Print (Mortara 250( OPD,W5,ICU)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 0, "คลัง NSO", "both"],
    ["NSO-062", "EKG Print EDAN( W5)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 2, "คลัง NSO", "both"],
    ["NSO-063", "EKG Print PhillipM1709A**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 0, "คลัง NSO", "both"],
    ["NSO-064", "EKGprint mortoraELI230 (ม้วน)( ER W6)", "เวชภัณฑ์มิใช่ยา", "ม้วน", 10, 7, "คลัง NSO", "both"],
    ["NSO-065", "Eletric clipper (โปรดเฟรสชันแนลเบรด)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1, "คลัง NSO", "both"],
    ["NSO-066", "Ethibond Excel No 2**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 2, 0, "คลัง NSO", "both"],
    ["NSO-067", "ETT No 5 /**NO Cuff (Safety clear)(ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 1, "คลัง NSO", "both"],
    ["NSO-068", "ETT No 7 (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 13, "คลัง NSO", "both"],
    ["NSO-069", "ETT No 8 (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 14, 3, "คลัง NSO", "both"],
    ["NSO-070", "Extension with T(100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 600, 667, "คลัง NSO", "both"],
    ["NSO-071", "Extension 18 นิ้ว (100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 3200, 984, "คลัง NSO", "both"],
    ["NSO-072", "Extension 36 นิ้ว(100ขิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 150, 9, "คลัง NSO", "both"],
    ["NSO-073", "Face shield **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 0, "คลัง NSO", "both"],
    ["NSO-074", "Fiber Wire No 2( OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1, "คลัง NSO", "both"],
    ["NSO-075", "Fiber Wire No 5( OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1, "คลัง NSO", "both"],
    ["NSO-076", "Foley 2 way no 10 balloon 5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 2, "คลัง NSO", "both"],
    ["NSO-077", "Foley 2 way no 14 balloon 10", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 120, 15, "คลัง NSO", "both"],
    ["NSO-078", "Foley 2 way no 16 balloon 10", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 520, 180, "คลัง NSO", "both"],
    ["NSO-079", "Foley 2 way no 18 ballloon 10", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 14, "คลัง NSO", "both"],
    ["NSO-080", "Foley 2 way no 20 balloon 10", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 60, 7, "คลัง NSO", "both"],
    ["NSO-081", "Foley 2 way no 24 balloon 10", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 0, "คลัง NSO", "both"],
    ["NSO-082", "Foley 3 way no 16 balloon 30", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 40, 9, "คลัง NSO", "both"],
    ["NSO-083", "Foley 3 way no 18 ballloon 30", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 6, "คลัง NSO", "both"],
    ["NSO-084", "Foley 3way no 24 balloon 30", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 2, "คลัง NSO", "both"],
    ["NSO-085", "Foley 3หาง No20", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 0, "คลัง NSO", "both"],
    ["NSO-086", "Foley 2 way no 12 balloon 10", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 40, 0, "คลัง NSO", "both"],
    ["NSO-087", "Foley 2 way no 6( NICU)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-088", "Gauze 4x4 แถบ x ray 12 ชั้น C/S (Pack)( CSSD)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 0, 7, "คลัง NSO", "both"],
    ["NSO-089", "Gauze 4x4 แถบ x ray 8 ชั้น 100ชิ้น/Pack( CSSD)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 46, 0, "คลัง NSO", "both"],
    ["NSO-090", "Guide wire L (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 21, 2, "คลัง NSO", "both"],
    ["NSO-091", "Guide wire M (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 19, 4, "คลัง NSO", "both"],
    ["NSO-092", "Guide wire S (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 15, 1, "คลัง NSO", "both"],
    ["NSO-093", "HA Bone Hydroxyapatite 5 cc.(กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 0, "คลัง NSO", "both"],
    ["NSO-094", "Heat Breathing Tube with MR290/Adualt(ชิ้น)( ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 24, 0, "คลัง NSO", "both"],
    ["NSO-095", "Infusion set (20ชิ้น/กล่อง)(W5,W6)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 100, 214, "คลัง NSO", "both"],
    ["NSO-096", "IOBAN 6640 10 pc (กล่อง) (OR)**", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 0, "คลัง NSO", "both"],
    ["NSO-097", "IOBAN 2/0 6650 10 pc (กล่อง) กระดูก (OR)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1, 1, "คลัง NSO", "both"],
    ["NSO-098", "IT26S (steam)class 5กล่อง(-/Pack)(CSSD)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 0, 13, "คลัง NSO", "both"],
    ["NSO-099", "J.S.E.T.Tube No 5 lot 4454680 No.cuff(ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 9, 0, "คลัง NSO", "both"],
    ["NSO-100", "J.S.E.T.Tube No 5 lot 4454682 cuff(ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 40, 0, "คลัง NSO", "both"],
    ["NSO-101", "jackson drain (400ml)silicone( OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 4, "คลัง NSO", "both"],
    ["NSO-102", "JS E.T. tube NO.2.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 2, "คลัง NSO", "both"],
    ["NSO-103", "JS E.T. tube NO.3.0", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 18, 2, "คลัง NSO", "both"],
    ["NSO-104", "JS E.T. tube NO.3.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 13, 6, "คลัง NSO", "both"],
    ["NSO-105", "JS E.T. tube NO.4", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 29, 7, "คลัง NSO", "both"],
    ["NSO-106", "JS E.T. tube NO.4.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 7, 4, "คลัง NSO", "both"],
    ["NSO-107", "JS E.T. tube NO.6", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 63, 5, "คลัง NSO", "both"],
    ["NSO-108", "JS E.T. tube NO.6.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 44, 10, "คลัง NSO", "both"],
    ["NSO-109", "JS E.T. tube NO.7.", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 15, 9, "คลัง NSO", "both"],
    ["NSO-110", "JS E.T. tube NO.7.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 4, 50, "คลัง NSO", "both"],
    ["NSO-111", "JS E.T. tube NO.8", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 280, 4, "คลัง NSO", "both"],
    ["NSO-112", "JS E.T. tube NO.8.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 15, 0, "คลัง NSO", "both"],
    ["NSO-113", "JS Tube No 5.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 40, 1, "คลัง NSO", "both"],
    ["NSO-114", "Manipler (slaple) 6.9x4.2 mm. 6pc/pack(OR)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 7, 1, "คลัง NSO", "both"],
    ["NSO-115", "Monoplus V 1 HR40s (2โหล)**", "เวชภัณฑ์มิใช่ยา", "โหล", 0, 0, "คลัง NSO", "both"],
    ["NSO-116", "Monosyn No4/0 70cm GS60 เข็มตรง (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1, "คลัง NSO", "both"],
    ["NSO-117", "Monosyn U4/0 70cm เข็มโค้ง**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 0, "คลัง NSO", "both"],
    ["NSO-118", "Mucus Extractor ชุดดูดเสมหะ", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 24, "คลัง NSO", "both"],
    ["NSO-119", "Multrpore dry ขนาด 1/2\"", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 13, 2, "คลัง NSO", "both"],
    ["NSO-120", "NeodisherIR 1L.(น้ำยาขจัดสนิม)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-121", "Neodisher Lm2 1L.(น้ำยาล้างพิมพ์ฟัน)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-122", "Neodisher Mediklar 5L.(น้ำยาเคลือบเร่งแห้ง)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-123", "NorplantWI (60x70)(ไทเกอร์ 3ชิ้น/กล่อง)(ปฐมภูมิ)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 0, "คลัง NSO", "both"],
    ["NSO-124", "Novasorb Quick 2/0 37mm 1/2 TC(OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 2, 4, "คลัง NSO", "both"],
    ["NSO-125", "NST print (philllip M1911 A(LR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 13, 4, "คลัง NSO", "both"],
    ["NSO-126", "Nutribag", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1600, 134, "คลัง NSO", "both"],
    ["NSO-127", "Nutribag line", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1500, 134, "คลัง NSO", "both"],
    ["NSO-128", "Nylon 8/0(1โหล/กล่อง)**", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1, 0, "คลัง NSO", "both"],
    ["NSO-129", "Nylon 2/0 DS30 (กล่อง)1x36 (OR,ER)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1, 1, "คลัง NSO", "both"],
    ["NSO-130", "Nylon 3/0 DS24 (กล่อง)1x36(OR,ER)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 11, 2, "คลัง NSO", "both"],
    ["NSO-131", "Nylon 4/0/0 DS19 (กล่อง)1x36(OR,ER)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 3, "คลัง NSO", "both"],
    ["NSO-132", "Nylon 5/0 DS16 (กล่อง)1x36(OR,ER)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 9, 1, "คลัง NSO", "both"],
    ["NSO-133", "Nylon 6/0 DS16 (กล่อง)1x36(OR,ER)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 6, 1, "คลัง NSO", "both"],
    ["NSO-134", "Nylon no 0 (DS39)**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 2, 0, "คลัง NSO", "both"],
    ["NSO-135", "Nylon no 1 HS48**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 0, "คลัง NSO", "both"],
    ["NSO-136", "Optiflow Canular Junior Size S แดง(ชิ้น)(W5,W6)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 0, "คลัง NSO", "both"],
    ["NSO-137", "Optiflow Canular Junior Size L ม่วง (W5,W6)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 23, 4, "คลัง NSO", "both"],
    ["NSO-138", "Optiflow Canular Junior Size XL เขียว(W5,W6)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 35, 2, "คลัง NSO", "both"],
    ["NSO-139", "Optiflow Canular Junior Size เหลือง(W5,W6,LR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 35, 4, "คลัง NSO", "both"],
    ["NSO-140", "Optiflow Canular Medium Size ผู้ใหญ่ (ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 9, "คลัง NSO", "both"],
    ["NSO-141", "Optilene mesh 15x15 cm (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1, 1, "คลัง NSO", "both"],
    ["NSO-142", "Optiline 2/0 HR26(OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-143", "Oxicel Standard5x7.5cm(12ชิ้น/กล่อง) (OR)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 0, "คลัง NSO", "both"],
    ["NSO-144", "Oxygen Cannula Adult (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 92, 143, "คลัง NSO", "both"],
    ["NSO-145", "Oxygen Cannula Child (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 44, 18, "คลัง NSO", "both"],
    ["NSO-146", "Oxygen Mask with Bag adult", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 75, "คลัง NSO", "both"],
    ["NSO-147", "Oxygen Mask with Bag Child", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 25, "คลัง NSO", "both"],
    ["NSO-148", "Oxygen tubing**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-149", "plate จี้ไฟฟ้า (ชิ้น) (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 150, 75, "คลัง NSO", "both"],
    ["NSO-150", "plate จี้ไฟฟ้า (เด็ก)(ชิ้น)(OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-151", "polysorb 0 kv34 (ortho) (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 14, 1, "คลัง NSO", "both"],
    ["NSO-152", "polysorb 1 kv34 (1กล่อง/3โหล) (OR)", "เวชภัณฑ์มิใช่ยา", "โหล", 2, 2, "คลัง NSO", "both"],
    ["NSO-153", "polysorb 1 VIO 150cm. (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-154", "polysorb 2-0 V20(30ชิ้น/กล่อง)(sheet) (OR,Anaes)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 6, 1, "คลัง NSO", "both"],
    ["NSO-155", "polysarb 3/0 SL693 C14 (TR) (ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 6, 1, "คลัง NSO", "both"],
    ["NSO-156", "polysorb 4-0 C13 (1 กล่อง/3โหล) (OR)", "เวชภัณฑ์มิใช่ยา", "โหล", 0, 1, "คลัง NSO", "both"],
    ["NSO-157", "polysorb 6-0 Sl-1625g (1โหล/กล่อง) **", "เวชภัณฑ์มิใช่ยา", "กล่อง", 3, 0, "คลัง NSO", "both"],
    ["NSO-158", "polysorb No 1 GS24 (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-159", "polysorb3--0 CV25(1กล่อง/3โหล) (OR)", "เวชภัณฑ์มิใช่ยา", "โหล", 4, 1, "คลัง NSO", "both"],
    ["NSO-160", "polysorb4-0CVF-23(round)1กล่อง/3โหล **", "เวชภัณฑ์มิใช่ยา", "โหล", 1, 0, "คลัง NSO", "both"],
    ["NSO-161", "Q bac Chlohexidedine Siap Gel 1000ml", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 8, "คลัง NSO", "both"],
    ["NSO-162", "Radivac drain bottle 400ml (OR)", "เวชภัณฑ์มิใช่ยา", "ขวด", 0, 19, "คลัง NSO", "both"],
    ["NSO-163", "Radivac drain bottle 600ml (OR)", "เวชภัณฑ์มิใช่ยา", "ขวด", 4, 0, "คลัง NSO", "both"],
    ["NSO-164", "Red dot 2238 (Pack)(50ชิ้น/pack)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 0, 33, "คลัง NSO", "both"],
    ["NSO-165", "Reddot เด็ก 2248 (50ชิ้น/pack)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 24, 3, "คลัง NSO", "both"],
    ["NSO-166", "Reddot 2268 (เด็กเล็ก 1ห่อ/3ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-167", "Seling Teflon Belt", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-168", "Silicone flat perforated drain size 10-0 สาย (OR)(10ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 0, "คลัง NSO", "both"],
    ["NSO-169", "Silk no 1 **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 0, "คลัง NSO", "both"],
    ["NSO-170", "silk no 2/0", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 7, 1, "คลัง NSO", "both"],
    ["NSO-171", "silk no 2/0 hr26 (กล่อง) ติดเข็ม", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 1, "คลัง NSO", "both"],
    ["NSO-172", "silk no3/0 (กล่อง) 3โหล/กล่อง **", "เวชภัณฑ์มิใช่ยา", "กล่อง", 2, 0, "คลัง NSO", "both"],
    ["NSO-173", "silk no3/0 hr22 (กล่อง) ติดเข็ม (OR,ICU)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 4, 1, "คลัง NSO", "both"],
    ["NSO-174", "silk no4/0 (กล่อง) (3โหล/กล่อง) **", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1, 0, "คลัง NSO", "both"],
    ["NSO-175", "silk no4/0 hr17 (กล่อง) ติดเข็ม**", "เวชภัณฑ์มิใช่ยา", "กล่อง", 3, 0, "คลัง NSO", "both"],
    ["NSO-176", "soda lime dust filter(1กล่อง/ชิ้น) (OR,Anaes)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1, "คลัง NSO", "both"],
    ["NSO-177", "spinal block sterile(disposable)(ชิ้น) (Anaes)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-178", "Spinocan 22gx3\"1/2 25pc/box (w)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 325, 9, "คลัง NSO", "both"],
    ["NSO-179", "Spinocan 25gx3\"1/2 25pc/box (Anaes)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 125, 9, "คลัง NSO", "both"],
    ["NSO-180", "Spinocan 25gx4\"3/4 25pc/box เข็มยาว**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-181", "Spinocan 27gx3\"1/2 25pc/box (Anaes)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 10, "คลัง NSO", "both"],
    ["NSO-182", "stepcel absorbable hemostat (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-183", "sterile cotton ball0.35g - 10ชิ้น (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 100, "คลัง NSO", "both"],
    ["NSO-184", "sterlie cotton ball 0.35 g-20 ชิ้น(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 350, "คลัง NSO", "both"],
    ["NSO-185", "sterlie cotton ball 0.35 g-3 ชิ้น(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1750, "คลัง NSO", "both"],
    ["NSO-186", "sterlie cotton swab6\"(sizeM)-5ชิ้น(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 417, "คลัง NSO", "both"],
    ["NSO-187", "sterlie cotton swab6\"(sizeS)-5ชิ้น(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 167, "คลัง NSO", "both"],
    ["NSO-188", "sterlie cotton swab6\"(sizeL)-5ชิ้น(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 334, "คลัง NSO", "both"],
    ["NSO-189", "sterlie gauze pads 2\"x2\" 8ply-10pcs(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 167, "คลัง NSO", "both"],
    ["NSO-190", "Stockinette 10x130cm(4\")(OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-191", "Stockinette 15x150cm(6\")(OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-192", "Suction connecting tube(W6) (สายรองรับสารคัดหลั่ง)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 60, 0, "คลัง NSO", "both"],
    ["NSO-193", "Suction Liner(3000x)**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 250, 0, "คลัง NSO", "both"],
    ["NSO-194", "Suction toothbrush (ICU)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 260, 0, "คลัง NSO", "both"],
    ["NSO-195", "Suction สายซิลิโคน 5x9 cm ม้วน (OR)", "เวชภัณฑ์มิใช่ยา", "ม้วน", 0, 1, "คลัง NSO", "both"],
    ["NSO-196", "Suction สายซิลิโคน 7x11 cm ม้วน", "เวชภัณฑ์มิใช่ยา", "ม้วน", 5, 1, "คลัง NSO", "both"],
    ["NSO-197", "Swab Disposable 12*12\" แถบxray (pack) (OR)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 200, 134, "คลัง NSO", "both"],
    ["NSO-198", "Swab Disposable 3*9\" แถบxray (pack) **", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 58, 0, "คลัง NSO", "both"],
    ["NSO-199", "SWX 60G450x450.BLNnwowen Sterilization (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-200", "SWX 60G600x600.BLNnwowen Sterilization (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-201", "Syring ball no 3 ชิ้น **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 90, 0, "คลัง NSO", "both"],
    ["NSO-202", "Syring ball no 6 ชิ้น (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 0, "คลัง NSO", "both"],
    ["NSO-203", "Syring ball no 2 (OR,LR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 100, 82, "คลัง NSO", "both"],
    ["NSO-204", "Tampon80x30 mm. (6 ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1, 0, "คลัง NSO", "both"],
    ["NSO-205", "Tegaderm 4.4x4.4 cm (1622W)เด็ก", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 11, 4, "คลัง NSO", "both"],
    ["NSO-206", "Tegaderm 9x25 (W)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 1, "คลัง NSO", "both"],
    ["NSO-207", "Tegaderm cHG, 8.5x11.5 cm(กล่อง) (ICU)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 0, "คลัง NSO", "both"],
    ["NSO-208", "Tegaderm ปิด IV(1623W)ผู้ใหญ่", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 53, 12, "คลัง NSO", "both"],
    ["NSO-209", "Tip cleanner (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 25, "คลัง NSO", "both"],
    ["NSO-210", "TM Disposable Blood PressureTransducers (ICU)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-211", "TM surgical No L (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 17, 0, "คลัง NSO", "both"],
    ["NSO-212", "TM surgical No XL (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 7, 0, "คลัง NSO", "both"],
    ["NSO-213", "T-piece ด้านเท่า ขุ่น", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-214", "T-piece ด้านเท่า สีใส", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-215", "Tracheostomy Tube(Jacson Tube) **No.8", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 0, "คลัง NSO", "both"],
    ["NSO-216", "trocar no28 (ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 30, 2, "คลัง NSO", "both"],
    ["NSO-217", "trocar no32 (W5)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 0, "คลัง NSO", "both"],
    ["NSO-218", "Umbillical cath no3.5 ชิ้น **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 0, "คลัง NSO", "both"],
    ["NSO-219", "Umbillical cath no5 ชิ้น **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 60, 0, "คลัง NSO", "both"],
    ["NSO-220", "Urine bag", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 230, 275, "คลัง NSO", "both"],
    ["NSO-221", "Urine Cath สวนทิ้ง no16 (LR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 5, "คลัง NSO", "both"],
    ["NSO-222", "Vicryl 4/0 (W9443) (ฟัน)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 2, "คลัง NSO", "both"],
    ["NSO-223", "V-plus5/0 **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1, 0, "คลัง NSO", "both"],
    ["NSO-224", "V-repide2/0 W9946 (LR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-225", "V-repide2/0 W9962 (LR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 3, "คลัง NSO", "both"],
    ["NSO-226", "กระดาษ THERMAL PAPER 80x80 m. TG(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-227", "กระดาษปริ้นเครื่องนึ่งไอน้ำ (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-228", "กระดาษปริ้นเครื่องล้าง Steelco (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-229", "กระดาษพิมพ์ภาพขาวดำ ยี่ห้อ Sony รุ่น UPP-2", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 0, "คลัง NSO", "both"],
    ["NSO-230", "กระดาษอัลตร้าซาวด์ยี่ห้อ Sonomed รุ่น SM11 **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 13, 0, "คลัง NSO", "both"],
    ["NSO-231", "กล่องทิ้งเข็ม กล่อง", "เวชภัณฑ์มิใช่ยา", "กล่อง", 23, 106, "คลัง NSO", "both"],
    ["NSO-232", "ข้อต่อ Suction (ชิ้น) **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-233", "คลิปห้ามเลือด 135 องศา ยาว 9 mm.(HX-160-135 CLIP)(40ชิ้น/set) (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-234", "คลิปห้ามเลือด 135 องศา ยาว 9 mm.(HX-160-135L LONG CLIP)(40ชิ้น/set) (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-235", "เครื่องดูดเสมหะสำหรับเด็ก Mu-tip (W,ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 25, 5, "คลัง NSO", "both"],
    ["NSO-236", "ชุดเซอร์กิตเครื่องช่วยหายใจแบบซิริโคน (ICU)", "เวชภัณฑ์มิใช่ยา", "ชุด", 0, 2, "คลัง NSO", "both"],
    ["NSO-237", "ชุดตรวจสอบประสิทธิภาพของเครื่องนึ่ง(ระบบ Per-Vaccuum) **", "เวชภัณฑ์มิใช่ยา", "ชุด", 0, 0, "คลัง NSO", "both"],
    ["NSO-238", "ชุดพ่นยาเด็ก", "เวชภัณฑ์มิใช่ยา", "ชุด", 0, 50, "คลัง NSO", "both"],
    ["NSO-239", "ชุดพ่นยาผู้ใหญ่", "เวชภัณฑ์มิใช่ยา", "ชุด", 8, 54, "คลัง NSO", "both"],
    ["NSO-240", "ชุดสายดมยาสลบชนิดใช้ได้ครั้งเดียวสำหรับผู้ใหญ่M-A-C1204(Anaes)(10ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 3, 0, "คลัง NSO", "both"],
    ["NSO-241", "ซองซีล TYVEK ZIGMA 12 นิ้ว 150x70mm (CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 4, "คลัง NSO", "both"],
    ["NSO-242", "ซองซีล TYVEK ZIGMA 14 นิ้ว 150x70mm(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 3, "คลัง NSO", "both"],
    ["NSO-243", "ซองซีล TYVEK ZIGMA 2 นิ้ว( 50x70mm)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 5, "คลัง NSO", "both"],
    ["NSO-244", "ซองซีล TYVEK ZIGMA 4 นิ้ว(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-245", "ซองซีล TYVEK ZIGMA 6 นิ้ว 150x70mm(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-246", "ซองซีล TYVEK ZIGMA 8 นิ้ว 150x70mm(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-247", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 2x200)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-248", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 3x200)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-249", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 4x200)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-250", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 6x200)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-251", "ตัวชี้วัดทางเคมีสำหรับไฮโดรเจนเพอร์ออกไซด์(พลาสม่า) (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-252", "ตัวทดสอบประสิทธิภาพการทำความสะอาดของเครื่องล้างอัตโนมัติ (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-253", "ตัวทดสอบประสิทธิภาพสำหรับเครื่องล้างอัลตร้าโซนิค (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-254", "ถุงมือยางสังเคราะห์สำหรับการศัลยกรรมชนิด(OR) (รายการที่ 1)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-255", "ถุงมือยางสังเคราะห์สำหรับการศัลยกรรมชนิด(OR) (รายการที่ 2)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-256", "ถุงมือยางสังเคราะห์สำหรับการศัลยกรรมชนิด(OR) (รายการที่ 3)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-257", "ถุงมือล้วงรก L คู่ (LR)", "เวชภัณฑ์มิใช่ยา", "คู่", 0, 0, "คลัง NSO", "both"],
    ["NSO-258", "ถุงมือล้วงรก M คู่ (LR)", "เวชภัณฑ์มิใช่ยา", "คู่", 0, 0, "คลัง NSO", "both"],
    ["NSO-259", "ถุงมือล้วงรก S คู่ (LR)", "เวชภัณฑ์มิใช่ยา", "คู่", 0, 0, "คลัง NSO", "both"],
    ["NSO-260", "เทปทนความร้อน(Supply)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-261", "เทปล่อนกันความร้อน(Supply)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-262", "น้ำยาฆ่าเชื้อสำหรับกล่องส่องทางเดินอาหารชนิดใช้กับเครื่องล้าง", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 2, "คลัง NSO", "both"],
    ["NSO-263", "น้ำยาทำลายเชื้อชนิดเข้มข้น ขนาด 1L", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-264", "น้ำยาล้างทำความสะอาดเครื่องมือแพทย์ ขนาด 5L", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 3, "คลัง NSO", "both"],
    ["NSO-265", "น้ำยาสำหรับเครื่องมืออัตโนมัติ Prozyme Alka", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-266", "น้ำยาไฮโดรเจนเปอร์ออกไซด์", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 40, "คลัง NSO", "both"],
    ["NSO-267", "ใบมีด Knife for hm800เครื่อง HM8000as/5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-268", "ป้ายข้อมือเด็ก สีขาว กล่อง (100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 6, 0, "คลัง NSO", "both"],
    ["NSO-269", "ป้ายข้อมือเด็ก สีชมพู กล่อง(100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 4, 0, "คลัง NSO", "both"],
    ["NSO-270", "ป้ายข้อมือเด็ก สีฟ้า กล่อง(100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 5, 0, "คลัง NSO", "both"],
    ["NSO-271", "ป้ายช้อมือผู้ใหญ่ สีขาว กล่อง(100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 10, 0, "คลัง NSO", "both"],
    ["NSO-272", "ป้ายข้อมือผู้ใหญ่ สีชมพู กล่อง แพ้ยา(100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1, 0, "คลัง NSO", "both"],
    ["NSO-273", "ป้ายพลาสติกจำแนกอุปกรณ์(จมน้ำ)สีขาว(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-274", "ป้ายพลาสติกจำแนกอุปกรณ์(จมน้ำ)สีแดง(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-275", "ป้ายพลาสติกจำแนกอุปกรณ์(จมน้ำ)สีส้ม(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-276", "ผ้า gauze พับ 3\"x3\"8ชิ้น 10 ชิ้น ปลอดเชื้อ(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 334, "คลัง NSO", "both"],
    ["NSO-277", "ผ้า gauze พับ 4\"x4\"8ชิ้น 10 ชิ้น ปลอดเชื้อ (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 600, "คลัง NSO", "both"],
    ["NSO-278", "ผ้ายางเขียว แดง ม้วน**", "เวชภัณฑ์มิใช่ยา", "ม้วน", 3, 0, "คลัง NSO", "both"],
    ["NSO-279", "ผ้ายาง ฟ้า ชมพู ม้วน", "เวชภัณฑ์มิใช่ยา", "ม้วน", 5, 2, "คลัง NSO", "both"],
    ["NSO-280", "แผ่นปิดแผลชนิดฟิล์มใสกันน้ำ(10ซม.x1ม) (W5)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1, "คลัง NSO", "both"],
    ["NSO-281", "พลาสเตอร์ใสกันน้ำ(Norplant 3 ชิ้น/กล่อง)(ปฐมภูมิ)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 0, "คลัง NSO", "both"],
    ["NSO-282", "พลาสเตอร์เหนียว 2นิ้ว(12ม้วน/กระบอก)(OR)", "เวชภัณฑ์มิใช่ยา", "ม้วน", 0, 1, "คลัง NSO", "both"],
    ["NSO-283", "ไม้กดลิ้นDisposable Sterile(กล่อง)**", "เวชภัณฑ์มิใช่ยา", "กล่อง", 13, 0, "คลัง NSO", "both"],
    ["NSO-284", "ล้อหมึก PB2-230 ชิ้น **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 36, 0, "คลัง NSO", "both"],
    ["NSO-285", "ล้อหมึก PB3-312 ชิ้น **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 0, "คลัง NSO", "both"],
    ["NSO-286", "สติ๊กเกอร์ PB2-230 ทันกตรรม **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-287", "สติกเกอร์ฉลากแบบม้วนขนาด 6x3.5cm (1000ด/ม้วน)", "เวชภัณฑ์มิใช่ยา", "ม้วน", 0, 0, "คลัง NSO", "both"],
    ["NSO-288", "สาย radivac no 10 (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 15, "คลัง NSO", "both"],
    ["NSO-289", "สาย radivac no 12 (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 17, "คลัง NSO", "both"],
    ["NSO-290", "สาย radivac no 8 (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 17, "คลัง NSO", "both"],
    ["NSO-291", "สายMindray EKG trunk cable 3 Lead,AHA (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-292", "สายMindray EKG trunk cable 5 Lead,AHA (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-293", "สายโผลบ(Supply)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-294", "สายพานด้านบน(Supply)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-295", "สายพานด้านล่าง(Supply)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-296", "สายยางลาเท็กซ์ No204 **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 0, "คลัง NSO", "both"],
    ["NSO-297", "สำลีก้อน 0.35 g ปลอดเชื้อ", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 100, "คลัง NSO", "both"],
    ["NSO-298", "หลอดทดสอบทางชีวภาพสำหรับไฮโดรเจนเพอร์ออกไซด์(พลาสมา)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-299", "หลอดไฟ Laryng (Hieni) **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1, 0, "คลัง NSO", "both"],
    ["NSO-300", "อัลโคซิล 70%Alcohol gel 500 ml", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-301", "เอี๊ยมพลาสติก แขนยาวผูกหลัง", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 770, 250, "คลัง NSO", "both"],
  ],
};

if (typeof module !== 'undefined') module.exports = SEED_DATA;

// ==================== Report2569 (ราคาตามรายงานบัญชีวัสดุ 2569 + รายชื่อบริษัท) — จาก docs/apps-script/report-2569.js ====================

/*
 * ข้อมูลจากรายงานบัญชีวัสดุประจำปี 2569 (แท็บ 1.รายงานวัสดุ) และรายชื่อบริษัท (เอกสารสแกน source หน้า 5, 7, 9, 11)
 * ใช้กับฟังก์ชัน previewReport2569 / applyReport2569 ใน Apps Script (รันครั้งเดียว)
 * items: [รหัสในระบบ, รหัสในรายงาน, ชื่อในระบบ, ราคาต่อหน่วย (คอลัมน์ N), 1 = ยอดคงเหลือในรายงานเป็น "-" (ปรับจำนวนเป็น 0)]
 * จับคู่รายการด้วยชื่อพัสดุ (ไฟล์ Stock 21 ต.ค. 2569 ↔ รายงาน) · ไม่มีในระบบ: S0219 US Print (Sony), S0252 ถุงเก็บปัสสาวะเด็ก
 */
var REPORT_2569 = {
  note: 'ปรับตามรายงานบัญชีวัสดุ 2569',
  items: [
    ["NSO-001", "S0001", "3 -ways", 7, 0],
    ["NSO-002", "S0003", "350 ml water humidifier", 40.42, 1],
    ["NSO-003", "S0002", "7Fr,2.4mm(OD)Triple Lumen(set C-Line)(ICU,Anaes)", 950, 1],
    ["NSO-004", "S0004", "Airway 100mm", 30, 0],
    ["NSO-005", "S0005", "Airway 40 mm", 30, 0],
    ["NSO-006", "S0006", "Airway 50 mm", 30, 0],
    ["NSO-007", "S0007", "Airway 60 mm", 30, 0],
    ["NSO-008", "S0008", "Airway 70 mm", 30, 0],
    ["NSO-009", "S0009", "Airway 80 mm", 30, 0],
    ["NSO-010", "S0010", "Airway 90 mm", 30, 0],
    ["NSO-011", "S0011", "Alcohol Hand Rub gel 1000ml(ขวด)", 400, 1],
    ["NSO-012", "S0012", "Avagard bottle", 1284, 1],
    ["NSO-013", "S0013", "Becterial Fillter(Heppa)", 121.98, 0],
    ["NSO-014", "S0014", "Becterial Fillter(HME)", 90.95, 1],
    ["NSO-015", "S0015", "Becterial Fillter(ชิ้น)", 80.25, 0],
    ["NSO-016", "S0016", "Becterial Fillter Baby(ชิ้น)", 101.65, 0],
    ["NSO-017", "S0017", "Bag Suction Liner (1500 ml)(ER,ICU)", 48, 0],
    ["NSO-018", "S0018", "Blade No10 (100ชิ้น/กล่อง)TR", 700, 0],
    ["NSO-019", "S0019", "Blade No11 (100ชิ้น/กล่อง)", 700, 0],
    ["NSO-020", "S0020", "Blade No 12 (100ชิ้น/กล่อง)( ห้องฟัน)", 700, 1],
    ["NSO-021", "S0021", "Blade no 15 (100ชิ้น/กล่อง)", 700, 1],
    ["NSO-022", "S0022", "Blade no 15c (100ชิ้น/กล่อง)", 700, 1],
    ["NSO-023", "S0023", "Blade no21 (100ชิ้น/กล่อง)", 700, 0],
    ["NSO-024", "S0026", "Bluribbon gel 15 gm(1 หลอด/กล่อง) (OR)", 192.6, 1],
    ["NSO-025", "S0024", "Bluribbon1x20cm. (20 ชิ้น/กล่อง)(OR)", 1712, 1],
    ["NSO-026", "S0025", "Bluribbon3x5cm (OR)", 1284, 1],
    ["NSO-027", "S0027", "BP print (ม้วน)", 60, 0],
    ["NSO-028", "S0028", "Caps-CHG(ICU)(กล่อง)", 1872.5, 1],
    ["NSO-029", "S0029", "Carrifix 10*10cm(กล่อง)", 246.1, 0],
    ["NSO-030", "S0030", "Carrifix 5*10cm(กล่อง)", 171.2, 0],
    ["NSO-031", "S0031", "CathereeplusRollNo.1010(1ม้วน/กล่อง10cm)(OR)", 1000, 1],
    ["NSO-032", "S0032", "Certrofix trio 720 (สายcentral line)Set", 856, 1],
    ["NSO-033", "S0033", "Chromic 2/0 C2037T (กล่อง) 1 โหล/กล่อง", 1016.5, 0],
    ["NSO-034", "S0034", "Chromic 1 c140G (1โหล/กล่อง", 1016.5, 1],
    ["NSO-035", "S0035", "Chromic 2/0 C2040T-90", 1016.5, 0],
    ["NSO-036", "S0036", "Chromic 2/0C2026(1 โหล/1กล่อง)", 802.5, 0],
    ["NSO-037", "S0037", "Chromic 4/0(C4017)17mm1/2round", 909.5, 0],
    ["NSO-038", "S0038", "Chromic C3026 (กล่อง)", 802.5, 0],
    ["NSO-039", "S0039", "Chronos ขนาด2.8*5.6mm (OR)", 4000, 1],
    ["NSO-040", "S0040", "Circruit Simple smooth bone (22mm)(ER)", 2000, 1],
    ["NSO-041", "S0041", "Close suction (tycare exel cather) 10ชิ้น/กล่อง(ICU)", 395.9, 0],
    ["NSO-042", "S0042", "Clotest (prontro Dry)(OR)", 7500, 0],
    ["NSO-043", "S0043", "Coban 1\"(5หลา)(30ม้วน/กล่อง)**", 1080.7, 0],
    ["NSO-044", "S0044", "Cord Clamp(100ชิ้น/กล่อง)( LR)", 1300, 0],
    ["NSO-045", "S0046", "Cuff Bp Manaul เด็กโต (ชิ้น)", 600, 0],
    ["NSO-046", "S0045", "Cuff Manaul ผู้ใหญ่ (ชิ้น)", 600, 0],
    ["NSO-047", "S0049", "Cuff BP อัตโนมัติเด็กโต (ชิ้น)", 450, 0],
    ["NSO-048", "S0048", "Cuff BP อัตโนมัติเด็กเล็ก (ชิ้น)", 450, 0],
    ["NSO-049", "S0047", "Cuff BP อัตโนมัติผู้ใหญ๋ (ชิ้น)", 450, 0],
    ["NSO-050", "S0050", "Cuff BP อัตโนมัติ ยาวพิเศษ(ชิ้น)", 650, 0],
    ["NSO-051", "S0051", "Cutting No 21 โค้ง3/8 (โหล)(ฟัน)", 210, 1],
    ["NSO-052", "S0052", "Cutting No 24 โค้ง3/8 (โหล)**", 210, 0],
    ["NSO-053", "S0053", "Cutting No 28 โค้ง3/8 (โหล)**", 210, 0],
    ["NSO-054", "S0054", "Cutting No 32 โค้ง1/2(โหล)(ICU)", 210, 1],
    ["NSO-055", "S0055", "Dafib Print(zoll)**", 400, 0],
    ["NSO-056", "S0056", "Defib Print Thermal 50*20**", 55, 0],
    ["NSO-057", "S0057", "Delta cut biopsy(Needle biopsy)(ER)", 1124.25, 0],
    ["NSO-058", "S0058", "DetroFoam(สเปรย์โฟมทำความสะอาดเครื่อง..)(CSSD)", 550, 1],
    ["NSO-059", "S0059", "Disposable Bladeless Crown Trocal 12.5x110", 2750, 0],
    ["NSO-060", "S0060", "Disposable Bladeless Crown Trocal 5.5x100", 2420, 0],
    ["NSO-061", "S0061", "EKG Print (Mortara 250( OPD,W5,ICU)", 650, 0],
    ["NSO-062", "S0062", "EKG Print EDAN( W5)", 550, 0],
    ["NSO-063", "S0063", "EKG Print PhillipM1709A**", 800, 0],
    ["NSO-064", "S0064", "EKGprint mortoraELI230 (ม้วน)( ER W6)", 400, 0],
    ["NSO-065", "S0065", "Eletric clipper (โปรดเฟรสชันแนลเบรด)", 6750, 1],
    ["NSO-066", "S0066", "Ethibond Excel No 2**", 16906, 0],
    ["NSO-067", "S0067", "ETT No 5 /**NO Cuff (Safety clear)(ชิ้น)", 40, 0],
    ["NSO-068", "S0068", "ETT No 7 (ชิ้น)", 40, 1],
    ["NSO-069", "S0069", "ETT No 8 (ชิ้น)", 40, 0],
    ["NSO-070", "S0072", "Extension with T(100ชิ้น/กล่อง)", 12, 0],
    ["NSO-071", "S0070", "Extension 18 นิ้ว (100ชิ้น/กล่อง)", 5.05, 0],
    ["NSO-072", "S0071", "Extension 36 นิ้ว(100ขิ้น/กล่อง)", 5.5, 0],
    ["NSO-073", "S0073", "Face shield **", 800, 0],
    ["NSO-074", "S0074", "Fiber Wire No 2( OR)", 880, 1],
    ["NSO-075", "S0075", "Fiber Wire No 5( OR)", 2400, 1],
    ["NSO-076", "S0076", "Foley 2 way no 10 balloon 5", 117.7, 1],
    ["NSO-077", "S0077", "Foley 2 way no 14 balloon 10", 26.75, 0],
    ["NSO-078", "S0078", "Foley 2 way no 16 balloon 10", 26.75, 0],
    ["NSO-079", "S0079", "Foley 2 way no 18 ballloon 10", 26.75, 1],
    ["NSO-080", "S0080", "Foley 2 way no 20 balloon 10", 26.75, 0],
    ["NSO-081", "S0081", "Foley 2 way no 24 balloon 10", 26.75, 0],
    ["NSO-082", "S0084", "Foley 3 way no 16 balloon 30", 175.48, 0],
    ["NSO-083", "S0082", "Foley 3 way no 18 ballloon 30", 175.48, 1],
    ["NSO-084", "S0083", "Foley 3way no 24 balloon 30", 175.48, 1],
    ["NSO-085", "S0085", "Foley 3หาง No20", 175.48, 0],
    ["NSO-086", "S0086", "Foley 2 way no 12 balloon 10", 26.75, 0],
    ["NSO-088", "S0088", "Gauze 4x4 แถบ x ray 12 ชั้น C/S (Pack)( CSSD)", 150, 1],
    ["NSO-089", "S0087", "Gauze 4x4 แถบ x ray 8 ชั้น 100ชิ้น/Pack( CSSD)", 125, 0],
    ["NSO-090", "S0089", "Guide wire L (ชิ้น)", 320.09, 0],
    ["NSO-091", "S0090", "Guide wire M (ชิ้น)", 320, 0],
    ["NSO-092", "S0091", "Guide wire S (ชิ้น)", 330, 0],
    ["NSO-093", "S0092", "HA Bone Hydroxyapatite 5 cc.(กล่อง)", 1800, 0],
    ["NSO-094", "S0093", "Heat Breathing Tube with MR290/Adualt(ชิ้น)( ER)", 2600, 0],
    ["NSO-095", "S0094", "Infusion set (20ชิ้น/กล่อง)(W5,W6)", 72.76, 0],
    ["NSO-096", "S0096", "IOBAN 6640 10 pc (กล่อง) (OR)**", 2996, 1],
    ["NSO-097", "S0095", "IOBAN 2/0 6650 10 pc (กล่อง) กระดูก (OR)", 4066, 0],
    ["NSO-098", "S0097", "IT26S (steam)class 5กล่อง(-/Pack)(CSSD)", 620, 1],
    ["NSO-099", "S0098", "J.S.E.T.Tube No 5 lot 4454680 No.cuff(ชิ้น)", 154.08, 0],
    ["NSO-100", "S0099", "J.S.E.T.Tube No 5 lot 4454682 cuff(ชิ้น)", 187.25, 0],
    ["NSO-101", "S0100", "jackson drain (400ml)silicone( OR)", 420, 0],
    ["NSO-102", "S0101", "JS E.T. tube NO.2.5", 154.08, 0],
    ["NSO-103", "S0102", "JS E.T. tube NO.3.0", 154.08, 0],
    ["NSO-104", "S0103", "JS E.T. tube NO.3.5", 154.08, 0],
    ["NSO-105", "S0104", "JS E.T. tube NO.4", 154.08, 0],
    ["NSO-106", "S0105", "JS E.T. tube NO.4.5", 154.08, 0],
    ["NSO-107", "S0106", "JS E.T. tube NO.6", 187.25, 0],
    ["NSO-108", "S0107", "JS E.T. tube NO.6.5", 187.25, 0],
    ["NSO-109", "S0108", "JS E.T. tube NO.7.", 187.25, 0],
    ["NSO-110", "S0109", "JS E.T. tube NO.7.5", 187.25, 0],
    ["NSO-111", "S0110", "JS E.T. tube NO.8", 187.25, 0],
    ["NSO-112", "S0111", "JS E.T. tube NO.8.5", 187.25, 0],
    ["NSO-113", "S0112", "JS Tube No 5.5", 184.3, 0],
    ["NSO-114", "S0113", "Manipler (slaple) 6.9x4.2 mm. 6pc/pack(OR)", 1605, 0],
    ["NSO-115", "S0114", "Monoplus V 1 HR40s (2โหล)**", 6420, 1],
    ["NSO-116", "S0115", "Monosyn No4/0 70cm GS60 เข็มตรง (OR)", 5778, 1],
    ["NSO-117", "S0116", "Monosyn U4/0 70cm เข็มโค้ง**", 6099, 0],
    ["NSO-118", "S0117", "Mucus Extractor ชุดดูดเสมหะ", 30, 1],
    ["NSO-119", "S0118", "Multrpore dry ขนาด 1/2\"", 909.5, 0],
    ["NSO-120", "S0121", "NeodisherIR 1L.(น้ำยาขจัดสนิม)(CSSD)", 1800, 1],
    ["NSO-121", "S0119", "Neodisher Lm2 1L.(น้ำยาล้างพิมพ์ฟัน)(CSSD)", 1200, 1],
    ["NSO-122", "S0120", "Neodisher Mediklar 5L.(น้ำยาเคลือบเร่งแห้ง)(CSSD)", 4200, 1],
    ["NSO-124", "S0122", "Novasorb Quick 2/0 37mm 1/2 TC(OR)", 1177, 0],
    ["NSO-125", "S0123", "NST print (philllip M1911 A(LR)", 450, 0],
    ["NSO-126", "S0124", "Nutribag", 15, 0],
    ["NSO-127", "S0125", "Nutribag line", 15, 0],
    ["NSO-128", "S0126", "Nylon 8/0(1โหล/กล่อง)**", 3852, 0],
    ["NSO-129", "S0127", "Nylon 2/0 DS30 (กล่อง)1x36 (OR,ER)", 1605, 0],
    ["NSO-130", "S0128", "Nylon 3/0 DS24 (กล่อง)1x36(OR,ER)", 1605, 0],
    ["NSO-131", "S0129", "Nylon 4/0/0 DS19 (กล่อง)1x36(OR,ER)", 1605, 1],
    ["NSO-132", "S0130", "Nylon 5/0 DS16 (กล่อง)1x36(OR,ER)", 1605, 0],
    ["NSO-133", "S0131", "Nylon 6/0 DS16 (กล่อง)1x36(OR,ER)", 1605, 0],
    ["NSO-134", "S0132", "Nylon no 0 (DS39)**", 1926, 0],
    ["NSO-135", "S0133", "Nylon no 1 HS48**", 1926, 0],
    ["NSO-136", "S0134", "Optiflow Canular Junior Size S แดง(ชิ้น)(W5,W6)", 2200, 0],
    ["NSO-137", "S0135", "Optiflow Canular Junior Size L ม่วง (W5,W6)", 2200, 0],
    ["NSO-138", "S0136", "Optiflow Canular Junior Size XL เขียว(W5,W6)", 2200, 0],
    ["NSO-139", "S0137", "Optiflow Canular Junior Size เหลือง(W5,W6,LR)", 2200, 0],
    ["NSO-140", "S0138", "Optiflow Canular Medium Size ผู้ใหญ่ (ER)", 1000, 0],
    ["NSO-141", "S0139", "Optilene mesh 15x15 cm (OR)", 10700, 0],
    ["NSO-142", "S0140", "Optiline 2/0 HR26(OR)", 4173, 1],
    ["NSO-143", "S0141", "Oxicel Standard5x7.5cm(12ชิ้น/กล่อง) (OR)", 2946, 1],
    ["NSO-144", "S0142", "Oxygen Cannula Adult (ชิ้น)", 25, 0],
    ["NSO-145", "S0143", "Oxygen Cannula Child (ชิ้น)", 30, 0],
    ["NSO-146", "S0144", "Oxygen Mask with Bag adult", 60, 1],
    ["NSO-147", "S0145", "Oxygen Mask with Bag Child", 60, 1],
    ["NSO-148", "S0146", "Oxygen tubing**", 28, 1],
    ["NSO-149", "S0147", "plate จี้ไฟฟ้า (ชิ้น) (OR)", 192.6, 0],
    ["NSO-150", "S0148", "plate จี้ไฟฟ้า (เด็ก)(ชิ้น)(OR)", 250, 1],
    ["NSO-151", "S0149", "polysorb 0 kv34 (ortho) (OR)", 1605, 0],
    ["NSO-152", "S0150", "polysorb 1 kv34 (1กล่อง/3โหล) (OR)", 4468.32, 0],
    ["NSO-153", "S0151", "polysorb 1 VIO 150cm. (OR)", 3600, 1],
    ["NSO-154", "S0152", "polysorb 2-0 V20(30ชิ้น/กล่อง)(sheet) (OR,Anaes)", 3530.74, 0],
    ["NSO-155", "S0153", "polysarb 3/0 SL693 C14 (TR) (ER)", 4815, 0],
    ["NSO-156", "S0154", "polysorb 4-0 C13 (1 กล่อง/3โหล) (OR)", 4815, 1],
    ["NSO-157", "S0155", "polysorb 6-0 Sl-1625g (1โหล/กล่อง) **", 1605, 0],
    ["NSO-158", "S0156", "polysorb No 1 GS24 (OR)", 4934.4, 1],
    ["NSO-159", "S0157", "polysorb3--0 CV25(1กล่อง/3โหล) (OR)", 3531, 0],
    ["NSO-160", "S0158", "polysorb4-0CVF-23(round)1กล่อง/3โหล **", 3852, 0],
    ["NSO-161", "S0159", "Q bac Chlohexidedine Siap Gel 1000ml", 400, 1],
    ["NSO-162", "S0160", "Radivac drain bottle 400ml (OR)", 170, 1],
    ["NSO-163", "S0161", "Radivac drain bottle 600ml (OR)", 130, 0],
    ["NSO-164", "S0162", "Red dot 2238 (Pack)(50ชิ้น/pack)", 909.5, 1],
    ["NSO-165", "S0163", "Reddot เด็ก 2248 (50ชิ้น/pack)", 963, 0],
    ["NSO-167", "S0164", "Seling Teflon Belt", 1380, 1],
    ["NSO-168", "S0165", "Silicone flat perforated drain size 10-0 สาย (OR)(10ชิ้น/กล่อง)", 220, 1],
    ["NSO-169", "S0166", "Silk no 1 **", 1605, 0],
    ["NSO-170", "S0167", "silk no 2/0", 1605, 0],
    ["NSO-171", "S0168", "silk no 2/0 hr26 (กล่อง) ติดเข็ม", 1605, 1],
    ["NSO-172", "S0169", "silk no3/0 (กล่อง) 3โหล/กล่อง **", 1605, 0],
    ["NSO-173", "S0170", "silk no3/0 hr22 (กล่อง) ติดเข็ม (OR,ICU)", 1605, 0],
    ["NSO-174", "S0171", "silk no4/0 (กล่อง) (3โหล/กล่อง) **", 1605, 0],
    ["NSO-175", "S0172", "silk no4/0 hr17 (กล่อง) ติดเข็ม**", 1926, 0],
    ["NSO-176", "S0173", "soda lime dust filter(1กล่อง/ชิ้น) (OR,Anaes)", 1200, 1],
    ["NSO-177", "S0174", "spinal block sterile(disposable)(ชิ้น) (Anaes)", 80, 1],
    ["NSO-178", "S0175", "Spinocan 22gx3\"1/2 25pc/box (w)", 42.8, 0],
    ["NSO-179", "S0176", "Spinocan 25gx3\"1/2 25pc/box (Anaes)", 53.5, 0],
    ["NSO-180", "S0177", "Spinocan 25gx4\"3/4 25pc/box เข็มยาว**", 160, 1],
    ["NSO-181", "S0178", "Spinocan 27gx3\"1/2 25pc/box (Anaes)", 53.5, 1],
    ["NSO-182", "S0179", "stepcel absorbable hemostat (OR)", 8560, 1],
    ["NSO-183", "S0180", "sterile cotton ball0.35g - 10ชิ้น (CSSD)", 3.25, 1],
    ["NSO-184", "S0182", "sterlie cotton ball 0.35 g-20 ชิ้น(CSSD)", 6, 1],
    ["NSO-185", "S0181", "sterlie cotton ball 0.35 g-3 ชิ้น(CSSD)", 1.5, 1],
    ["NSO-186", "S0184", "sterlie cotton swab6\"(sizeM)-5ชิ้น(CSSD)", 3, 1],
    ["NSO-187", "S0185", "sterlie cotton swab6\"(sizeS)-5ชิ้น(CSSD)", 3, 1],
    ["NSO-188", "S0183", "sterlie cotton swab6\"(sizeL)-5ชิ้น(CSSD)", 3, 1],
    ["NSO-189", "S0186", "sterlie gauze pads 2\"x2\" 8ply-10pcs(CSSD)", 3.25, 1],
    ["NSO-190", "S0187", "Stockinette 10x130cm(4\")(OR)", 175, 1],
    ["NSO-191", "S0188", "Stockinette 15x150cm(6\")(OR)", 195, 1],
    ["NSO-192", "S0189", "Suction connecting tube(W6) (สายรองรับสารคัดหลั่ง)", 35, 0],
    ["NSO-193", "S0190", "Suction Liner(3000x)**", 61.2, 0],
    ["NSO-194", "S0191", "Suction toothbrush (ICU)", 89, 0],
    ["NSO-195", "S0192", "Suction สายซิลิโคน 5x9 cm ม้วน (OR)", 1350, 1],
    ["NSO-196", "S0193", "Suction สายซิลิโคน 7x11 cm ม้วน", 1500, 0],
    ["NSO-197", "S0194", "Swab Disposable 12*12\" แถบxray (pack) (OR)", 71.25, 0],
    ["NSO-198", "S0195", "Swab Disposable 3*9\" แถบxray (pack) **", 65, 0],
    ["NSO-199", "S0196", "SWX 60G450x450.BLNnwowen Sterilization (CSSD)", 909.5, 1],
    ["NSO-200", "S0197", "SWX 60G600x600.BLNnwowen Sterilization (CSSD)", 1557.52, 1],
    ["NSO-201", "S0198", "Syring ball no 3 ชิ้น **", 70, 0],
    ["NSO-202", "S0199", "Syring ball no 6 ชิ้น (OR)", 120, 0],
    ["NSO-203", "S0200", "Syring ball no 2 (OR,LR)", 60, 0],
    ["NSO-204", "S0203", "Tampon80x30 mm. (6 ชิ้น/กล่อง)", 1926, 0],
    ["NSO-205", "S0204", "Tegaderm 4.4x4.4 cm (1622W)เด็ก", 856, 0],
    ["NSO-206", "S0205", "Tegaderm 9x25 (W)", 2097.2, 0],
    ["NSO-207", "S0206", "Tegaderm cHG, 8.5x11.5 cm(กล่อง) (ICU)", 5671, 1],
    ["NSO-208", "S0207", "Tegaderm ปิด IV(1623W)ผู้ใหญ่", 856, 0],
    ["NSO-209", "S0208", "Tip cleanner (OR)", 32, 0],
    ["NSO-210", "S0209", "TM Disposable Blood PressureTransducers (ICU)", 650, 1],
    ["NSO-211", "S0210", "TM surgical No L (OR)", 98, 0],
    ["NSO-212", "S0211", "TM surgical No XL (OR)", 98, 0],
    ["NSO-213", "S0201", "T-piece ด้านเท่า ขุ่น", 100, 1],
    ["NSO-214", "S0202", "T-piece ด้านเท่า สีใส", 100, 1],
    ["NSO-215", "S0212", "Tracheostomy Tube(Jacson Tube) **No.8", 850, 0],
    ["NSO-216", "S0213", "trocar no28 (ER)", 450, 0],
    ["NSO-217", "S0214", "trocar no32 (W5)", 450, 0],
    ["NSO-218", "S0215", "Umbillical cath no3.5 ชิ้น **", 210, 0],
    ["NSO-219", "S0216", "Umbillical cath no5 ชิ้น **", 210, 0],
    ["NSO-220", "S0217", "Urine bag", 14.5, 0],
    ["NSO-221", "S0218", "Urine Cath สวนทิ้ง no16 (LR)", 28, 1],
    ["NSO-222", "S0220", "Vicryl 4/0 (W9443) (ฟัน)", 2878.3, 0],
    ["NSO-223", "S0221", "V-plus5/0 **", 8634.64, 0],
    ["NSO-224", "S0222", "V-repide2/0 W9946 (LR)", 2696.4, 1],
    ["NSO-225", "S0223", "V-repide2/0 W9962 (LR)", 2696.4, 1],
    ["NSO-226", "S0224", "กระดาษ THERMAL PAPER 80x80 m. TG(CSSD)", 50, 1],
    ["NSO-227", "S0225", "กระดาษปริ้นเครื่องนึ่งไอน้ำ (CSSD)", 160.5, 1],
    ["NSO-228", "S0226", "กระดาษปริ้นเครื่องล้าง Steelco (CSSD)", 250, 1],
    ["NSO-229", "S0227", "กระดาษพิมพ์ภาพขาวดำ ยี่ห้อ Sony รุ่น UPP-2", 2500, 0],
    ["NSO-230", "S0228", "กระดาษอัลตร้าซาวด์ยี่ห้อ Sonomed รุ่น SM11 **", 741.82, 0],
    ["NSO-231", "S0229", "กล่องทิ้งเข็ม กล่อง", 35, 0],
    ["NSO-232", "S0230", "ข้อต่อ Suction (ชิ้น) **", 50, 1],
    ["NSO-233", "S0231", "คลิปห้ามเลือด 135 องศา ยาว 9 mm.(HX-160-135 CLIP)(40ชิ้น/set) (OR)", 18000, 1],
    ["NSO-234", "S0232", "คลิปห้ามเลือด 135 องศา ยาว 9 mm.(HX-160-135L LONG CLIP)(40ชิ้น/set) (OR)", 18000, 1],
    ["NSO-235", "S0233", "เครื่องดูดเสมหะสำหรับเด็ก Mu-tip (W,ER)", 42.8, 0],
    ["NSO-236", "S0238", "ชุดเซอร์กิตเครื่องช่วยหายใจแบบซิริโคน (ICU)", 14000, 1],
    ["NSO-237", "S0234", "ชุดตรวจสอบประสิทธิภาพของเครื่องนึ่ง(ระบบ Per-Vaccuum) **", 2900, 1],
    ["NSO-238", "S0236", "ชุดพ่นยาเด็ก", 100, 1],
    ["NSO-239", "S0235", "ชุดพ่นยาผู้ใหญ่", 100, 0],
    ["NSO-240", "S0237", "ชุดสายดมยาสลบชนิดใช้ได้ครั้งเดียวสำหรับผู้ใหญ่M-A-C1204(Anaes)(10ชิ้น/กล่อง)", 2500, 0],
    ["NSO-241", "S0243", "ซองซีล TYVEK ZIGMA 12 นิ้ว 150x70mm (CSSD)", 3600, 1],
    ["NSO-242", "S0244", "ซองซีล TYVEK ZIGMA 14 นิ้ว 150x70mm(CSSD)", 4000, 1],
    ["NSO-243", "S0239", "ซองซีล TYVEK ZIGMA 2 นิ้ว( 50x70mm)(CSSD)", 850, 1],
    ["NSO-244", "S0240", "ซองซีล TYVEK ZIGMA 4 นิ้ว(CSSD)", 1340, 1],
    ["NSO-245", "S0241", "ซองซีล TYVEK ZIGMA 6 นิ้ว 150x70mm(CSSD)", 2000, 1],
    ["NSO-246", "S0242", "ซองซีล TYVEK ZIGMA 8 นิ้ว 150x70mm(CSSD)", 2600, 1],
    ["NSO-247", "S0245", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 2x200)(CSSD)", 435, 1],
    ["NSO-248", "S0246", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 3x200)(CSSD)", 320, 1],
    ["NSO-249", "S0247", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 4x200)(CSSD)", 580, 1],
    ["NSO-250", "S0248", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 6x200)(CSSD)", 855, 1],
    ["NSO-251", "S0249", "ตัวชี้วัดทางเคมีสำหรับไฮโดรเจนเพอร์ออกไซด์(พลาสม่า) (CSSD)", 1200, 1],
    ["NSO-252", "S0250", "ตัวทดสอบประสิทธิภาพการทำความสะอาดของเครื่องล้างอัตโนมัติ (CSSD)", 1800, 1],
    ["NSO-253", "S0251", "ตัวทดสอบประสิทธิภาพสำหรับเครื่องล้างอัลตร้าโซนิค (CSSD)", 3450, 1],
    ["NSO-254", "S0253", "ถุงมือยางสังเคราะห์สำหรับการศัลยกรรมชนิด(OR) (รายการที่ 1)", 2675, 1],
    ["NSO-255", "S0254", "ถุงมือยางสังเคราะห์สำหรับการศัลยกรรมชนิด(OR) (รายการที่ 2)", 2675, 1],
    ["NSO-256", "S0255", "ถุงมือยางสังเคราะห์สำหรับการศัลยกรรมชนิด(OR) (รายการที่ 3)", 2675, 1],
    ["NSO-257", "S0256", "ถุงมือล้วงรก L คู่ (LR)", 270, 1],
    ["NSO-258", "S0257", "ถุงมือล้วงรก M คู่ (LR)", 270, 1],
    ["NSO-259", "S0258", "ถุงมือล้วงรก S คู่ (LR)", 180, 1],
    ["NSO-260", "S0259", "เทปทนความร้อน(Supply)", 6500, 1],
    ["NSO-261", "S0260", "เทปล่อนกันความร้อน(Supply)", 2530, 1],
    ["NSO-262", "S0261", "น้ำยาฆ่าเชื้อสำหรับกล่องส่องทางเดินอาหารชนิดใช้กับเครื่องล้าง", 6000, 1],
    ["NSO-263", "S0262", "น้ำยาทำลายเชื้อชนิดเข้มข้น ขนาด 1L", 7490, 1],
    ["NSO-264", "S0263", "น้ำยาล้างทำความสะอาดเครื่องมือแพทย์ ขนาด 5L", 6848, 1],
    ["NSO-265", "S0264", "น้ำยาสำหรับเครื่องมืออัตโนมัติ Prozyme Alka", 4400, 1],
    ["NSO-266", "S0265", "น้ำยาไฮโดรเจนเปอร์ออกไซด์", 750, 1],
    ["NSO-267", "S0266", "ใบมีด Knife for hm800เครื่อง HM8000as/5", 9750, 1],
    ["NSO-268", "S0267", "ป้ายข้อมือเด็ก สีขาว กล่อง (100ชิ้น/กล่อง)", 300, 0],
    ["NSO-269", "S0268", "ป้ายข้อมือเด็ก สีชมพู กล่อง(100ชิ้น/กล่อง)", 270, 0],
    ["NSO-270", "S0269", "ป้ายข้อมือเด็ก สีฟ้า กล่อง(100ชิ้น/กล่อง)", 270, 0],
    ["NSO-271", "S0270", "ป้ายช้อมือผู้ใหญ่ สีขาว กล่อง(100ชิ้น/กล่อง)", 270, 0],
    ["NSO-272", "S0271", "ป้ายข้อมือผู้ใหญ่ สีชมพู กล่อง แพ้ยา(100ชิ้น/กล่อง)", 270, 0],
    ["NSO-273", "S0272", "ป้ายพลาสติกจำแนกอุปกรณ์(จมน้ำ)สีขาว(CSSD)", 35, 1],
    ["NSO-274", "S0273", "ป้ายพลาสติกจำแนกอุปกรณ์(จมน้ำ)สีแดง(CSSD)", 35, 1],
    ["NSO-275", "S0274", "ป้ายพลาสติกจำแนกอุปกรณ์(จมน้ำ)สีส้ม(CSSD)", 35, 1],
    ["NSO-276", "S0275", "ผ้า gauze พับ 3\"x3\"8ชิ้น 10 ชิ้น ปลอดเชื้อ(CSSD)", 7, 1],
    ["NSO-277", "S0276", "ผ้า gauze พับ 4\"x4\"8ชิ้น 10 ชิ้น ปลอดเชื้อ (CSSD)", 10, 1],
    ["NSO-278", "S0277", "ผ้ายางเขียว แดง ม้วน**", 700, 0],
    ["NSO-279", "S0278", "ผ้ายาง ฟ้า ชมพู ม้วน", 850, 0],
    ["NSO-280", "S0279", "แผ่นปิดแผลชนิดฟิล์มใสกันน้ำ(10ซม.x1ม) (W5)", 117.7, 1],
    ["NSO-281", "S0280", "พลาสเตอร์ใสกันน้ำ(Norplant 3 ชิ้น/กล่อง)(ปฐมภูมิ)", 36.38, 1],
    ["NSO-282", "S0281", "พลาสเตอร์เหนียว 2นิ้ว(12ม้วน/กระบอก)(OR)", 499.01, 1],
    ["NSO-283", "S0282", "ไม้กดลิ้นDisposable Sterile(กล่อง)**", 100, 0],
    ["NSO-284", "S0283", "ล้อหมึก PB2-230 ชิ้น **", 120, 0],
    ["NSO-285", "S0284", "ล้อหมึก PB3-312 ชิ้น **", 214, 0],
    ["NSO-286", "S0285", "สติ๊กเกอร์ PB2-230 ทันกตรรม **", 32.1, 1],
    ["NSO-287", "S0286", "สติกเกอร์ฉลากแบบม้วนขนาด 6x3.5cm (1000ด/ม้วน)", 500, 1],
    ["NSO-288", "S0287", "สาย radivac no 10 (OR)", 30, 1],
    ["NSO-289", "S0288", "สาย radivac no 12 (OR)", 30, 1],
    ["NSO-290", "S0289", "สาย radivac no 8 (OR)", 30, 1],
    ["NSO-291", "S0292", "สายMindray EKG trunk cable 3 Lead,AHA (OR)", 4000, 1],
    ["NSO-292", "S0293", "สายMindray EKG trunk cable 5 Lead,AHA (OR)", 5000, 1],
    ["NSO-293", "S0294", "สายโผลบ(Supply)", 25000, 1],
    ["NSO-294", "S0295", "สายพานด้านบน(Supply)", 9650, 1],
    ["NSO-295", "S0296", "สายพานด้านล่าง(Supply)", 7050, 1],
    ["NSO-296", "S0297", "สายยางลาเท็กซ์ No204 **", 980, 0],
    ["NSO-297", "S0298", "สำลีก้อน 0.35 g ปลอดเชื้อ", 12, 1],
    ["NSO-298", "S0299", "หลอดทดสอบทางชีวภาพสำหรับไฮโดรเจนเพอร์ออกไซด์(พลาสมา)", 9500, 1],
    ["NSO-299", "S0300", "หลอดไฟ Laryng (Hieni) **", 3300, 0],
    ["NSO-300", "S0301", "อัลโคซิล 70%Alcohol gel 500 ml", 58, 1],
    ["NSO-301", "S0302", "เอี๊ยมพลาสติก แขนยาวผูกหลัง", 8, 0],
  ],
  suppliers: [
    "เทอราจินี",
    "มาร์ธา กรุ๊ป",
    "เอสเอโมเดิร์นไลน์",
    "เมดิคแมนไทย",
    "แจ็กเจียอุตสาหกรรม",
    "เอลิสต์ซัพพลาย",
    "เอโอเทรดดิ้ง",
    "ทริมเมอร์",
    "เซนต์เมดิคอล",
    "พนาสวัสดิ์",
    "เจพีพีเทรดดิ้ง",
    "ไลอ้อนอินเตอร์เมด",
    "โพสท์เฮลท์แคร์",
    "ชิมม์",
    "เจนกิจแพทย์ภัณฑ์",
    "โซวิค",
    "ซีโร่ห์เมดิคอล",
    "เดวิดบราเดอร์สกรุ๊ป",
    "เอ็มดีลิ้งค์",
    "เอ็นราฟโนเนียสเมดิคอลอิควิปเมนท์",
    "เคเจวาย",
    "ริชเมดิคอลซัพพลาย",
    "ซิลลิค",
    "เอ็มดีซี",
    "ซัมเมดิคอล",
    "สยาม HOSPITAL SUPPLY",
    "มีดี ซัพพลาย",
    "เรียลเมด",
    "ฟิวเจอร์เมดิคอล",
    "ตะวันแม็คไวลซ์",
    "เอ็นจี (NG) progressive",
    "เอ็ม บี ดี เซอร์จิคอล",
    "จุฑาวรรตน์ (บริษัท)",
    "เอ.เอส.ที เมดิคอล ซัพพลาย",
    "ไอเอ็นเอส แล็บเซิร์ฟ จำกัด",
    "โกร๊ธ ซัพพลาย เมดิคอล จำกัด",
    "เอ็ทซีดับบลิว",
    "หจก.เอ็ม.อาร์.เมดิคอลอินสทรูเม้นท์",
    "ยู.พี.เมดิคอล จำกัด",
    "เจ๊กเจีย",
    "ดีไวซ์อินโนเวชั่น",
    "Prime Medical",
    "เอ แอนด์ เอ",
    "อินโนเวทีฟ อิมเมจจิ้ง",
    "Draeger Medical (Thailand) Ltd.",
    "เวิล์ดเกท จำกัด",
    "พี.ซี.ดรักเซ็นเตอร์ จำกัด",
    "เอสแอนด์ที เทคนิคัล ซัพพลาย จำกัด",
    "บีเวอร์ เมดิคอล อินดัสตรี้ จำกัด",
    "เอ็มมีเน้นซ์ อินเตอร์เนชั่นแนล จำกัด",
    "อัลฟาเมด คอร์ปอเรชั่น จำกัด",
    "ดีพร้อม เมดดิคอล",
    "J.S Vision LTD.",
    "ชัยศิริ เวชภัณฑ์ จำกัด",
    "เมทต้า อีควิปเมนท์ จำกัด",
    "เอ็นโดเมด เซอร์วิส จำกัด",
    "ภาสิน หจก.",
    "ดีเคเคดี",
    "ไพส์ซีส เมดิคอล จำกัด",
    "บริษัท สเปเชียล เมด จำกัด",
    "เทคโนเมดิคัล จำกัด (มหาชน)",
    "เอทีแซด โกบอล จำกัด",
    "เจริญพลัส เฮลท์แคร์ จำกัด",
    "Olympus",
    "สตาร์เร็ท เซ้าท์อีสต์ เอเชียน จำกัด",
    "เอสเอ็มดี เจเนซิส จำกัด",
    "อินไทม์ เมดิคอล จำกัด",
    "ไวด์ เมดิคอลแอนด์ซัพพลาย จำกัด",
    "ชีวา เมดิคอลแอนด์ซัพพลาย จำกัด",
    "บริษัท แปซิฟิค เฮลธ์แคร์ (ไทยแลนด์) จำกัด",
    "บริษัท ที.จี.อินเตอร์มาเก็ตติ้ง จำกัด",
    "บริษัท อีทีเอ็ม เมดิเคิล จำกัด",
    "Bio Inno Tech Co.,Ltd",
    "บริษัท เคมเทคเฮล์แคร์ จำกัด",
    "บริษัท กริฟฟิน ไทยเมดิก จำกัด",
    "บริษัท จีเอชซี เมด จำกัด",
    "บริษัท เพาเวอร์เทกซ์ เอเซีย จำกัด",
    "บริษัท นำวิวัฒน์ เมดิคอล คอร์ปอเรชั่น จำกัด",
    "บริษัท ฉัตรแก้ว โปรดักส์ จำกัด",
    "บริษัท ไซกา เมดิค จำกัด",
    "บริษัท นิคโก้เฮลแคร์ จำกัด",
    "บริษัท โนวาแคร์ จำกัด",
    "บริษัท เอไอ ธิงค์แท้งค์ จำกัด",
    "เซ็นต์เมด",
    "เอ็มมีเน้นท์",
    "เอ็ม อาร์ เมดิคอล",
    "อินโนเสทีฟ จำกัด",
    "เวิลด์ไลฟ์ เมดิคอล จำกัด",
    "บริษัท ซิลลิค ฟาร์มา จำกัด",
    "Sterlyn Health Co.,Ltd",
    "อินเด็กซ์ เมดิคัล แอนด์ ซัพพลาย",
  ],
};

if (typeof module !== 'undefined') module.exports = REPORT_2569;

// ==================== RichMenuImage (รูปเมนู LINE OA สำหรับ setupRichMenu) — จาก docs/apps-script/richmenu.jpg ====================

var LINE_RICHMENU_JPG = [
  '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',
];
