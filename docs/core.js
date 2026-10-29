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
