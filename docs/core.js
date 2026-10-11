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
    db.items.forEach(function (i) {
      if (i.available_qty < 0) i.available_qty = 0;
      i.total_qty = i.available_qty + (lent[i.id] || 0);
    });
    return db;
  }

  function allows(item, type) { return item.kind === 'both' || item.kind === type; }

  function moveStock(db, ctx, o) {
    var item = byId(db.items, o.item_id) || fail('ไม่พบรายการพัสดุ');
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
        if (merged[id] > item.available_qty) {
          fail('"' + item.name + '" คงเหลือไม่พอ (ขอ ' + merged[id] + ', คงเหลือ ' + item.available_qty + ' ' + item.unit + ')');
        }
      });
      // เลขที่เอกสาร เช่น WD6910-0001 (ปี พ.ศ. 2 หลัก + เดือน + ลำดับในเดือน)
      var be = String(ctx.now.getFullYear() + 543).slice(2) + pad(ctx.now.getMonth() + 1);
      var prefix = (type === 'withdraw' ? 'WD' : 'BR') + be + '-';
      var seq = 0;
      db.requests.forEach(function (r) {
        if (r.request_no.indexOf(prefix) === 0) seq = Math.max(seq, Number(r.request_no.slice(prefix.length)));
      });
      var r = {
        id: nextId(db.requests), request_no: prefix + ('000' + (seq + 1)).slice(-4), borrower_name: name, phone: str(p.phone),
        department: dept, purpose: str(p.purpose), borrow_date: today, due_date: due,
        status: type === 'withdraw' ? 'issued' : 'borrowed', created_at: stamp(ctx.now), approved_at: stamp(ctx.now),
        returned_at: '', note: str(p.note), type: type,
      };
      db.requests.push(r);
      Object.keys(merged).forEach(function (id) {
        var q = merged[id];
        db.request_items.push({ request_id: r.id, item_id: Number(id), qty: q, returned_qty: 0, lost_qty: 0 });
        moveStock(db, ctx, type === 'withdraw'
          ? { item_id: id, type: 'withdraw', available_delta: -q, total_delta: -q, qty: -q, request_no: r.request_no }
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

  return { TABLES: TABLES, STATUS: STATUS, MOVE: MOVE, TYPES: TYPES, KINDS: KINDS, allows: allows, publicView: publicView, monthlySummary: monthlySummary, autoReturnDue: autoReturnDue, AUTO_RETURN_NOTE: AUTO_RETURN_NOTE, run: run, seed: seed, normalize: normalize, emptyDb: emptyDb, ymd: ymd };
})();

if (typeof module !== 'undefined') module.exports = BorrowCore;
