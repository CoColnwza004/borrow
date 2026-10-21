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
  requests: 'ประวัติการเบิก',
  request_items: 'รายการในคำขอ',
  movements: 'ประวัติสต็อก',
  departments: 'หน่วยงาน',
  categories: 'หมวดหมู่',
  // 2 แท็บนี้สร้างใหม่ทุกครั้ง ไว้ดูอย่างเดียว ระบบไม่อ่านกลับ (สร้างครั้งแรกจะย้ายไปไว้หน้าสุด)
  log: 'รายการเบิก-ยืม',
  on_loan: 'พัสดุที่ถูกยืมอยู่',
};

// ชื่อแท็บเดิม: ชีตที่ใช้งานอยู่แล้วจะถูกเปลี่ยนชื่อให้อัตโนมัติ (ข้อมูลเดิมอยู่ครบ)
var LEGACY_NAMES = { requests: ['คำขอยืม'] };

function sheet_(ss, t) {
  var sh = ss.getSheetByName(SHEET_NAMES[t]);
  if (sh) return sh;
  var old = (LEGACY_NAMES[t] || []).map(function (n) { return ss.getSheetByName(n); }).filter(Boolean)[0];
  if (old) old.setName(SHEET_NAMES[t]);
  return old || null;
}

/**
 * รันจากหน้า Apps Script เพื่อสร้างแท็บและใส่รายการพัสดุ/แผนกจาก SeedData
 * รันซ้ำได้จนกว่าจะเริ่มมีการเบิก/ยืมจริง (จะเขียนทับรายการพัสดุ แผนก และประวัติสต็อกทั้งหมด)
 */
function setup() {
  if (typeof SEED_DATA === 'undefined') throw new Error('ไม่พบไฟล์ SeedData กรุณาคัดลอก docs/seed-data.js มาเป็นไฟล์ SeedData ก่อน');
  var sh = sheet_(SpreadsheetApp.getActiveSpreadsheet(), 'requests');
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

/**
 * ก่อนเปิดใช้งานจริง: รันฟังก์ชันนี้ 1 ครั้งจากหน้า Apps Script (เลือก resetForLaunch แล้วกด เรียกใช้)
 * ล้างประวัติการเบิก/ยืม รายการในคำขอ และประวัติสต็อกทั้งหมด แล้วตั้งยอดคงเหลือทุกรายการเป็น 0
 * รายชื่อพัสดุ รายชื่อแผนก และหมวดหมู่อยู่ครบ · ถ้ารันผิด ย้อนกลับได้ที่ Google Sheet → ไฟล์ → ประวัติเวอร์ชัน
 */
function resetForLaunch() {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = loadDb_();
    var n = BorrowCore.resetForLaunch(db);
    saveDb_(db);
    Logger.log('รีเซ็ตเรียบร้อย: ลบใบเบิก/ยืม ' + n.requests + ' ใบ, ประวัติสต็อก ' + n.movements + ' รายการ, ตั้งยอด ' +
      db.items.length + ' รายการเป็น 0 (เก็บแผนก ' + db.departments.length + ' แผนกไว้)');
  } finally {
    lock.releaseLock();
  }
}

/**
 * ล้างสต็อกเดิมทั้งหมด แล้วใส่รายการพัสดุและยอดคงเหลือตามไฟล์ Stock ล่าสุด (SEED_DATA ในไฟล์นี้)
 * รัน 1 ครั้งจากหน้า Apps Script (เลือก loadNewStock แล้วกด เรียกใช้)
 * ล้างประวัติการเบิก/ยืมและประวัติสต็อกด้วย · รายชื่อแผนกอยู่ครบ · ย้อนกลับได้ที่ ไฟล์ → ประวัติเวอร์ชัน
 */
function loadNewStock() {
  if (typeof SEED_DATA === 'undefined') throw new Error('ไม่พบข้อมูล SEED_DATA กรุณาวางไฟล์ AllInOne.gs ให้ครบทั้งไฟล์');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var db = loadDb_();
    var before = BorrowCore.replaceStock(db, SEED_DATA, new Date());
    saveDb_(db);
    Logger.log('ใส่สต็อกใหม่เรียบร้อย: ' + db.items.length + ' รายการ (เดิม ' + before.items + ' รายการ, ลบใบเบิก/ยืม ' + before.requests +
      ' ใบ) จาก ' + SEED_DATA.source + ' · แผนก ' + db.departments.length + ' แผนกอยู่ครบ');
  } finally {
    lock.releaseLock();
  }
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
    var n = d.header.length;
    var rows = [d.header].concat(d.rows).map(function (r) { return r.map(String); });
    var sh = sheet_(ss, t);
    var cur = null;
    if (!sh) {
      sh = ss.insertSheet(SHEET_NAMES[t]);
      var front = { log: 1, on_loan: 2 };
      if (front[t]) { ss.setActiveSheet(sh); ss.moveActiveSheet(front[t]); }
    } else {
      cur = RAW_[t] || sh.getDataRange().getValues().map(function (r) { return r.map(String); });
      if (JSON.stringify(cur) === JSON.stringify(rows)) return; // แท็บนี้ไม่มีอะไรเปลี่ยน
    }
    // ล้างเฉพาะเมื่อข้อมูลเดิมยาว/กว้างกว่าของใหม่ (ไม่งั้นเขียนทับได้เลย)
    if (cur && (cur.length > rows.length || (cur[0] || []).length > n)) sh.clearContents();
    var range = sh.getRange(1, 1, rows.length, n);
    range.setNumberFormat('@'); // เก็บเป็นข้อความ ป้องกัน Sheets แปลงวันที่/รหัสเอง
    range.setValues(rows);
    // จัดหัวตารางเฉพาะแท็บใหม่ หรือเมื่อหัวคอลัมน์เปลี่ยน
    if (!cur || JSON.stringify(cur[0]) !== JSON.stringify(rows[0])) {
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, n).setFontWeight('bold').setBackground(null).setFontColor(null);
      // คอลัมน์ภาษาไทยที่ระบบเขียนให้อัตโนมัติ (แก้ในชีตไม่มีผล) ทำหัวคอลัมน์สีฟ้าอ่อนไว้
      if (d.extra) sh.getRange(1, n - d.extra + 1, 1, d.extra).setBackground('#e8f0fe');
      if (d.front) formatReadable_(sh, d, rows.length);
    }
  });
}
