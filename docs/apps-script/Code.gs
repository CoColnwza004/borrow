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
var ADMIN_PIN = '1234';

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
  return handle_(body);
}

function handle_(body) {
  var isAdmin = String(body.pin || '') === ADMIN_PIN;
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
