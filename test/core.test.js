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

test('core: withdraw deducts available and total immediately', () => {
  const db = Core.seed(new Date());
  const paper = db.items.find((i) => i.code === 'OF-001');
  const id = Core.run(db, 'createRequest', { ...person, type: 'withdraw', items: [{ item_id: paper.id, qty: 5 }] }, user);
  const r = db.requests.find((x) => x.id === id);
  assert.equal(r.status, 'issued');
  assert.equal(r.type, 'withdraw');
  assert.match(r.request_no, /^WD\d{4}-0001$/);
  assert.equal(r.due_date, '');
  assert.equal(paper.available_qty, 115);
  assert.equal(paper.total_qty, 115);
  assert.equal(db.movements.at(-1).type, 'withdraw');
  assert.throws(() => Core.run(db, 'returnItems', { id, items: [{ item_id: paper.id, returned_qty: 1 }] }, admin), /กำลังยืม/);
});

test('core: borrow deducts available only, return puts it back', () => {
  const db = Core.seed(new Date());
  const nb = db.items.find((i) => i.code === 'EQ-005');
  const id = Core.run(db, 'createRequest', { ...person, type: 'borrow', due_date: DUE, items: [{ item_id: nb.id, qty: 2 }] }, user);
  const r = db.requests.find((x) => x.id === id);
  assert.equal(r.status, 'borrowed');
  assert.match(r.request_no, /^BR\d{4}-0001$/);
  assert.equal(nb.available_qty, 4);
  assert.equal(nb.total_qty, 6);
  assert.throws(() => Core.run(db, 'returnItems', { id, items: [{ item_id: nb.id, returned_qty: 2 }] }, user), /PIN/);
  Core.run(db, 'returnItems', { id, items: [{ item_id: nb.id, returned_qty: 1, lost_qty: 1 }] }, admin);
  assert.equal(nb.available_qty, 5);
  assert.equal(nb.total_qty, 5);
  assert.equal(r.status, 'returned');
});

test('core: validation for type, department, due date, kind and stock', () => {
  const db = Core.seed(new Date());
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
  assert.throws(() => Core.run(db, 'createRequest', { ...b, due_date: '2000-01-01' }, user), /ก่อนวันนี้/);
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

test('Apps Script: setup + doPost round-trip through mocked Google Sheets', () => {
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
        setValues: (rows) => { sh.data = rows.map((x) => x.slice()); },
      }),
      setFrozenRows() {},
    };
    sheets[name] = sh;
    return sh;
  };
  const ss = { getSheetByName: (n) => sheets[n] || null, insertSheet: mkSheet, getSpreadsheetTimeZone: () => 'Asia/Bangkok' };
  const ctx = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (s) => ({ body: s, setMimeType() { return this; } }) },
    Utilities: { formatDate: (d) => d.toISOString().slice(0, 10) },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/core.js'), 'utf8'), ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../docs/apps-script/Code.gs'), 'utf8'), ctx);
  ctx.setup();
  assert.equal(sheets['อุปกรณ์'].data.length, 16);
  assert.throws(() => ctx.setup(), /มีข้อมูลอยู่แล้ว/);

  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  const create = post({ action: 'createRequest', payload: { ...person, type: 'withdraw', items: [{ item_id: 1, qty: 2 }] } });
  assert.equal(create.ok, true);
  const borrow = post({ action: 'createRequest', payload: { ...person, type: 'borrow', due_date: DUE, items: [{ item_id: 9, qty: 1 }] } });
  assert.equal(borrow.ok, true);
  const bad = post({ action: 'returnItems', payload: { id: borrow.result, items: [{ item_id: 9, returned_qty: 1 }] }, pin: 'wrong' });
  assert.equal(bad.ok, false);
  // reload from "sheet" text values
  const loaded = JSON.parse(ctx.doGet().body).state;
  assert.equal(loaded.items.find((i) => i.id === 1).available_qty, 118);
  assert.equal(loaded.items.find((i) => i.id === 1).kind, 'withdraw');
  assert.equal(loaded.items.find((i) => i.id === 9).available_qty, 14);
  assert.deepEqual(loaded.requests.map((r) => [r.type, r.status]), [['withdraw', 'issued'], ['borrow', 'borrowed']]);
  const ret = post({ action: 'returnItems', payload: { id: borrow.result, items: [{ item_id: 9, returned_qty: 1 }] }, pin: '1234' });
  assert.equal(ret.ok, true);
  assert.equal(ret.state.items.find((i) => i.id === 9).available_qty, 15);
});
