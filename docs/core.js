/*
 * BorrowCore — กฎการเบิกพัสดุและการตัดสต็อก
 * ไฟล์เดียวกันนี้ใช้ทั้งในเบราว์เซอร์ (โหมดทดลอง) และใน Google Apps Script (คัดลอกไปเป็น Core.gs)
 * ข้อมูลทั้งหมดอยู่ในอ็อบเจกต์ db = { items, requests, request_items, movements, departments, categories }
 */
var BorrowCore = (function () {
  // ระบบเบิกอย่างเดียว (ของออกจากคลังถาวร ไม่ต้องคืน) ใบเบิกทุกใบมีสถานะ "เบิกแล้ว"
  var STATUS = { issued: 'เบิกแล้ว' };
  var MOVE = { receive: 'รับเข้า', withdraw: 'เบิกจ่าย', adjust: 'ปรับปรุงยอด', lost: 'ชำรุด/สูญหาย' };

  // คอลัมน์ที่ระบบอ่าน/เขียน · ชีตเวอร์ชันก่อนที่มีคอลัมน์ของระบบยืม (total_qty, kind, due_date ฯลฯ) อ่านได้ ระบบข้ามคอลัมน์นั้นไป
  var TABLES = {
    items: ['id', 'code', 'name', 'category', 'unit', 'available_qty', 'min_qty', 'location', 'active'],
    requests: ['id', 'request_no', 'borrower_name', 'phone', 'department', 'purpose', 'status', 'created_at', 'note'],
    request_items: ['request_id', 'item_id', 'qty'],
    movements: ['id', 'created_at', 'item_id', 'type', 'qty', 'available_after', 'request_no', 'note'],
    departments: ['name', 'full_name'],
    categories: ['name'],
  };
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
    // ใบเบิกทุกใบ = เบิกแล้ว (ใบที่ค้างจากระบบยืมเดิมแสดงเป็นใบเบิกในประวัติ)
    db.requests.forEach(function (r) { r.status = 'issued'; });
    // คงเหลือติดลบได้ (เบิกของที่หมด = ค้างจ่าย) รับเข้าครั้งถัดไปจะหักล้างเอง
    return db;
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
    });
  }

  function lines(db, requestId) {
    return db.request_items.filter(function (l) { return l.request_id === requestId; });
  }

  var ADMIN_ACTIONS = ['checkPin', 'saveItem', 'stock', 'addMaster', 'removeMaster'];

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
      db.requests.forEach(function (r) {
        if (r.request_no.indexOf(prefix) === 0) seq = Math.max(seq, Number(r.request_no.slice(prefix.length)));
      });
      var r = {
        id: nextId(db.requests), request_no: prefix + (seq + 1 < 1000 ? ('00' + (seq + 1)).slice(-3) : String(seq + 1)), borrower_name: name, phone: str(p.phone),
        department: dept, purpose: str(p.purpose), status: 'issued', created_at: stamp(ctx.now), note: str(p.note),
      };
      db.requests.push(r);
      Object.keys(merged).forEach(function (id) {
        var q = merged[id];
        db.request_items.push({ request_id: r.id, item_id: Number(id), qty: q });
        moveStock(db, ctx, { item_id: id, type: 'withdraw', delta: -q, request_no: r.request_no, allowNegative: true });
      });
      return r.id;
    },

    saveItem: function (db, p, ctx) {
      var code = req(p.code, 'รหัสพัสดุ');
      var dup = find(db.items, function (i) { return i.code === code && i.id !== Number(p.id || 0); });
      if (dup) fail('รหัสพัสดุนี้มีอยู่แล้ว');
      var fields = {
        code: code, name: req(p.name, 'ชื่อพัสดุ'), category: str(p.category), unit: str(p.unit) || 'ชิ้น',
        min_qty: int(p.min_qty || 0, 'จุดสั่งซื้อขั้นต่ำ'), location: str(p.location), active: p.active === false ? 0 : 1,
      };
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
        if (qty) moveStock(db, ctx, { item_id: item.id, type: 'receive', delta: qty, note: 'ยอดยกมาเริ่มต้น' });
      }
      return item.id;
    },

    // type: receive (รับเข้า) | lost (ตัดชำรุด) | adjust (ระบุยอดที่นับได้จริง)
    stock: function (db, p, ctx) {
      var item = byId(db.items, p.item_id) || fail('ไม่พบรายการพัสดุ');
      var q;
      if (p.type === 'receive') {
        q = int(p.qty, 'จำนวน', 1);
        moveStock(db, ctx, { item_id: item.id, type: 'receive', delta: q, note: p.note });
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
        log.push([thaiStamp(r.created_at), r.request_no, r.borrower_name, r.department, it.code, it.name, l.qty, it.unit]);
      });
    });
    out.log = {
      header: ['วันที่เวลาที่เบิก', 'เลขที่', 'ผู้เบิก', 'แผนก', 'รหัสพัสดุ', 'ชื่อพัสดุ', 'จำนวน', 'หน่วย'],
      extra: 8, rows: log,
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

  // สรุปรายเดือน month = 'YYYY-MM' (นับใบเบิกที่ทำรายการในเดือนนั้น)
  function monthlySummary(db, month) {
    var reqs = db.requests.filter(function (r) { return r.created_at.slice(0, 7) === month; })
      .sort(function (a, b) { return a.id - b.id; });
    var t = { withdraw_docs: 0, withdraw_qty: 0 };
    var withdrawn = {}, depts = {};
    reqs.forEach(function (r) {
      var d = depts[r.department] || (depts[r.department] = { name: r.department, withdraw_docs: 0, withdraw_qty: 0 });
      var ls = lines(db, r.id);
      var qty = ls.reduce(function (s, l) { return s + l.qty; }, 0);
      t.withdraw_docs++; t.withdraw_qty += qty; d.withdraw_docs++; d.withdraw_qty += qty;
      ls.forEach(function (l) {
        if (!withdrawn[l.item_id]) {
          var it = byId(db.items, l.item_id) || { code: '', name: '(ลบแล้ว)', unit: '' };
          withdrawn[l.item_id] = { item_id: l.item_id, code: it.code, name: it.name, unit: it.unit, qty: 0, times: 0 };
        }
        withdrawn[l.item_id].qty += l.qty;
        withdrawn[l.item_id].times++;
      });
    });
    function values(map) { return Object.keys(map).map(function (k) { return map[k]; }); }
    return {
      month: month, totals: t, requests: reqs,
      withdrawn: values(withdrawn).sort(function (a, b) { return b.qty - a.qty || a.code.localeCompare(b.code); }),
      departments: values(depts).sort(function (a, b) { return b.withdraw_qty - a.withdraw_qty || a.name.localeCompare(b.name); }),
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
      run(db, 'saveItem', { code: x[0], name: x[1], category: x[2], unit: x[3], initial_qty: x[4], min_qty: x[5], location: x[6] }, ctx);
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
    (data.categories || []).forEach(function (n) {
      if (!find(db.categories, function (c) { return c.name === n; })) db.categories.push({ name: n });
    });
    return before;
  }

  return { replaceStock: replaceStock, resetForLaunch: resetForLaunch, TABLES: TABLES, STATUS: STATUS, MOVE: MOVE, publicView: publicView, monthlySummary: monthlySummary, sheetData: sheetData, thaiStamp: thaiStamp, run: run, seed: seed, normalize: normalize, fieldOf: fieldOf, emptyDb: emptyDb, ymd: ymd };
})();

if (typeof module !== 'undefined') module.exports = BorrowCore;
