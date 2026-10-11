/*
 * BorrowCore — กฎการยืม-คืนและการตัดสต็อก
 * ไฟล์เดียวกันนี้ใช้ทั้งในเบราว์เซอร์ (โหมดทดลอง) และใน Google Apps Script (คัดลอกไปเป็น Core.gs)
 * ข้อมูลทั้งหมดอยู่ในอ็อบเจกต์ db = { items, requests, request_items, movements, departments, categories }
 */
var BorrowCore = (function () {
  var STATUS = { pending: 'รออนุมัติ', borrowed: 'กำลังยืม', returned: 'คืนแล้ว', rejected: 'ไม่อนุมัติ', cancelled: 'ยกเลิก' };
  var MOVE = { receive: 'รับเข้า', borrow: 'ยืมออก', return: 'รับคืน', adjust: 'ปรับปรุงยอด', lost: 'ชำรุด/สูญหาย' };

  var TABLES = {
    items: ['id', 'code', 'name', 'category', 'unit', 'total_qty', 'available_qty', 'min_qty', 'location', 'active'],
    requests: ['id', 'request_no', 'borrower_name', 'phone', 'department', 'purpose', 'borrow_date', 'due_date',
      'status', 'created_at', 'approved_at', 'returned_at', 'note'],
    request_items: ['request_id', 'item_id', 'qty', 'returned_qty', 'lost_qty'],
    movements: ['id', 'created_at', 'item_id', 'type', 'qty', 'available_after', 'total_after', 'request_no', 'note'],
    departments: ['name'],
    categories: ['name'],
  };
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
          TABLES[t].forEach(function (c) { o[c] = NUMERIC.indexOf(c) >= 0 ? Number(r[c] || 0) : str(r[c]); });
          return o;
        });
    });
    return db;
  }

  function moveStock(db, ctx, o) {
    var item = byId(db.items, o.item_id) || fail('ไม่พบรายการอุปกรณ์');
    var available = item.available_qty + o.available_delta;
    var total = item.total_qty + o.total_delta;
    if (available < 0) fail('"' + item.name + '" คงเหลือไม่พอ (คงเหลือ ' + item.available_qty + ' ' + item.unit + ')');
    if (total < 0 || available > total) fail('ยอดสต็อกของ "' + item.name + '" ไม่ถูกต้องหลังปรับปรุง');
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

    createRequest: function (db, p, ctx) {
      var name = req(p.borrower_name, 'ชื่อผู้ยืม');
      var dept = req(p.department, 'หน่วยงาน');
      if (!isDate(p.borrow_date) || !isDate(p.due_date)) fail('กรุณาระบุวันที่ยืมและกำหนดคืนให้ถูกต้อง');
      if (p.due_date < p.borrow_date) fail('วันกำหนดคืนต้องไม่ก่อนวันที่ยืม');
      if (!p.items || !p.items.length) fail('กรุณาเลือกอุปกรณ์อย่างน้อย 1 รายการ');
      var merged = {};
      p.items.forEach(function (l) {
        var id = int(l.item_id, 'รหัสอุปกรณ์', 1);
        merged[id] = (merged[id] || 0) + int(l.qty, 'จำนวน', 1);
      });
      Object.keys(merged).forEach(function (id) {
        var item = byId(db.items, id);
        if (!item || !item.active) fail('มีอุปกรณ์ที่ไม่พบหรือถูกปิดใช้งาน');
        if (merged[id] > item.available_qty) {
          fail('"' + item.name + '" คงเหลือไม่พอ (ขอ ' + merged[id] + ', คงเหลือ ' + item.available_qty + ' ' + item.unit + ')');
        }
      });
      var prefix = 'BR' + ymd(ctx.now).slice(2, 7).replace('-', '') + '-';
      var seq = 0;
      db.requests.forEach(function (r) {
        if (r.request_no.indexOf(prefix) === 0) seq = Math.max(seq, Number(r.request_no.slice(prefix.length)));
      });
      var r = {
        id: nextId(db.requests), request_no: prefix + ('000' + (seq + 1)).slice(-4), borrower_name: name, phone: str(p.phone),
        department: dept, purpose: str(p.purpose), borrow_date: p.borrow_date, due_date: p.due_date, status: 'pending',
        created_at: stamp(ctx.now), approved_at: '', returned_at: '', note: str(p.note),
      };
      db.requests.push(r);
      Object.keys(merged).forEach(function (id) {
        db.request_items.push({ request_id: r.id, item_id: Number(id), qty: merged[id], returned_qty: 0, lost_qty: 0 });
      });
      return r.id;
    },

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
        var l = find(lines(db, r.id), function (l) { return l.item_id === Number(x.item_id); }) || fail('มีอุปกรณ์ที่ไม่อยู่ในคำขอนี้');
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
      var code = req(p.code, 'รหัสอุปกรณ์');
      var dup = find(db.items, function (i) { return i.code === code && i.id !== Number(p.id || 0); });
      if (dup) fail('รหัสอุปกรณ์นี้มีอยู่แล้ว');
      var fields = {
        code: code, name: req(p.name, 'ชื่ออุปกรณ์'), category: str(p.category), unit: str(p.unit) || 'ชิ้น',
        min_qty: int(p.min_qty || 0, 'จุดสั่งซื้อขั้นต่ำ'), location: str(p.location), active: p.active === false ? 0 : 1,
      };
      var item;
      if (p.id) {
        item = byId(db.items, p.id) || fail('ไม่พบรายการอุปกรณ์');
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
      var item = byId(db.items, p.item_id) || fail('ไม่พบรายการอุปกรณ์');
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
      table.push({ name: name });
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

  function seed(now) {
    var db = emptyDb();
    ['คลังพัสดุกลาง', 'หอผู้ป่วยอายุรกรรมชาย', 'หอผู้ป่วยศัลยกรรมหญิง', 'ห้องฉุกเฉิน (ER)', 'หอผู้ป่วยวิกฤต (ICU)', 'แผนกผู้ป่วยนอก (OPD)']
      .forEach(function (n) { db.departments.push({ name: n }); });
    ['ครุภัณฑ์การแพทย์', 'อุปกรณ์ช่วยเคลื่อนย้าย', 'อุปกรณ์ช่วยหายใจ', 'อุปกรณ์ติดตามสัญญาณชีพ', 'อื่น ๆ']
      .forEach(function (n) { db.categories.push({ name: n }); });
    var ctx = { now: now || new Date(), isAdmin: true };
    [
      ['EQ-001', 'เครื่องวัดความดันโลหิตแบบดิจิทัล', 'อุปกรณ์ติดตามสัญญาณชีพ', 'เครื่อง', 15, 3, 'คลัง A ชั้น 1'],
      ['EQ-002', 'เครื่องวัดออกซิเจนปลายนิ้ว (Pulse Oximeter)', 'อุปกรณ์ติดตามสัญญาณชีพ', 'เครื่อง', 20, 5, 'คลัง A ชั้น 1'],
      ['EQ-003', 'เครื่องให้สารละลายทางหลอดเลือด (Infusion Pump)', 'ครุภัณฑ์การแพทย์', 'เครื่อง', 10, 2, 'คลัง A ชั้น 2'],
      ['EQ-004', 'เครื่องดูดเสมหะ (Suction)', 'ครุภัณฑ์การแพทย์', 'เครื่อง', 6, 2, 'คลัง A ชั้น 2'],
      ['EQ-005', 'รถเข็นนั่ง (Wheelchair)', 'อุปกรณ์ช่วยเคลื่อนย้าย', 'คัน', 12, 3, 'คลัง B'],
      ['EQ-006', 'เปลนอนเคลื่อนย้ายผู้ป่วย (Stretcher)', 'อุปกรณ์ช่วยเคลื่อนย้าย', 'เตียง', 5, 1, 'คลัง B'],
      ['EQ-007', 'ถังออกซิเจนพร้อมเกจ์', 'อุปกรณ์ช่วยหายใจ', 'ถัง', 18, 4, 'ห้องเก็บก๊าซ'],
      ['EQ-008', 'เครื่องผลิตออกซิเจน (Oxygen Concentrator)', 'อุปกรณ์ช่วยหายใจ', 'เครื่อง', 4, 1, 'คลัง A ชั้น 2'],
      ['EQ-009', 'เครื่องติดตามสัญญาณชีพ (Patient Monitor)', 'อุปกรณ์ติดตามสัญญาณชีพ', 'เครื่อง', 8, 2, 'คลัง A ชั้น 2'],
      ['EQ-010', 'ที่นอนลมป้องกันแผลกดทับ', 'อื่น ๆ', 'ชุด', 10, 2, 'คลัง B'],
    ].forEach(function (x) {
      run(db, 'saveItem', { code: x[0], name: x[1], category: x[2], unit: x[3], initial_qty: x[4], min_qty: x[5], location: x[6] }, ctx);
    });
    return db;
  }

  return { TABLES: TABLES, STATUS: STATUS, MOVE: MOVE, run: run, seed: seed, normalize: normalize, emptyDb: emptyDb, ymd: ymd };
})();

if (typeof module !== 'undefined') module.exports = BorrowCore;
