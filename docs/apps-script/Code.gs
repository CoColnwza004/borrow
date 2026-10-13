/**
 * ตัวเชื่อม Google Sheets สำหรับระบบเบิก-ยืมพัสดุ
 * วิธีติดตั้งอยู่ใน README.md หัวข้อ "ขั้นที่ 2: เชื่อม Google Sheets"
 *
 * วิธีง่ายสุด: วาง docs/apps-script/AllInOne.gs (รวมทุกไฟล์ไว้แล้ว) ลงใน Code.gs ไฟล์เดียว
 * หรือแยกเป็น 3 ไฟล์:
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
  // 2 แท็บนี้สร้างใหม่ทุกครั้ง ไว้ดูอย่างเดียว ระบบไม่อ่านกลับ (สร้างครั้งแรกจะย้ายไปไว้หน้าสุด)
  log: 'รายการเบิก-ยืม',
  on_loan: 'พัสดุที่ถูกยืมอยู่',
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
  installDailyTrigger();
}

/**
 * ตั้งเวลาให้ระบบคืนพัสดุที่ถึงวันคืนเข้าสต็อกอัตโนมัติทุกวัน (ประมาณ 00:00–01:00 ตามเขตเวลาของโปรเจกต์)
 * setup() เรียกให้แล้ว ถ้าติดตั้งไว้ก่อนหน้านี้ ให้รันฟังก์ชันนี้ 1 ครั้ง (รันซ้ำได้ ไม่สร้างซ้อน)
 */
function installDailyTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoReturnDaily') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('autoReturnDaily').timeBased().everyDays(1).atHour(0).nearMinute(5).create();
}

/** ทำงานอัตโนมัติทุกวันจาก installDailyTrigger() */
function autoReturnDaily() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = loadDb_();
    if (BorrowCore.autoReturnDue(db, new Date())) saveDb_(db);
  } finally {
    lock.releaseLock();
  }
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
    var isAdmin = String(body.pin || '') === ADMIN_PIN;
    var result = null;
    // เผื่อ trigger รายวันยังไม่ได้ติดตั้ง/ยังไม่ทำงาน: ตรวจใบยืมที่ถึงวันคืนทุกครั้งที่มีคนใช้เว็บ
    var autoReturned = BorrowCore.autoReturnDue(db, new Date());
    if (body.action !== 'load') {
      result = BorrowCore.run(db, body.action, body.payload, { isAdmin: isAdmin });
    }
    if (body.action !== 'load' || autoReturned) saveDb_(db);
    // ประวัติการเบิก-ยืมส่งให้เฉพาะเจ้าหน้าที่ (มี PIN) ผู้ใช้ทั่วไปได้เฉพาะสต็อกและใบที่เพิ่งส่ง
    var state = isAdmin ? db : BorrowCore.publicView(db, body.action === 'createRequest' ? result : 0);
    return json_({ ok: true, result: result, state: state });
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
  var data = BorrowCore.sheetData(db);
  Object.keys(data).forEach(function (t) {
    var d = data[t];
    var sh = ss.getSheetByName(SHEET_NAMES[t]);
    if (!sh) {
      sh = ss.insertSheet(SHEET_NAMES[t]);
      var front = { log: 1, on_loan: 2 };
      if (front[t]) { ss.setActiveSheet(sh); ss.moveActiveSheet(front[t]); }
    }
    var rows = [d.header].concat(d.rows);
    var n = d.header.length;
    sh.clearContents();
    var range = sh.getRange(1, 1, rows.length, n);
    range.setNumberFormat('@'); // เก็บเป็นข้อความ ป้องกัน Sheets แปลงวันที่/รหัสเอง
    range.setValues(rows.map(function (r) { return r.map(String); }));
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground(null);
    // คอลัมน์ภาษาไทยที่ระบบเขียนให้อัตโนมัติ (แก้ในชีตไม่มีผล) ทำหัวคอลัมน์สีฟ้าอ่อนไว้
    if (d.extra) sh.getRange(1, n - d.extra + 1, 1, d.extra).setBackground('#e8f0fe');
  });
}
