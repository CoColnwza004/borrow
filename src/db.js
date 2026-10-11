const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { hashPassword } = require('./auth');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  phone TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'staff')),
  department_id INTEGER REFERENCES departments(id),
  active INTEGER NOT NULL DEFAULT 1
);

-- total_qty = จำนวนที่โรงพยาบาลมีทั้งหมด, available_qty = คงเหลือในคลัง (พร้อมให้ยืม)
-- จำนวนที่ถูกยืมอยู่ = total_qty - available_qty
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category_id INTEGER REFERENCES categories(id),
  unit TEXT NOT NULL DEFAULT 'ชิ้น',
  total_qty INTEGER NOT NULL DEFAULT 0 CHECK (total_qty >= 0),
  available_qty INTEGER NOT NULL DEFAULT 0 CHECK (available_qty >= 0 AND available_qty <= total_qty),
  min_qty INTEGER NOT NULL DEFAULT 0,
  location TEXT,
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS borrow_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_no TEXT NOT NULL UNIQUE,
  borrower_name TEXT NOT NULL,
  borrower_phone TEXT,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  purpose TEXT,
  borrow_date TEXT NOT NULL,
  due_date TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'borrowed', 'returned', 'rejected', 'cancelled')),
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
  approved_by INTEGER REFERENCES users(id),
  approved_at TEXT,
  returned_at TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS borrow_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL REFERENCES borrow_requests(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES items(id),
  qty INTEGER NOT NULL CHECK (qty > 0),
  returned_qty INTEGER NOT NULL DEFAULT 0,
  lost_qty INTEGER NOT NULL DEFAULT 0,
  UNIQUE (request_id, item_id)
);

-- ประวัติการเคลื่อนไหวสต็อกทุกครั้ง (รับเข้า / ยืมออก / คืน / ปรับปรุง / ชำรุด-สูญหาย)
CREATE TABLE IF NOT EXISTS stock_movements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES items(id),
  type TEXT NOT NULL CHECK (type IN ('receive', 'borrow', 'return', 'adjust', 'lost')),
  qty INTEGER NOT NULL,
  available_after INTEGER NOT NULL,
  total_after INTEGER NOT NULL,
  request_id INTEGER REFERENCES borrow_requests(id),
  note TEXT,
  user_id INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_requests_status ON borrow_requests(status);
CREATE INDEX IF NOT EXISTS idx_movements_item ON stock_movements(item_id);
`;

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  seed(db);
  return db;
}

// รันฟังก์ชันใน transaction; rollback อัตโนมัติถ้ามี error
function transaction(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function seed(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (n > 0) return;

  transaction(db, () => {
    const insDept = db.prepare('INSERT INTO departments (name, phone) VALUES (?, ?)');
    for (const [name, phone] of [
      ['คลังพัสดุกลาง', '1100'],
      ['หอผู้ป่วยอายุรกรรมชาย', '2101'],
      ['หอผู้ป่วยศัลยกรรมหญิง', '2202'],
      ['ห้องฉุกเฉิน (ER)', '1669'],
      ['หอผู้ป่วยวิกฤต (ICU)', '2301'],
      ['แผนกผู้ป่วยนอก (OPD)', '1200'],
    ]) insDept.run(name, phone);

    const insCat = db.prepare('INSERT INTO categories (name) VALUES (?)');
    for (const name of ['ครุภัณฑ์การแพทย์', 'อุปกรณ์ช่วยเคลื่อนย้าย', 'อุปกรณ์ช่วยหายใจ', 'อุปกรณ์ติดตามสัญญาณชีพ', 'อื่น ๆ']) {
      insCat.run(name);
    }

    const insUser = db.prepare(
      'INSERT INTO users (username, password_hash, full_name, role, department_id) VALUES (?, ?, ?, ?, ?)'
    );
    insUser.run('admin', hashPassword('admin1234'), 'ผู้ดูแลระบบ (คลังพัสดุ)', 'admin', 1);
    insUser.run('ward', hashPassword('ward1234'), 'พยาบาลหอผู้ป่วยอายุรกรรม', 'staff', 2);

    const insItem = db.prepare(`INSERT INTO items
      (code, name, category_id, unit, total_qty, available_qty, min_qty, location)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
    const insMove = db.prepare(`INSERT INTO stock_movements
      (item_id, type, qty, available_after, total_after, note, user_id) VALUES (?, 'receive', ?, ?, ?, 'ยอดยกมาเริ่มต้น', 1)`);
    for (const [code, name, cat, unit, qty, min, loc] of [
      ['EQ-001', 'เครื่องวัดความดันโลหิตแบบดิจิทัล', 4, 'เครื่อง', 15, 3, 'คลัง A ชั้น 1'],
      ['EQ-002', 'เครื่องวัดออกซิเจนปลายนิ้ว (Pulse Oximeter)', 4, 'เครื่อง', 20, 5, 'คลัง A ชั้น 1'],
      ['EQ-003', 'เครื่องให้สารละลายทางหลอดเลือด (Infusion Pump)', 1, 'เครื่อง', 10, 2, 'คลัง A ชั้น 2'],
      ['EQ-004', 'เครื่องดูดเสมหะ (Suction)', 1, 'เครื่อง', 6, 2, 'คลัง A ชั้น 2'],
      ['EQ-005', 'รถเข็นนั่ง (Wheelchair)', 2, 'คัน', 12, 3, 'คลัง B'],
      ['EQ-006', 'เปลนอนเคลื่อนย้ายผู้ป่วย (Stretcher)', 2, 'เตียง', 5, 1, 'คลัง B'],
      ['EQ-007', 'ถังออกซิเจนพร้อมเกจ์', 3, 'ถัง', 18, 4, 'ห้องเก็บก๊าซ'],
      ['EQ-008', 'เครื่องผลิตออกซิเจน (Oxygen Concentrator)', 3, 'เครื่อง', 4, 1, 'คลัง A ชั้น 2'],
      ['EQ-009', 'เครื่องติดตามสัญญาณชีพ (Patient Monitor)', 4, 'เครื่อง', 8, 2, 'คลัง A ชั้น 2'],
      ['EQ-010', 'ที่นอนลมป้องกันแผลกดทับ', 5, 'ชุด', 10, 2, 'คลัง B'],
    ]) {
      const { lastInsertRowid } = insItem.run(code, name, cat, unit, qty, qty, min, loc);
      insMove.run(lastInsertRowid, qty, qty, qty);
    }
  });
}

module.exports = { openDb, transaction };
