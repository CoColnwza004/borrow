/**
 * ระบบเบิก-ยืมพัสดุ — ไฟล์รวมสำหรับ Google Apps Script (ไฟล์เดียวจบ)
 * ไฟล์นี้สร้างอัตโนมัติด้วย npm run build:gs ห้ามแก้ตรงนี้ ให้แก้ไฟล์ต้นฉบับใน docs/ แล้ว build ใหม่
 *
 * วิธีใช้: ใน Apps Script ให้มีไฟล์ Code.gs ไฟล์เดียว ลบเนื้อหาเดิมทั้งหมด แล้ววางไฟล์นี้ทั้งไฟล์
 * จากนั้นแก้ ADMIN_PIN ด้านล่าง กดบันทึก แล้วเรียกใช้ฟังก์ชัน setup
 */

// ==================== Code.gs (ตัวเชื่อม Google Sheets — แก้ ADMIN_PIN ได้ที่นี่) ====================

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

// ==================== Core (กฎการเบิก/ยืมและการตัดสต็อก) — จาก docs/core.js ====================

/*
 * BorrowCore — กฎการเบิก/ยืม-คืนพัสดุและการตัดสต็อก
 * ไฟล์เดียวกันนี้ใช้ทั้งในเบราว์เซอร์ (โหมดทดลอง) และใน Google Apps Script (คัดลอกไปเป็น Core.gs)
 * ข้อมูลทั้งหมดอยู่ในอ็อบเจกต์ db = { items, requests, request_items, movements, departments, categories }
 */
var BorrowCore = (function () {
  var STATUS = { issued: 'เบิกแล้ว', pending: 'รออนุมัติ', borrowed: 'กำลังยืม', returned: 'คืนแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก' };
  var MOVE = { receive: 'รับเข้า', withdraw: 'เบิกจ่าย', borrow: 'ยืมออก', return: 'รับคืน', adjust: 'ปรับปรุงยอด', lost: 'ชำรุด/สูญหาย' };
  // ประเภทคำขอ: เบิก = ของออกจากคลังถาวร ไม่ต้องคืน / ยืม = ต้องคืนตามกำหนด
  var TYPES = { withdraw: 'เบิก', borrow: 'ยืม' };
  // พัสดุแต่ละรายการให้ใช้กับคำขอประเภทใดได้บ้าง
  var KINDS = { withdraw: 'เบิกได้อย่างเดียว', borrow: 'ยืมได้อย่างเดียว', both: 'เบิกและยืมได้' };

  var TABLES = {
    items: ['id', 'code', 'name', 'category', 'unit', 'total_qty', 'available_qty', 'min_qty', 'location', 'active', 'kind'],
    requests: ['id', 'request_no', 'borrower_name', 'phone', 'department', 'purpose', 'borrow_date', 'due_date',
      'status', 'created_at', 'approved_at', 'returned_at', 'note', 'type'],
    request_items: ['request_id', 'item_id', 'qty', 'returned_qty', 'lost_qty'],
    movements: ['id', 'created_at', 'item_id', 'type', 'qty', 'available_after', 'total_after', 'request_no', 'note'],
    departments: ['name', 'full_name'],
    categories: ['name'],
  };
  // หัวคอลัมน์ภาษาไทยในแท็บประวัติการเบิก ที่เป็นข้อมูลจริง (อ่านกลับเข้าระบบ)
  var LABELS = { requests: { request_no: 'เลขที่', borrower_name: 'ผู้เบิก/ผู้ยืม', department: 'แผนก', note: 'หมายเหตุ' } };
  function fieldOf(table, header) {
    var m = LABELS[table];
    if (m) for (var k in m) if (m[k] === header) return k;
    return header;
  }
  var NUMERIC = ['id', 'total_qty', 'available_qty', 'min_qty', 'active', 'request_id', 'item_id', 'qty', 'returned_qty', 'lost_qty',
    'available_after', 'total_after'];

  function fail(msg) { throw new Error(msg); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function stamp(d) { return ymd(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
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
  function find(rows, pred) { for (var i = 0; i < rows.length; i++) if (pred(rows[i])) return rows[i]; return null; }
  function byId(rows, id) { id = Number(id); return find(rows, function (r) { return r.id === id; }); }

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
            o[c] = NUMERIC.indexOf(c) >= 0 ? Number(r[c] || 0) : str(r[c]);
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
      if (!i.name) i.name = i.code || 'พัสดุ #' + i.id;
      if (!i.unit) i.unit = 'ชิ้น';
    });
    // ชีตเวอร์ชันก่อนไม่มีคอลัมน์ kind / type
    db.items.forEach(function (i) { if (!KINDS[i.kind]) i.kind = 'both'; });
    db.requests.forEach(function (r) { if (!TYPES[r.type]) r.type = 'borrow'; });
    // จำนวนทั้งหมด = คงเหลือ + ที่ถูกยืมออกไปและยังไม่คืน คำนวณใหม่ทุกครั้ง
    // เพื่อให้แก้ "คงเหลือ" (available_qty) ในชีตได้โดยตรงคอลัมน์เดียว
    var lent = {};
    var open = {};
    db.requests.forEach(function (r) { if (r.status === 'borrowed') open[r.id] = true; });
    db.request_items.forEach(function (l) {
      if (open[l.request_id]) lent[l.item_id] = (lent[l.item_id] || 0) + Math.max(0, l.qty - l.returned_qty - l.lost_qty);
    });
    // คงเหลือติดลบได้ (เบิกของที่หมด = ค้างจ่าย) รับเข้าครั้งถัดไปจะหักล้างเอง
    db.items.forEach(function (i) {
      i.total_qty = i.available_qty + (lent[i.id] || 0);
    });
    return db;
  }

  function allows(item, type) { return item.kind === 'both' || item.kind === type; }

  function moveStock(db, ctx, o) {
    var item = byId(db.items, o.item_id) || fail('ไม่พบรายการพัสดุ');
    var available = item.available_qty + o.available_delta;
    var total = item.total_qty + o.total_delta;
    // ห้ามลดจนติดลบ ยกเว้นการเบิก (allowNegative) ส่วนการรับเข้า/คืนเข้าสต็อกที่ติดลบอยู่ทำได้เสมอ
    if (!o.allowNegative && o.available_delta < 0 && available < 0) fail('"' + item.name + '" คงเหลือไม่พอ (คงเหลือ ' + item.available_qty + ' ' + item.unit + ')');
    if ((!o.allowNegative && o.total_delta < 0 && total < 0) || available > total) fail('ยอดสต็อกของ "' + item.name + '" ไม่ถูกต้องหลังปรับปรุง');
    item.available_qty = available;
    item.total_qty = total;
    db.movements.push({
      id: nextId(db.movements), created_at: stamp(ctx.now), item_id: item.id, type: o.type, qty: o.qty,
      available_after: available, total_after: total, request_no: o.request_no || '', note: str(o.note),
    });
  }

  function lines(db, requestId) {
    return db.request_items.filter(function (l) { return l.request_id === requestId; });
  }

  var ADMIN_ACTIONS = ['checkPin', 'approve', 'reject', 'returnItems', 'saveItem', 'stock', 'addMaster', 'removeMaster'];

  var actions = {
    checkPin: function () { return true; },

    // ส่งฟอร์มเบิก/ยืม: ตัดสต็อกทันที ไม่ต้องรออนุมัติ
    createRequest: function (db, p, ctx) {
      var type = TYPES[p.type] ? p.type : fail('กรุณาเลือกประเภท เบิก หรือ ยืม');
      var name = req(p.borrower_name, 'ชื่อผู้' + TYPES[type]);
      var dept = req(p.department, 'แผนก');
      if (!find(db.departments, function (d) { return d.name === dept; })) fail('กรุณาเลือกแผนกจากรายการ');
      var today = ymd(ctx.now);
      var due = '';
      if (type === 'borrow') {
        if (!isDate(p.due_date)) fail('กรุณาระบุวันคืน');
        // ถึงวันคืนระบบจะคืนเข้าสต็อกอัตโนมัติ จึงต้องคืนวันพรุ่งนี้เป็นอย่างเร็ว
        if (p.due_date <= today) fail('วันคืนต้องเป็นวันพรุ่งนี้หรือหลังจากนั้น');
        due = p.due_date;
      }
      if (!p.items || !p.items.length) fail('กรุณาเลือกพัสดุอย่างน้อย 1 รายการ');
      var merged = {};
      p.items.forEach(function (l) {
        var id = int(l.item_id, 'รหัสพัสดุ', 1);
        merged[id] = (merged[id] || 0) + int(l.qty, 'จำนวน', 1);
      });
      Object.keys(merged).forEach(function (id) {
        var item = byId(db.items, id);
        if (!item || !item.active) fail('มีพัสดุที่ไม่พบหรือถูกปิดใช้งาน');
        if (!allows(item, type)) fail('"' + item.name + '" ' + KINDS[item.kind]);
        // เบิกได้แม้ของหมด (ยอดติดลบ) ส่วนการยืมต้องมีของจริง
        if (type === 'borrow' && merged[id] > item.available_qty) {
          fail('"' + item.name + '" คงเหลือไม่พอ (ขอ ' + merged[id] + ', คงเหลือ ' + item.available_qty + ' ' + item.unit + ')');
        }
      });
      // เลขที่เอกสาร เช่น WD69-001 = ประเภท + ปี พ.ศ. 2 หลัก + ลำดับในปีนั้น (เกิน 999 เป็น 4 หลักอัตโนมัติ)
      var be = String(ctx.now.getFullYear() + 543).slice(2);
      var prefix = (type === 'withdraw' ? 'WD' : 'BR') + be + '-';
      var seq = 0;
      db.requests.forEach(function (r) {
        if (r.request_no.indexOf(prefix) === 0) seq = Math.max(seq, Number(r.request_no.slice(prefix.length)));
      });
      var r = {
        id: nextId(db.requests), request_no: prefix + (seq + 1 < 1000 ? ('00' + (seq + 1)).slice(-3) : String(seq + 1)), borrower_name: name, phone: str(p.phone),
        department: dept, purpose: str(p.purpose), borrow_date: today, due_date: due,
        status: type === 'withdraw' ? 'issued' : 'borrowed', created_at: stamp(ctx.now), approved_at: stamp(ctx.now),
        returned_at: '', note: str(p.note), type: type,
      };
      db.requests.push(r);
      Object.keys(merged).forEach(function (id) {
        var q = merged[id];
        db.request_items.push({ request_id: r.id, item_id: Number(id), qty: q, returned_qty: 0, lost_qty: 0 });
        moveStock(db, ctx, type === 'withdraw'
          ? { item_id: id, type: 'withdraw', available_delta: -q, total_delta: -q, qty: -q, request_no: r.request_no, allowNegative: true }
          : { item_id: id, type: 'borrow', available_delta: -q, total_delta: 0, qty: -q, request_no: r.request_no });
      });
      return r.id;
    },

    // approve / reject / cancelRequest ใช้กับคำขอ "รออนุมัติ" ที่ค้างจากระบบเวอร์ชันก่อน
    cancelRequest: function (db, p) {
      var r = byId(db.requests, p.id) || fail('ไม่พบคำขอยืม');
      if (r.status !== 'pending') fail('ยกเลิกได้เฉพาะคำขอที่รออนุมัติ');
      r.status = 'cancelled';
      return r.id;
    },

    approve: function (db, p, ctx) {
      var r = byId(db.requests, p.id) || fail('ไม่พบคำขอยืม');
      if (r.status !== 'pending') fail('คำขอนี้ไม่อยู่ในสถานะรออนุมัติ');
      lines(db, r.id).forEach(function (l) {
        moveStock(db, ctx, { item_id: l.item_id, type: 'borrow', available_delta: -l.qty, total_delta: 0, qty: -l.qty, request_no: r.request_no });
      });
      r.status = 'borrowed';
      r.approved_at = stamp(ctx.now);
      return r.id;
    },

    reject: function (db, p, ctx) {
      var r = byId(db.requests, p.id) || fail('ไม่พบคำขอยืม');
      if (r.status !== 'pending') fail('ไม่สามารถปฏิเสธคำขอนี้ได้');
      r.status = 'rejected';
      r.approved_at = stamp(ctx.now);
      if (str(p.note)) r.note = str(p.note);
      return r.id;
    },

    // คืนบางส่วนได้: items = [{ item_id, returned_qty, lost_qty }]
    returnItems: function (db, p, ctx) {
      var r = byId(db.requests, p.id) || fail('ไม่พบคำขอยืม');
      if (r.status !== 'borrowed') fail('คำขอนี้ไม่อยู่ในสถานะกำลังยืม');
      var touched = false;
      (p.items || []).forEach(function (x) {
        var l = find(lines(db, r.id), function (l) { return l.item_id === Number(x.item_id); }) || fail('มีพัสดุที่ไม่อยู่ในคำขอนี้');
        var ret = int(x.returned_qty || 0, 'จำนวนที่คืน');
        var lost = int(x.lost_qty || 0, 'จำนวนชำรุด/สูญหาย');
        if (ret + lost === 0) return;
        var outstanding = l.qty - l.returned_qty - l.lost_qty;
        if (ret + lost > outstanding) fail('จำนวนคืนเกินจำนวนค้างคืน (ค้าง ' + outstanding + ')');
        if (ret) moveStock(db, ctx, { item_id: l.item_id, type: 'return', available_delta: ret, total_delta: 0, qty: ret, request_no: r.request_no });
        if (lost) moveStock(db, ctx, { item_id: l.item_id, type: 'lost', available_delta: 0, total_delta: -lost, qty: -lost, request_no: r.request_no, note: p.note });
        l.returned_qty += ret;
        l.lost_qty += lost;
        touched = true;
      });
      if (!touched) fail('กรุณาระบุจำนวนที่คืน');
      var remaining = lines(db, r.id).reduce(function (s, l) { return s + l.qty - l.returned_qty - l.lost_qty; }, 0);
      if (remaining === 0) { r.status = 'returned'; r.returned_at = stamp(ctx.now); }
      return r.id;
    },

    saveItem: function (db, p, ctx) {
      var code = req(p.code, 'รหัสพัสดุ');
      var dup = find(db.items, function (i) { return i.code === code && i.id !== Number(p.id || 0); });
      if (dup) fail('รหัสพัสดุนี้มีอยู่แล้ว');
      var fields = {
        code: code, name: req(p.name, 'ชื่อพัสดุ'), category: str(p.category), unit: str(p.unit) || 'ชิ้น',
        min_qty: int(p.min_qty || 0, 'จุดสั่งซื้อขั้นต่ำ'), location: str(p.location), active: p.active === false ? 0 : 1,
        kind: KINDS[p.kind] ? p.kind : 'both',
      };
      var item;
      if (p.id) {
        item = byId(db.items, p.id) || fail('ไม่พบรายการพัสดุ');
        Object.keys(fields).forEach(function (k) { item[k] = fields[k]; });
      } else {
        item = fields;
        item.id = nextId(db.items);
        item.total_qty = 0;
        item.available_qty = 0;
        db.items.push(item);
        var qty = int(p.initial_qty || 0, 'จำนวนเริ่มต้น');
        if (qty) moveStock(db, ctx, { item_id: item.id, type: 'receive', available_delta: qty, total_delta: qty, qty: qty, note: 'ยอดยกมาเริ่มต้น' });
      }
      return item.id;
    },

    // type: receive (รับเข้า) | lost (ตัดชำรุด) | adjust (ระบุยอดที่นับได้จริง)
    stock: function (db, p, ctx) {
      var item = byId(db.items, p.item_id) || fail('ไม่พบรายการพัสดุ');
      var q;
      if (p.type === 'receive') {
        q = int(p.qty, 'จำนวน', 1);
        moveStock(db, ctx, { item_id: item.id, type: 'receive', available_delta: q, total_delta: q, qty: q, note: p.note });
      } else if (p.type === 'lost') {
        q = int(p.qty, 'จำนวน', 1);
        moveStock(db, ctx, { item_id: item.id, type: 'lost', available_delta: -q, total_delta: -q, qty: -q, note: p.note });
      } else if (p.type === 'adjust') {
        var diff = int(p.counted_qty, 'ยอดที่นับได้') - item.available_qty;
        if (diff) moveStock(db, ctx, { item_id: item.id, type: 'adjust', available_delta: diff, total_delta: diff, qty: diff, note: p.note || 'ปรับยอดตามการตรวจนับ' });
      } else {
        fail('ประเภทการปรับสต็อกไม่ถูกต้อง');
      }
      return item.id;
    },

    addMaster: function (db, p) {
      var table = p.table === 'categories' ? db.categories : db.departments;
      var name = req(p.name, 'ชื่อ');
      if (find(table, function (r) { return r.name === name; })) fail('มีชื่อนี้อยู่แล้ว');
      table.push(p.table === 'categories' ? { name: name } : { name: name, full_name: str(p.full_name) });
      return name;
    },

    removeMaster: function (db, p) {
      var key = p.table === 'categories' ? 'categories' : 'departments';
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

  var AUTO_RETURN_NOTE = 'คืนอัตโนมัติเมื่อถึงวันคืน';

  // ถึงวันคืน (ตั้งแต่ 00:00 ของวันคืน) → คืนพัสดุที่ยังค้างเข้าสต็อกอัตโนมัติ ไม่ว่าคืนของจริงแล้วหรือยัง
  // คืนค่าจำนวนใบยืมที่ถูกปิด (0 = ไม่มีอะไรเปลี่ยน)
  function autoReturnDue(db, now) {
    now = now || new Date();
    var today = ymd(now);
    var ctx = { now: now };
    var closed = 0;
    db.requests.forEach(function (r) {
      if (r.status !== 'borrowed' || !isDate(r.due_date) || r.due_date > today) return;
      lines(db, r.id).forEach(function (l) {
        var out = l.qty - l.returned_qty - l.lost_qty;
        if (out <= 0) return;
        moveStock(db, ctx, { item_id: l.item_id, type: 'return', available_delta: out, total_delta: 0, qty: out, request_no: r.request_no, note: AUTO_RETURN_NOTE });
        l.returned_qty += out;
      });
      r.status = 'returned';
      r.returned_at = stamp(now);
      r.note = r.note ? r.note + ' · ' + AUTO_RETURN_NOTE : AUTO_RETURN_NOTE;
      closed++;
    });
    return closed;
  }

  // ---------- ตารางสำหรับเขียนลง Google Sheets ----------
  // คอลัมน์ตาม TABLES (ระบบอ่านกลับ) + คอลัมน์ภาษาไทยต่อท้ายให้คนอ่านง่าย (ระบบไม่อ่านกลับ เขียนใหม่ทุกครั้ง)
  // และแท็บ on_loan = รายการพัสดุที่ถูกยืมอยู่ตอนนี้
  function sheetData(db) {
    var itemOf = function (id) { return byId(db.items, id) || { code: '', name: '(ลบแล้ว)', unit: '' }; };
    var reqOf = function (id) { return byId(db.requests, id) || { request_no: '', status: '' }; };
    var outstanding = function (l) { return reqOf(l.request_id).status === 'borrowed' ? l.qty - l.returned_qty - l.lost_qty : 0; };
    var lent = {};
    var withdrawn = {};
    db.request_items.forEach(function (l) {
      lent[l.item_id] = (lent[l.item_id] || 0) + outstanding(l);
      var r = reqOf(l.request_id);
      if (r.type === 'withdraw' && r.status === 'issued') withdrawn[l.item_id] = (withdrawn[l.item_id] || 0) + l.qty;
    });
    var extra = {
      items: [['ถูกยืมอยู่', function (i) { return lent[i.id] || 0; }], ['เบิกไปแล้วรวม', function (i) { return withdrawn[i.id] || 0; }]],
      requests: [
        ['ประเภท', function (r) { return TYPES[r.type] || ''; }],
        ['สถานะ', function (r) { return STATUS[r.status] || r.status; }],
        ['รายการพัสดุ', function (r) {
          return lines(db, r.id).map(function (l) { var it = itemOf(l.item_id); return it.name + ' ×' + l.qty + ' ' + it.unit; }).join(', ');
        }],
      ],
      request_items: [
        ['เลขที่', function (l) { return reqOf(l.request_id).request_no; }],
        ['รหัสพัสดุ', function (l) { return itemOf(l.item_id).code; }],
        ['ชื่อพัสดุ', function (l) { return itemOf(l.item_id).name; }],
        ['หน่วย', function (l) { return itemOf(l.item_id).unit; }],
        ['ค้างคืน', outstanding],
      ],
      movements: [
        ['รายการ', function (m) { return MOVE[m.type] || m.type; }],
        ['รหัสพัสดุ', function (m) { return itemOf(m.item_id).code; }],
        ['ชื่อพัสดุ', function (m) { return itemOf(m.item_id).name; }],
      ],
    };
    // วันที่แบบไทยสำหรับคนอ่าน เช่น 12/10/2569 09:15
    var thaiStamp = function (v) {
      var m = /^(\d{4})-(\d{2})-(\d{2})(?: (\d{2}:\d{2}))?/.exec(v || '');
      return m ? Number(m[3]) + '/' + Number(m[2]) + '/' + (Number(m[1]) + 543) + (m[4] ? ' ' + m[4] : '') : '';
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
      ['วันที่', function (r) { return thaiStamp(r.created_at); }],
      ['ประเภท', function (r) { return TYPES[r.type] || ''; }],
      [LABELS.requests.borrower_name, function (r) { return r.borrower_name; }],
      ['แผนก', function (r) { return r.department; }],
      ['รายการพัสดุ', function (r) {
        return lines(db, r.id).map(function (l) { var it = itemOf(l.item_id); return it.name + ' ×' + l.qty + ' ' + it.unit; }).join('\n');
      }],
      ['จำนวนรวม', function (r) { return lines(db, r.id).reduce(function (n, l) { return n + l.qty; }, 0); }],
      ['สถานะ', function (r) { return STATUS[r.status] || r.status; }],
      ['กำหนดคืน', function (r) { return r.type === 'borrow' ? thaiStamp(r.due_date) : ''; }],
      ['หมายเหตุ', function (r) { return r.note; }],
    ];
    var reqSys = TABLES.requests.filter(function (c) { return !LABELS.requests[c]; });
    out.requests = {
      header: reqFront.map(function (e) { return e[0]; }).concat(reqSys),
      front: reqFront.length, sys: reqSys.length, wide: 6,
      rows: db.requests.slice().sort(function (a, b) { return b.id - a.id; }).map(function (r) {
        return reqFront.map(function (e) { var v = e[1](r); return v === undefined ? '' : v; })
          .concat(reqSys.map(function (c) { return r[c] === undefined ? '' : r[c]; }));
      }),
    };
    var loans = [];
    db.requests.filter(function (r) { return r.status === 'borrowed'; })
      .sort(function (a, b) { return a.due_date.localeCompare(b.due_date) || a.id - b.id; })
      .forEach(function (r) {
        lines(db, r.id).forEach(function (l) {
          var q = l.qty - l.returned_qty - l.lost_qty;
          if (q <= 0) return;
          var it = itemOf(l.item_id);
          loans.push([r.request_no, thaiStamp(r.created_at), r.borrower_name, r.department, it.code, it.name, q, it.unit, thaiStamp(r.due_date)]);
        });
      });
    // แท็บ log: 1 แถวต่อพัสดุ 1 รายการ ล่าสุดอยู่บน อ่านง่าย ใช้กรอง/Pivot ในชีตได้
    var log = [];
    db.requests.slice().sort(function (a, b) { return b.id - a.id; }).forEach(function (r) {
      lines(db, r.id).forEach(function (l) {
        var it = itemOf(l.item_id);
        var w = r.type === 'withdraw';
        log.push([thaiStamp(r.created_at), r.request_no, TYPES[r.type] || '', r.borrower_name, r.department,
          it.code, it.name, l.qty, it.unit, STATUS[r.status] || r.status,
          w ? '' : thaiStamp(r.due_date), w ? '' : l.returned_qty, w ? '' : outstanding(l)]);
      });
    });
    out.log = {
      header: ['วันที่', 'เลขที่', 'ประเภท', 'ผู้เบิก/ผู้ยืม', 'แผนก', 'รหัสพัสดุ', 'ชื่อพัสดุ', 'จำนวน', 'หน่วย', 'สถานะ', 'กำหนดคืน', 'คืนแล้ว', 'ยังไม่คืน'],
      extra: 13, rows: log,
    };
    out.on_loan = {
      header: ['เลขที่', 'วันที่ยืม', 'ผู้ยืม', 'แผนก', 'รหัสพัสดุ', 'ชื่อพัสดุ', 'จำนวนที่ยังไม่คืน', 'หน่วย', 'กำหนดคืน'],
      extra: 9, rows: loans,
    };
    return out;
  }

  // ข้อมูลที่ส่งให้ผู้ใช้ทั่วไป (ไม่มี PIN): สต็อก แผนก หมวดหมู่ และเฉพาะใบที่เพิ่งส่ง (ใช้ทำ PDF)
  // ประวัติการเบิก-ยืมทั้งหมด (ชื่อผู้ขอ ฯลฯ) ส่งให้เฉพาะเจ้าหน้าที่
  function publicView(db, keepRequestId) {
    var keep = Number(keepRequestId || 0);
    return {
      items: db.items, departments: db.departments, categories: db.categories,
      requests: db.requests.filter(function (r) { return r.id === keep; }),
      request_items: db.request_items.filter(function (l) { return l.request_id === keep; }),
      movements: [],
    };
  }

  // สรุปรายเดือน month = 'YYYY-MM' (นับใบที่ทำรายการในเดือนนั้น ไม่นับที่ยกเลิก/ไม่อนุมัติ/รออนุมัติ)
  function monthlySummary(db, month, today) {
    var COUNTED = { issued: 1, borrowed: 1, returned: 1 };
    var reqs = db.requests.filter(function (r) { return COUNTED[r.status] && r.created_at.slice(0, 7) === month; })
      .sort(function (a, b) { return a.id - b.id; });
    var t = { withdraw_docs: 0, withdraw_qty: 0, borrow_docs: 0, borrow_qty: 0, returned_qty: 0, lost_qty: 0, outstanding_qty: 0, overdue_docs: 0 };
    var withdrawn = {}, borrowed = {}, depts = {};
    function itemRow(map, id) {
      if (!map[id]) {
        var it = byId(db.items, id) || { code: '', name: '(ลบแล้ว)', unit: '' };
        map[id] = { item_id: id, code: it.code, name: it.name, unit: it.unit, qty: 0, times: 0, returned: 0, lost: 0, outstanding: 0 };
      }
      return map[id];
    }
    reqs.forEach(function (r) {
      var w = r.type === 'withdraw';
      var d = depts[r.department] || (depts[r.department] = { name: r.department, withdraw_docs: 0, withdraw_qty: 0, borrow_docs: 0, borrow_qty: 0 });
      var lines = db.request_items.filter(function (l) { return l.request_id === r.id; });
      var qty = lines.reduce(function (s, l) { return s + l.qty; }, 0);
      if (w) { t.withdraw_docs++; t.withdraw_qty += qty; d.withdraw_docs++; d.withdraw_qty += qty; }
      else {
        t.borrow_docs++; t.borrow_qty += qty; d.borrow_docs++; d.borrow_qty += qty;
        if (r.status === 'borrowed' && r.due_date && today && r.due_date < today) t.overdue_docs++;
      }
      lines.forEach(function (l) {
        var row = itemRow(w ? withdrawn : borrowed, l.item_id);
        row.qty += l.qty;
        row.times++;
        if (!w) {
          var out = r.status === 'borrowed' ? l.qty - l.returned_qty - l.lost_qty : 0;
          row.returned += l.returned_qty; row.lost += l.lost_qty; row.outstanding += out;
          t.returned_qty += l.returned_qty; t.lost_qty += l.lost_qty; t.outstanding_qty += out;
        }
      });
    });
    function values(map) { return Object.keys(map).map(function (k) { return map[k]; }); }
    var byQty = function (a, b) { return b.qty - a.qty || a.code.localeCompare(b.code); };
    return {
      month: month, totals: t, requests: reqs,
      withdrawn: values(withdrawn).sort(byQty),
      borrowed: values(borrowed).sort(byQty),
      departments: values(depts).sort(function (a, b) {
        return (b.withdraw_qty + b.borrow_qty) - (a.withdraw_qty + a.borrow_qty) || a.name.localeCompare(b.name);
      }),
    };
  }

  // สร้างฐานข้อมูลตั้งต้นจาก SEED_DATA (ไฟล์ seed-data.js / SeedData.gs)
  function seed(now, data) {
    if (!data) data = typeof SEED_DATA !== 'undefined' ? SEED_DATA : { departments: [], categories: [], items: [] };
    var db = emptyDb();
    data.departments.forEach(function (d) { db.departments.push({ name: d[0], full_name: d[1] || '' }); });
    data.categories.forEach(function (n) { db.categories.push({ name: n }); });
    var ctx = { now: now || new Date(), isAdmin: true };
    data.items.forEach(function (x) {
      run(db, 'saveItem', { code: x[0], name: x[1], category: x[2], unit: x[3], initial_qty: x[4], min_qty: x[5], location: x[6], kind: x[7] }, ctx);
    });
    return db;
  }

  // เริ่มใช้งานจริง: ล้างใบเบิก/ใบยืมและประวัติสต็อกทั้งหมด ตั้งยอดทุกรายการเป็น 0
  // เก็บรายชื่อพัสดุ (ชื่อ รหัส หน่วย หมวดหมู่ ที่เก็บ จุดเตือน) รายชื่อแผนก และหมวดหมู่ไว้เหมือนเดิม
  function resetForLaunch(db) {
    var cleared = { requests: db.requests.length, movements: db.movements.length };
    db.requests = [];
    db.request_items = [];
    db.movements = [];
    db.items.forEach(function (i) { i.available_qty = 0; i.total_qty = 0; });
    return cleared;
  }

  return { resetForLaunch: resetForLaunch, TABLES: TABLES, STATUS: STATUS, MOVE: MOVE, TYPES: TYPES, KINDS: KINDS, allows: allows, publicView: publicView, monthlySummary: monthlySummary, sheetData: sheetData, autoReturnDue: autoReturnDue, AUTO_RETURN_NOTE: AUTO_RETURN_NOTE, run: run, seed: seed, normalize: normalize, fieldOf: fieldOf, emptyDb: emptyDb, ymd: ymd };
})();

if (typeof module !== 'undefined') module.exports = BorrowCore;

// ==================== SeedData (รายการพัสดุและแผนกตั้งต้น) — จาก docs/seed-data.js ====================

/*
 * ข้อมูลตั้งต้นของระบบ (ใช้ตอนรัน setup() ใน Apps Script และในโหมดทดลอง)
 * - departments: [ชื่อย่อแผนก, ชื่อเต็ม]
 * - items: [รหัส, ชื่อพัสดุ, หมวดหมู่, หน่วย, คงเหลือ, จุดสั่งซื้อขั้นต่ำ, สถานที่เก็บ, ประเภท]
 *   คงเหลือ = คอลัมน์ "คงเหลือ" จาก stock NSO ณ วันที่ 8 เมษายน 2569 (ช่องว่าง = 0)
 *   จุดสั่งซื้อขั้นต่ำ = ปริมาณจ่าย 6 เดือน ÷ 6 (ปัดขึ้น) คือเตือนเมื่อเหลือไม่พอใช้ราว 1 เดือน
 *   ประเภท: withdraw = เบิกได้อย่างเดียว, borrow = ยืมได้อย่างเดียว, both = เบิกและยืมได้
 * ใน Apps Script ให้คัดลอกไฟล์นี้ไปเป็นไฟล์ชื่อ SeedData
 */
var SEED_DATA = {
  source: 'stock NSO ณ วันที่ 8 เมษายน 2569',
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
    ["NSO-001", "3 -ways", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 425, "คลัง NSO", "both"],
    ["NSO-002", "350 ml water humidifier", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 725, 200, "คลัง NSO", "both"],
    ["NSO-003", "7Fr,2.4mm(OD)Triple Lumen(set C-Line)(ICU,Anaes)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-004", "Airway 100mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 60, 7, "คลัง NSO", "both"],
    ["NSO-005", "Airway 40 mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 0, "คลัง NSO", "both"],
    ["NSO-006", "Airway 50 mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 49, 1, "คลัง NSO", "both"],
    ["NSO-007", "Airway 60 mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 2, "คลัง NSO", "both"],
    ["NSO-008", "Airway 70 mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 54, 1, "คลัง NSO", "both"],
    ["NSO-009", "Airway 80 mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 57, 12, "คลัง NSO", "both"],
    ["NSO-010", "Airway 90 mm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 72, 20, "คลัง NSO", "both"],
    ["NSO-011", "Alcohol Hand Rub gel 1000ml(ขวด)", "เวชภัณฑ์มิใช่ยา", "ขวด", 61, 14, "คลัง NSO", "both"],
    ["NSO-012", "Avagard bottle", "เวชภัณฑ์มิใช่ยา", "ขวด", 0, 1, "คลัง NSO", "both"],
    ["NSO-013", "Becterial Fillter(Heppa)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 200, 30, "คลัง NSO", "both"],
    ["NSO-014", "Becterial Fillter(HME)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 75, 25, "คลัง NSO", "both"],
    ["NSO-015", "Becterial Fillter(ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 46, "คลัง NSO", "both"],
    ["NSO-016", "Becterial Fillter Baby(ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 13, "คลัง NSO", "both"],
    ["NSO-017", "Bag Suction Liner (1500 ml)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-018", "Blade No10 (100ชิ้น/กล่อง)TR", "เวชภัณฑ์มิใช่ยา", "กล่อง", 5, 1, "คลัง NSO", "both"],
    ["NSO-019", "Blade No11 (100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 20, 3, "คลัง NSO", "both"],
    ["NSO-020", "Blade No 12 (100ชิ้น/กล่อง)( ห้องฟัน)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1, 1, "คลัง NSO", "both"],
    ["NSO-021", "Blade no 15 (100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 5, 1, "คลัง NSO", "both"],
    ["NSO-022", "Blade no 15c (100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 3, 1, "คลัง NSO", "both"],
    ["NSO-023", "Blade no21 (100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 8, 1, "คลัง NSO", "both"],
    ["NSO-024", "Bluribbon3x5cm (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-025", "BP print (ม้วน)", "เวชภัณฑ์มิใช่ยา", "ม้วน", 555, 42, "คลัง NSO", "both"],
    ["NSO-026", "Caps-CHG(ICU)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-027", "Carrifix 10*10cm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 110, 32, "คลัง NSO", "both"],
    ["NSO-028", "Carrifix 5*10cm", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 62, 17, "คลัง NSO", "both"],
    ["NSO-029", "CathereeplusRollNo.1010(1ม้วน/กล่อง10cm)(OR)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 3, 1, "คลัง NSO", "both"],
    ["NSO-030", "Chromic 2/0 C2037T (กล่อง) 1 โหล/กล่อง", "เวชภัณฑ์มิใช่ยา", "กล่อง", 15, 0, "คลัง NSO", "both"],
    ["NSO-031", "Chromic 1 c140G (1โหล/กล่อง", "เวชภัณฑ์มิใช่ยา", "กล่อง", 9, 2, "คลัง NSO", "both"],
    ["NSO-032", "Chromic 2/0 C2040T-90", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 0, "คลัง NSO", "both"],
    ["NSO-033", "Chromic 2/0C2026(1 โหล/1กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 29, 0, "คลัง NSO", "both"],
    ["NSO-034", "Chromic 4/0(C4017)17mm1/2round", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 2, 1, "คลัง NSO", "both"],
    ["NSO-035", "Chromic C3026 (กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 4, 1, "คลัง NSO", "both"],
    ["NSO-036", "Chronos ขนาด2.8*5.6mm (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1, "คลัง NSO", "both"],
    ["NSO-037", "Circruit Simple smooth bone (22mm)(ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1, "คลัง NSO", "both"],
    ["NSO-038", "Close suction (tycare exel cather) 10ชิ้น/กล่อง(ICU)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 150, 17, "คลัง NSO", "both"],
    ["NSO-039", "Clotest (prontro Dry)(OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 2, 0, "คลัง NSO", "both"],
    ["NSO-040", "Coban 1\"(5หลา)(30ม้วน/กล่อง)**", "เวชภัณฑ์มิใช่ยา", "กล่อง", 3, 0, "คลัง NSO", "both"],
    ["NSO-041", "Cord Clamp(100ชิ้น/กล่อง)( LR)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 3, 1, "คลัง NSO", "both"],
    ["NSO-042", "Cuff Bp Manaul เด็กโต (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 0, "คลัง NSO", "both"],
    ["NSO-043", "Cuff Manaul ผู้ใหญ่ (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 7, 0, "คลัง NSO", "both"],
    ["NSO-044", "Cuff BP อัตโนมัติเด็กโต (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 4, 2, "คลัง NSO", "both"],
    ["NSO-045", "Cuff BP อัตโนมัติเด็กเล็ก (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 1, "คลัง NSO", "both"],
    ["NSO-046", "Cuff BP อัตโนมัติผู้ใหญ๋ (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 5, "คลัง NSO", "both"],
    ["NSO-047", "Cuff BP อัตโนมัติ ยาวพิเศษ(ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 2, "คลัง NSO", "both"],
    ["NSO-048", "Cutting No 21 โค้ง3/8 (โหล)(ฟัน)", "เวชภัณฑ์มิใช่ยา", "โหล", 0, 0, "คลัง NSO", "both"],
    ["NSO-049", "Cutting No 24 โค้ง3/8 (โหล)**", "เวชภัณฑ์มิใช่ยา", "โหล", 2, 0, "คลัง NSO", "both"],
    ["NSO-050", "Cutting No 28 โค้ง3/8 (โหล)**", "เวชภัณฑ์มิใช่ยา", "โหล", 5, 0, "คลัง NSO", "both"],
    ["NSO-051", "Cutting No 32 โค้ง1/2(โหล)(ICU)", "เวชภัณฑ์มิใช่ยา", "โหล", 1, 1, "คลัง NSO", "both"],
    ["NSO-052", "Dafib Print(zoll)**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 25, 0, "คลัง NSO", "both"],
    ["NSO-053", "Defib Print Thermal 50*20**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 22, 0, "คลัง NSO", "both"],
    ["NSO-054", "Delta cut biopsy(Needle biopsy)(ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 90, 4, "คลัง NSO", "both"],
    ["NSO-055", "DetroFoam(สเปรย์โฟมทำความสะอาดเครื่อง..)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-056", "EKG Print (Mortara 250( OPD,W5,ICU)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 0, "คลัง NSO", "both"],
    ["NSO-057", "EKG Print EDAN( W5)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 4, 2, "คลัง NSO", "both"],
    ["NSO-058", "EKG Print PhillipM1709A**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 0, "คลัง NSO", "both"],
    ["NSO-059", "EKGprint mortoraELI230 (ม้วน)( ER W6)", "เวชภัณฑ์มิใช่ยา", "ม้วน", 50, 7, "คลัง NSO", "both"],
    ["NSO-060", "Eletric clipper (โปรดเฟรสชันแนลเบรด)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 1, "คลัง NSO", "both"],
    ["NSO-061", "Ethibond Excel No 2**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 2, 0, "คลัง NSO", "both"],
    ["NSO-062", "ETT No 5 /**NO Cuff (Safety clear)(ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 13, 1, "คลัง NSO", "both"],
    ["NSO-063", "ETT No 7 (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 25, 13, "คลัง NSO", "both"],
    ["NSO-064", "ETT No 8 (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 35, 3, "คลัง NSO", "both"],
    ["NSO-065", "Extension with T(100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1200, 667, "คลัง NSO", "both"],
    ["NSO-066", "Extension 18 นิ้ว (100ชิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 5600, 984, "คลัง NSO", "both"],
    ["NSO-067", "Extension 36 นิ้ว(100ขิ้น/กล่อง)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 300, 9, "คลัง NSO", "both"],
    ["NSO-068", "Face shield **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-069", "Fiber Wire No 2( OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1, "คลัง NSO", "both"],
    ["NSO-070", "Fiber Wire No 5( OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1, "คลัง NSO", "both"],
    ["NSO-071", "Foley 2 way no 10 balloon 5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 2, "คลัง NSO", "both"],
    ["NSO-072", "Foley 2 way no 14 balloon 10", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 160, 15, "คลัง NSO", "both"],
    ["NSO-073", "Foley 2 way no 16 balloon 10", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1380, 180, "คลัง NSO", "both"],
    ["NSO-074", "Foley 2 way no 18 ballloon 10", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 30, 14, "คลัง NSO", "both"],
    ["NSO-075", "Foley 2 way no 20 balloon 10", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 90, 7, "คลัง NSO", "both"],
    ["NSO-076", "Foley 2 way no 24 balloon 10", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 0, "คลัง NSO", "both"],
    ["NSO-077", "Foley 3 way no 16 balloon 30", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 80, 9, "คลัง NSO", "both"],
    ["NSO-078", "Foley 3 way no 18 ballloon 30", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 6, "คลัง NSO", "both"],
    ["NSO-079", "Foley 3way no 24 balloon 30", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 2, "คลัง NSO", "both"],
    ["NSO-080", "Foley 3หาง No20", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 0, "คลัง NSO", "both"],
    ["NSO-081", "Foley 2 way no 12 balloon 10", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-082", "Foley 2 way no 6( NICU)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-083", "Gauze 4x4 แถบ x ray 12 ชั้น C/S (Pack)( CSSD)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 52, 7, "คลัง NSO", "both"],
    ["NSO-084", "Gauze 4x4 แถบ x ray 8 ชั้น 100ชิ้น/Pack( CSSD)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 96, 0, "คลัง NSO", "both"],
    ["NSO-085", "Guide wire L (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 32, 2, "คลัง NSO", "both"],
    ["NSO-086", "Guide wire M (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 4, "คลัง NSO", "both"],
    ["NSO-087", "Guide wire S (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 15, 1, "คลัง NSO", "both"],
    ["NSO-088", "Heat Breathing Tube with MR290/Adualt( ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 49, 2, "คลัง NSO", "both"],
    ["NSO-089", "Infusion set (20ชิ้น/กล่อง)(W5,W6)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 820, 214, "คลัง NSO", "both"],
    ["NSO-090", "IOBAN 6640 10 pc (กล่อง) (OR)**", "เวชภัณฑ์มิใช่ยา", "กล่อง", 9, 0, "คลัง NSO", "both"],
    ["NSO-091", "IOBAN 2/0 6650 10 pc (กล่อง) กระดูก (OR)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 5, 1, "คลัง NSO", "both"],
    ["NSO-092", "IT26S (steam)class 5กล่อง(-/Pack)(CSSD)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 0, 13, "คลัง NSO", "both"],
    ["NSO-093", "J.S.E.T.Tube No 5 lot 4454680 No.cuff", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 35, 0, "คลัง NSO", "both"],
    ["NSO-094", "J.S.E.T.Tube No 5 lot 4454682 cuff", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 40, 1, "คลัง NSO", "both"],
    ["NSO-095", "jackson drain (400ml)silicone( OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 4, "คลัง NSO", "both"],
    ["NSO-096", "JS E.T. tube NO.2.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 2, "คลัง NSO", "both"],
    ["NSO-097", "JS E.T. tube NO.3.0", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 18, 2, "คลัง NSO", "both"],
    ["NSO-098", "JS E.T. tube NO.3.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 14, 6, "คลัง NSO", "both"],
    ["NSO-099", "JS E.T. tube NO.4", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 7, "คลัง NSO", "both"],
    ["NSO-100", "JS E.T. tube NO.4.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 7, 4, "คลัง NSO", "both"],
    ["NSO-101", "JS E.T. tube NO.6", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 64, 5, "คลัง NSO", "both"],
    ["NSO-102", "JS E.T. tube NO.6.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 15, 10, "คลัง NSO", "both"],
    ["NSO-103", "JS E.T. tube NO.7.", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 100, 9, "คลัง NSO", "both"],
    ["NSO-104", "JS E.T. tube NO.7.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 14, 50, "คลัง NSO", "both"],
    ["NSO-105", "JS E.T. tube NO.8", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 300, 4, "คลัง NSO", "both"],
    ["NSO-106", "JS E.T. tube NO.8.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 15, 0, "คลัง NSO", "both"],
    ["NSO-107", "JS Tube No 5.5", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 45, 1, "คลัง NSO", "both"],
    ["NSO-108", "Manipler (slaple) 6.9x4.2 mm. 6pc/pack(OR)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 18, 1, "คลัง NSO", "both"],
    ["NSO-109", "Monoplus V 1 HR40s (2โหล)**", "เวชภัณฑ์มิใช่ยา", "โหล", 1, 0, "คลัง NSO", "both"],
    ["NSO-110", "Monosyn No4/0 70cm GS60 เข็มตรง (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 1, "คลัง NSO", "both"],
    ["NSO-111", "Monosyn U4/0 70cm เข็มโค้ง**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 0, "คลัง NSO", "both"],
    ["NSO-112", "Mucus Extractor ชุดดูดเสมหะ", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 140, 24, "คลัง NSO", "both"],
    ["NSO-113", "Multrpore dry ขนาด 1/2\"", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 18, 2, "คลัง NSO", "both"],
    ["NSO-114", "NeodisherIR 1L.(น้ำยาขจัดสนิม)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-115", "Neodisher Lm2 1L.(น้ำยาล้างพิมพ์ฟัน)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-116", "Neodisher Mediklar 5L.(น้ำยาเคลือบเร่งแห้ง)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-117", "NorplantWI (60x70)(ไทเกอร์ 3ชิ้น/กล่อง)(ปฐมภูมิ)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 0, "คลัง NSO", "both"],
    ["NSO-118", "Novasorb Quick 2/0 37mm 1/2 TC(OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 12, 4, "คลัง NSO", "both"],
    ["NSO-119", "NST print (philllip M1911 A(LR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 36, 4, "คลัง NSO", "both"],
    ["NSO-120", "Nutribag", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1200, 134, "คลัง NSO", "both"],
    ["NSO-121", "Nutribag line", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1200, 134, "คลัง NSO", "both"],
    ["NSO-122", "Nylon 8/0(1โหล/กล่อง)**", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1, 0, "คลัง NSO", "both"],
    ["NSO-123", "Nylon 2/0 DS30 (กล่อง)1x36 (OR,ER)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 8, 1, "คลัง NSO", "both"],
    ["NSO-124", "Nylon 3/0 DS24 (กล่อง)1x36(OR,ER)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 2, 2, "คลัง NSO", "both"],
    ["NSO-125", "Nylon 4/0/0 DS19 (กล่อง)1x36(OR,ER)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 5, 3, "คลัง NSO", "both"],
    ["NSO-126", "Nylon 5/0 DS16 (กล่อง)1x36(OR,ER)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 17, 1, "คลัง NSO", "both"],
    ["NSO-127", "Nylon 6/0 DS16 (กล่อง)1x36(OR,ER)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 6, 1, "คลัง NSO", "both"],
    ["NSO-128", "Nylon no 0 (DS39)**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 2, 0, "คลัง NSO", "both"],
    ["NSO-129", "Nylon no 1 HS48**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 0, "คลัง NSO", "both"],
    ["NSO-130", "Optiflow Canular Junior Size L ม่วง (W5,W6)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 30, 4, "คลัง NSO", "both"],
    ["NSO-131", "Optiflow Canular Junior Size XL เขียว(W5,W6)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 40, 2, "คลัง NSO", "both"],
    ["NSO-132", "Optiflow Canular Junior Size เหลือง(W5,W6,LR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 4, "คลัง NSO", "both"],
    ["NSO-133", "Optiflow Canular Medium Size ผู้ใหญ่ (ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 9, "คลัง NSO", "both"],
    ["NSO-134", "Optilene mesh 15x15 cm (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 4, 1, "คลัง NSO", "both"],
    ["NSO-135", "Optiline 2/0 HR26(OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 2, 0, "คลัง NSO", "both"],
    ["NSO-136", "Oxicel Standard5x7.5cm(12ชิ้น/กล่อง) (OR)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 0, "คลัง NSO", "both"],
    ["NSO-137", "Oxygen Cannula Adult (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 94, 143, "คลัง NSO", "both"],
    ["NSO-138", "Oxygen Cannula Child (ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 45, 18, "คลัง NSO", "both"],
    ["NSO-139", "Oxygen Mask with Bag adult", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 75, "คลัง NSO", "both"],
    ["NSO-140", "Oxygen Mask with Bag Child", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 25, "คลัง NSO", "both"],
    ["NSO-141", "Oxygen tubing**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 18, 0, "คลัง NSO", "both"],
    ["NSO-142", "plate จี้ไฟฟ้า (ชิ้น) (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 200, 75, "คลัง NSO", "both"],
    ["NSO-143", "plate จี้ไฟฟ้า (เด็ก)(OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 5, "คลัง NSO", "both"],
    ["NSO-144", "polysorb 0 kv34 (ortho) (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 16, 1, "คลัง NSO", "both"],
    ["NSO-145", "polysorb 1 kv34 (1กล่อง/3โหล) (OR)", "เวชภัณฑ์มิใช่ยา", "โหล", 5, 2, "คลัง NSO", "both"],
    ["NSO-146", "polysorb 1 VIO 150cm. (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-147", "polysorb 2-0 V20(30ชิ้น/กล่อง)(sheet) (OR,Anaes)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 2, 1, "คลัง NSO", "both"],
    ["NSO-148", "polysarb 3/0 SL693 C14 (TR) (ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 7, 1, "คลัง NSO", "both"],
    ["NSO-149", "polysorb 4-0 C13 (1 กล่อง/3โหล) (OR)", "เวชภัณฑ์มิใช่ยา", "โหล", 0, 1, "คลัง NSO", "both"],
    ["NSO-150", "polysorb 6-0 Sl-1625g (1โหล/กล่อง) **", "เวชภัณฑ์มิใช่ยา", "กล่อง", 3, 0, "คลัง NSO", "both"],
    ["NSO-151", "polysorb No 1 GS24 (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1, 0, "คลัง NSO", "both"],
    ["NSO-152", "polysorb3--0 CV25(1กล่อง/3โหล) (OR)", "เวชภัณฑ์มิใช่ยา", "โหล", 6, 1, "คลัง NSO", "both"],
    ["NSO-153", "polysorb4-0CVF-23(round)1กล่อง/3โหล **", "เวชภัณฑ์มิใช่ยา", "โหล", 3, 0, "คลัง NSO", "both"],
    ["NSO-154", "Q bac Chlohexidedine Siap Gel 1000ml", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 51, 8, "คลัง NSO", "both"],
    ["NSO-155", "Radivac drain bottle 400ml (OR)", "เวชภัณฑ์มิใช่ยา", "ขวด", 5, 19, "คลัง NSO", "both"],
    ["NSO-156", "Radivac drain bottle 600ml (OR)", "เวชภัณฑ์มิใช่ยา", "ขวด", 6, 0, "คลัง NSO", "both"],
    ["NSO-157", "Red dot 2238 (Pack)(50ชิ้น/pack)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 83, 33, "คลัง NSO", "both"],
    ["NSO-158", "Reddot เด็ก 2248 (50ชิ้น/pack)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 37, 3, "คลัง NSO", "both"],
    ["NSO-159", "Reddot 2268 (เด็กเล็ก 1ห่อ/3ชิ้น)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-160", "Silicone flat perforated drain size 10-0 สาย (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 4, "คลัง NSO", "both"],
    ["NSO-161", "Silk no 1 **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 0, "คลัง NSO", "both"],
    ["NSO-162", "silk no 2/0", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 1, "คลัง NSO", "both"],
    ["NSO-163", "silk no 2/0 hr26 (กล่อง) ติดเข็ม", "เวชภัณฑ์มิใช่ยา", "กล่อง", 12, 1, "คลัง NSO", "both"],
    ["NSO-164", "silk no3/0 (กล่อง) 3โหล/กล่อง **", "เวชภัณฑ์มิใช่ยา", "กล่อง", 4, 0, "คลัง NSO", "both"],
    ["NSO-165", "silk no3/0 hr22 (กล่อง) ติดเข็ม (OR,ICU)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 7, 1, "คลัง NSO", "both"],
    ["NSO-166", "silk no4/0 (กล่อง) (3โหล/กล่อง) **", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1, 0, "คลัง NSO", "both"],
    ["NSO-167", "silk no4/0 hr17 (กล่อง) ติดเข็ม**", "เวชภัณฑ์มิใช่ยา", "กล่อง", 3, 0, "คลัง NSO", "both"],
    ["NSO-168", "soda lime dust filter(1กล่อง/ชิ้น) (OR,Anaes)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 1, "คลัง NSO", "both"],
    ["NSO-169", "spinal block sterile(disposable) (Anaes)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 25, 0, "คลัง NSO", "both"],
    ["NSO-170", "Spinocan 22gx3\"1/2 25pc/box (w)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 350, 9, "คลัง NSO", "both"],
    ["NSO-171", "Spinocan 25gx3\"1/2 25pc/box (Anaes)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 250, 9, "คลัง NSO", "both"],
    ["NSO-172", "Spinocan 25gx43\"1/2 25pc/box เข็มยาว**", "เวชภัณฑ์มิใช่ยา", "กล่อง", 25, 0, "คลัง NSO", "both"],
    ["NSO-173", "Spinocan 27gx3\"1/2 25pc/box (Anaes)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 292, 10, "คลัง NSO", "both"],
    ["NSO-174", "stepcel absorbable hemostat (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1, 0, "คลัง NSO", "both"],
    ["NSO-175", "sterile cotton ball0.35g - 10ชิ้น (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 100, "คลัง NSO", "both"],
    ["NSO-176", "sterlie cotton ball 0.35 g-20 ชิ้น(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 350, "คลัง NSO", "both"],
    ["NSO-177", "sterlie cotton ball 0.35 g-3 ชิ้น(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 1750, "คลัง NSO", "both"],
    ["NSO-178", "sterlie cotton swab6\"(sizeM)-5ชิ้น(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 417, "คลัง NSO", "both"],
    ["NSO-179", "sterlie cotton swab6\"(sizeS)-5ชิ้น(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 167, "คลัง NSO", "both"],
    ["NSO-180", "sterlie cotton swab6\"(sizeL)-5ชิ้น(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 334, "คลัง NSO", "both"],
    ["NSO-181", "sterlie gauze pads 2\"x2\" 8ply-10pcs(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 167, "คลัง NSO", "both"],
    ["NSO-182", "Stockinette 10x130cm(4\")(OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-183", "Stockinette 15x150cm(6\")(OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-184", "Suction connecting tube(W6)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 7, "คลัง NSO", "both"],
    ["NSO-185", "Suction Liner(3000x)**", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 300, 0, "คลัง NSO", "both"],
    ["NSO-186", "Suction toothbrush (ICU)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 310, 0, "คลัง NSO", "both"],
    ["NSO-187", "Suction สายซิลิโคน 5x9 cm ม้วน (OR)", "เวชภัณฑ์มิใช่ยา", "ม้วน", 0, 1, "คลัง NSO", "both"],
    ["NSO-188", "Suction สายซิลิโคน 7x11 cm ม้วน", "เวชภัณฑ์มิใช่ยา", "ม้วน", 8, 1, "คลัง NSO", "both"],
    ["NSO-189", "Swab Disposable 12*12\" แถบxray (pack) (OR)", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 200, 134, "คลัง NSO", "both"],
    ["NSO-190", "Swab Disposable 3*9\" แถบxray (pack) **", "เวชภัณฑ์มิใช่ยา", "แพ็ค", 58, 0, "คลัง NSO", "both"],
    ["NSO-191", "SWX 60G450x450.BLNnwowen Sterilization (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-192", "SWX 60G600x600.BLNnwowen Sterilization (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-193", "Syring ball no 3 ชิ้น **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 90, 0, "คลัง NSO", "both"],
    ["NSO-194", "Syring ball no 6 ชิ้น (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 0, "คลัง NSO", "both"],
    ["NSO-195", "Syring ball no 2 (OR,LR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 82, "คลัง NSO", "both"],
    ["NSO-196", "Tegaderm 4.4x4.4 cm (1622W)เด็ก", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 22, 4, "คลัง NSO", "both"],
    ["NSO-197", "Tegaderm 9x25 (W)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 8, 1, "คลัง NSO", "both"],
    ["NSO-198", "Tegaderm cHG, 8.5x11.5 cm(กล่อง) (ICU)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 0, "คลัง NSO", "both"],
    ["NSO-199", "Tegaderm ปิด IV(1623W)ผู้ใหญ่", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 130, 12, "คลัง NSO", "both"],
    ["NSO-200", "Tip cleanner (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 25, "คลัง NSO", "both"],
    ["NSO-201", "TM Disposable Blood PressureTransducers (ICU)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-202", "TM surgical No L (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 0, "คลัง NSO", "both"],
    ["NSO-203", "TM surgical No XL (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 0, "คลัง NSO", "both"],
    ["NSO-204", "T-piece ด้านเท่า ขุ่น", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 60, 0, "คลัง NSO", "both"],
    ["NSO-205", "T-piece ด้านเท่า สีใส", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 60, 0, "คลัง NSO", "both"],
    ["NSO-206", "Tracheostomy Tube(Jacson Tube) **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 0, "คลัง NSO", "both"],
    ["NSO-207", "trocar no28 (ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 2, "คลัง NSO", "both"],
    ["NSO-208", "trocar no32 (W5)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 10, 0, "คลัง NSO", "both"],
    ["NSO-209", "Umbillical cath no3.5 ชิ้น **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 20, 0, "คลัง NSO", "both"],
    ["NSO-210", "Umbillical cath no5 ชิ้น **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 40, 0, "คลัง NSO", "both"],
    ["NSO-211", "Urine bag", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1105, 275, "คลัง NSO", "both"],
    ["NSO-212", "Urine Cath สวนทิ้ง no16 (LR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 80, 5, "คลัง NSO", "both"],
    ["NSO-213", "US print (sony) (LR,X-Rays)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 13, 2, "คลัง NSO", "both"],
    ["NSO-214", "Vicryl 4/0 (W9443) (ฟัน)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 2, "คลัง NSO", "both"],
    ["NSO-215", "V-plus5/0 **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1, 0, "คลัง NSO", "both"],
    ["NSO-216", "V-repide2/0 W9946 (LR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 2, 0, "คลัง NSO", "both"],
    ["NSO-217", "V-repide2/0 W9962 (LR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 18, 3, "คลัง NSO", "both"],
    ["NSO-218", "กระดาษ THERMAL PAPER 80x80 m. TG(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-219", "กระดาษปริ้นเครื่องนึ่งไอน้ำ (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-220", "กระดาษปริ้นเครื่องล้าง Steelco (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-221", "กระดาษอัลตร้าซาวด์ยี่ห้อ Sonomed รุ่น SM11 **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 16, 0, "คลัง NSO", "both"],
    ["NSO-222", "กล่องทิ้งเข็ม กล่อง", "เวชภัณฑ์มิใช่ยา", "กล่อง", 415, 106, "คลัง NSO", "both"],
    ["NSO-223", "ข้อต่อ Suction (ชิ้น) **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-224", "คลิปห้ามเลือด 135 องศา ยาว 9 mm.(HX-160-135 CLIP)(40ชิ้น/set) (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-225", "คลิปห้ามเลือด 135 องศา ยาว 9 mm.(HX-160-135L LONG CLIP)(40ชิ้น/set) (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-226", "เครื่องดูดเสมหะสำหรับเด็ก Mu-tip (W,ER)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 25, 5, "คลัง NSO", "both"],
    ["NSO-227", "ชุดเซอร์กิตเครื่องช่วยหายใจแบบซิริโคน (ICU)", "เวชภัณฑ์มิใช่ยา", "ชุด", 0, 2, "คลัง NSO", "both"],
    ["NSO-228", "ชุดตรวจสอบประสิทธิภาพของเครื่องนึ่ง(ระบบ Per-Vaccuum) **", "เวชภัณฑ์มิใช่ยา", "ชุด", 0, 0, "คลัง NSO", "both"],
    ["NSO-229", "ชุดพ่นยาเด็ก", "เวชภัณฑ์มิใช่ยา", "ชุด", 0, 50, "คลัง NSO", "both"],
    ["NSO-230", "ชุดพ่นยาผู้ใหญ่", "เวชภัณฑ์มิใช่ยา", "ชุด", 8, 54, "คลัง NSO", "both"],
    ["NSO-231", "ชุดสายดมยาสลบชนิดใช้ได้ครั้งเดียวสำหรับผู้ใหญ่M-A-C1204(Anaes)", "เวชภัณฑ์มิใช่ยา", "ชุด", 0, 0, "คลัง NSO", "both"],
    ["NSO-232", "ซองซีล TYVEK ZIGMA 12 นิ้ว 150x70mm (CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 4, "คลัง NSO", "both"],
    ["NSO-233", "ซองซีล TYVEK ZIGMA 14 นิ้ว 150x70mm(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 3, "คลัง NSO", "both"],
    ["NSO-234", "ซองซีล TYVEK ZIGMA 2 นิ้ว( 50x70mm)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 5, "คลัง NSO", "both"],
    ["NSO-235", "ซองซีล TYVEK ZIGMA 4 นิ้ว(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-236", "ซองซีล TYVEK ZIGMA 6 นิ้ว 150x70mm(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-237", "ซองซีล TYVEK ZIGMA 8 นิ้ว 150x70mm(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-238", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 2x200)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-239", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 3x200)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-240", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 4x200)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-241", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 6x200)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-242", "ซองบรรจุเวชภัณฑ์ชนิดเรียบ Index (ขนาด 8x200)(CSSD)", "เวชภัณฑ์มิใช่ยา", "ซอง", 0, 0, "คลัง NSO", "both"],
    ["NSO-243", "ตัวชี้วัดทางเคมีสำหรับไฮโดรเจนเพอร์ออกไซด์(พลาสม่า) (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-244", "ตัวทดสอบประสิทธิภาพการทำความสะอาดของเครื่องล้างอัตโนมัติ (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-245", "ตัวทดสอบประสิทธิภาพสำหรับเครื่องล้างอัลตร้าโซนิค (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-246", "ถุงมือยางสังเคราะห์สำหรับการศัลยกรรมชนิด(OR) (รายการที่ 1)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-247", "ถุงมือยางสังเคราะห์สำหรับการศัลยกรรมชนิด(OR) (รายการที่ 2)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-248", "ถุงมือยางสังเคราะห์สำหรับการศัลยกรรมชนิด(OR) (รายการที่ 3)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-249", "ถุงมือล้วงรก L คู่ (LR)", "เวชภัณฑ์มิใช่ยา", "คู่", 10, 0, "คลัง NSO", "both"],
    ["NSO-250", "ถุงมือล้วงรก M คู่ (LR)", "เวชภัณฑ์มิใช่ยา", "คู่", 10, 0, "คลัง NSO", "both"],
    ["NSO-251", "ถุงมือล้วงรก S คู่ (LR)", "เวชภัณฑ์มิใช่ยา", "คู่", 0, 0, "คลัง NSO", "both"],
    ["NSO-252", "น้ำยาฆ่าเชื้อสำหรับกล่องส่องทางเดินอาหารชนิดใช้กับเครื่องล้าง", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 2, "คลัง NSO", "both"],
    ["NSO-253", "น้ำยาทำลายเชื้อชนิดเข้มข้น ขนาด 1L", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-254", "น้ำยาล้างทำความสะอาดเครื่องมือแพทย์ ขนาด 5L", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 3, "คลัง NSO", "both"],
    ["NSO-255", "น้ำยาสำหรับเครื่องมืออัตโนมัติ Prozyme Alka", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-256", "น้ำยาไฮโดรเจนเปอร์ออกไซด์", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 40, "คลัง NSO", "both"],
    ["NSO-257", "ป้ายข้อมือเด็ก สีขาว กล่อง", "เวชภัณฑ์มิใช่ยา", "กล่อง", 17, 1, "คลัง NSO", "both"],
    ["NSO-258", "ป้ายข้อมือเด็ก สีชมพู กล่อง", "เวชภัณฑ์มิใช่ยา", "กล่อง", 7, 1, "คลัง NSO", "both"],
    ["NSO-259", "ป้ายข้อมือเด็ก สีฟ้า กล่อง", "เวชภัณฑ์มิใช่ยา", "กล่อง", 10, 1, "คลัง NSO", "both"],
    ["NSO-260", "ป้ายช้อมือผู้ใหญ่ สีขาว กล่อง", "เวชภัณฑ์มิใช่ยา", "กล่อง", 23, 4, "คลัง NSO", "both"],
    ["NSO-261", "ป้ายข้อมือผู้ใหญ่ สีชมพู กล่อง แพ้ยา", "เวชภัณฑ์มิใช่ยา", "กล่อง", 1, 1, "คลัง NSO", "both"],
    ["NSO-262", "ป้ายพลาสติกจำแนกอุปกรณ์(จมน้ำ)สีขาว(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-263", "ป้ายพลาสติกจำแนกอุปกรณ์(จมน้ำ)สีแดง(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-264", "ป้ายพลาสติกจำแนกอุปกรณ์(จมน้ำ)สีส้ม(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-265", "ผ้า gauze พับ 3\"x3\"8ชิ้น 10 ชิ้น ปลอดเชื้อ(CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 334, "คลัง NSO", "both"],
    ["NSO-266", "ผ้า gauze พับ 4\"x4\"8ชิ้น 10 ชิ้น ปลอดเชื้อ (CSSD)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 600, "คลัง NSO", "both"],
    ["NSO-267", "ผ้ายางเขียว แดง ม้วน**", "เวชภัณฑ์มิใช่ยา", "ม้วน", 3, 0, "คลัง NSO", "both"],
    ["NSO-268", "ผ้ายาง ฟ้า ชมพู ม้วน", "เวชภัณฑ์มิใช่ยา", "ม้วน", 4, 2, "คลัง NSO", "both"],
    ["NSO-269", "แผ่นปิดแผลชนิดฟิล์มใสกันน้ำ(10ซม.x1ม) (W5)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 1, "คลัง NSO", "both"],
    ["NSO-270", "พลาสเตอร์ใสกันน้ำ(Norplant 3 ชิ้น/กล่อง)(ปฐมภูมิ)", "เวชภัณฑ์มิใช่ยา", "กล่อง", 0, 0, "คลัง NSO", "both"],
    ["NSO-271", "พลาสเตอร์เหนียว 2นิ้ว(12ม้วน/กระบอก)(OR)", "เวชภัณฑ์มิใช่ยา", "ม้วน", 1, 1, "คลัง NSO", "both"],
    ["NSO-272", "ไม้กดลิ้นDisposable Sterile(กล่อง)**", "เวชภัณฑ์มิใช่ยา", "กล่อง", 15, 0, "คลัง NSO", "both"],
    ["NSO-273", "ล้อหมึก PB2-230 ชิ้น **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 36, 0, "คลัง NSO", "both"],
    ["NSO-274", "ล้อหมึก PB3-312 ชิ้น **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 5, 0, "คลัง NSO", "both"],
    ["NSO-275", "สตกิ๊ เกอร์ PB2-230 ทันกตรรม **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 100, 0, "คลัง NSO", "both"],
    ["NSO-276", "สติกเกอร์ฉลากแบบม้วนขนาด 6x3.5cm (1000ด/ม้วน)", "เวชภัณฑ์มิใช่ยา", "ม้วน", 0, 0, "คลัง NSO", "both"],
    ["NSO-277", "สาย radivac no 10 (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 15, "คลัง NSO", "both"],
    ["NSO-278", "สาย radivac no 12 (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 17, "คลัง NSO", "both"],
    ["NSO-279", "สาย radivac no 8 (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 17, "คลัง NSO", "both"],
    ["NSO-280", "สายMindray EKG trunk cable 3 Lead,AHA (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-281", "สายMindray EKG trunk cable 5 Lead,AHA (OR)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-282", "สายยางลาเท็กซ์ No204 **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 3, 0, "คลัง NSO", "both"],
    ["NSO-283", "สำลีก้อน 0.35 g ปลอดเชื้อ", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 100, "คลัง NSO", "both"],
    ["NSO-284", "หลอดทดสอบทางชีวภาพสำหรับไฮโดรเจนเพอร์ออกไซด์(พลาสมา)", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 0, "คลัง NSO", "both"],
    ["NSO-285", "หลอดไฟ Laryng (Hieni) **", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 1, 0, "คลัง NSO", "both"],
    ["NSO-286", "เอี๊ยมพลาสติก แขนยาวผูกหลัง", "เวชภัณฑ์มิใช่ยา", "ชิ้น", 0, 250, "คลัง NSO", "both"],
  ],
};

if (typeof module !== 'undefined') module.exports = SEED_DATA;
