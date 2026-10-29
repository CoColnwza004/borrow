/**
 * ระบบเบิก-ยืมพัสดุ — ไฟล์รวมสำหรับ Google Apps Script (ไฟล์เดียวจบ)
 * ไฟล์นี้สร้างอัตโนมัติด้วย npm run build:gs ห้ามแก้ตรงนี้ ให้แก้ไฟล์ต้นฉบับใน docs/ แล้ว build ใหม่
 *
 * วิธีใช้: ใน Apps Script ให้มีไฟล์ Code.gs ไฟล์เดียว ลบเนื้อหาเดิมทั้งหมด แล้ววางไฟล์นี้ทั้งไฟล์
 * จากนั้นแก้ ADMIN_PIN ด้านล่าง กดบันทึก แล้วเรียกใช้ฟังก์ชัน setup
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
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = loadDb_();
    var result = null;
    if (body.action !== 'load') {
      result = BorrowCore.run(db, body.action, body.payload, { isAdmin: isAdmin });
      saveDb_(db);
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
    lock.releaseLock();
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

// ==================== Core (กฎการเบิก/ยืมและการตัดสต็อก) — จาก docs/core.js ====================

/*
 * BorrowCore — กฎการเบิกพัสดุและการตัดสต็อก
 * ไฟล์เดียวกันนี้ใช้ทั้งในเบราว์เซอร์ (โหมดทดลอง) และใน Google Apps Script (คัดลอกไปเป็น Core.gs)
 * ข้อมูลทั้งหมดอยู่ในอ็อบเจกต์ db = { items, requests, request_items, movements, departments, categories, suppliers, units, locations }
 */
var BorrowCore = (function () {
  // ระบบเบิกอย่างเดียว (ของออกจากคลังถาวร ไม่ต้องคืน) ใบเบิกทุกใบมีสถานะ "เบิกแล้ว"
  var STATUS = { issued: 'เบิกแล้ว' };
  var MOVE = { receive: 'รับเข้า', withdraw: 'เบิกจ่าย', adjust: 'ปรับปรุงยอด', lost: 'ชำรุด/สูญหาย', cancel: 'คืนจากใบเบิกที่ลบ' };

  // คอลัมน์ที่ระบบอ่าน/เขียน · ชีตเวอร์ชันก่อนที่มีคอลัมน์ของระบบยืม (total_qty, kind, due_date ฯลฯ) อ่านได้ ระบบข้ามคอลัมน์นั้นไป
  var TABLES = {
    // price = ราคาต่อ 1 หน่วยนับ (บาท)
    items: ['id', 'code', 'name', 'category', 'unit', 'available_qty', 'min_qty', 'location', 'active', 'price'],
    requests: ['id', 'request_no', 'borrower_name', 'phone', 'department', 'purpose', 'status', 'created_at', 'note'],
    // price = ราคาต่อหน่วย ณ วันที่เบิก (ราคาพัสดุเปลี่ยนภายหลัง ใบเบิกเดิมไม่เปลี่ยน)
    request_items: ['request_id', 'item_id', 'qty', 'price'],
    // รับเข้า: บริษัทผู้จำหน่าย วันหมดอายุ (YYYY-MM-DD) และเลขใบส่งของ ของล็อตนั้น
    // price = ราคาต่อหน่วยของล็อตที่รับเข้า (บาท) ใช้สรุปมูลค่ารับเข้า
    movements: ['id', 'created_at', 'item_id', 'type', 'qty', 'available_after', 'request_no', 'note', 'supplier', 'expiry_date', 'delivery_no', 'price'],
    departments: ['name', 'full_name'],
    categories: ['name'],
    suppliers: ['name'],
    units: ['name'],
    locations: ['name'],
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
            o[c] = c === 'price' ? money(r[c]) : NUMERIC.indexOf(c) >= 0 ? Number(r[c] || 0) : str(r[c]);
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
    });
    // ตัวเลือกหน่วยนับ / สถานที่เก็บ: แท็บยังว่าง (ชีตก่อนมีแท็บนี้) ตั้งจากค่าที่พัสดุใช้อยู่ บันทึกครั้งถัดไปจะลงชีตให้
    if (!db.units.length) addNames(db, 'units', DEFAULT_UNITS.concat(db.items.map(function (i) { return i.unit; })));
    if (!db.locations.length) addNames(db, 'locations', db.items.map(function (i) { return i.location; }));
    // ใบเบิกทุกใบ = เบิกแล้ว (ใบที่ค้างจากระบบยืมเดิมแสดงเป็นใบเบิกในประวัติ)
    db.requests.forEach(function (r) { r.status = 'issued'; });
    // คงเหลือติดลบได้ (เบิกของที่หมด = ค้างจ่าย) รับเข้าครั้งถัดไปจะหักล้างเอง
    return db;
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
      id: nextId(db.movements), created_at: stamp(ctx.now), item_id: item.id, type: o.type, qty: o.delta,
      available_after: available, request_no: o.request_no || '', note: str(o.note),
      supplier: str(o.supplier), expiry_date: str(o.expiry_date), delivery_no: str(o.delivery_no),
      price: o.type === 'receive' ? (o.price === undefined || str(o.price) === '' ? item.price || 0 : money(o.price, 'ราคาต่อหน่วย')) : 0,
    });
  }

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
  var ADMIN_ACTIONS = ['checkPin', 'saveItem', 'stock', 'addMaster', 'removeMaster', 'deleteRequest'];

  // ข้อมูลล็อตที่รับเข้า (ไม่บังคับ): บริษัท วันหมดอายุ เลขใบส่งของ
  function lot(p) {
    var expiry = str(p.expiry_date);
    if (expiry && !isDate(expiry)) fail('วันหมดอายุไม่ถูกต้อง กรุณาเลือกจากปฏิทิน');
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
        department: dept, purpose: str(p.purpose), status: 'issued', created_at: stamp(ctx.now), note: str(p.note),
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
      // หน่วยนับ / สถานที่เก็บใหม่ เพิ่มลงรายการตัวเลือกให้ด้วย
      addNames(db, 'units', [fields.unit]);
      addNames(db, 'locations', [fields.location]);
      var item;
      if (p.id) {
        item = byId(db.items, p.id) || fail('ไม่พบรายการพัสดุ');
        Object.keys(fields).forEach(function (k) { item[k] = fields[k]; });
      } else {
        item = fields;
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
        moveStock(db, ctx, withLot({ item_id: item.id, type: 'receive', delta: q, note: p.note, price: p.price }, p));
      } else if (p.type === 'lost') {
        q = int(p.qty, 'จำนวน', 1);
        moveStock(db, ctx, { item_id: item.id, type: 'lost', delta: -q, note: p.note });
      } else if (p.type === 'adjust') {
        var diff = int(p.counted_qty, 'ยอดที่นับได้') - item.available_qty;
        if (diff) moveStock(db, ctx, { item_id: item.id, type: 'adjust', delta: diff, note: p.note || 'ปรับยอดตามการตรวจนับ' });
      } else {
        fail('ประเภทการปรับสต็อกไม่ถูกต้อง');
      }
      return item.id;
    },

    // ลบใบเบิก (เจ้าหน้าที่): restock = คืนจำนวนพัสดุในใบนั้นเข้าสต็อก (บันทึกในประวัติสต็อกว่า "คืนจากใบเบิกที่ลบ")
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

    removeMaster: function (db, p) {
      var key = masterTable(p.table);
      db[key] = db[key].filter(function (r) { return r.name !== p.name; });
      return p.name;
    },
  };

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

  return { expiryAlerts: expiryAlerts, byId: byId, lines: lines, flowSummary: flowSummary, movePrice: movePrice, OPENING: OPENING, stockSummary: stockSummary, linePrice: linePrice, requestValue: requestValue, nextItemCode: nextItemCode, replaceStock: replaceStock, resetForLaunch: resetForLaunch, TABLES: TABLES, STATUS: STATUS, MOVE: MOVE, publicView: publicView, monthlySummary: monthlySummary, sheetData: sheetData, thaiStamp: thaiStamp, run: run, seed: seed, normalize: normalize, fieldOf: fieldOf, emptyDb: emptyDb, ymd: ymd };
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
