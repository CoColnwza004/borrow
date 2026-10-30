const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../docs/core.js');
const SEED = require('../docs/seed-data.js');
// ข้อมูลพัสดุจริง (docs/seed-data.js): จำนวนรายการ และยอดตั้งต้นของพัสดุตาม id
const N = SEED.items.length;
const Q = (id) => SEED.items[id - 1][4];

const admin = { isAdmin: true };
const user = { isAdmin: false };

const person = { borrower_name: 'สมชาย ใจดี', department: 'งานธุรการ' };
// ข้อมูลเล็ก ๆ สำหรับทดสอบกฎ (แยกจากข้อมูลจริงใน docs/seed-data.js)
const FIXTURE = {
  departments: [['งานธุรการ', ''], ['ICU', 'งานการพยาบาลผู้ป่วยหนัก']],
  categories: ['ทั่วไป'],
  items: [
    ['OF-001', 'กระดาษ A4', 'ทั่วไป', 'รีม', 120, 20, 'คลัง'],
    ['MD-005', 'ถุงมือ M', 'ทั่วไป', 'กล่อง', 6, 1, 'คลัง'],
    ['MD-006', 'ผ้าก๊อซ', 'ทั่วไป', 'ห่อ', 3, 1, 'คลัง'],
  ],
};

test('core: withdraw deducts stock immediately and records the time to the second', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  const id = Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 5 }] }, { now: new Date('2026-10-24T09:15:42') });
  const r = db.requests.find((x) => x.id === id);
  assert.equal(r.status, 'issued');
  assert.match(r.request_no, /^WD69-001$/);
  assert.equal(r.created_at, '2026-10-24 09:15:42');
  assert.equal(paper.available_qty, 115);
  assert.deepEqual([db.movements.at(-1).type, db.movements.at(-1).qty, db.movements.at(-1).created_at], ['withdraw', -5, '2026-10-24 09:15:42']);
  assert.equal(Core.thaiStamp(r.created_at), '24/10/2569 09:15:42');
  assert.equal(Core.thaiStamp('2026-10-01 08:05'), '1/10/2569 08:05'); // ข้อมูลเก่าไม่มีวินาที
});

test('core: borrowing is gone — no due date, no borrow request numbers, no return/approve actions', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const gloves = db.items.find((i) => i.code === 'MD-005');
  // ส่ง type/due_date แบบระบบเดิมมาก็ได้ใบเบิกธรรมดา
  const id = Core.run(db, 'createRequest', { ...person, type: 'borrow', due_date: '2099-12-31', items: [{ item_id: gloves.id, qty: 2 }] }, user);
  const r = db.requests.find((x) => x.id === id);
  assert.match(r.request_no, /^WD/);
  assert.deepEqual(Object.keys(r).sort(), [...Core.TABLES.requests].sort());
  assert.equal(gloves.available_qty, 4);
  for (const a of ['returnItems', 'approve', 'reject', 'cancelRequest']) assert.throws(() => Core.run(db, a, { id }, admin), /ไม่รู้จักคำสั่ง/);
  assert.equal(Core.TYPES, undefined);
  assert.equal(Core.KINDS, undefined);
  assert.equal(Core.autoReturnDue, undefined);
  assert.ok(!Core.TABLES.items.includes('total_qty') && !Core.TABLES.items.includes('kind'));
  assert.ok(!Core.TABLES.requests.some((c) => /due|return|borrow_date|type|approved/.test(c)));
});

test('core: validation for department, name, items and inactive items', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  const w = { ...person, items: [{ item_id: paper.id, qty: 1 }] };
  assert.throws(() => Core.run(db, 'createRequest', { ...w, borrower_name: ' ' }, user), /ชื่อผู้เบิก/);
  assert.throws(() => Core.run(db, 'createRequest', { ...w, department: 'แผนกที่ไม่มี' }, user), /แผนกจากรายการ/);
  assert.throws(() => Core.run(db, 'createRequest', { ...w, items: [] }, user), /อย่างน้อย 1/);
  assert.throws(() => Core.run(db, 'createRequest', { ...w, items: [{ item_id: paper.id, qty: 0 }] }, user), /จำนวน/);
  paper.active = 0;
  assert.throws(() => Core.run(db, 'createRequest', w, user), /ปิดใช้งาน/);
  assert.equal(db.requests.length, 0);
  assert.equal(paper.available_qty, 120);
});

test('core: receiving stock records the company, expiry date and delivery note; companies are managed like departments', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  Core.run(db, 'addMaster', { table: 'suppliers', name: 'บริษัท เอ บี ซี จำกัด' }, admin);
  assert.deepEqual(db.suppliers, [{ name: 'บริษัท เอ บี ซี จำกัด' }]);
  assert.throws(() => Core.run(db, 'addMaster', { table: 'suppliers', name: 'บริษัท เอ บี ซี จำกัด' }, admin), /มีชื่อนี้อยู่แล้ว/);
  assert.throws(() => Core.run(db, 'addMaster', { table: 'suppliers', name: 'x' }, user), /PIN/);
  assert.equal(db.departments.length, 2, 'ไม่ไปเพิ่มเป็นแผนก');
  Core.run(db, 'stock', { item_id: paper.id, type: 'receive', qty: 30, supplier: 'บริษัท เอ บี ซี จำกัด', expiry_date: '2027-06-30', delivery_no: 'IV-2569/0012' }, admin);
  const m = db.movements.at(-1);
  assert.deepEqual([m.type, m.qty, m.supplier, m.expiry_date, m.delivery_no], ['receive', 30, 'บริษัท เอ บี ซี จำกัด', '2027-06-30', 'IV-2569/0012']);
  assert.equal(paper.available_qty, 150);
  assert.throws(() => Core.run(db, 'stock', { item_id: paper.id, type: 'receive', qty: 1, expiry_date: '30/06/2570' }, admin), /วันหมดอายุไม่ถูกต้อง/);
  // ไม่ใส่ก็รับเข้าได้ (ไม่บังคับ)
  Core.run(db, 'stock', { item_id: paper.id, type: 'receive', qty: 1 }, admin);
  assert.deepEqual([db.movements.at(-1).supplier, db.movements.at(-1).expiry_date, db.movements.at(-1).delivery_no], ['', '', '']);
  Core.run(db, 'removeMaster', { table: 'suppliers', name: 'บริษัท เอ บี ซี จำกัด' }, admin);
  assert.equal(db.suppliers.length, 0);
  // ข้อมูลเดิมที่ยังไม่มีคอลัมน์บริษัท/วันหมดอายุ อ่านได้
  const old = Core.normalize({ movements: [{ id: 1, created_at: '2026-01-01 08:00', item_id: 1, type: 'receive', qty: 5, available_after: 5 }] });
  assert.deepEqual([old.movements[0].supplier, old.movements[0].expiry_date, old.suppliers.length], ['', '', 0]);
});

test('core: new items get the next item code automatically (NSO-301 → NSO-302), with the first receive lot', () => {
  const db = Core.seed(new Date(), SEED);
  assert.equal(Core.nextItemCode(db.items), 'NSO-302');
  const id = Core.run(db, 'saveItem', { name: 'ถุงมือไนไตรล์ S', unit: 'กล่อง', initial_qty: 20, supplier: 'บ.ทดสอบ', expiry_date: '2028-01-31', delivery_no: 'DN-77' }, admin);
  const it = db.items.find((i) => i.id === id);
  assert.equal(it.code, 'NSO-302');
  assert.equal(it.available_qty, 20);
  assert.deepEqual([db.movements.at(-1).supplier, db.movements.at(-1).expiry_date, db.movements.at(-1).delivery_no], ['บ.ทดสอบ', '2028-01-31', 'DN-77']);
  assert.equal(Core.run(db, 'saveItem', { name: 'ถัดไป' }, admin) && db.items.at(-1).code, 'NSO-303');
  assert.throws(() => Core.run(db, 'saveItem', { code: 'NSO-001', name: 'ซ้ำ' }, admin), /มีอยู่แล้ว/);
  assert.equal(Core.nextItemCode([]), 'NSO-001');
  assert.equal(Core.nextItemCode([{ code: 'A-9' }, { code: 'A-10' }, { code: 'X' }]), 'A-11');
  // แถวที่พิมพ์ในชีตเองโดยไม่ใส่รหัส ได้รหัสถัดไปให้
  const loaded = Core.normalize({ items: [{ id: 1, code: 'NSO-007', name: 'a', available_qty: 1 }, { name: 'ของใหม่', available_qty: 3 }] });
  assert.equal(loaded.items[1].code, 'NSO-008');
});

test('core: staff can delete a withdraw slip, optionally returning its stock; the slip number is never reused', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  const gloves = db.items.find((i) => i.code === 'MD-005');
  const a = Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 10 }, { item_id: gloves.id, qty: 2 }] }, user);
  const b = Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 5 }] }, user);
  assert.throws(() => Core.run(db, 'deleteRequest', { id: a }, user), /PIN/);
  // ลบพร้อมคืนสต็อก
  assert.match(Core.run(db, 'deleteRequest', { id: a, restock: true }, admin), /^WD\d\d-001$/);
  assert.deepEqual([paper.available_qty, gloves.available_qty], [115, 6]);
  assert.deepEqual(db.movements.slice(-2).map((m) => [m.type, m.qty, m.note]), [['cancel', 10, 'ลบใบเบิก ' + db.movements.at(-1).request_no], ['cancel', 2, 'ลบใบเบิก ' + db.movements.at(-1).request_no]]);
  assert.equal(db.requests.length, 1);
  assert.ok(!db.request_items.some((l) => l.request_id === a));
  // ลบโดยไม่คืนสต็อก
  Core.run(db, 'deleteRequest', { id: b }, admin);
  assert.equal(paper.available_qty, 115);
  assert.equal(db.requests.length, 0);
  assert.throws(() => Core.run(db, 'deleteRequest', { id: b }, admin), /ไม่พบใบเบิก/);
  // ใบใหม่ไม่ใช้เลขที่ของใบที่ลบไปแล้ว
  const c = Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 1 }] }, user);
  assert.match(db.requests.find((r) => r.id === c).request_no, /-003$/);
});

test('core: withdrawing more than stock goes negative; receiving new stock offsets it', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  const admin = { isAdmin: true };
  const id = Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 125 }] }, user);
  assert.equal(db.requests.find((r) => r.id === id).status, 'issued');
  assert.equal(paper.available_qty, -5);
  // เบิกตอนของหมด (ติดลบอยู่แล้ว) ก็ยังได้
  Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 3 }] }, user);
  assert.equal(paper.available_qty, -8);
  // ติดลบต้องอยู่หลังโหลดจากชีต (ไม่ถูกปัดเป็น 0)
  const reloaded = Core.normalize(JSON.parse(JSON.stringify(db)));
  assert.equal(reloaded.items.find((i) => i.id === paper.id).available_qty, -8);
  // รับเข้า 20 หักล้างยอดค้าง เหลือ 12
  Core.run(db, 'stock', { item_id: paper.id, type: 'receive', qty: 20 }, admin);
  assert.equal(paper.available_qty, 12);
  // ตัดชำรุดเกินยอดในระบบได้ (ยอดติดลบ)
  Core.run(db, 'stock', { item_id: paper.id, type: 'lost', qty: 13 }, admin);
  assert.equal(paper.available_qty, -1);
});

test('core: rows from the old borrow system still load as withdrawals', () => {
  const db = Core.normalize({
    items: [{ id: 1, code: 'X', name: 'old', total_qty: 5, available_qty: 2, active: 1, kind: 'borrow' }],
    requests: [{ id: 1, request_no: 'BR2601-0001', borrower_name: 'a', department: 'b', status: 'borrowed', type: 'borrow', due_date: '2026-01-31' }],
    request_items: [{ request_id: 1, item_id: 1, qty: 3, returned_qty: 0, lost_qty: 0 }],
  });
  assert.deepEqual(db.items[0], { id: 1, code: 'X', name: 'old', category: '', unit: 'ชิ้น', available_qty: 2, min_qty: 0, location: '', active: 1, price: 0 });
  assert.equal(db.requests[0].status, 'issued');
  assert.equal(db.requests[0].due_date, undefined);
  assert.deepEqual(db.request_items[0], { request_id: 1, item_id: 1, qty: 3, price: 0 });
  assert.equal(Core.fieldOf('requests', 'ผู้เบิก/ผู้ยืม'), 'borrower_name'); // หัวคอลัมน์เดิมในชีต
  assert.equal(Core.fieldOf('requests', 'ผู้เบิก'), 'borrower_name');
});

function mockAppsScript() {
  const sheets = {};
  const logs = [];
  const mkSheet = (name) => {
    const sh = {
      data: [],
      writes: 0,
      getLastRow: () => sh.data.length,
      // เหมือน Sheets จริง: ได้ตารางสี่เหลี่ยม ช่องว่าง = ''
      getDataRange: () => {
        sh.reads = (sh.reads || 0) + 1;
        const w = Math.max(0, ...sh.data.map((r) => r.length));
        return { getValues: () => (sh.data.length ? sh.data : [[]]).map((r) => Array.from({ length: Math.max(w, 1) }, (_, j) => r[j] ?? '')) };
      },
      clearContents: () => { sh.data = []; },
      clear: () => { sh.data = []; sh.cleared = (sh.cleared || 0) + 1; },
      insertRowsAfter: (pos, k) => { sh.data.splice(pos, 0, ...Array.from({ length: k }, () => [])); sh.inserts = (sh.inserts || 0) + 1; },
      getRange: (r, c, nr) => ({
        setNumberFormat() { return this; },
        setFontWeight() { return this; },
        setBackground() { return this; },
        setFontColor() { return this; },
        setVerticalAlignment() { return this; },
        setWrap() { return this; },
        // เขียนทับเฉพาะช่วงที่กำหนด แถว/คอลัมน์นอกช่วงยังอยู่ (เหมือน Sheets จริง)
        setValues: (rows) => {
          sh.writes++;
          sh.rowsWritten = (sh.rowsWritten || 0) + rows.length;
          rows.forEach((row, i) => { const t = sh.data[r - 1 + i] || []; row.forEach((v, j) => { t[c - 1 + j] = v; }); sh.data[r - 1 + i] = t; });
        },
      }),
      setFrozenRows() {},
      setFrozenColumns() {},
      autoResizeColumns() {},
      setColumnWidth() {},
      setName: (n) => { delete sheets[name]; sheets[n] = sh; name = n; },
    };
    sheets[name] = sh;
    return sh;
  };
  const triggers = [];
  const cache = new Map();
  const ScriptApp = {
    getProjectTriggers: () => triggers.slice(),
    deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
    newTrigger: (fn) => {
      const b = { timeBased: () => b, everyDays: () => b, atHour: () => b, nearMinute: () => b,
        create: () => { const t = { getHandlerFunction: () => fn }; triggers.push(t); return t; } };
      return b;
    },
  };
  const order = [];
  const ss = {
    setActiveSheet: (sh) => { ss.active = sh; },
    moveActiveSheet: (pos) => { const name = Object.keys(sheets).find((k) => sheets[k] === ss.active); order.splice(pos - 1, 0, name); },
    getSheetByName: (n) => sheets[n] || null, insertSheet: mkSheet, getSpreadsheetTimeZone: () => 'Asia/Bangkok',
    deleteSheet: (sh) => { delete sheets[Object.keys(sheets).find((k) => sheets[k] === sh)]; },
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST/edit', getName: () => 'พัสดุ รพ.' };
  const ctx = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp,
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
    Logger: { log: (m) => { logs.push(m); } },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => { cache.set(k, v); }, remove: (k) => { cache.delete(k); } }) },
  });
  return { sheets, ctx, triggers, order, logs, cache };
}

test('Apps Script: only changed tabs are rewritten, shrinking tabs leave no stale rows', () => {
  const { sheets, ctx } = mockAppsScript();
  for (const f of ['core.js', 'apps-script/Code.gs', 'seed-data.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs', f), 'utf8'), ctx);
  ctx.setup();
  const writes = () => Object.fromEntries(Object.entries(sheets).map(([k, v]) => [k, v.writes]));
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  let before = writes();
  assert.equal(post({ action: 'load' }).ok, true);
  assert.deepEqual(writes(), before, 'load ไม่เขียนชีต');
  before = writes();
  assert.equal(post({ action: 'createRequest', payload: { borrower_name: 'ก ข', department: 'ICU', items: [{ item_id: 2, qty: 1 }] } }).ok, true);
  const after = writes();
  for (const t of ['อุปกรณ์', 'ประวัติการเบิก', 'รายการในคำขอ', 'ประวัติสต็อก', 'รายการเบิก']) assert.equal(after[t], before[t] + 1, t);
  for (const t of ['หน่วยงาน', 'หมวดหมู่']) assert.equal(after[t], before[t], t + ' ไม่ต้องเขียนใหม่');
  assert.deepEqual(Object.keys(sheets).sort(), ['บริษัท', 'หน่วยนับ', 'สถานที่เก็บ', 'ประวัติการเบิก', 'ประวัติสต็อก', 'รายการในคำขอ', 'รายการเบิก', 'หน่วยงาน', 'หมวดหมู่', 'อุปกรณ์'].sort());
  // ลบแผนก: แท็บสั้นลง ต้องไม่มีแถวเก่าค้าง
  assert.equal(post({ action: 'removeMaster', payload: { table: 'departments', name: 'ICU' }, pin: '1234' }).ok, true);
  assert.equal(sheets['หน่วยงาน'].data.length, 22);
  assert.ok(!sheets['หน่วยงาน'].data.some((r) => r[0] === 'ICU'));
  const reloaded = post({ action: 'load', pin: '1234' }).state;
  assert.equal(reloaded.departments.length, 21);
  assert.equal(reloaded.items.find((i) => i.id === 2).available_qty, Q(2) - 1);
});

test('Apps Script: old "คำขอยืม" tab is renamed to "ประวัติการเบิก" and keeps its data', () => {
  const { sheets, ctx } = mockAppsScript();
  for (const f of ['core.js', 'apps-script/Code.gs', 'seed-data.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs', f), 'utf8'), ctx);
  ctx.setup();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  post({ action: 'createRequest', payload: { borrower_name: 'ผู้เบิกเดิม', department: 'ICU', items: [{ item_id: 2, qty: 1 }] } });
  // จำลองชีตเวอร์ชันก่อน: แท็บชื่อ คำขอยืม หัวคอลัมน์อังกฤษ
  const C = require('../docs/core.js');
  const old = sheets['ประวัติการเบิก'];
  const hdr = old.data[0].map((h) => C.fieldOf('requests', h));
  old.data[0] = hdr;
  old.setName('คำขอยืม');
  assert.ok(sheets['คำขอยืม'] && !sheets['ประวัติการเบิก']);
  const st = post({ action: 'load', pin: '1234' }).state;
  assert.ok(sheets['ประวัติการเบิก'] && !sheets['คำขอยืม'], 'tab renamed');
  assert.equal(st.requests.length, 1);
  assert.equal(st.requests[0].borrower_name, 'ผู้เบิกเดิม');
  // บันทึกครั้งถัดไปเขียนหัวคอลัมน์ภาษาไทย
  post({ action: 'createRequest', payload: { borrower_name: 'คนใหม่', department: 'ER', items: [{ item_id: 2, qty: 1 }] } });
  assert.equal(sheets['ประวัติการเบิก'].data[0][0], 'เลขที่');
  assert.equal(post({ action: 'load', pin: '1234' }).state.requests.length, 2);
});

test('Apps Script: setup + doPost round-trip through mocked Google Sheets', () => {
  const { sheets, ctx } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/Code.gs'), 'utf8'), ctx);
  assert.throws(() => ctx.setup(), /SeedData/);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/seed-data.js'), 'utf8'), ctx);
  ctx.setup();
  assert.equal(sheets['อุปกรณ์'].data.length, N + 1);
  assert.equal(sheets['หน่วยงาน'].data.length, 23);
  assert.equal(sheets['พัสดุที่ถูกยืมอยู่'], undefined);
  ctx.setup(); // ยังไม่มีการเบิก รันซ้ำได้

  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  const icu = { borrower_name: 'สมชาย ใจดี', department: 'ICU' };
  const create = post({ action: 'createRequest', payload: { ...icu, items: [{ item_id: 2, qty: 2 }] } });
  assert.equal(create.ok, true);
  assert.throws(() => ctx.setup(), /มีรายการเบิกในชีตแล้ว/);
  const second = post({ action: 'createRequest', payload: { ...icu, items: [{ item_id: 4, qty: 1 }] } });
  assert.equal(second.ok, true);
  assert.equal(post({ action: 'stock', payload: { item_id: 4, type: 'receive', qty: 1 }, pin: 'wrong' }).ok, false);
  // ผู้ใช้ทั่วไป (ไม่มี PIN) ไม่เห็นประวัติ เห็นเฉพาะใบที่ตัวเองเพิ่งส่ง
  assert.deepEqual(create.state.requests.map((r) => r.id), [create.result]);
  assert.equal(create.state.request_items.length, 1);
  assert.equal(create.state.movements.length, 0);
  const pub = JSON.parse(ctx.doGet().body).state;
  assert.equal(pub.requests.length, 0);
  assert.equal(pub.items.length, N);
  assert.equal(pub.departments.length, 22);
  assert.equal(post({ action: 'load', pin: 'wrong' }).state.requests.length, 0);
  // ลิงก์ Google Sheet ส่งให้เฉพาะเจ้าหน้าที่
  assert.equal(post({ action: 'load', pin: 'wrong' }).sheet, undefined);
  assert.equal(post({ action: 'load', pin: '1234' }).sheet.url, 'https://docs.google.com/spreadsheets/d/TEST/edit');
  // reload from "sheet" text values (เจ้าหน้าที่เห็นครบ)
  const loaded = post({ action: 'load', pin: '1234' }).state;
  assert.equal(loaded.items.find((i) => i.id === 2).available_qty, Q(2) - 2);
  assert.equal(loaded.items.find((i) => i.id === 2).kind, undefined);
  assert.equal(loaded.items.find((i) => i.id === 4).available_qty, Q(4) - 1);
  assert.equal(loaded.departments.find((d) => d.name === 'ICU').full_name, 'งานการพยาบาลผู้ป่วยหนัก');
  assert.deepEqual(loaded.requests.sort((a, b) => a.id - b.id).map((r) => [r.request_no.slice(0, 2), r.status]), [['WD', 'issued'], ['WD', 'issued']]);
  assert.match(loaded.requests[0].created_at, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
});

test('Apps Script: saves write only the rows that changed, and the sheet matches a full rewrite', () => {
  const { sheets, ctx } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/AllInOne.gs'), 'utf8'), ctx);
  ctx.setup();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  for (let k = 0; k < 30; k++) assert.equal(post({ action: 'createRequest', payload: { borrower_name: 'คน ' + k, department: 'ICU', items: [{ item_id: 1 + (k % 5), qty: 1 }, { item_id: 9, qty: 2 }] } }).ok, true);
  const rows = (t) => Object.fromEntries(Object.entries(sheets).map(([n, sh]) => [n, sh.rowsWritten || 0]));
  const before = rows();
  assert.equal(post({ action: 'createRequest', payload: { borrower_name: 'คนล่าสุด', department: 'ER', items: [{ item_id: 2, qty: 3 }] } }).ok, true);
  const after = rows();
  const wrote = (n) => after[n] - before[n];
  assert.equal(wrote('อุปกรณ์'), 1, 'แก้เฉพาะแถวพัสดุที่ถูกเบิก');
  assert.equal(wrote('ประวัติสต็อก'), 1, 'ต่อท้าย 1 แถว');
  assert.equal(wrote('รายการในคำขอ'), 1);
  assert.equal(wrote('ประวัติการเบิก'), 1, 'แทรกใบใหม่บนสุด');
  assert.equal(wrote('รายการเบิก'), 1);
  assert.equal(sheets['ประวัติการเบิก'].data[1][2], 'คนล่าสุด');
  // เนื้อหาในชีตต้องเหมือนการเขียนใหม่ทั้งแท็บทุกตัวอักษร
  const st = post({ action: 'load', pin: '1234' }).state;
  const full = Core.sheetData(Core.normalize(st));
  const names = { items: 'อุปกรณ์', requests: 'ประวัติการเบิก', request_items: 'รายการในคำขอ', movements: 'ประวัติสต็อก', log: 'รายการเบิก', departments: 'หน่วยงาน' };
  for (const [t, n] of Object.entries(names)) {
    assert.deepEqual(JSON.parse(JSON.stringify(sheets[n].data)), [full[t].header, ...full[t].rows].map((r) => r.map(String)), n);
  }
});

test('Apps Script: บริษัท tab, receive lot columns and deleting a slip round-trip through the sheet', () => {
  const { sheets, ctx } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/AllInOne.gs'), 'utf8'), ctx);
  ctx.setup();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  assert.equal(post({ action: 'addMaster', payload: { table: 'suppliers', name: 'บริษัท ก จำกัด' }, pin: '1234' }).ok, true);
  assert.deepEqual(sheets['บริษัท'].data, [['name', 'contact', 'phone', 'email', 'note'], ['บริษัท ก จำกัด', '', '', '', '']]);
  assert.equal(post({ action: 'stock', payload: { item_id: 3, type: 'receive', qty: 7, supplier: 'บริษัท ก จำกัด', expiry_date: '2027-03-31', delivery_no: 'IV-1' }, pin: '1234' }).ok, true);
  const mv = sheets['ประวัติสต็อก'];
  const h = mv.data[0];
  const last = mv.data.at(-1);
  assert.deepEqual([last[h.indexOf('supplier')], last[h.indexOf('expiry_date')], last[h.indexOf('delivery_no')]], ['บริษัท ก จำกัด', '2027-03-31', 'IV-1']);
  const w = post({ action: 'createRequest', payload: { borrower_name: 'ก', department: 'ICU', items: [{ item_id: 3, qty: 2 }] } });
  const del = post({ action: 'deleteRequest', payload: { id: w.result, restock: true }, pin: '1234' });
  assert.equal(del.ok, true, del.error);
  const st = post({ action: 'load', pin: '1234' }).state;
  assert.equal(st.requests.length, 0);
  assert.equal(st.items.find((i) => i.id === 3).available_qty, Q(3) + 7);
  assert.equal(sheets['ประวัติการเบิก'].data.length, 1, 'แท็บประวัติการเบิกไม่มีแถวค้าง');
  assert.equal(sheets['รายการเบิก'].data.length, 1);
  assert.equal(st.suppliers[0].name, 'บริษัท ก จำกัด');
  assert.equal(post({ action: 'deleteRequest', payload: { id: 1 } }).ok, false, 'ผู้ใช้ทั่วไปลบไม่ได้');
});

test('Apps Script: public stock loads come from a short cache (no sheet reads, no lock queue) and refresh after a save', () => {
  const { sheets, ctx, cache } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/AllInOne.gs'), 'utf8'), ctx);
  ctx.setup();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  const reads = () => Object.values(sheets).reduce((s, sh) => s + (sh.reads || 0), 0);
  assert.ok(cache.size, 'setup ใส่แคชไว้แล้ว');
  let r0 = reads();
  const a = JSON.parse(ctx.doGet().body);
  assert.equal(a.ok, true);
  assert.equal(a.state.items.length, N);
  assert.equal(reads(), r0, 'โหลดจากแคช ไม่อ่านชีต');
  // ใบเบิก: แคชได้ยอดใหม่ทันที
  post({ action: 'createRequest', payload: { borrower_name: 'ก', department: 'ICU', items: [{ item_id: 2, qty: 4 }] } });
  const b = post({ action: 'load' });
  assert.equal(b.state.items.find((i) => i.id === 2).available_qty, Q(2) - 4);
  assert.equal(b.state.requests.length, 0, 'แคชสาธารณะไม่มีชื่อผู้เบิก');
  assert.ok(!JSON.stringify(cache.get('public-state-v2')).includes('borrower_name') || JSON.parse(cache.get('public-state-v2')).requests.length === 0);
  // เจ้าหน้าที่ (PIN) อ่านจากชีตเสมอ
  r0 = reads();
  assert.equal(post({ action: 'load', pin: '1234' }).state.requests.length, 1);
  assert.ok(reads() > r0);
  // แคชหมดอายุ → อ่านจากชีตแล้วใส่แคชใหม่
  cache.clear();
  r0 = reads();
  assert.equal(post({ action: 'load' }).state.items.length, N);
  assert.ok(reads() > r0 && cache.size === 1);
});

test('seed data: stock list from the 21 Oct 2569 file and departments', () => {
  const db = Core.seed(new Date(), SEED);
  assert.equal(db.items.length, 301);
  assert.equal(db.departments.length, 22);
  assert.equal(new Set(db.items.map((i) => i.code)).size, 301);
  assert.equal(new Set(db.items.map((i) => i.name)).size, 301);
  assert.equal(db.items.reduce((s, i) => s + i.available_qty, 0), 14690);
  assert.deepEqual([db.items[0].code, db.items[300].code], ['NSO-001', 'NSO-301']);
  const byName = (n) => db.items.find((i) => i.name === n);
  assert.equal(byName('3 -ways').available_qty, 50);
  assert.equal(byName('Bag Suction Liner (1500 ml)(ER,ICU)').available_qty, 1350);
  assert.equal(byName('BP print (ม้วน)').available_qty, 187);
  assert.equal(byName('เอี๊ยมพลาสติก แขนยาวผูกหลัง').available_qty, 770);
  assert.equal(byName('เอี๊ยมพลาสติก แขนยาวผูกหลัง').min_qty, 250); // จุดเตือนเดิมยังอยู่
  assert.equal(byName('สายพานด้านล่าง(Supply)').available_qty, 0); // วรรณยุกต์ซ้ำในไฟล์ถูกแก้แล้ว
  assert.ok(byName('น้ำยาไฮโดรเจนเปอร์ออกไซด์'));
  assert.ok(db.items.every((i) => !/ า| [\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]/.test(i.name)), 'Thai vowels repaired');
  assert.deepEqual(db.departments[0], { name: 'ICU', full_name: 'งานการพยาบาลผู้ป่วยหนัก' });
});

test('Apps Script AllInOne.gs: up to date and works as the only file', () => {
  const { build } = require('../scripts/build-gs.js');
  const file = fs.readFileSync(path.join(__dirname, '../docs/apps-script/AllInOne.gs'), 'utf8');
  assert.equal(file, build(), 'AllInOne.gs ไม่ตรงกับไฟล์ต้นฉบับ — รัน npm run build:gs');
  const { sheets, ctx } = mockAppsScript();
  vm.runInContext(file, ctx);
  ctx.setup();
  assert.equal(sheets['อุปกรณ์'].data.length, N + 1);
  const res = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'createRequest',
    payload: { borrower_name: 'ทดสอบ', department: 'ER', items: [{ item_id: 2, qty: 5 }] } }) } }).body);
  assert.equal(res.ok, true);
  assert.equal(res.state.items.find((i) => i.id === 2).available_qty, Q(2) - 5);
});

test('core: stock edited directly in the sheet (available_qty only) keeps working', () => {
  const db = Core.seed(new Date(), FIXTURE);
  // เจ้าหน้าที่แก้ในชีต: กระดาษจาก 120 เป็น 200 พิมพ์เป็นข้อความ
  const raw = JSON.parse(JSON.stringify(db));
  raw.items.find((i) => i.code === 'OF-001').available_qty = '200';
  const loaded = Core.normalize(raw);
  const paper = loaded.items.find((i) => i.code === 'OF-001');
  assert.equal(paper.available_qty, 200);
  Core.run(loaded, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 150 }] }, user);
  assert.equal(paper.available_qty, 50);
});

test('core: monthly summary of withdrawals', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const ctxAt = (d) => ({ isAdmin: true, now: new Date(d) });
  const paper = db.items.find((i) => i.code === 'OF-001');
  const gloves = db.items.find((i) => i.code === 'MD-005');
  const icu = { borrower_name: 'ก', department: 'ICU' };
  Core.run(db, 'createRequest', { ...icu, items: [{ item_id: paper.id, qty: 5 }, { item_id: gloves.id, qty: 2 }] }, ctxAt('2026-10-02T09:00:00'));
  Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 3 }] }, ctxAt('2026-10-05T09:00:00'));
  Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 50 }] }, ctxAt('2026-11-01T09:00:00'));
  const sum = Core.monthlySummary(db, '2026-10');
  assert.deepEqual(sum.totals, { withdraw_docs: 2, withdraw_qty: 10, withdraw_value: 0 });
  assert.deepEqual(sum.withdrawn.map((r) => [r.code, r.qty, r.times]), [['OF-001', 8, 2], ['MD-005', 2, 1]]);
  assert.deepEqual(sum.departments.map((d) => [d.name, d.withdraw_docs, d.withdraw_qty]), [['ICU', 1, 7], ['งานธุรการ', 1, 3]]);
  assert.equal(sum.borrowed, undefined);
  assert.equal(sum.requests.length, 2);
  assert.equal(Core.monthlySummary(db, '2026-11').totals.withdraw_qty, 50);
  assert.equal(Core.monthlySummary(db, '2026-09').requests.length, 0);
});

test('core: item price, price kept on each slip, and slip totals', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  const gloves = db.items.find((i) => i.code === 'MD-005');
  // ใบที่เบิกก่อนใส่ราคา ใช้ราคาปัจจุบันของพัสดุ
  const before = Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 2 }] }, user);
  Core.run(db, 'saveItem', { ...paper, price: '1,250.50' }, admin);
  Core.run(db, 'saveItem', { ...gloves, price: 89 }, admin);
  assert.equal(paper.price, 1250.5);
  assert.throws(() => Core.run(db, 'saveItem', { ...gloves, price: '-1' }, admin), /ราคาต่อหน่วย/);
  assert.throws(() => Core.run(db, 'saveItem', { ...gloves, price: 'abc' }, admin), /ราคาต่อหน่วย/);
  assert.equal(Core.requestValue(db, before), 2501);
  const id = Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 1 }, { item_id: gloves.id, qty: 3 }] }, user);
  assert.deepEqual(db.request_items.filter((l) => l.request_id === id).map((l) => l.price), [1250.5, 89]);
  assert.equal(Core.requestValue(db, id), 1517.5);
  // ราคาเปลี่ยนภายหลัง ใบเบิกเดิมยังใช้ราคา ณ วันที่เบิก
  Core.run(db, 'saveItem', { ...gloves, price: 100 }, admin);
  assert.equal(Core.requestValue(db, id), 1517.5);
  const d = Core.sheetData(db);
  const req = d.requests.rows.find((r) => r[0] === db.requests.find((x) => x.id === id).request_no);
  assert.equal(req[d.requests.header.indexOf('รวมเงิน (บาท)')], 1517.5);
  const lc = (n) => d.log.header.indexOf(n);
  assert.deepEqual(d.log.rows.slice(0, 2).map((r) => [r[lc('ราคาต่อหน่วย')], r[lc('รวมเงิน (บาท)')]]), [[1250.5, 1250.5], [89, 267]]);
  // ราคาที่พิมพ์ในชีตเองแบบมีคอมมา/สัญลักษณ์บาท อ่านได้
  assert.equal(Core.normalize({ items: [{ id: 1, code: 'X', name: 'x', price: '฿1,000' }] }).items[0].price, 1000);
});

test('core: units and storage locations are dropdown lists that grow from the web or the sheet', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const names = (t) => db[t].map((x) => x.name);
  for (const u of ['ชิ้น', 'กล่อง', 'ขวด', 'ม้วน', 'โหล', 'รีม', 'ห่อ']) assert.ok(names('units').includes(u), u);
  assert.deepEqual(names('locations'), ['คลัง']);
  Core.run(db, 'addMaster', { table: 'units', name: 'แพ็ค' }, admin);
  Core.run(db, 'addMaster', { table: 'locations', name: 'ตู้ A ชั้น 2' }, admin);
  assert.throws(() => Core.run(db, 'addMaster', { table: 'units', name: 'แพ็ค' }, admin), /มีชื่อนี้อยู่แล้ว/);
  assert.throws(() => Core.run(db, 'addMaster', { table: 'units', name: 'x' }, user), /PIN/);
  assert.throws(() => Core.run(db, 'addMaster', { table: 'nope', name: 'x' }, admin), /ไม่รู้จักรายการ/);
  // พัสดุที่ใช้หน่วย/ที่เก็บใหม่ เพิ่มลงรายการให้เอง
  Core.run(db, 'saveItem', { name: 'เทปกาว', unit: 'แถว', location: 'ห้องเก็บของ 2' }, admin);
  assert.ok(names('units').includes('แถว') && names('locations').includes('ห้องเก็บของ 2'));
  Core.run(db, 'removeMaster', { table: 'units', name: 'โหล' }, admin);
  assert.ok(!names('units').includes('โหล'));
  // ชีตเดิมที่ยังไม่มีแท็บหน่วยนับ/สถานที่เก็บ: ตั้งจากค่าที่พัสดุใช้อยู่
  const old = Core.normalize({ items: [{ id: 1, code: 'A', name: 'a', unit: 'แกลลอน', location: 'ตู้ 1' }] });
  assert.deepEqual(old.units.map((u) => u.name), ['ชิ้น', 'กล่อง', 'ขวด', 'ม้วน', 'โหล', 'แกลลอน']);
  assert.deepEqual(old.locations.map((u) => u.name), ['ตู้ 1']);
  assert.ok(Core.sheetData(db).units.rows.some((r) => r[0] === 'แพ็ค'));
});

test('core: summary by department, by month or by year, with money totals', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  const gloves = db.items.find((i) => i.code === 'MD-005');
  Core.run(db, 'saveItem', { ...paper, price: 120 }, admin);
  Core.run(db, 'saveItem', { ...gloves, price: 85.5 }, admin);
  const at = (d) => ({ isAdmin: false, now: new Date(d + 'T09:00:00') });
  const icu = { borrower_name: 'ก', department: 'ICU' };
  Core.run(db, 'createRequest', { ...icu, items: [{ item_id: paper.id, qty: 2 }, { item_id: gloves.id, qty: 2 }] }, at('2026-03-02'));
  Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 1 }] }, at('2026-03-05'));
  Core.run(db, 'createRequest', { ...icu, items: [{ item_id: paper.id, qty: 5 }] }, at('2026-10-01'));
  Core.run(db, 'createRequest', { ...icu, items: [{ item_id: paper.id, qty: 1 }] }, at('2027-01-01'));
  const march = Core.monthlySummary(db, '2026-03');
  assert.deepEqual(march.totals, { withdraw_docs: 2, withdraw_qty: 5, withdraw_value: 531 });
  assert.deepEqual(march.withdrawn.map((w) => [w.code, w.qty, w.price, w.value]), [['OF-001', 3, 120, 360], ['MD-005', 2, 85.5, 171]]);
  assert.deepEqual(march.departments.map((d) => [d.name, d.withdraw_value]), [['ICU', 411], ['งานธุรการ', 120]]);
  const icuMarch = Core.monthlySummary(db, '2026-03', 'ICU');
  assert.deepEqual(icuMarch.totals, { withdraw_docs: 1, withdraw_qty: 4, withdraw_value: 411 });
  assert.equal(icuMarch.department, 'ICU');
  assert.equal(icuMarch.values[icuMarch.requests[0].id], 411);
  const year = Core.monthlySummary(db, '2026', 'ICU');
  assert.equal(year.yearly, true);
  assert.deepEqual(year.totals, { withdraw_docs: 2, withdraw_qty: 9, withdraw_value: 1011 });
  assert.equal(year.months.length, 12);
  assert.deepEqual(year.months.filter((m) => m.withdraw_docs).map((m) => [m.month, m.withdraw_value]), [['2026-03', 411], ['2026-10', 600]]);
  assert.equal(Core.monthlySummary(db, '2026').totals.withdraw_docs, 3);
  assert.equal(Core.monthlySummary(db, '2026-03').months.length, 0);
});

test('core: stock report per month / year — issued qty & value, balance at period end & value', () => {
  const db = Core.seed(new Date('2026-01-01T08:00:00'), FIXTURE); // ยอดยกมา กระดาษ 120 ถุงมือ 6 ผ้าก๊อซ 3
  const paper = db.items.find((i) => i.code === 'OF-001');
  const gloves = db.items.find((i) => i.code === 'MD-005');
  Core.run(db, 'saveItem', { ...paper, price: 120 }, admin);
  Core.run(db, 'saveItem', { ...gloves, price: 85.5 }, admin);
  const at = (d) => ({ isAdmin: true, now: new Date(d + 'T09:00:00') });
  Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 10 }, { item_id: gloves.id, qty: 2 }] }, at('2026-03-02'));
  Core.run(db, 'stock', { item_id: paper.id, type: 'receive', qty: 50 }, at('2026-03-20'));
  Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 5 }] }, at('2026-04-01'));
  Core.run(db, 'createRequest', { ...person, items: [{ item_id: gloves.id, qty: 1 }] }, at('2027-01-05'));
  const mar = Core.stockSummary(db, '2026-03');
  const row = (sum, code) => sum.items.find((r) => r.code === code);
  assert.deepEqual([row(mar, 'OF-001').issued, row(mar, 'OF-001').issued_value, row(mar, 'OF-001').received, row(mar, 'OF-001').balance, row(mar, 'OF-001').balance_value],
    [10, 1200, 50, 160, 19200]);
  assert.deepEqual([row(mar, 'MD-005').issued, row(mar, 'MD-005').balance, row(mar, 'MD-005').balance_value], [2, 4, 342]);
  assert.deepEqual(row(mar, 'MD-006').balance, 3);
  assert.deepEqual(mar.totals, { items: 3, issued_items: 2, issued_qty: 12, issued_value: 1371, received_qty: 50, balance_qty: 167, balance_value: 19542 });
  assert.deepEqual(mar.issued.map((r) => r.code), ['OF-001', 'MD-005']);
  // รายปี: คงเหลือ ณ สิ้นปี 2569 ไม่นับการเบิกปี 2570
  const y = Core.stockSummary(db, '2026');
  assert.equal(y.yearly, true);
  assert.deepEqual([row(y, 'OF-001').issued, row(y, 'OF-001').balance, row(y, 'MD-005').balance], [15, 155, 4]);
  assert.equal(y.totals.issued_value, 1971);
  // เดือนก่อนมีการเคลื่อนไหว: ยอดคงเหลือ = ยอดยกมา
  assert.equal(row(Core.stockSummary(db, '2026-02'), 'OF-001').balance, 120);
  assert.equal(row(Core.stockSummary(db, '2027'), 'MD-005').balance, 3);
});

test('core: receive / issue value summary by month and year (opening balance not counted as received)', () => {
  const db = Core.seed(new Date('2026-01-01T08:00:00'), FIXTURE);
  assert.ok(db.movements.every((m) => m.note === Core.OPENING));
  const paper = db.items.find((i) => i.code === 'OF-001');
  const gloves = db.items.find((i) => i.code === 'MD-005');
  Core.run(db, 'saveItem', { ...paper, price: 120 }, admin);
  Core.run(db, 'saveItem', { ...gloves, price: 85.5 }, admin);
  const at = (d) => ({ isAdmin: true, now: new Date(d + 'T09:00:00') });
  // รับเข้าราคาของล็อตนี้ 110 บาท (ไม่ใส่ = ราคาปัจจุบัน)
  Core.run(db, 'stock', { item_id: paper.id, type: 'receive', qty: 50, price: '110', supplier: 'บ.ก' }, at('2026-03-05'));
  Core.run(db, 'stock', { item_id: gloves.id, type: 'receive', qty: 10 }, at('2026-03-06'));
  assert.equal(db.movements.at(-1).price, 85.5);
  assert.throws(() => Core.run(db, 'stock', { item_id: gloves.id, type: 'receive', qty: 1, price: '-5' }, at('2026-03-06')), /ราคาต่อหน่วย/);
  Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 4 }] }, at('2026-03-10'));
  Core.run(db, 'stock', { item_id: paper.id, type: 'receive', qty: 5 }, at('2026-07-01'));
  // พัสดุใหม่จากเว็บพร้อมจำนวนเริ่มต้น = รับเข้า (ไม่ใช่ยอดยกมา)
  const nid = Core.run(db, 'saveItem', { name: 'เทป', price: 10, initial_qty: 3, receive_price: 9 }, at('2026-07-02'));
  const mar = Core.flowSummary(db, '2026-03');
  assert.deepEqual(mar.totals, { in_qty: 60, in_value: 6355, in_items: 2, in_count: 2, out_qty: 4, out_value: 480, out_items: 1, out_count: 1 });
  assert.deepEqual(mar.receipts.map((r) => [r.code, r.qty, r.price, r.value, r.supplier]), [['OF-001', 50, 110, 5500, 'บ.ก'], ['MD-005', 10, 85.5, 855, '']]);
  assert.deepEqual(mar.items.map((r) => [r.code, r.in_value, r.out_value]), [['MD-005', 855, 0], ['OF-001', 5500, 480]]);
  const y = Core.flowSummary(db, '2026');
  assert.equal(y.totals.in_value, 6355 + 600 + 27);
  assert.equal(y.months.length, 12);
  assert.deepEqual(y.months.filter((m) => m.in_value || m.out_value).map((m) => [m.month, m.in_value, m.out_value]), [['2026-03', 6355, 480], ['2026-07', 627, 0]]);
  assert.ok(y.receipts.some((r) => r.item_id === nid && r.price === 9));
  assert.equal(Core.flowSummary(db, '2026-01').totals.in_qty, 0, 'ยอดยกมาไม่นับเป็นรับเข้า');
  assert.equal(Core.stockSummary(db, '2026-01').totals.received_qty, 0);
});

test('core: lookups stay correct as rows are added and removed (indexes)', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  const a = Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 1 }] }, user);
  assert.equal(Core.requestValue(db, a), 0);
  Core.run(db, 'saveItem', { ...paper, price: 10 }, admin);
  const b = Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 2 }] }, user);
  assert.equal(Core.requestValue(db, b), 20);
  Core.run(db, 'deleteRequest', { id: a, restock: true }, admin);
  assert.equal(Core.requestValue(db, a), 0);
  const c = Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 3 }] }, user);
  assert.equal(Core.requestValue(db, c), 30);
  const nid = Core.run(db, 'saveItem', { name: 'ใหม่', price: 5 }, admin);
  const d = Core.run(db, 'createRequest', { ...person, items: [{ item_id: nid, qty: 2 }] }, user);
  assert.equal(Core.requestValue(db, d), 10);
});

test('core: expiry alerts within N months, lot quantity estimated first-in-first-out', () => {
  const db = Core.seed(new Date('2026-01-01T08:00:00'), { departments: [['ICU', '']], categories: [], items: [['A', 'น้ำเกลือ', '', 'ขวด', 0, 0, ''], ['B', 'ถุงมือ', '', 'กล่อง', 0, 0, '']] });
  const at = (d) => ({ isAdmin: true, now: new Date(d + 'T09:00:00') });
  const rc = (id, qty, exp, d) => Core.run(db, 'stock', { item_id: id, type: 'receive', qty, expiry_date: exp, supplier: 'บ.ก' }, at(d));
  rc(1, 10, '2026-06-30', '2026-01-05'); // ล็อตเก่า
  rc(1, 10, '2027-12-31', '2026-02-05'); // ล็อตใหม่ (เกิน 8 เดือน)
  rc(2, 5, '2026-03-01', '2026-01-10'); // หมดอายุแล้ว
  rc(2, 5, '', '2026-02-10'); // ไม่ระบุวันหมดอายุ
  Core.run(db, 'createRequest', { borrower_name: 'ก', department: 'ICU', items: [{ item_id: 1, qty: 4 }] }, at('2026-03-01'));
  let a = Core.expiryAlerts(db, '2026-04-01', 8);
  assert.deepEqual(a.map((x) => [x.code, x.qty, x.expiry_date, x.days, x.expired]), [['B', 5, '2026-03-01', -31, true], ['A', 6, '2026-06-30', 90, false]]);
  // ใช้ไปจนเหลือแค่ล็อตใหม่: ล็อตเก่าไม่ต้องเตือนแล้ว
  Core.run(db, 'createRequest', { borrower_name: 'ก', department: 'ICU', items: [{ item_id: 1, qty: 6 }, { item_id: 2, qty: 5 }] }, at('2026-04-02'));
  a = Core.expiryAlerts(db, '2026-04-03', 8);
  assert.deepEqual(a.map((x) => x.code), []);
  // ล็อตใหม่เข้าช่วง 8 เดือน
  assert.deepEqual(Core.expiryAlerts(db, '2027-05-01', 8).map((x) => [x.code, x.qty]), [['A', 10]]);
  assert.deepEqual(Core.expiryAlerts(db, '2027-04-29', 8).map((x) => x.code), []);
});

test('core: supplier contacts, rename keeps history, delivery summary by delivery note', () => {
  const db = Core.seed(new Date('2026-01-01T08:00:00'), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  const gloves = db.items.find((i) => i.code === 'MD-005');
  Core.run(db, 'saveItem', { ...paper, price: 120 }, admin);
  Core.run(db, 'saveSupplier', { name: 'บ.เอ', contact: 'คุณสมศรี', phone: '081-234-5678' }, admin);
  assert.throws(() => Core.run(db, 'saveSupplier', { name: 'บ.เอ' }, admin), /มีชื่อบริษัทนี้อยู่แล้ว/);
  assert.throws(() => Core.run(db, 'saveSupplier', { name: 'x' }, user), /PIN/);
  const at = (d) => ({ isAdmin: true, now: new Date(d + 'T09:00:00') });
  Core.run(db, 'stock', { item_id: paper.id, type: 'receive', qty: 10, supplier: 'บ.เอ', delivery_no: 'IV-1' }, at('2026-03-01'));
  Core.run(db, 'stock', { item_id: gloves.id, type: 'receive', qty: 4, price: 80, supplier: 'บ.เอ', delivery_no: 'IV-1' }, at('2026-03-01'));
  Core.run(db, 'stock', { item_id: paper.id, type: 'receive', qty: 5, price: 110, supplier: 'บ.เอ' }, at('2027-01-10'));
  Core.run(db, 'stock', { item_id: paper.id, type: 'receive', qty: 1, supplier: 'บ.ไม่อยู่ในรายชื่อ' }, at('2026-05-01'));
  // แก้ชื่อบริษัท: ประวัติรับเข้าเปลี่ยนชื่อตาม
  Core.run(db, 'saveSupplier', { old_name: 'บ.เอ', name: 'บริษัท เอ จำกัด', contact: 'คุณสมศรี', phone: '02-111-2222' }, admin);
  assert.equal(db.suppliers.length, 1);
  assert.equal(db.movements.filter((m) => m.supplier === 'บริษัท เอ จำกัด').length, 3);
  const sum = Core.supplierSummary(db, '2026');
  const a = sum.find((s) => s.name === 'บริษัท เอ จำกัด');
  assert.deepEqual([a.phone, a.receipts, a.deliveries, a.qty, a.value, a.year_value, a.last_date.slice(0, 10)], ['02-111-2222', 3, 2, 19, 1200 + 320 + 550, 1520, '2027-01-10']);
  assert.deepEqual(a.docs.map((d) => [d.delivery_no, d.lines.length, d.value]), [['', 1, 550], ['IV-1', 2, 1520]]);
  assert.deepEqual(a.items.map((i) => [i.code, i.qty, i.last_price]), [['OF-001', 15, 110], ['MD-005', 4, 80]]);
  const b = sum.find((s) => s.name === 'บ.ไม่อยู่ในรายชื่อ');
  assert.equal(b.listed, false);
  assert.deepEqual(Core.sheetData(db).suppliers.header, ['name', 'contact', 'phone', 'email', 'note']);
});

test('core: stock can be set freely (bulk, from item form, negative, lost beyond balance)', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const [paper, gloves, gauze] = ['OF-001', 'MD-005', 'MD-006'].map((c) => db.items.find((i) => i.code === c));
  const n = Core.run(db, 'setStock', { items: [{ item_id: paper.id, qty: 50 }, { item_id: gloves.id, qty: '6' }, { item_id: gauze.id, qty: -2 }], note: 'นับสต็อกสิ้นเดือน' }, admin);
  assert.equal(n, 2, 'ยอดเท่าเดิมไม่บันทึก');
  assert.deepEqual([paper.available_qty, gloves.available_qty, gauze.available_qty], [50, 6, -2]);
  assert.deepEqual(db.movements.slice(-2).map((m) => [m.type, m.qty, m.note]), [['adjust', -70, 'นับสต็อกสิ้นเดือน'], ['adjust', -5, 'นับสต็อกสิ้นเดือน']]);
  assert.throws(() => Core.run(db, 'setStock', { items: [{ item_id: paper.id, qty: 1.5 }] }, admin), /จำนวนเต็ม/);
  assert.throws(() => Core.run(db, 'setStock', { items: [{ item_id: paper.id, qty: 1 }] }, user), /PIN/);
  Core.run(db, 'saveItem', { ...paper, available_qty: '75' }, admin);
  assert.equal(paper.available_qty, 75);
  assert.equal(db.movements.at(-1).note, 'แก้ไขยอดคงเหลือ');
  Core.run(db, 'saveItem', { ...paper, name: 'กระดาษ A4 80g' }, admin); // ไม่ส่งยอด = ไม่เปลี่ยน
  assert.equal(paper.available_qty, 75);
  Core.run(db, 'stock', { item_id: gloves.id, type: 'lost', qty: 10 }, admin);
  assert.equal(gloves.available_qty, -4);
  Core.run(db, 'stock', { item_id: gloves.id, type: 'adjust', counted_qty: -1 }, admin);
  assert.equal(gloves.available_qty, -1);
});

test('core: staff can edit a withdrawal slip — quantities, add/remove items, stock follows', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const [paper, gloves, gauze] = ['OF-001', 'MD-005', 'MD-006'].map((c) => db.items.find((i) => i.code === c));
  Core.run(db, 'saveItem', { ...paper, price: 100 }, admin);
  const id = Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 5 }, { item_id: gloves.id, qty: 2 }] }, user);
  Core.run(db, 'saveItem', { ...paper, price: 150 }, admin); // ราคาเปลี่ยนหลังเบิก
  Core.run(db, 'saveItem', { ...gauze, price: 30 }, admin);
  const before = [paper.available_qty, gloves.available_qty, gauze.available_qty];
  assert.throws(() => Core.run(db, 'editRequest', { id, borrower_name: 'x', department: 'ICU', items: [{ item_id: paper.id, qty: 1 }] }, user), /PIN/);
  assert.throws(() => Core.run(db, 'editRequest', { id, borrower_name: 'x', department: 'ICU', items: [] }, admin), /อย่างน้อย 1 รายการ/);
  // กระดาษ 5 → 8 (เพิ่ม 3), ถุงมือลบออก (คืน 2), ผ้าก๊อซเพิ่มใหม่ 1
  Core.run(db, 'editRequest', { id, borrower_name: 'สมชาย ใจดี (แก้)', department: 'ICU', note: 'เพิ่มของ', items: [{ item_id: paper.id, qty: 8 }, { item_id: gauze.id, qty: 1 }] }, { isAdmin: true, now: new Date('2026-10-30T10:00:00') });
  assert.deepEqual([paper.available_qty, gloves.available_qty, gauze.available_qty], [before[0] - 3, before[1] + 2, before[2] - 1]);
  const ls = db.request_items.filter((l) => l.request_id === id).map((l) => [l.item_id, l.qty, l.price]);
  assert.deepEqual(ls, [[paper.id, 8, 100], [gauze.id, 1, 30]]);
  const r = db.requests.find((x) => x.id === id);
  assert.deepEqual([r.borrower_name, r.department, r.note, r.edited_at], ['สมชาย ใจดี (แก้)', 'ICU', 'เพิ่มของ', '2026-10-30 10:00:00']);
  assert.equal(Core.requestValue(db, id), 830);
  const mv = db.movements.filter((m) => m.note === 'แก้ไขใบเบิก ' + r.request_no).map((m) => [m.type, m.qty]);
  assert.deepEqual(mv.sort(), [['cancel', 2], ['withdraw', -1], ['withdraw', -3]]);
  // ลบใบเบิกหลังแก้: คืนตามจำนวนล่าสุด
  Core.run(db, 'deleteRequest', { id, restock: true }, admin);
  assert.deepEqual([paper.available_qty, gloves.available_qty, gauze.available_qty], [before[0] + 5, before[1] + 2, before[2]]);
});

test('report 2569: prices from column N, dashed balance → 0, suppliers added once, re-run is a no-op', () => {
  const R = require('../docs/apps-script/report-2569.js');
  const db = Core.seed(new Date('2026-10-21T08:00:00'), SEED);
  const res = Core.applyReport(db, R, { now: new Date('2026-10-30T10:00:00') });
  assert.equal(res.missing.length + res.mismatch.length, 0, JSON.stringify(res.mismatch.slice(0, 3)));
  assert.equal(res.priced.length, 298);
  const byCode = (c) => db.items.find((i) => i.code === c);
  assert.equal(byCode('NSO-001').price, 7);
  assert.equal(byCode('NSO-003').price, 950);
  // ยอดคงเหลือในรายงานเป็น "-" แต่ในระบบยังมีของ → ปรับเป็น 0 (5 รายการจากไฟล์ 21 ต.ค.)
  assert.deepEqual(res.zeroed.map((z) => z.code).sort(), ['NSO-020', 'NSO-021', 'NSO-022', 'NSO-024', 'NSO-025']);
  assert.equal(byCode('NSO-021').available_qty, 0);
  assert.equal(db.movements.at(-1).note, 'ปรับตามรายงานบัญชีวัสดุ 2569');
  // รายการอื่นไม่แตะยอด
  assert.equal(byCode('NSO-001').available_qty, SEED.items[0][4]);
  // บริษัท: ชื่อซ้ำ (ไพส์ซีส, ไวด์, ชีวา ฯลฯ) เพิ่มครั้งเดียว
  assert.equal(res.suppliers.length, R.suppliers.length);
  assert.equal(new Set(db.suppliers.map((s) => s.name)).size, db.suppliers.length);
  const again = Core.applyReport(db, R);
  assert.deepEqual([again.priced.length, again.zeroed.length, again.suppliers.length, again.same], [0, 0, 0, 298]);
  // ชื่อในระบบไม่ตรงกับข้อมูล (รหัสถูกใช้กับพัสดุอื่น) → ข้าม
  byCode('NSO-010').name = 'กระดาษทิชชู่';
  const x = Core.applyReport(db, { note: 'x', items: [['NSO-010', 'S0010', 'Airway 90 mm', 1, 0]], suppliers: ['บริษัท จีเอชซี เมด จำกัด', 'จีเอชซี เมด จำกัด'] });
  assert.equal(x.mismatch.length, 1);
  assert.equal(x.suppliers.length, 0, 'มีอยู่แล้ว (ชื่อต่างกันแค่คำว่าบริษัท)');
});

test('Apps Script: previewReport2569 changes nothing, applyReport2569 updates the sheet and writes a log tab', () => {
  const { sheets, ctx } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/AllInOne.gs'), 'utf8'), ctx);
  ctx.setup();
  const before = JSON.stringify(sheets['อุปกรณ์'].data);
  ctx.previewReport2569();
  assert.equal(JSON.stringify(sheets['อุปกรณ์'].data), before);
  assert.match(sheets['ปรับตามรายงาน 2569'].data[0][1], /ตัวอย่าง/);
  ctx.applyReport2569();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  const st = post({ action: 'load', pin: '1234' }).state;
  assert.equal(st.items.find((i) => i.code === 'NSO-003').price, 950);
  assert.equal(st.items.find((i) => i.code === 'NSO-021').available_qty, 0);
  assert.ok(st.suppliers.length >= 80);
  assert.match(sheets['ปรับตามรายงาน 2569'].data[0][1], /ปรับแล้ว/);
});

test('Apps Script: an old borrow-system sheet is cleaned up and keeps its data', () => {
  const { sheets, ctx, triggers } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/AllInOne.gs'), 'utf8'), ctx);
  const ss = ctx.SpreadsheetApp.getActiveSpreadsheet();
  const put = (name, rows) => { ss.insertSheet(name).data = rows.map((r) => r.map(String)); };
  put('อุปกรณ์', [['id', 'code', 'name', 'category', 'unit', 'total_qty', 'available_qty', 'min_qty', 'location', 'active', 'kind', 'ถูกยืมอยู่', 'เบิกไปแล้วรวม'],
    [1, 'A-1', 'ถุงมือ', '', 'กล่อง', 12, 10, 0, '', 1, 'both', 2, 0]]);
  put('ประวัติการเบิก', [['เลขที่', 'วันที่', 'ประเภท', 'ผู้เบิก/ผู้ยืม', 'แผนก', 'รายการพัสดุ', 'จำนวนรวม', 'สถานะ', 'กำหนดคืน', 'หมายเหตุ',
    'id', 'phone', 'purpose', 'borrow_date', 'due_date', 'status', 'created_at', 'approved_at', 'returned_at', 'type'],
  ['BR69-001', '1/10/2569 09:00', 'ยืม', 'ผู้ยืมเดิม', 'ICU', 'ถุงมือ ×2 กล่อง', 2, 'กำลังยืม', '31/12/2569', '', 1, '', '', '2026-10-01', '2026-12-31', 'borrowed', '2026-10-01 09:00', '2026-10-01 09:00', '', 'borrow']]);
  put('รายการในคำขอ', [['request_id', 'item_id', 'qty', 'returned_qty', 'lost_qty', 'ค้างคืน'], [1, 1, 2, 0, 0, 2]]);
  put('ประวัติสต็อก', [['id', 'created_at', 'item_id', 'type', 'qty', 'available_after', 'total_after', 'request_no', 'note']]);
  put('หน่วยงาน', [['name', 'full_name'], ['ICU', '']]);
  put('พัสดุที่ถูกยืมอยู่', [['เลขที่'], ['BR69-001']]);
  put('รายการเบิก-ยืม', [['วันที่'], ['x']]);
  ctx.ScriptApp.newTrigger('autoReturnDaily').timeBased().everyDays(1).atHour(0).nearMinute(5).create();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  const st = post({ action: 'load', pin: '1234' }).state;
  assert.deepEqual(st.requests.map((r) => [r.request_no, r.borrower_name, r.status]), [['BR69-001', 'ผู้ยืมเดิม', 'issued']]);
  assert.deepEqual([st.items[0].available_qty, 'total_qty' in st.items[0], 'kind' in st.items[0]], [10, false, false]);
  assert.equal(post({ action: 'createRequest', payload: { borrower_name: 'คนใหม่', department: 'ICU', items: [{ item_id: 1, qty: 1 }] } }).ok, true);
  assert.equal(sheets['พัสดุที่ถูกยืมอยู่'], undefined, 'แท็บของระบบยืมถูกลบ');
  assert.equal(sheets['รายการเบิก-ยืม'], undefined);
  assert.deepEqual(sheets['รายการเบิก'].data[0], ['วันที่เวลาที่เบิก', 'เลขที่', 'ผู้เบิก', 'แผนก', 'รหัสพัสดุ', 'ชื่อพัสดุ', 'จำนวน', 'หน่วย', 'ราคาต่อหน่วย', 'รวมเงิน (บาท)']);
  assert.equal(sheets['รายการเบิก'].data.length, 3);
  assert.deepEqual(sheets['อุปกรณ์'].data[0], [...Core.TABLES.items, 'เบิกไปแล้วรวม']);
  assert.equal(sheets['อุปกรณ์'].data[1][Core.TABLES.items.indexOf('available_qty')], '9');
  assert.deepEqual(sheets['รายการในคำขอ'].data[0], ['request_id', 'item_id', 'qty', 'price', 'เลขที่', 'รหัสพัสดุ', 'ชื่อพัสดุ', 'หน่วย', 'รวมเงิน (บาท)']);
  const hdr = sheets['ประวัติการเบิก'].data[0];
  assert.ok(!hdr.some((h) => /ยืม|คืน|ประเภท|due|return|type|approved|borrow_date|สถานะ/.test(h)), hdr.join());
  assert.ok(sheets['ประวัติการเบิก'].cleared, 'สีหัวตารางเดิมถูกล้าง');
  assert.equal(post({ action: 'load', pin: '1234' }).state.requests.find((r) => r.request_no === 'BR69-001').borrower_name, 'ผู้ยืมเดิม');
  // ตัวตั้งเวลา "คืนอัตโนมัติ" ของระบบเดิมลบตัวเองทิ้งเมื่อทำงาน
  ctx.autoReturnDaily();
  assert.deepEqual(triggers, []);
});

test('core: request numbers are short (WD69-001) and count up within the Buddhist year', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  const at = (d) => ({ isAdmin: false, now: new Date(d + 'T09:00:00') });
  const w = (d) => {
    const id = Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 1 }] }, at(d));
    return db.requests.find((r) => r.id === id).request_no;
  };
  assert.equal(w('2026-03-01'), 'WD69-001');
  assert.equal(w('2026-11-30'), 'WD69-002'); // ไม่เริ่มใหม่ทุกเดือน
  db.requests.push({ ...db.requests[0], id: 50, request_no: 'BR69-007' }); // ใบยืมเดิมไม่กระทบเลขใบเบิก
  assert.equal(w('2026-12-01'), 'WD69-003');
  assert.equal(w('2027-01-02'), 'WD70-001'); // ขึ้นปีใหม่ เริ่ม 001
  // เลขเกิน 999 ขยายเป็น 4 หลัก
  db.requests.push({ ...db.requests[0], id: 999, request_no: 'WD70-999' });
  assert.equal(w('2027-01-03'), 'WD70-1000');
  assert.equal(w('2027-01-04'), 'WD70-1001');
});

test('core: sheet tables add readable Thai columns (withdraw only, time to the second)', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const gloves = db.items.find((i) => i.code === 'MD-005');
  const paper = db.items.find((i) => i.code === 'OF-001');
  Core.run(db, 'createRequest', { ...person, items: [{ item_id: paper.id, qty: 3 }] }, user);
  Core.run(db, 'createRequest', { ...person, items: [{ item_id: gloves.id, qty: 2 }] }, user);
  const d = Core.sheetData(db);
  assert.deepEqual(Object.keys(d).sort(), ['categories', 'departments', 'items', 'locations', 'log', 'movements', 'request_items', 'requests', 'suppliers', 'units']);
  const col = (t, name) => d[t].header.indexOf(name);
  // แท็บประวัติการเบิก: คอลัมน์อ่านง่ายอยู่หน้า ครบทุกช่องของระบบ (หัวไทยแปลงกลับได้) ล่าสุดอยู่บน
  assert.deepEqual(d.requests.header.slice(0, 8), ['เลขที่', 'วันที่เวลาที่เบิก', 'ผู้เบิก', 'แผนก', 'รายการพัสดุ', 'จำนวนรวม', 'รวมเงิน (บาท)', 'หมายเหตุ']);
  assert.equal(d.requests.header[d.requests.wide - 1], 'รายการพัสดุ');
  assert.deepEqual(Core.TABLES.requests.filter((c) => !d.requests.header.map((h) => Core.fieldOf('requests', h)).includes(c)), []);
  const req = d.requests.rows[0];
  assert.equal(req[col('requests', 'จำนวนรวม')], 2);
  assert.match(d.requests.rows[1][col('requests', 'วันที่เวลาที่เบิก')], /^\d{1,2}\/\d{1,2}\/25\d\d \d{2}:\d{2}:\d{2}$/);
  assert.equal(req[col('requests', 'รายการพัสดุ')], 'ถุงมือ M ×2 กล่อง');
  assert.equal(d.request_items.rows[1][col('request_items', 'ชื่อพัสดุ')], 'ถุงมือ M');
  assert.equal(d.items.rows.find((r) => r[1] === 'OF-001')[col('items', 'เบิกไปแล้วรวม')], 3);
  assert.ok(!JSON.stringify([d.items.header, d.request_items.header, d.movements.header, d.log.header]).match(/ยืม|คืน|total|kind/));
  // แท็บรายการเบิก: ชื่อพัสดุ + จำนวน ล่าสุดอยู่บน
  const lc = (name) => d.log.header.indexOf(name);
  assert.deepEqual(d.log.rows.map((r) => [r[lc('ชื่อพัสดุ')], r[lc('จำนวน')], r[lc('หน่วย')]]), [['ถุงมือ M', 2, 'กล่อง'], ['กระดาษ A4', 3, 'รีม']]);
  assert.match(d.log.rows[0][lc('วันที่เวลาที่เบิก')], /^\d{1,2}\/\d{1,2}\/25\d\d \d{2}:\d{2}:\d{2}$/);
  // อ่านกลับจากชีต: คอลัมน์ไทยถูกละไว้ ข้อมูลเหมือนเดิม
  const back = {};
  Object.keys(Core.TABLES).forEach((t) => {
    // เหมือน Code.gs: แปลงหัวไทยกลับ แล้วข้ามคอลัมน์ที่ระบบสร้างไว้อ่านอย่างเดียว
    back[t] = d[t].rows.map((r) => Object.fromEntries(d[t].header.map((h, i) => [Core.fieldOf(t, h), String(r[i])])
      .filter(([k]) => Core.TABLES[t].includes(k))));
  });
  const loaded = Core.normalize(back);
  const be = String(new Date().getFullYear() + 543).slice(2);
  assert.deepEqual(loaded.requests.sort((a, b) => a.id - b.id).map((r) => [r.status, r.request_no, r.borrower_name, r.department]),
    [['issued', 'WD' + be + '-001', 'สมชาย ใจดี', 'งานธุรการ'], ['issued', 'WD' + be + '-002', 'สมชาย ใจดี', 'งานธุรการ']]);
  assert.equal(loaded.items.find((i) => i.code === 'MD-005').available_qty, gloves.available_qty);
  assert.deepEqual(loaded.requests[0].created_at, db.requests[0].created_at);
});

test('Cloudflare _headers is generated from netlify.toml (same CSP and cache rules)', () => {
  const { build } = require('../scripts/cf-headers.js');
  const toml = fs.readFileSync(path.join(__dirname, '../netlify.toml'), 'utf8');
  const out = build(toml);
  const csp = toml.match(/Content-Security-Policy = "(.*)"/)[1];
  assert.ok(out.includes('/*\n  Content-Security-Policy: ' + csp + '\n'));
  assert.match(out, /\n {2}X-Frame-Options: DENY\n/);
  assert.match(out, /\/fonts\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
  assert.match(out, /\/vendor\/\*\n {2}Cache-Control: public, max-age=31536000, immutable/);
});

test('Cloudflare build marks preview branches as the test site, the main branch as the real site', () => {
  const { buildInfo } = require('../scripts/cf-headers.js');
  assert.equal(buildInfo({}), null, 'ไม่ได้ build บน Cloudflare: ใช้ไฟล์ตั้งต้น (เว็บจริง)');
  const parse = (js) => JSON.parse(js.match(/BUILD_INFO = (\{.*\});/)[1]);
  const prod = parse(buildInfo({ WORKERS_CI_BRANCH: 'claude/magical-hamilton-g35q6e', WORKERS_CI_COMMIT_SHA: 'abcdef1234567' }));
  assert.deepEqual([prod.test, prod.commit], [false, 'abcdef1']);
  const prev = parse(buildInfo({ WORKERS_CI_BRANCH: 'claude/admiring-clarke-lvp2ic', WORKERS_CI_COMMIT_SHA: '1234567890' }));
  assert.deepEqual([prev.test, prev.branch, prev.commit], [true, 'claude/admiring-clarke-lvp2ic', '1234567']);
  assert.equal(parse(buildInfo({ CF_PAGES_BRANCH: 'fix-x', CF_PAGES_COMMIT_SHA: 'ffffffffff' })).test, true);
  // ไฟล์ตั้งต้นใน repo = เว็บจริง ยกเว้นลิงก์ preview ของ Netlify / Vercel
  const src = fs.readFileSync(path.join(__dirname, '../docs/build-info.js'), 'utf8');
  const isTest = (hostname) => { const ctx = { window: {}, location: { hostname } }; vm.runInNewContext(src, ctx); return ctx.window.BUILD_INFO.test; };
  for (const h of ['pakkred-supply.cocolnwza004.workers.dev', 'parkkredhospitalsupply.netlify.app', 'cocolnwza004.github.io', 'borrow-cocolnwza004s-projects.vercel.app', 'borrow-ten.vercel.app', 'localhost', 'supply.example.go.th']) {
    assert.equal(isTest(h), false, h + ' = เว็บจริง');
  }
  for (const h of ['deploy-preview-30--parkkredhospitalsupply.netlify.app', 'claude-admiring-clarke-lvp2ic--parkkredhospitalsupply.netlify.app',
    'borrow-git-claude-admiring-clarke-lvp2ic-cocolnwza004s-projects.vercel.app', 'borrow-2b1is6tfx-cocolnwza004s-projects.vercel.app']) {
    assert.equal(isTest(h), true, h + ' = เว็บทดสอบ');
  }
});

test('Apps Script: withdrawing an out-of-stock item writes a negative balance to the sheet; receiving offsets it', () => {
  const { sheets, ctx } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/AllInOne.gs'), 'utf8'), ctx);
  ctx.setup();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  const inv = sheets['อุปกรณ์'];
  const col = inv.data[0].indexOf('available_qty');
  const row = () => inv.data.find((r, i) => i > 0 && Number(r[col]) === 0); // พัสดุที่หมดในชีต
  const outRow = row();
  const id = Number(outRow[0]);
  const cell = () => inv.data.find((r) => r[0] === String(id))[col];
  const w = post({ action: 'createRequest', payload: { borrower_name: 'ก ข', department: 'ICU', items: [{ item_id: id, qty: 3 }] } });
  assert.equal(w.ok, true, w.error);
  assert.equal(cell(), '-3');
  assert.equal(post({ action: 'load' }).state.items.find((i) => i.id === id).available_qty, -3);
  assert.equal(post({ action: 'stock', payload: { item_id: id, type: 'receive', qty: 10 }, pin: '1234' }).ok, true);
  assert.equal(cell(), '7');
});

test('Apps Script: resetForLaunch clears history and zeroes stock but keeps items and departments', () => {
  const { sheets, ctx, logs } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/AllInOne.gs'), 'utf8'), ctx);
  ctx.setup();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  post({ action: 'createRequest', payload: { borrower_name: 'ทดลอง', department: 'ICU', items: [{ item_id: 2, qty: 3 }] } });
  post({ action: 'createRequest', payload: { borrower_name: 'ทดลอง', department: 'ER', items: [{ item_id: 4, qty: 1 }] } });
  post({ action: 'saveItem', payload: { id: 5, code: 'NSO-005', name: 'ชื่อที่แก้แล้ว', category: 'เวชภัณฑ์มิใช่ยา', unit: 'กล่อง', min_qty: 7, location: 'ห้อง 2', active: 1 }, pin: '1234' });
  const items = sheets['อุปกรณ์'].data.length;
  const depts = sheets['หน่วยงาน'].data.length;
  ctx.resetForLaunch();
  assert.match(logs.at(-1), /ลบใบเบิก 2 ใบ/);
  for (const t of ['ประวัติการเบิก', 'รายการในคำขอ', 'ประวัติสต็อก', 'รายการเบิก']) assert.equal(sheets[t].data.length, 1, t + ' เหลือแค่หัวตาราง');
  assert.equal(sheets['อุปกรณ์'].data.length, items);
  assert.equal(sheets['หน่วยงาน'].data.length, depts);
  const st = post({ action: 'load', pin: '1234' }).state;
  assert.ok(st.items.every((i) => i.available_qty === 0));
  assert.equal(st.requests.length + st.movements.length + st.request_items.length, 0);
  const edited = st.items.find((i) => i.id === 5);
  assert.deepEqual([edited.name, edited.unit, edited.min_qty, edited.location], ['ชื่อที่แก้แล้ว', 'กล่อง', 7, 'ห้อง 2']);
  // ใช้งานต่อได้ทันที: เลขที่เริ่มใหม่ และเบิกของที่ยอดเป็น 0 ได้ (ติดลบ)
  const w = post({ action: 'createRequest', payload: { borrower_name: 'คนแรก', department: 'ICU', items: [{ item_id: 2, qty: 1 }] } });
  assert.equal(w.ok, true);
  assert.match(post({ action: 'load', pin: '1234' }).state.requests[0].request_no, /^WD\d\d-001$/);
});

test('Apps Script: an item row typed straight into the sheet (no id/active/unit) is picked up and can be withdrawn', () => {
  const { sheets, ctx, cache } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/AllInOne.gs'), 'utf8'), ctx);
  ctx.setup();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  const inv = sheets['อุปกรณ์'];
  const h = inv.data[0];
  const row = (vals) => h.map((c) => (c in vals ? String(vals[c]) : ''));
  // เจ้าหน้าที่พิมพ์แถวใหม่ท้ายตาราง: ใส่แค่รหัส ชื่อ คงเหลือ
  inv.data.push(row({ code: 'NEW-1', name: 'ถุงมือไนไตรล์ M', available_qty: 50 }));
  // แถวที่คัดลอกมาแล้ว id ซ้ำกับของเดิม
  inv.data.push(row({ id: 2, code: 'NEW-2', name: 'ผ้าก๊อซ 3x3', unit: 'ห่อ', available_qty: 10, active: 1 }));
  cache.clear(); // แก้ในชีตเอง: เว็บเห็นเมื่อแคชยอดสต็อก (20 วินาที) หมดอายุ
  const st = post({ action: 'load' }).state;
  const glove = st.items.find((i) => i.code === 'NEW-1');
  const gauze = st.items.find((i) => i.code === 'NEW-2');
  assert.deepEqual([glove.id, glove.active, glove.unit, glove.available_qty], [N + 1, 1, 'ชิ้น', 50]);
  assert.equal(gauze.id, N + 2);
  assert.equal(st.items.find((i) => i.id === 2).code, 'NSO-002'); // ของเดิมไม่เปลี่ยน
  const w = post({ action: 'createRequest', payload: { borrower_name: 'ก', department: 'ICU', items: [{ item_id: N + 1, qty: 5 }, { item_id: N + 2, qty: 1 }] } });
  assert.equal(w.ok, true, w.error);
  // id ที่ระบบตั้งให้ถูกเขียนกลับลงชีต
  const back = (code) => inv.data.find((r) => r[h.indexOf('code')] === code);
  assert.deepEqual([back('NEW-1')[0], back('NEW-1')[h.indexOf('available_qty')]], [String(N + 1), '45']);
  assert.deepEqual([back('NEW-2')[0], back('NEW-2')[h.indexOf('available_qty')]], [String(N + 2), '9']);
  assert.equal(inv.data.filter((r, i) => i > 0 && r[0] === '2').length, 1);
});

test('Apps Script: updateSheet adds missing tabs (บริษัท) and keeps every row', () => {
  const { sheets, ctx, logs } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/AllInOne.gs'), 'utf8'), ctx);
  ctx.setup();
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  assert.equal(post({ action: 'createRequest', payload: { borrower_name: 'ก', department: 'ICU', items: [{ item_id: 1, qty: 2 }] } }).ok, true);
  assert.throws(() => ctx.setup(), /updateSheet/);
  delete sheets['บริษัท']; // ชีตที่ใช้โค้ดเวอร์ชันก่อนมีแท็บบริษัท
  const before = JSON.stringify(sheets['ประวัติการเบิก'].data);
  ctx.updateSheet();
  assert.match(logs.at(-1), /สร้างแท็บ บริษัท/);
  assert.equal(sheets['บริษัท'].data[0][0], 'name');
  assert.equal(JSON.stringify(sheets['ประวัติการเบิก'].data), before);
  assert.equal(post({ action: 'load', pin: '1234' }).state.requests.length, 1);
  ctx.updateSheet();
  assert.match(logs.at(-1), /มีแท็บครบแล้ว/);
});

test('Apps Script: loadNewStock replaces every item with the new stock file and keeps departments', () => {
  const { sheets, ctx, logs } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/AllInOne.gs'), 'utf8'), ctx);
  // ชีตเดิม: รายการพัสดุชุดเก่า 3 รายการ + แผนกที่เพิ่มเอง + มีประวัติเบิก
  const OLD = { departments: [['ICU', 'งานการพยาบาลผู้ป่วยหนัก'], ['คลินิกพิเศษ', 'แผนกที่เพิ่มเอง']], categories: ['เก่า'],
    items: [['OLD-1', 'ของเก่า 1', 'เก่า', 'ชิ้น', 5, 0, '', 'both'], ['OLD-2', 'ของเก่า 2', 'เก่า', 'ชิ้น', 9, 0, '', 'both'], ['OLD-3', 'ของเก่า 3', 'เก่า', 'ชิ้น', 1, 0, '', 'both']] };
  ctx.saveDb_(Core.seed(new Date(), OLD));
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  assert.equal(post({ action: 'createRequest', payload: { borrower_name: 'ก', department: 'คลินิกพิเศษ', items: [{ item_id: 1, qty: 2 }] } }).ok, true);
  ctx.loadNewStock();
  assert.match(logs.at(-1), /301 รายการ \(เดิม 3 รายการ, ลบใบเบิก 1 ใบ\)/);
  const st = post({ action: 'load', pin: '1234' }).state;
  assert.equal(st.items.length, N);
  assert.deepEqual(st.items.map((i) => [i.code, i.name, i.available_qty]), SEED.items.map((x) => [x[0], x[1], x[4]]));
  assert.equal(st.requests.length + st.request_items.length, 0);
  assert.deepEqual(st.departments.map((d) => d.name), ['ICU', 'คลินิกพิเศษ']); // แผนกเดิมอยู่ครบ
  assert.ok(st.categories.some((c) => c.name === 'เวชภัณฑ์มิใช่ยา'));
  for (const t of ['ประวัติการเบิก', 'รายการเบิก']) assert.equal(sheets[t].data.length, 1);
  assert.equal(sheets['อุปกรณ์'].data.length, N + 1);
  // เบิกได้ทันทีด้วยรหัสใหม่
  const w = post({ action: 'createRequest', payload: { borrower_name: 'ข', department: 'ICU', items: [{ item_id: 1, qty: 3 }] } });
  assert.equal(w.ok, true);
  assert.equal(post({ action: 'load' }).state.items[0].available_qty, Q(1) - 3);
});
