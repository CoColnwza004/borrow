const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');

let server;
let base;
let adminToken;
let staffToken;

async function call(method, url, { token, body, raw } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = raw ? 'text/csv' : 'application/json';
  const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const type = res.headers.get('content-type') || '';
  return { status: res.status, body: type.includes('json') ? await res.json() : await res.text() };
}

const today = () => new Date().toISOString().slice(0, 10);

before(async () => {
  const db = openDb(':memory:');
  const app = createApp(db, { stockApiKey: 'test-key' });
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
  adminToken = (await call('POST', '/api/login', { body: { username: 'admin', password: 'admin1234' } })).body.token;
  staffToken = (await call('POST', '/api/login', { body: { username: 'ward', password: 'ward1234' } })).body.token;
});

after(() => server.close());

test('login rejects wrong password and protects API', async () => {
  assert.equal((await call('POST', '/api/login', { body: { username: 'admin', password: 'x' } })).status, 401);
  assert.equal((await call('GET', '/api/items')).status, 401);
  assert.ok(adminToken && staffToken);
});

test('borrow → approve → partial return → full return keeps stock in sync', async () => {
  const items = (await call('GET', '/api/items', { token: staffToken })).body;
  const pump = items.find((i) => i.code === 'EQ-003');
  assert.equal(pump.available_qty, 10);

  const created = await call('POST', '/api/requests', {
    token: staffToken,
    body: { borrower_name: 'พยาบาลทดสอบ', borrow_date: today(), due_date: today(), items: [{ item_id: pump.id, qty: 3 }] },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, 'pending');
  assert.equal(created.body.department_id, 2, 'staff request is forced to own department');

  // Pending requests do not reduce stock
  assert.equal((await call('GET', `/api/items/${pump.id}`, { token: adminToken })).body.available_qty, 10);

  // Staff cannot approve
  assert.equal((await call('POST', `/api/requests/${created.body.id}/approve`, { token: staffToken })).status, 403);

  const approved = await call('POST', `/api/requests/${created.body.id}/approve`, { token: adminToken });
  assert.equal(approved.body.status, 'borrowed');
  let item = (await call('GET', `/api/items/${pump.id}`, { token: adminToken })).body;
  assert.equal(item.available_qty, 7);
  assert.equal(item.borrowed_qty, 3);
  assert.equal(item.borrowers.length, 1);

  // Return 1, report 1 lost, 1 still outstanding
  const partial = await call('POST', `/api/requests/${created.body.id}/return`, {
    token: adminToken, body: { items: [{ item_id: pump.id, returned_qty: 1, lost_qty: 1 }] },
  });
  assert.equal(partial.body.status, 'borrowed');
  item = (await call('GET', `/api/items/${pump.id}`, { token: adminToken })).body;
  assert.equal(item.available_qty, 8);
  assert.equal(item.total_qty, 9);

  // Over-return is rejected
  const over = await call('POST', `/api/requests/${created.body.id}/return`, {
    token: adminToken, body: { items: [{ item_id: pump.id, returned_qty: 5 }] },
  });
  assert.equal(over.status, 400);

  const done = await call('POST', `/api/requests/${created.body.id}/return`, {
    token: adminToken, body: { items: [{ item_id: pump.id, returned_qty: 1 }] },
  });
  assert.equal(done.body.status, 'returned');
  item = (await call('GET', `/api/items/${pump.id}`, { token: adminToken })).body;
  assert.equal(item.available_qty, 9);
  assert.equal(item.total_qty, 9);
  assert.deepEqual(item.movements.slice(0, 4).map((m) => m.type), ['return', 'lost', 'return', 'borrow']);
});

test('cannot request or approve more than available stock', async () => {
  const items = (await call('GET', '/api/items', { token: adminToken })).body;
  const stretcher = items.find((i) => i.code === 'EQ-006');
  const tooMany = await call('POST', '/api/requests', {
    token: staffToken,
    body: { borrower_name: 'x', borrow_date: today(), due_date: today(), items: [{ item_id: stretcher.id, qty: 99 }] },
  });
  assert.equal(tooMany.status, 409);

  // Two pending requests that together exceed stock: second approval must fail
  const mk = () => call('POST', '/api/requests', {
    token: staffToken,
    body: { borrower_name: 'x', borrow_date: today(), due_date: today(), items: [{ item_id: stretcher.id, qty: 3 }] },
  });
  const a = (await mk()).body;
  const b = (await mk()).body;
  assert.equal((await call('POST', `/api/requests/${a.id}/approve`, { token: adminToken })).status, 200);
  const second = await call('POST', `/api/requests/${b.id}/approve`, { token: adminToken });
  assert.equal(second.status, 409);
  assert.equal((await call('GET', `/api/requests/${b.id}`, { token: adminToken })).body.status, 'pending');
});

test('stock receive, count adjustment and write-off are logged', async () => {
  const created = await call('POST', '/api/items', {
    token: adminToken, body: { code: 'T-1', name: 'อุปกรณ์ทดสอบ', initial_qty: 5, min_qty: 2 },
  });
  assert.equal(created.status, 201);
  const id = created.body.id;
  assert.equal((await call('POST', `/api/items/${id}/stock`, { token: adminToken, body: { type: 'receive', qty: 3 } })).body.available_qty, 8);
  const adj = (await call('POST', `/api/items/${id}/stock`, { token: adminToken, body: { type: 'adjust', counted_qty: 6 } })).body;
  assert.equal(adj.available_qty, 6);
  assert.equal(adj.total_qty, 6);
  assert.equal((await call('POST', `/api/items/${id}/stock`, { token: adminToken, body: { type: 'lost', qty: 10 } })).status, 409);
  const movements = (await call('GET', `/api/movements?item_id=${id}`, { token: adminToken })).body;
  assert.deepEqual(movements.map((m) => [m.type, m.qty]), [['adjust', -2], ['receive', 3], ['receive', 5]]);
});

test('CSV import creates and updates items', async () => {
  const csv = 'รหัส,ชื่อ,หมวดหมู่,หน่วย,จำนวนทั้งหมด,ขั้นต่ำ,สถานที่\nNEW-1,"เครื่องชั่ง, เด็ก",หมวดใหม่,เครื่อง,4,1,คลัง C\nEQ-001,เครื่องวัดความดันโลหิตแบบดิจิทัล,,เครื่อง,20,3,\n';
  const res = await call('POST', '/api/items/import', { token: adminToken, body: csv, raw: true });
  assert.deepEqual(res.body, { created: 1, updated: 1, errors: [] });
  const items = (await call('GET', '/api/items', { token: adminToken })).body;
  assert.equal(items.find((i) => i.code === 'NEW-1').name, 'เครื่องชั่ง, เด็ก');
  assert.equal(items.find((i) => i.code === 'EQ-001').total_qty, 20);

  const exported = await call('GET', '/api/items/export.csv', { token: adminToken });
  assert.match(exported.body, /NEW-1,"เครื่องชั่ง, เด็ก"/);
});

test('staff only sees own department requests; public stock API needs key', async () => {
  const other = await call('POST', '/api/requests', {
    token: adminToken,
    body: { borrower_name: 'ER', department_id: 4, borrow_date: today(), due_date: today(), items: [{ item_id: 1, qty: 1 }], issue_now: true },
  });
  assert.equal(other.body.status, 'borrowed');
  assert.equal((await call('GET', `/api/requests/${other.body.id}`, { token: staffToken })).status, 404);
  const mine = (await call('GET', '/api/requests', { token: staffToken })).body;
  assert.ok(mine.every((r) => r.department_id === 2));

  assert.equal((await call('GET', '/api/public/stock')).status, 401);
  const res = await fetch(base + '/api/public/stock', { headers: { 'x-api-key': 'test-key' } });
  const data = await res.json();
  assert.ok(data.items.some((i) => i.code === 'EQ-001' && i.borrowed_qty === 1));
});
