/**
 * ตัวเชื่อม Google Sheets สำหรับระบบเบิก-ยืมพัสดุ
 * วิธีติดตั้งอยู่ใน README.md หัวข้อ "ขั้นที่ 2: เชื่อม Google Sheets"
 *
 * ไฟล์ในโปรเจกต์ Apps Script ต้องมี 3 ไฟล์:
 *   Core.gs      = คัดลอกเนื้อหาทั้งหมดจาก docs/core.js
 *   SeedData.gs  = คัดลอกเนื้อหาทั้งหมดจาก docs/seed-data.js (รายการพัสดุ/ยอดคงเหลือ และรายชื่อแผนกตั้งต้น)
 *   Code.gs      = ไฟล์นี้
 */

// *** เปลี่ยนรหัส PIN สำหรับเจ้าหน้าที่พัสดุ (ใช้รับคืน / จัดการสต็อก) ***
var ADMIN_PIN = '1234';

// ชื่อแท็บคงไว้ตามเวอร์ชันก่อน เพื่อให้ชีตที่ใช้งานอยู่แล้วอ่านต่อได้
var SHEET_NAMES = {
  items: 'อุปกรณ์',
  requests: 'คำขอยืม',
  request_items: 'รายการในคำขอ',
  movements: 'ประวัติสต็อก',
  departments: 'หน่วยงาน',
  categories: 'หมวดหมู่',
};

/**
 * รันจากหน้า Apps Script เพื่อสร้างแท็บและใส่รายการพัสดุ/แผนกจาก SeedData
 * รันซ้ำได้จนกว่าจะเริ่มมีการเบิก/ยืมจริง (จะเขียนทับรายการพัสดุ แผนก และประวัติสต็อกทั้งหมด)
 */
function setup() {
  if (typeof SEED_DATA === 'undefined') throw new Error('ไม่พบไฟล์ SeedData กรุณาคัดลอก docs/seed-data.js มาเป็นไฟล์ SeedData ก่อน');
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAMES.requests);
  if (sh && sh.getLastRow() > 1) {
    throw new Error('มีรายการเบิก/ยืมในชีตแล้ว ไม่ได้เขียนทับ (ถ้าต้องการเริ่มใหม่ให้ลบแท็บ "' + SHEET_NAMES.requests + '" ก่อน)');
  }
  saveDb_(BorrowCore.seed(new Date(), SEED_DATA));
}

function doGet() {
  return handle_({ action: 'load' });
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
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = loadDb_();
    var result = null;
    if (body.action !== 'load') {
      result = BorrowCore.run(db, body.action, body.payload, { isAdmin: String(body.pin || '') === ADMIN_PIN });
      saveDb_(db);
    }
    return json_({ ok: true, result: result, state: db });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    lock.releaseLock();
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function loadDb_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tz = ss.getSpreadsheetTimeZone();
  var db = BorrowCore.emptyDb();
  Object.keys(BorrowCore.TABLES).forEach(function (t) {
    var sh = ss.getSheetByName(SHEET_NAMES[t]);
    if (!sh || sh.getLastRow() < 2) return;
    var values = sh.getDataRange().getValues();
    var header = values.shift();
    db[t] = values.map(function (row) {
      var o = {};
      header.forEach(function (h, i) {
        var v = row[i];
        // ถ้ามีคนพิมพ์วันที่ลงในชีตเอง Sheets จะแปลงเป็น Date ให้แปลงกลับเป็นข้อความ
        if (v instanceof Date) v = Utilities.formatDate(v, tz, h === 'created_at' || /_at$/.test(h) ? 'yyyy-MM-dd HH:mm' : 'yyyy-MM-dd');
        o[h] = v;
      });
      return o;
    });
  });
  return BorrowCore.normalize(db);
}

function saveDb_(db) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(BorrowCore.TABLES).forEach(function (t) {
    var cols = BorrowCore.TABLES[t];
    var sh = ss.getSheetByName(SHEET_NAMES[t]) || ss.insertSheet(SHEET_NAMES[t]);
    var rows = [cols].concat(db[t].map(function (r) { return cols.map(function (c) { return r[c] === undefined ? '' : r[c]; }); }));
    sh.clearContents();
    var range = sh.getRange(1, 1, rows.length, cols.length);
    range.setNumberFormat('@'); // เก็บเป็นข้อความ ป้องกัน Sheets แปลงวันที่/รหัสเอง
    range.setValues(rows.map(function (r) { return r.map(String); }));
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, cols.length).setFontWeight('bold');
  });
}
