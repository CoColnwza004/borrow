const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../docs/core.js');

const admin = { isAdmin: true };
const user = { isAdmin: false };

const DUE = '2099-12-31';
const person = { borrower_name: 'สมชาย ใจดี', department: 'งานธุรการ' };
// ข้อมูลเล็ก ๆ สำหรับทดสอบกฎ (แยกจากข้อมูลจริงใน docs/seed-data.js)
const FIXTURE = {
  departments: [['งานธุรการ', ''], ['ICU', 'งานการพยาบาลผู้ป่วยหนัก']],
  categories: ['ทั่วไป'],
  items: [
    ['OF-001', 'กระดาษ A4', 'ทั่วไป', 'รีม', 120, 20, 'คลัง', 'withdraw'],
    ['EQ-005', 'โน้ตบุ๊ก', 'ทั่วไป', 'เครื่อง', 6, 1, 'คลัง', 'borrow'],
    ['EQ-006', 'โปรเจกเตอร์', 'ทั่วไป', 'เครื่อง', 3, 1, 'คลัง', 'borrow'],
  ],
};

test('core: withdraw deducts available and total immediately', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  const id = Core.run(db, 'createRequest', { ...person, type: 'withdraw', items: [{ item_id: paper.id, qty: 5 }] }, user);
  const r = db.requests.find((x) => x.id === id);
  assert.equal(r.status, 'issued');
  assert.equal(r.type, 'withdraw');
  assert.match(r.request_no, /^WD\d{2}-001$/);
  assert.equal(r.due_date, '');
  assert.equal(paper.available_qty, 115);
  assert.equal(paper.total_qty, 115);
  assert.equal(db.movements.at(-1).type, 'withdraw');
  assert.throws(() => Core.run(db, 'returnItems', { id, items: [{ item_id: paper.id, returned_qty: 1 }] }, admin), /กำลังยืม/);
});

test('core: borrow deducts available only, return puts it back', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const nb = db.items.find((i) => i.code === 'EQ-005');
  const id = Core.run(db, 'createRequest', { ...person, type: 'borrow', due_date: DUE, items: [{ item_id: nb.id, qty: 2 }] }, user);
  const r = db.requests.find((x) => x.id === id);
  assert.equal(r.status, 'borrowed');
  assert.match(r.request_no, /^BR\d{2}-001$/);
  assert.equal(nb.available_qty, 4);
  assert.equal(nb.total_qty, 6);
  assert.throws(() => Core.run(db, 'returnItems', { id, items: [{ item_id: nb.id, returned_qty: 2 }] }, user), /PIN/);
  Core.run(db, 'returnItems', { id, items: [{ item_id: nb.id, returned_qty: 1, lost_qty: 1 }] }, admin);
  assert.equal(nb.available_qty, 5);
  assert.equal(nb.total_qty, 5);
  assert.equal(r.status, 'returned');
});

test('core: validation for type, department, due date, kind and stock', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  const proj = db.items.find((i) => i.code === 'EQ-006');
  const w = { ...person, type: 'withdraw', items: [{ item_id: paper.id, qty: 1 }] };
  assert.throws(() => Core.run(db, 'createRequest', { ...w, type: '' }, user), /เบิก หรือ ยืม/);
  assert.throws(() => Core.run(db, 'createRequest', { ...w, department: 'แผนกที่ไม่มี' }, user), /แผนกจากรายการ/);
  assert.throws(() => Core.run(db, 'createRequest', { ...w, items: [] }, user), /อย่างน้อย 1/);
  assert.throws(() => Core.run(db, 'createRequest', { ...w, items: [{ item_id: paper.id, qty: 999 }] }, user), /คงเหลือไม่พอ/);
  assert.throws(() => Core.run(db, 'createRequest', { ...w, items: [{ item_id: proj.id, qty: 1 }] }, user), /ยืมได้อย่างเดียว/);
  const b = { ...person, type: 'borrow', items: [{ item_id: proj.id, qty: 1 }] };
  assert.throws(() => Core.run(db, 'createRequest', b, user), /วันคืน/);
  assert.throws(() => Core.run(db, 'createRequest', { ...b, due_date: '2000-01-01' }, user), /วันพรุ่งนี้/);
  assert.throws(() => Core.run(db, 'createRequest', { ...b, due_date: Core.ymd(new Date()) }, user), /วันพรุ่งนี้/);
  assert.throws(() => Core.run(db, 'createRequest', { ...b, due_date: DUE, items: [{ item_id: paper.id, qty: 1 }] }, user), /เบิกได้อย่างเดียว/);
  assert.equal(db.requests.length, 0);
  assert.equal(paper.available_qty, 120);
});

test('core: legacy rows without type/kind still load', () => {
  const db = Core.normalize({
    items: [{ id: 1, code: 'X', name: 'old', total_qty: 2, available_qty: 2, active: 1 }],
    requests: [{ id: 1, request_no: 'BR2601-0001', borrower_name: 'a', department: 'b', status: 'pending' }],
  });
  assert.equal(db.items[0].kind, 'both');
  assert.equal(db.requests[0].type, 'borrow');
  Core.run(db, 'approve', { id: 1 }, admin);
  assert.equal(db.requests[0].status, 'borrowed');
});

function mockAppsScript() {
  const sheets = {};
  const mkSheet = (name) => {
    const sh = {
      data: [],
      getLastRow: () => sh.data.length,
      getDataRange: () => ({ getValues: () => sh.data.map((r) => r.slice()) }),
      clearContents: () => { sh.data = []; },
      getRange: (r, c, nr) => ({
        setNumberFormat() { return this; },
        setFontWeight() { return this; },
        setBackground() { return this; },
        setValues: (rows) => { sh.data = rows.map((x) => x.slice()); },
      }),
      setFrozenRows() {},
    };
    sheets[name] = sh;
    return sh;
  };
  const triggers = [];
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
    getSheetByName: (n) => sheets[n] || null, insertSheet: mkSheet, getSpreadsheetTimeZone: () => 'Asia/Bangkok' };
  const ctx = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ScriptApp,
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
  });
  return { sheets, ctx, triggers, order };
}

test('Apps Script: setup + doPost round-trip through mocked Google Sheets', () => {
  const { sheets, ctx } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/Code.gs'), 'utf8'), ctx);
  assert.throws(() => ctx.setup(), /SeedData/);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/seed-data.js'), 'utf8'), ctx);
  ctx.setup();
  assert.equal(sheets['อุปกรณ์'].data.length, 287);
  assert.equal(sheets['หน่วยงาน'].data.length, 23);
  assert.deepEqual(JSON.parse(JSON.stringify(sheets['พัสดุที่ถูกยืมอยู่'].data)), [['เลขที่', 'วันที่ยืม', 'ผู้ยืม', 'แผนก', 'รหัสพัสดุ', 'ชื่อพัสดุ', 'จำนวนที่ยังไม่คืน', 'หน่วย', 'กำหนดคืน']]);
  ctx.setup(); // ยังไม่มีการเบิก/ยืม รันซ้ำได้

  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  const icu = { borrower_name: 'สมชาย ใจดี', department: 'ICU' };
  const create = post({ action: 'createRequest', payload: { ...icu, type: 'withdraw', items: [{ item_id: 2, qty: 2 }] } });
  assert.equal(create.ok, true);
  assert.throws(() => ctx.setup(), /มีรายการเบิก\/ยืม/);
  const borrow = post({ action: 'createRequest', payload: { ...icu, type: 'borrow', due_date: DUE, items: [{ item_id: 4, qty: 1 }] } });
  assert.equal(borrow.ok, true);
  // แท็บ "พัสดุที่ถูกยืมอยู่" ระบุว่าใครยืมอะไรไป
  assert.deepEqual(JSON.parse(JSON.stringify(sheets['พัสดุที่ถูกยืมอยู่'].data.slice(1).map((r) => [r[2], r[3], r[5], r[6]]))), [['สมชาย ใจดี', 'ICU', 'Airway 100mm', '1']]);
  const bad = post({ action: 'returnItems', payload: { id: borrow.result, items: [{ item_id: 4, returned_qty: 1 }] }, pin: 'wrong' });
  assert.equal(bad.ok, false);
  // ผู้ใช้ทั่วไป (ไม่มี PIN) ไม่เห็นประวัติ เห็นเฉพาะใบที่ตัวเองเพิ่งส่ง
  assert.deepEqual(create.state.requests.map((r) => r.id), [create.result]);
  assert.equal(create.state.request_items.length, 1);
  assert.equal(create.state.movements.length, 0);
  const pub = JSON.parse(ctx.doGet().body).state;
  assert.equal(pub.requests.length, 0);
  assert.equal(pub.items.length, 286);
  assert.equal(pub.departments.length, 22);
  assert.equal(post({ action: 'load', pin: 'wrong' }).state.requests.length, 0);
  // reload from "sheet" text values (เจ้าหน้าที่เห็นครบ)
  const loaded = post({ action: 'load', pin: '1234' }).state;
  assert.equal(loaded.items.find((i) => i.id === 2).available_qty, 723);
  assert.equal(loaded.items.find((i) => i.id === 2).kind, 'both');
  assert.equal(loaded.items.find((i) => i.id === 4).available_qty, 59);
  assert.equal(loaded.departments.find((d) => d.name === 'ICU').full_name, 'งานการพยาบาลผู้ป่วยหนัก');
  assert.deepEqual(loaded.requests.map((r) => [r.type, r.status]), [['withdraw', 'issued'], ['borrow', 'borrowed']]);
  const ret = post({ action: 'returnItems', payload: { id: borrow.result, items: [{ item_id: 4, returned_qty: 1 }] }, pin: '1234' });
  assert.equal(ret.ok, true);
  assert.equal(ret.state.items.find((i) => i.id === 4).available_qty, 60);
});

test('seed data: stock NSO list and departments', () => {
  const SEED = require('../docs/seed-data.js');
  const db = Core.seed(new Date(), SEED);
  assert.equal(db.items.length, 286);
  assert.equal(db.departments.length, 22);
  assert.equal(new Set(db.items.map((i) => i.code)).size, 286);
  assert.equal(new Set(db.items.map((i) => i.name)).size, 286);
  assert.equal(db.items.reduce((s, i) => s + i.available_qty, 0), 21015);
  const byName = (n) => db.items.find((i) => i.name === n);
  assert.equal(byName('350 ml water humidifier').available_qty, 725);
  assert.equal(byName('BP print (ม้วน)').available_qty, 555);
  assert.equal(byName('เอี๊ยมพลาสติก แขนยาวผูกหลัง').available_qty, 0);
  assert.equal(byName('เอี๊ยมพลาสติก แขนยาวผูกหลัง').min_qty, 250); // ใช้ 1500 ใน 6 เดือน
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
  assert.equal(sheets['อุปกรณ์'].data.length, 287);
  const res = JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify({ action: 'createRequest',
    payload: { borrower_name: 'ทดสอบ', department: 'ER', type: 'withdraw', items: [{ item_id: 2, qty: 5 }] } }) } }).body);
  assert.equal(res.ok, true);
  assert.equal(res.state.items.find((i) => i.id === 2).available_qty, 720);
});

test('core: stock edited directly in the sheet (available_qty only) keeps working', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const nb = db.items.find((i) => i.code === 'EQ-005');
  const id = Core.run(db, 'createRequest', { ...person, type: 'borrow', due_date: DUE, items: [{ item_id: nb.id, qty: 2 }] }, user);
  // เจ้าหน้าที่แก้ในชีต: กระดาษจาก 120 เป็น 200, โน้ตบุ๊กคงเหลือจาก 4 เป็น 10 (ไม่ได้แตะ total_qty) และพิมพ์เป็นข้อความ
  const raw = JSON.parse(JSON.stringify(db));
  raw.items.find((i) => i.code === 'OF-001').available_qty = '200';
  raw.items.find((i) => i.code === 'EQ-005').available_qty = '10';
  const loaded = Core.normalize(raw);
  const paper = loaded.items.find((i) => i.code === 'OF-001');
  const nb2 = loaded.items.find((i) => i.code === 'EQ-005');
  assert.equal(paper.total_qty, 200);
  assert.equal(nb2.total_qty, 12); // 10 ในคลัง + 2 ที่ยืมออกไป
  Core.run(loaded, 'createRequest', { ...person, type: 'withdraw', items: [{ item_id: paper.id, qty: 150 }] }, user);
  assert.equal(paper.available_qty, 50);
  Core.run(loaded, 'returnItems', { id, items: [{ item_id: nb2.id, returned_qty: 2 }] }, admin);
  assert.equal(nb2.available_qty, 12);
  assert.equal(nb2.total_qty, 12);
});

test('core: monthly summary of withdrawals and borrows', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const ctxAt = (d) => ({ isAdmin: true, now: new Date(d) });
  const paper = db.items.find((i) => i.code === 'OF-001');
  const nb = db.items.find((i) => i.code === 'EQ-005');
  const proj = db.items.find((i) => i.code === 'EQ-006');
  const icu = { borrower_name: 'ก', department: 'ICU' };
  Core.run(db, 'createRequest', { ...icu, type: 'withdraw', items: [{ item_id: paper.id, qty: 5 }] }, ctxAt('2026-10-02T09:00:00'));
  Core.run(db, 'createRequest', { ...person, type: 'withdraw', items: [{ item_id: paper.id, qty: 3 }] }, ctxAt('2026-10-05T09:00:00'));
  const b1 = Core.run(db, 'createRequest', { ...icu, type: 'borrow', due_date: '2026-10-10', items: [{ item_id: nb.id, qty: 2 }, { item_id: proj.id, qty: 1 }] }, ctxAt('2026-10-06T09:00:00'));
  Core.run(db, 'returnItems', { id: b1, items: [{ item_id: nb.id, returned_qty: 1, lost_qty: 0 }, { item_id: proj.id, returned_qty: 1 }] }, ctxAt('2026-10-08T09:00:00'));
  Core.run(db, 'createRequest', { ...person, type: 'withdraw', items: [{ item_id: paper.id, qty: 50 }] }, ctxAt('2026-11-01T09:00:00'));
  const sum = Core.monthlySummary(db, '2026-10', '2026-10-20');
  assert.deepEqual(sum.totals, { withdraw_docs: 2, withdraw_qty: 8, borrow_docs: 1, borrow_qty: 3, returned_qty: 2, lost_qty: 0, outstanding_qty: 1, overdue_docs: 1 });
  assert.deepEqual(sum.withdrawn.map((r) => [r.code, r.qty, r.times]), [['OF-001', 8, 2]]);
  assert.deepEqual(sum.borrowed.map((r) => [r.code, r.qty, r.returned, r.outstanding]), [['EQ-005', 2, 1, 1], ['EQ-006', 1, 1, 0]]);
  assert.deepEqual(sum.departments.map((d) => [d.name, d.withdraw_qty, d.borrow_qty]), [['ICU', 5, 3], ['งานธุรการ', 3, 0]]);
  assert.equal(sum.requests.length, 3);
  assert.equal(Core.monthlySummary(db, '2026-11', '2026-11-02').totals.withdraw_qty, 50);
  assert.equal(Core.monthlySummary(db, '2026-09', '2026-11-02').requests.length, 0);
});

test('core: borrowed items go back to stock automatically on the due date', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const nb = db.items.find((i) => i.code === 'EQ-005');
  const proj = db.items.find((i) => i.code === 'EQ-006');
  const at = (d) => ({ isAdmin: true, now: new Date(d + 'T09:00:00') });
  const id = Core.run(db, 'createRequest', { ...person, type: 'borrow', due_date: '2026-10-15',
    items: [{ item_id: nb.id, qty: 3 }, { item_id: proj.id, qty: 2 }] }, at('2026-10-10'));
  // คืนบางส่วนก่อนกำหนด + แจ้งหาย 1
  Core.run(db, 'returnItems', { id, items: [{ item_id: nb.id, returned_qty: 1, lost_qty: 1 }] }, at('2026-10-12'));
  assert.equal(nb.available_qty, 4);
  assert.equal(Core.autoReturnDue(db, new Date('2026-10-14T23:59:00')), 0);
  assert.equal(db.requests[0].status, 'borrowed');
  assert.equal(Core.autoReturnDue(db, new Date('2026-10-15T00:05:00')), 1);
  const r = db.requests[0];
  assert.equal(r.status, 'returned');
  assert.match(r.note, /คืนอัตโนมัติ/);
  assert.equal(nb.available_qty, 5); // ค้าง 1 คืนอัตโนมัติ (ที่หายไม่คืน)
  assert.equal(proj.available_qty, 3);
  const auto = db.movements.filter((m) => m.note === Core.AUTO_RETURN_NOTE);
  assert.deepEqual(auto.map((m) => [m.item_id, m.qty, m.type]), [[nb.id, 1, 'return'], [proj.id, 2, 'return']]);
  assert.equal(Core.autoReturnDue(db, new Date('2026-10-20T00:05:00')), 0); // ไม่คืนซ้ำ
  assert.equal(nb.available_qty, 5);
});

test('Apps Script: daily trigger and page loads apply automatic returns', () => {
  const { sheets, ctx, triggers, order } = mockAppsScript();
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/AllInOne.gs'), 'utf8'), ctx);
  ctx.setup();
  ctx.setup(); // รันซ้ำ trigger ไม่ซ้อน
  assert.deepEqual(order, ['รายการเบิก-ยืม', 'พัสดุที่ถูกยืมอยู่']); // แท็บอ่านง่ายอยู่หน้าสุด ย้ายครั้งเดียว
  assert.deepEqual(triggers.map((t) => t.getHandlerFunction()), ['autoReturnDaily']);
  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  const b = post({ action: 'createRequest', payload: { borrower_name: 'ก', department: 'ICU', type: 'borrow', due_date: DUE, items: [{ item_id: 4, qty: 5 }] } });
  assert.equal(b.ok, true);
  const qty = () => Number(sheets['อุปกรณ์'].data.find((row) => row[0] === '4')[6]);
  assert.equal(qty(), 55);
  const logRow = sheets['รายการเบิก-ยืม'].data[1];
  assert.deepEqual([logRow[2], logRow[3], logRow[6], logRow[7], logRow[8]], ['ยืม', 'ก', 'Airway 100mm', '5', 'ชิ้น']);
  // จำลองว่าถึงวันคืนแล้ว: แก้วันคืนในชีตเป็นเมื่อวาน
  const req = sheets['คำขอยืม'];
  const dueCol = req.data[0].indexOf('due_date');
  req.data[1][dueCol] = '2020-01-01';
  ctx.autoReturnDaily();
  assert.equal(qty(), 60);
  assert.equal(req.data[1][req.data[0].indexOf('status')], 'returned');
  // ใบที่สอง: ไม่มี trigger ทำงาน แต่มีคนเปิดเว็บ (load) ก็คืนให้เช่นกัน
  post({ action: 'createRequest', payload: { borrower_name: 'ข', department: 'ER', type: 'borrow', due_date: DUE, items: [{ item_id: 4, qty: 2 }] } });
  assert.equal(qty(), 58);
  req.data[2][dueCol] = '2020-01-01';
  JSON.parse(ctx.doGet().body);
  assert.equal(qty(), 60);
});

test('core: request numbers are short (WD69-001) and count up within the Buddhist year', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const paper = db.items.find((i) => i.code === 'OF-001');
  const nb = db.items.find((i) => i.code === 'EQ-005');
  const at = (d) => ({ isAdmin: false, now: new Date(d + 'T09:00:00') });
  const w = (d) => {
    const id = Core.run(db, 'createRequest', { ...person, type: 'withdraw', items: [{ item_id: paper.id, qty: 1 }] }, at(d));
    return db.requests.find((r) => r.id === id).request_no;
  };
  assert.equal(w('2026-03-01'), 'WD69-001');
  assert.equal(w('2026-11-30'), 'WD69-002'); // ไม่เริ่มใหม่ทุกเดือน
  const b = Core.run(db, 'createRequest', { ...person, type: 'borrow', due_date: '2026-12-31', items: [{ item_id: nb.id, qty: 1 }] }, at('2026-12-01'));
  assert.equal(db.requests.find((r) => r.id === b).request_no, 'BR69-001');
  assert.equal(w('2027-01-02'), 'WD70-001'); // ขึ้นปีใหม่ เริ่ม 001
  // เลขเกิน 999 ขยายเป็น 4 หลัก
  db.requests.push({ ...db.requests[0], id: 999, request_no: 'WD70-999' });
  assert.equal(w('2027-01-03'), 'WD70-1000');
  assert.equal(w('2027-01-04'), 'WD70-1001');
});

test('core: sheet tables add readable Thai columns and an on-loan tab', () => {
  const db = Core.seed(new Date(), FIXTURE);
  const nb = db.items.find((i) => i.code === 'EQ-005');
  const paper = db.items.find((i) => i.code === 'OF-001');
  Core.run(db, 'createRequest', { ...person, type: 'withdraw', items: [{ item_id: paper.id, qty: 3 }] }, user);
  const id = Core.run(db, 'createRequest', { ...person, type: 'borrow', due_date: DUE, items: [{ item_id: nb.id, qty: 2 }] }, user);
  Core.run(db, 'returnItems', { id, items: [{ item_id: nb.id, returned_qty: 1 }] }, admin);
  const d = Core.sheetData(db);
  const col = (t, name) => d[t].header.indexOf(name);
  // คอลัมน์เดิมอยู่ที่เดิม คอลัมน์ไทยต่อท้าย
  assert.deepEqual(d.requests.header.slice(0, Core.TABLES.requests.length), Core.TABLES.requests);
  const req = d.requests.rows[1];
  assert.equal(req[col('requests', 'ประเภท')], 'ยืม');
  assert.equal(req[col('requests', 'สถานะ')], 'กำลังยืม');
  assert.equal(req[col('requests', 'รายการพัสดุ')], 'โน้ตบุ๊ก ×2 เครื่อง');
  const line = d.request_items.rows[1];
  assert.deepEqual([line[col('request_items', 'ชื่อพัสดุ')], line[col('request_items', 'ค้างคืน')]], ['โน้ตบุ๊ก', 1]);
  assert.equal(d.items.rows.find((r) => r[1] === 'EQ-005')[col('items', 'ถูกยืมอยู่')], 1);
  assert.equal(d.items.rows.find((r) => r[1] === 'OF-001')[col('items', 'เบิกไปแล้วรวม')], 3);
  // แท็บรายการเบิก-ยืม: ชื่อพัสดุ + จำนวน ล่าสุดอยู่บน
  const lc = (name) => d.log.header.indexOf(name);
  assert.deepEqual(d.log.rows.map((r) => [r[lc('ประเภท')], r[lc('ชื่อพัสดุ')], r[lc('จำนวน')], r[lc('หน่วย')], r[lc('คืนแล้ว')], r[lc('ยังไม่คืน')]]),
    [['ยืม', 'โน้ตบุ๊ก', 2, 'เครื่อง', 1, 1], ['เบิก', 'กระดาษ A4', 3, 'รีม', '', '']]);
  assert.match(d.log.rows[0][lc('วันที่')], /^\d{1,2}\/\d{1,2}\/25\d\d \d{2}:\d{2}$/);
  assert.match(d.log.rows[0][lc('กำหนดคืน')], /^31\/12\/2642$/);
  assert.deepEqual(d.on_loan.rows.map((r) => [r[2], r[5], r[6], r[8]]), [['สมชาย ใจดี', 'โน้ตบุ๊ก', 1, '31/12/2642']]);
  // อ่านกลับจากชีต: คอลัมน์ไทยถูกละไว้ ข้อมูลเหมือนเดิม
  const back = {};
  Object.keys(Core.TABLES).forEach((t) => {
    back[t] = d[t].rows.map((r) => Object.fromEntries(d[t].header.map((h, i) => [h, String(r[i])])));
  });
  const loaded = Core.normalize(back);
  assert.deepEqual(loaded.requests.map((r) => r.status), ['issued', 'borrowed']);
  assert.equal(loaded.items.find((i) => i.code === 'EQ-005').available_qty, nb.available_qty);
  assert.equal(Object.keys(loaded.requests[0]).includes('ประเภท'), false);
});
