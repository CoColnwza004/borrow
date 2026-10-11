const express = require('express');
const path = require('node:path');
const { transaction } = require('./db');
const { hashPassword, verifyPassword, createToken, readToken } = require('./auth');
const { parseCsv, toCsv } = require('./csv');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const STATUS_TEXT = {
  pending: 'รออนุมัติ',
  borrowed: 'กำลังยืม',
  returned: 'คืนแล้ว',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
};

const MOVEMENT_TEXT = {
  receive: 'รับเข้า',
  borrow: 'ยืมออก',
  return: 'รับคืน',
  adjust: 'ปรับปรุงยอด',
  lost: 'ชำรุด/สูญหาย',
};

// node:sqlite ไม่รับค่า undefined
const val = (v) => (v === undefined || v === '' ? null : v);

function toInt(v, field, { min = 0 } = {}) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < min) throw new HttpError(400, `${field} ต้องเป็นจำนวนเต็มตั้งแต่ ${min} ขึ้นไป`);
  return n;
}

function required(v, field) {
  if (v === undefined || v === null || String(v).trim() === '') throw new HttpError(400, `กรุณาระบุ${field}`);
  return String(v).trim();
}

function isDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
}

function createApp(db, options = {}) {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use(express.text({ type: ['text/csv', 'text/plain'], limit: '2mb' }));

  const getUser = db.prepare(
    `SELECT u.id, u.username, u.full_name, u.role, u.department_id, d.name AS department_name
     FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = ? AND u.active = 1`
  );

  // ---------- Middleware ----------
  function auth(req, res, next) {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    const uid = readToken(token);
    const user = uid && getUser.get(uid);
    if (!user) throw new HttpError(401, 'กรุณาเข้าสู่ระบบ');
    req.user = user;
    next();
  }

  function adminOnly(req, res, next) {
    if (req.user.role !== 'admin') throw new HttpError(403, 'เฉพาะเจ้าหน้าที่คลัง/ผู้ดูแลระบบเท่านั้น');
    next();
  }

  // ---------- Stock helper ----------
  // เปลี่ยนยอดสต็อกและบันทึกประวัติในคราวเดียว (ต้องเรียกภายใน transaction)
  const getItem = db.prepare('SELECT * FROM items WHERE id = ?');
  const updateItemQty = db.prepare('UPDATE items SET total_qty = ?, available_qty = ? WHERE id = ?');
  const insertMovement = db.prepare(`INSERT INTO stock_movements
    (item_id, type, qty, available_after, total_after, request_id, note, user_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  function moveStock({ itemId, type, availableDelta, totalDelta, qty, requestId = null, note = null, userId }) {
    const item = getItem.get(itemId);
    if (!item) throw new HttpError(404, 'ไม่พบรายการอุปกรณ์');
    const available = item.available_qty + availableDelta;
    const total = item.total_qty + totalDelta;
    if (available < 0) throw new HttpError(409, `"${item.name}" คงเหลือไม่พอ (คงเหลือ ${item.available_qty} ${item.unit})`);
    if (total < 0 || available > total) throw new HttpError(409, `ยอดสต็อกของ "${item.name}" ไม่ถูกต้องหลังปรับปรุง`);
    updateItemQty.run(total, available, itemId);
    insertMovement.run(itemId, type, qty, available, total, requestId, val(note), userId);
  }

  // ---------- Auth ----------
  app.post('/api/login', (req, res) => {
    const { username, password } = req.body || {};
    const row = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(String(username || ''));
    if (!row || !verifyPassword(String(password || ''), row.password_hash)) {
      throw new HttpError(401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    }
    res.json({ token: createToken(row.id), user: getUser.get(row.id) });
  });

  // ---------- Public stock API (สำหรับเชื่อมกับระบบอื่นของโรงพยาบาล) ----------
  app.get('/api/public/stock', (req, res) => {
    const key = options.stockApiKey;
    if (!key || req.get('x-api-key') !== key) throw new HttpError(401, 'API key ไม่ถูกต้อง');
    const rows = db.prepare(`SELECT i.code, i.name, c.name AS category, i.unit, i.total_qty, i.available_qty,
        i.total_qty - i.available_qty AS borrowed_qty, i.min_qty, i.location
      FROM items i LEFT JOIN categories c ON c.id = i.category_id WHERE i.active = 1 ORDER BY i.code`).all();
    res.json({ updated_at: new Date().toISOString(), items: rows });
  });

  const api = express.Router();
  api.use(auth);

  api.get('/me', (req, res) => res.json(req.user));

  api.post('/me/password', (req, res) => {
    const { old_password, new_password } = req.body || {};
    const row = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(req.user.id);
    if (!verifyPassword(String(old_password || ''), row.password_hash)) throw new HttpError(400, 'รหัสผ่านเดิมไม่ถูกต้อง');
    if (!new_password || String(new_password).length < 6) throw new HttpError(400, 'รหัสผ่านใหม่ต้องมีอย่างน้อย 6 ตัวอักษร');
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(new_password)), req.user.id);
    res.json({ ok: true });
  });

  // ---------- Dashboard ----------
  api.get('/dashboard', (req, res) => {
    const deptFilter = req.user.role === 'admin' ? '' : 'AND r.department_id = ' + Number(req.user.department_id);
    const stock = db.prepare(`SELECT COUNT(*) AS item_count, COALESCE(SUM(total_qty), 0) AS total_qty,
        COALESCE(SUM(available_qty), 0) AS available_qty FROM items WHERE active = 1`).get();
    const counts = db.prepare(`SELECT
        SUM(status = 'pending') AS pending,
        SUM(status = 'borrowed') AS borrowed,
        SUM(status = 'borrowed' AND due_date < date('now', 'localtime')) AS overdue
      FROM borrow_requests r WHERE 1 = 1 ${deptFilter}`).get();
    const lowStock = db.prepare(`SELECT id, code, name, unit, available_qty, total_qty, min_qty FROM items
      WHERE active = 1 AND available_qty <= min_qty ORDER BY available_qty - min_qty, name LIMIT 20`).all();
    const overdue = db.prepare(`SELECT r.id, r.request_no, r.borrower_name, r.due_date, d.name AS department_name,
        CAST(julianday(date('now', 'localtime')) - julianday(r.due_date) AS INTEGER) AS days_overdue
      FROM borrow_requests r JOIN departments d ON d.id = r.department_id
      WHERE r.status = 'borrowed' AND r.due_date < date('now', 'localtime') ${deptFilter}
      ORDER BY r.due_date LIMIT 20`).all();
    const recent = db.prepare(`SELECT m.created_at, m.type, m.qty, m.available_after, i.name AS item_name, i.unit,
        r.request_no FROM stock_movements m JOIN items i ON i.id = m.item_id
      LEFT JOIN borrow_requests r ON r.id = m.request_id ORDER BY m.id DESC LIMIT 10`).all();
    res.json({
      stock: { ...stock, borrowed_qty: stock.total_qty - stock.available_qty },
      requests: { pending: counts.pending || 0, borrowed: counts.borrowed || 0, overdue: counts.overdue || 0 },
      low_stock: lowStock,
      overdue,
      recent_movements: recent,
    });
  });

  // ---------- Master data: departments / categories ----------
  for (const [route, table, label] of [
    ['departments', 'departments', 'หน่วยงาน'],
    ['categories', 'categories', 'หมวดหมู่'],
  ]) {
    const hasPhone = table === 'departments';
    api.get(`/${route}`, (req, res) => {
      res.json(db.prepare(`SELECT * FROM ${table} ORDER BY name`).all());
    });
    api.post(`/${route}`, adminOnly, (req, res) => {
      const name = required(req.body.name, `ชื่อ${label}`);
      try {
        const r = hasPhone
          ? db.prepare(`INSERT INTO ${table} (name, phone) VALUES (?, ?)`).run(name, val(req.body.phone))
          : db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(name);
        res.status(201).json({ id: Number(r.lastInsertRowid) });
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) throw new HttpError(409, `มี${label}ชื่อนี้อยู่แล้ว`);
        throw e;
      }
    });
    api.put(`/${route}/:id`, adminOnly, (req, res) => {
      const name = required(req.body.name, `ชื่อ${label}`);
      try {
        const r = hasPhone
          ? db.prepare(`UPDATE ${table} SET name = ?, phone = ? WHERE id = ?`).run(name, val(req.body.phone), req.params.id)
          : db.prepare(`UPDATE ${table} SET name = ? WHERE id = ?`).run(name, req.params.id);
        if (!r.changes) throw new HttpError(404, `ไม่พบ${label}`);
        res.json({ ok: true });
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) throw new HttpError(409, `มี${label}ชื่อนี้อยู่แล้ว`);
        throw e;
      }
    });
    api.delete(`/${route}/:id`, adminOnly, (req, res) => {
      try {
        db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(req.params.id);
      } catch (e) {
        if (String(e.message).includes('FOREIGN KEY')) throw new HttpError(409, `ลบไม่ได้ เนื่องจาก${label}นี้ถูกใช้งานอยู่`);
        throw e;
      }
      res.json({ ok: true });
    });
  }

  // ---------- Users ----------
  api.get('/users', adminOnly, (req, res) => {
    res.json(db.prepare(`SELECT u.id, u.username, u.full_name, u.role, u.department_id, u.active, d.name AS department_name
      FROM users u LEFT JOIN departments d ON d.id = u.department_id ORDER BY u.username`).all());
  });

  api.post('/users', adminOnly, (req, res) => {
    const b = req.body;
    const username = required(b.username, 'ชื่อผู้ใช้');
    const password = required(b.password, 'รหัสผ่าน');
    if (password.length < 6) throw new HttpError(400, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
    if (!['admin', 'staff'].includes(b.role)) throw new HttpError(400, 'สิทธิ์ผู้ใช้ไม่ถูกต้อง');
    try {
      const r = db.prepare(`INSERT INTO users (username, password_hash, full_name, role, department_id)
        VALUES (?, ?, ?, ?, ?)`).run(username, hashPassword(password), required(b.full_name, 'ชื่อ-นามสกุล'), b.role, val(b.department_id));
      res.status(201).json({ id: Number(r.lastInsertRowid) });
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'ชื่อผู้ใช้นี้มีอยู่แล้ว');
      throw e;
    }
  });

  api.put('/users/:id', adminOnly, (req, res) => {
    const b = req.body;
    if (!['admin', 'staff'].includes(b.role)) throw new HttpError(400, 'สิทธิ์ผู้ใช้ไม่ถูกต้อง');
    if (Number(req.params.id) === req.user.id && (b.role !== 'admin' || !b.active)) {
      throw new HttpError(400, 'ไม่สามารถลดสิทธิ์หรือปิดใช้งานบัญชีของตนเองได้');
    }
    const r = db.prepare('UPDATE users SET full_name = ?, role = ?, department_id = ?, active = ? WHERE id = ?')
      .run(required(b.full_name, 'ชื่อ-นามสกุล'), b.role, val(b.department_id), b.active ? 1 : 0, req.params.id);
    if (!r.changes) throw new HttpError(404, 'ไม่พบผู้ใช้');
    if (b.password) {
      if (String(b.password).length < 6) throw new HttpError(400, 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');
      db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(String(b.password)), req.params.id);
    }
    res.json({ ok: true });
  });

  // ---------- Items / Stock ----------
  const ITEM_SELECT = `SELECT i.*, c.name AS category_name, i.total_qty - i.available_qty AS borrowed_qty
    FROM items i LEFT JOIN categories c ON c.id = i.category_id`;

  function listItems(query) {
    const where = [];
    const params = [];
    if (query.all !== '1') where.push('i.active = 1');
    if (query.q) {
      where.push('(i.name LIKE ? OR i.code LIKE ? OR i.location LIKE ?)');
      params.push(`%${query.q}%`, `%${query.q}%`, `%${query.q}%`);
    }
    if (query.category_id) { where.push('i.category_id = ?'); params.push(query.category_id); }
    if (query.low === '1') where.push('i.available_qty <= i.min_qty');
    if (query.available === '1') where.push('i.available_qty > 0');
    return db.prepare(`${ITEM_SELECT} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.code`).all(...params);
  }

  api.get('/items', (req, res) => res.json(listItems(req.query)));

  api.get('/items/export.csv', (req, res) => {
    const rows = listItems(req.query).map((i) => [
      i.code, i.name, i.category_name, i.unit, i.total_qty, i.available_qty, i.borrowed_qty, i.min_qty, i.location, i.description,
    ]);
    res.type('text/csv').attachment(`stock-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(toCsv(['รหัส', 'ชื่อ', 'หมวดหมู่', 'หน่วย', 'จำนวนทั้งหมด', 'คงเหลือ', 'ถูกยืม', 'จุดสั่งซื้อขั้นต่ำ', 'สถานที่เก็บ', 'รายละเอียด'], rows));
  });

  api.get('/items/:id', (req, res) => {
    const item = db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(req.params.id);
    if (!item) throw new HttpError(404, 'ไม่พบรายการอุปกรณ์');
    item.movements = db.prepare(`SELECT m.*, u.full_name AS user_name, r.request_no FROM stock_movements m
      LEFT JOIN users u ON u.id = m.user_id LEFT JOIN borrow_requests r ON r.id = m.request_id
      WHERE m.item_id = ? ORDER BY m.id DESC LIMIT 100`).all(req.params.id);
    item.borrowers = db.prepare(`SELECT r.id, r.request_no, r.borrower_name, r.due_date, d.name AS department_name,
        bi.qty - bi.returned_qty - bi.lost_qty AS outstanding
      FROM borrow_items bi JOIN borrow_requests r ON r.id = bi.request_id JOIN departments d ON d.id = r.department_id
      WHERE bi.item_id = ? AND r.status = 'borrowed' AND bi.qty > bi.returned_qty + bi.lost_qty
      ORDER BY r.due_date`).all(req.params.id);
    res.json(item);
  });

  api.post('/items', adminOnly, (req, res) => {
    const b = req.body;
    const code = required(b.code, 'รหัสอุปกรณ์');
    const name = required(b.name, 'ชื่ออุปกรณ์');
    const qty = toInt(b.initial_qty ?? 0, 'จำนวนเริ่มต้น');
    const minQty = toInt(b.min_qty ?? 0, 'จุดสั่งซื้อขั้นต่ำ');
    const id = transaction(db, () => {
      let r;
      try {
        r = db.prepare(`INSERT INTO items (code, name, category_id, unit, min_qty, location, description)
          VALUES (?, ?, ?, ?, ?, ?, ?)`).run(code, name, val(b.category_id), b.unit || 'ชิ้น', minQty, val(b.location), val(b.description));
      } catch (e) {
        if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'รหัสอุปกรณ์นี้มีอยู่แล้ว');
        throw e;
      }
      const itemId = Number(r.lastInsertRowid);
      if (qty > 0) {
        moveStock({ itemId, type: 'receive', availableDelta: qty, totalDelta: qty, qty, note: 'ยอดยกมาเริ่มต้น', userId: req.user.id });
      }
      return itemId;
    });
    res.status(201).json({ id });
  });

  api.put('/items/:id', adminOnly, (req, res) => {
    const b = req.body;
    try {
      const r = db.prepare(`UPDATE items SET code = ?, name = ?, category_id = ?, unit = ?, min_qty = ?, location = ?,
        description = ?, active = ? WHERE id = ?`).run(
        required(b.code, 'รหัสอุปกรณ์'), required(b.name, 'ชื่ออุปกรณ์'), val(b.category_id), b.unit || 'ชิ้น',
        toInt(b.min_qty ?? 0, 'จุดสั่งซื้อขั้นต่ำ'), val(b.location), val(b.description), b.active === false ? 0 : 1, req.params.id
      );
      if (!r.changes) throw new HttpError(404, 'ไม่พบรายการอุปกรณ์');
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) throw new HttpError(409, 'รหัสอุปกรณ์นี้มีอยู่แล้ว');
      throw e;
    }
    res.json({ ok: true });
  });

  // รับเข้า / ปรับปรุงยอด / ตัดชำรุด-สูญหาย
  api.post('/items/:id/stock', adminOnly, (req, res) => {
    const { type, note } = req.body;
    const itemId = Number(req.params.id);
    transaction(db, () => {
      if (type === 'receive') {
        const qty = toInt(req.body.qty, 'จำนวน', { min: 1 });
        moveStock({ itemId, type, availableDelta: qty, totalDelta: qty, qty, note, userId: req.user.id });
      } else if (type === 'lost') {
        const qty = toInt(req.body.qty, 'จำนวน', { min: 1 });
        moveStock({ itemId, type, availableDelta: -qty, totalDelta: -qty, qty: -qty, note, userId: req.user.id });
      } else if (type === 'adjust') {
        // ตรวจนับจริง: ระบุยอดคงเหลือในคลังที่นับได้ ระบบจะคำนวณผลต่างให้
        const counted = toInt(req.body.counted_qty, 'ยอดที่นับได้');
        const item = getItem.get(itemId);
        if (!item) throw new HttpError(404, 'ไม่พบรายการอุปกรณ์');
        const diff = counted - item.available_qty;
        if (diff === 0) return;
        moveStock({ itemId, type, availableDelta: diff, totalDelta: diff, qty: diff, note: note || 'ปรับยอดตามการตรวจนับ', userId: req.user.id });
      } else {
        throw new HttpError(400, 'ประเภทการปรับสต็อกไม่ถูกต้อง');
      }
    });
    res.json(db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(itemId));
  });

  // นำเข้าข้อมูลสต็อกจากไฟล์ CSV (เช่น ส่งออกจากระบบคลังเดิม / Excel)
  // คอลัมน์: รหัส,ชื่อ,หมวดหมู่,หน่วย,จำนวนทั้งหมด,จุดสั่งซื้อขั้นต่ำ,สถานที่เก็บ
  api.post('/items/import', adminOnly, (req, res) => {
    const text = typeof req.body === 'string' ? req.body : req.body?.csv;
    if (!text) throw new HttpError(400, 'ไม่พบข้อมูล CSV');
    const rows = parseCsv(text);
    if (rows.length && /รหัส|code/i.test(rows[0][0])) rows.shift();
    const result = { created: 0, updated: 0, errors: [] };

    transaction(db, () => {
      const findCat = db.prepare('SELECT id FROM categories WHERE name = ?');
      const insCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
      const findItem = db.prepare('SELECT * FROM items WHERE code = ?');
      rows.forEach((cols, idx) => {
        const line = idx + 2;
        const [code, name, catName, unit, totalStr, minStr, location] = cols.map((c) => (c ?? '').trim());
        if (!code || !name) { result.errors.push(`แถว ${line}: ต้องมีรหัสและชื่อ`); return; }
        const total = Number(totalStr || 0);
        const min = Number(minStr || 0);
        if (!Number.isInteger(total) || total < 0 || !Number.isInteger(min) || min < 0) {
          result.errors.push(`แถว ${line} (${code}): จำนวนไม่ถูกต้อง`); return;
        }
        let categoryId = null;
        if (catName) categoryId = findCat.get(catName)?.id ?? Number(insCat.run(catName).lastInsertRowid);
        const existing = findItem.get(code);
        if (!existing) {
          const r = db.prepare(`INSERT INTO items (code, name, category_id, unit, min_qty, location) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(code, name, categoryId, unit || 'ชิ้น', min, val(location));
          if (total > 0) {
            moveStock({ itemId: Number(r.lastInsertRowid), type: 'receive', availableDelta: total, totalDelta: total, qty: total, note: 'นำเข้าจาก CSV', userId: req.user.id });
          }
          result.created++;
        } else {
          db.prepare('UPDATE items SET name = ?, category_id = COALESCE(?, category_id), unit = ?, min_qty = ?, location = COALESCE(?, location), active = 1 WHERE id = ?')
            .run(name, categoryId, unit || existing.unit, min, val(location), existing.id);
          const diff = total - existing.total_qty;
          if (diff !== 0) {
            const borrowed = existing.total_qty - existing.available_qty;
            if (existing.available_qty + diff < 0) {
              result.errors.push(`แถว ${line} (${code}): ยอดใหม่ ${total} น้อยกว่าจำนวนที่ถูกยืมอยู่ (${borrowed}) ข้ามการปรับยอด`);
            } else {
              moveStock({ itemId: existing.id, type: 'adjust', availableDelta: diff, totalDelta: diff, qty: diff, note: 'ปรับยอดจากการนำเข้า CSV', userId: req.user.id });
            }
          }
          result.updated++;
        }
      });
    });
    res.json(result);
  });

  // ---------- Borrow requests ----------
  function requestScope(user) {
    return user.role === 'admin' ? { sql: '', params: [] } : { sql: ' AND r.department_id = ?', params: [user.department_id] };
  }

  function loadRequest(id, user) {
    const scope = requestScope(user);
    const r = db.prepare(`SELECT r.*, d.name AS department_name, cu.full_name AS created_by_name, au.full_name AS approved_by_name,
        (r.status = 'borrowed' AND r.due_date < date('now', 'localtime')) AS is_overdue
      FROM borrow_requests r JOIN departments d ON d.id = r.department_id
      LEFT JOIN users cu ON cu.id = r.created_by LEFT JOIN users au ON au.id = r.approved_by
      WHERE r.id = ?${scope.sql}`).get(id, ...scope.params);
    if (!r) throw new HttpError(404, 'ไม่พบคำขอยืม');
    r.items = db.prepare(`SELECT bi.*, i.code, i.name, i.unit, i.available_qty FROM borrow_items bi
      JOIN items i ON i.id = bi.item_id WHERE bi.request_id = ? ORDER BY i.code`).all(id);
    return r;
  }

  api.get('/requests', (req, res) => {
    const scope = requestScope(req.user);
    const where = ['1 = 1' + scope.sql];
    const params = [...scope.params];
    if (req.query.status) { where.push('r.status = ?'); params.push(req.query.status); }
    if (req.query.overdue === '1') where.push(`r.status = 'borrowed' AND r.due_date < date('now', 'localtime')`);
    if (req.query.q) {
      where.push('(r.request_no LIKE ? OR r.borrower_name LIKE ? OR EXISTS (SELECT 1 FROM borrow_items bi JOIN items i ON i.id = bi.item_id WHERE bi.request_id = r.id AND i.name LIKE ?))');
      params.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`);
    }
    const rows = db.prepare(`SELECT r.*, d.name AS department_name,
        (r.status = 'borrowed' AND r.due_date < date('now', 'localtime')) AS is_overdue,
        (SELECT GROUP_CONCAT(i.name || ' x' || bi.qty, ', ') FROM borrow_items bi JOIN items i ON i.id = bi.item_id WHERE bi.request_id = r.id) AS item_summary
      FROM borrow_requests r JOIN departments d ON d.id = r.department_id
      WHERE ${where.join(' AND ')} ORDER BY r.id DESC LIMIT 500`).all(...params);
    res.json(rows);
  });

  api.get('/requests/:id', (req, res) => res.json(loadRequest(req.params.id, req.user)));

  api.post('/requests', (req, res) => {
    const b = req.body;
    const borrowerName = required(b.borrower_name, 'ชื่อผู้ยืม');
    const departmentId = req.user.role === 'admin' ? toInt(b.department_id, 'หน่วยงาน', { min: 1 }) : req.user.department_id;
    if (!departmentId) throw new HttpError(400, 'บัญชีของท่านยังไม่ได้ผูกกับหน่วยงาน กรุณาติดต่อผู้ดูแลระบบ');
    if (!isDate(b.borrow_date) || !isDate(b.due_date)) throw new HttpError(400, 'กรุณาระบุวันที่ยืมและกำหนดคืนให้ถูกต้อง');
    if (b.due_date < b.borrow_date) throw new HttpError(400, 'วันกำหนดคืนต้องไม่ก่อนวันที่ยืม');
    if (!Array.isArray(b.items) || b.items.length === 0) throw new HttpError(400, 'กรุณาเลือกอุปกรณ์อย่างน้อย 1 รายการ');

    const lines = new Map();
    for (const line of b.items) {
      const itemId = toInt(line.item_id, 'รหัสอุปกรณ์', { min: 1 });
      lines.set(itemId, (lines.get(itemId) || 0) + toInt(line.qty, 'จำนวน', { min: 1 }));
    }

    const id = transaction(db, () => {
      for (const [itemId, qty] of lines) {
        const item = getItem.get(itemId);
        if (!item || !item.active) throw new HttpError(400, 'มีอุปกรณ์ที่ไม่พบหรือถูกปิดใช้งาน');
        if (qty > item.available_qty) {
          throw new HttpError(409, `"${item.name}" คงเหลือไม่พอ (ขอ ${qty}, คงเหลือ ${item.available_qty} ${item.unit})`);
        }
      }
      const prefix = `BR${new Date().toISOString().slice(2, 7).replace('-', '')}-`;
      const last = db.prepare('SELECT request_no FROM borrow_requests WHERE request_no LIKE ? ORDER BY request_no DESC LIMIT 1').get(prefix + '%');
      const seq = last ? Number(last.request_no.slice(prefix.length)) + 1 : 1;
      const r = db.prepare(`INSERT INTO borrow_requests
        (request_no, borrower_name, borrower_phone, department_id, purpose, borrow_date, due_date, created_by, note)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        prefix + String(seq).padStart(4, '0'), borrowerName, val(b.borrower_phone), departmentId, val(b.purpose),
        b.borrow_date, b.due_date, req.user.id, val(b.note)
      );
      const reqId = Number(r.lastInsertRowid);
      const ins = db.prepare('INSERT INTO borrow_items (request_id, item_id, qty) VALUES (?, ?, ?)');
      for (const [itemId, qty] of lines) ins.run(reqId, itemId, qty);

      // เจ้าหน้าที่คลังทำรายการเอง สามารถจ่ายของได้ทันที
      if (b.issue_now && req.user.role === 'admin') issueRequest(reqId, req.user.id);
      return reqId;
    });
    res.status(201).json(loadRequest(id, req.user));
  });

  function issueRequest(id, userId) {
    const r = db.prepare('SELECT * FROM borrow_requests WHERE id = ?').get(id);
    if (!r) throw new HttpError(404, 'ไม่พบคำขอยืม');
    if (r.status !== 'pending') throw new HttpError(409, 'คำขอนี้ไม่อยู่ในสถานะรออนุมัติ');
    const items = db.prepare('SELECT * FROM borrow_items WHERE request_id = ?').all(id);
    for (const bi of items) {
      moveStock({ itemId: bi.item_id, type: 'borrow', availableDelta: -bi.qty, totalDelta: 0, qty: -bi.qty, requestId: id, note: r.request_no, userId });
    }
    db.prepare(`UPDATE borrow_requests SET status = 'borrowed', approved_by = ?, approved_at = datetime('now', 'localtime') WHERE id = ?`)
      .run(userId, id);
  }

  api.post('/requests/:id/approve', adminOnly, (req, res) => {
    transaction(db, () => issueRequest(Number(req.params.id), req.user.id));
    res.json(loadRequest(req.params.id, req.user));
  });

  api.post('/requests/:id/reject', adminOnly, (req, res) => {
    const r = db.prepare(`UPDATE borrow_requests SET status = 'rejected', approved_by = ?, approved_at = datetime('now', 'localtime'),
      note = COALESCE(?, note) WHERE id = ? AND status = 'pending'`).run(req.user.id, val(req.body?.note), req.params.id);
    if (!r.changes) throw new HttpError(409, 'ไม่สามารถปฏิเสธคำขอนี้ได้');
    res.json(loadRequest(req.params.id, req.user));
  });

  api.post('/requests/:id/cancel', (req, res) => {
    const r = loadRequest(req.params.id, req.user);
    if (r.status !== 'pending') throw new HttpError(409, 'ยกเลิกได้เฉพาะคำขอที่รออนุมัติ');
    db.prepare(`UPDATE borrow_requests SET status = 'cancelled' WHERE id = ?`).run(r.id);
    res.json(loadRequest(r.id, req.user));
  });

  // รับคืน (คืนบางส่วนได้) — items: [{ item_id, returned_qty, lost_qty }]
  api.post('/requests/:id/return', adminOnly, (req, res) => {
    const id = Number(req.params.id);
    const lines = Array.isArray(req.body?.items) ? req.body.items : [];
    transaction(db, () => {
      const r = db.prepare('SELECT * FROM borrow_requests WHERE id = ?').get(id);
      if (!r) throw new HttpError(404, 'ไม่พบคำขอยืม');
      if (r.status !== 'borrowed') throw new HttpError(409, 'คำขอนี้ไม่อยู่ในสถานะกำลังยืม');
      const getLine = db.prepare('SELECT * FROM borrow_items WHERE request_id = ? AND item_id = ?');
      let touched = false;
      for (const line of lines) {
        const bi = getLine.get(id, Number(line.item_id));
        if (!bi) throw new HttpError(400, 'มีอุปกรณ์ที่ไม่อยู่ในคำขอนี้');
        const ret = toInt(line.returned_qty ?? 0, 'จำนวนที่คืน');
        const lost = toInt(line.lost_qty ?? 0, 'จำนวนชำรุด/สูญหาย');
        if (ret + lost === 0) continue;
        const outstanding = bi.qty - bi.returned_qty - bi.lost_qty;
        if (ret + lost > outstanding) throw new HttpError(400, `จำนวนคืนเกินจำนวนค้างคืน (ค้าง ${outstanding})`);
        if (ret) moveStock({ itemId: bi.item_id, type: 'return', availableDelta: ret, totalDelta: 0, qty: ret, requestId: id, note: r.request_no, userId: req.user.id });
        if (lost) moveStock({ itemId: bi.item_id, type: 'lost', availableDelta: 0, totalDelta: -lost, qty: -lost, requestId: id, note: `${r.request_no} ${req.body.note || ''}`.trim(), userId: req.user.id });
        db.prepare('UPDATE borrow_items SET returned_qty = returned_qty + ?, lost_qty = lost_qty + ? WHERE id = ?').run(ret, lost, bi.id);
        touched = true;
      }
      if (!touched) throw new HttpError(400, 'กรุณาระบุจำนวนที่คืน');
      const { remaining } = db.prepare('SELECT SUM(qty - returned_qty - lost_qty) AS remaining FROM borrow_items WHERE request_id = ?').get(id);
      if (remaining === 0) {
        db.prepare(`UPDATE borrow_requests SET status = 'returned', returned_at = datetime('now', 'localtime') WHERE id = ?`).run(id);
      }
    });
    res.json(loadRequest(id, req.user));
  });

  api.get('/requests-export.csv', (req, res) => {
    const scope = requestScope(req.user);
    const rows = db.prepare(`SELECT r.request_no, r.borrower_name, d.name AS department_name, r.borrow_date, r.due_date, r.status,
        r.returned_at, i.code, i.name, bi.qty, bi.returned_qty, bi.lost_qty
      FROM borrow_requests r JOIN departments d ON d.id = r.department_id
      JOIN borrow_items bi ON bi.request_id = r.id JOIN items i ON i.id = bi.item_id
      WHERE 1 = 1${scope.sql} ORDER BY r.id DESC`).all(...scope.params);
    res.type('text/csv').attachment(`borrow-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(toCsv(
      ['เลขที่คำขอ', 'ผู้ยืม', 'หน่วยงาน', 'วันที่ยืม', 'กำหนดคืน', 'สถานะ', 'วันที่คืนครบ', 'รหัสอุปกรณ์', 'อุปกรณ์', 'จำนวนยืม', 'คืนแล้ว', 'ชำรุด/สูญหาย'],
      rows.map((r) => [r.request_no, r.borrower_name, r.department_name, r.borrow_date, r.due_date, STATUS_TEXT[r.status], r.returned_at,
        r.code, r.name, r.qty, r.returned_qty, r.lost_qty])
    ));
  });

  // ---------- Stock movement log ----------
  function listMovements(q) {
    const where = ['1 = 1'];
    const params = [];
    if (q.item_id) { where.push('m.item_id = ?'); params.push(q.item_id); }
    if (q.type) { where.push('m.type = ?'); params.push(q.type); }
    if (isDate(q.from)) { where.push('date(m.created_at) >= ?'); params.push(q.from); }
    if (isDate(q.to)) { where.push('date(m.created_at) <= ?'); params.push(q.to); }
    return db.prepare(`SELECT m.*, i.code, i.name AS item_name, i.unit, u.full_name AS user_name, r.request_no
      FROM stock_movements m JOIN items i ON i.id = m.item_id
      LEFT JOIN users u ON u.id = m.user_id LEFT JOIN borrow_requests r ON r.id = m.request_id
      WHERE ${where.join(' AND ')} ORDER BY m.id DESC LIMIT 1000`).all(...params);
  }

  api.get('/movements', adminOnly, (req, res) => res.json(listMovements(req.query)));

  api.get('/movements-export.csv', adminOnly, (req, res) => {
    res.type('text/csv').attachment(`stock-movements-${new Date().toISOString().slice(0, 10)}.csv`);
    res.send(toCsv(
      ['วันเวลา', 'รหัส', 'อุปกรณ์', 'ประเภท', 'จำนวน', 'คงเหลือหลังทำรายการ', 'ยอดรวมหลังทำรายการ', 'เลขที่คำขอ', 'หมายเหตุ', 'ผู้ทำรายการ'],
      listMovements(req.query).map((m) => [m.created_at, m.code, m.item_name, MOVEMENT_TEXT[m.type], m.qty, m.available_after,
        m.total_after, m.request_no, m.note, m.user_name])
    ));
  });

  app.use('/api', api);
  app.use('/api', (req, res) => { throw new HttpError(404, 'ไม่พบ API'); });

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: status >= 500 ? 'เกิดข้อผิดพลาดภายในระบบ' : err.message });
  });

  return app;
}

module.exports = { createApp, STATUS_TEXT, MOVEMENT_TEXT };
