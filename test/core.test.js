const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Core = require('../docs/core.js');

const admin = { isAdmin: true };
const user = { isAdmin: false };

test('core: borrow → approve → partial return keeps stock in sync', () => {
  const db = Core.seed(new Date());
  const pump = db.items.find((i) => i.code === 'EQ-003');
  const id = Core.run(db, 'createRequest', {
    borrower_name: 'พยาบาล', department: 'ER', borrow_date: '2026-10-01', due_date: '2026-10-05',
    items: [{ item_id: pump.id, qty: 3 }],
  }, user);
  assert.equal(pump.available_qty, 10);
  assert.throws(() => Core.run(db, 'approve', { id }, user), /PIN/);
  Core.run(db, 'approve', { id }, admin);
  assert.equal(pump.available_qty, 7);
  Core.run(db, 'returnItems', { id, items: [{ item_id: pump.id, returned_qty: 2, lost_qty: 1 }] }, admin);
  assert.equal(pump.available_qty, 9);
  assert.equal(pump.total_qty, 9);
  assert.equal(db.requests[0].status, 'returned');
});

test('core: cannot over-borrow, failed approve is rejected', () => {
  const db = Core.seed(new Date());
  const s = db.items.find((i) => i.code === 'EQ-006');
  const base = { borrower_name: 'x', department: 'ER', borrow_date: '2026-10-01', due_date: '2026-10-01' };
  assert.throws(() => Core.run(db, 'createRequest', { ...base, items: [{ item_id: s.id, qty: 99 }] }, user), /คงเหลือไม่พอ/);
  const a = Core.run(db, 'createRequest', { ...base, items: [{ item_id: s.id, qty: 3 }] }, user);
  const b = Core.run(db, 'createRequest', { ...base, items: [{ item_id: s.id, qty: 3 }] }, user);
  Core.run(db, 'approve', { id: a }, admin);
  assert.throws(() => Core.run(db, 'approve', { id: b }, admin), /คงเหลือไม่พอ/);
  assert.equal(db.requests.find((r) => r.id === b).status, 'pending');
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
  assert.equal(sheets['อุปกรณ์'].data.length, 11);
  assert.throws(() => ctx.setup(), /มีข้อมูลอยู่แล้ว/);

  const post = (body) => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(body) } }).body);
  const create = post({ action: 'createRequest', payload: { borrower_name: 'a', department: 'ER', borrow_date: '2026-10-01', due_date: '2026-10-02', items: [{ item_id: 1, qty: 2 }] } });
  assert.equal(create.ok, true);
  assert.equal(post({ action: 'approve', payload: { id: create.result }, pin: 'wrong' }).ok, false);
  const ok = post({ action: 'approve', payload: { id: create.result }, pin: '1234' });
  assert.equal(ok.ok, true);
  // reload from "sheet" text values
  const loaded = JSON.parse(ctx.doGet().body).state;
  assert.equal(loaded.items.find((i) => i.id === 1).available_qty, 13);
  assert.equal(loaded.requests[0].status, 'borrowed');
});
