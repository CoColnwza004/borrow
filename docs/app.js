'use strict';

// ===================== Config & state =====================
const CONFIG = window.APP_CONFIG || {};
const API_URL = (CONFIG.API_URL || '').trim();
const DEMO = !API_URL;
const DEMO_KEY = 'borrow-demo-db';
const DEMO_PIN = '1234';
const { STATUS, MOVE } = BorrowCore;

const state = {
  db: null,
  pin: sessionStorage.getItem('pin') || '',
  cart: [], // [{ item_id, qty }]
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isAdmin = () => !!state.pin;
const today = () => BorrowCore.ymd(new Date());
const fmtNum = (n) => Number(n || 0).toLocaleString('th-TH');

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return BorrowCore.ymd(d);
}
function fmtDate(s) {
  if (!s) return '-';
  return new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}
function fmtDateTime(s) {
  if (!s) return '-';
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d) ? s : d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// ===================== Data layer =====================
// โหมดทดลอง: เก็บใน localStorage / โหมดจริง: เรียก Google Apps Script
async function remote(action, payload) {
  const res = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain เพื่อไม่ให้ติด CORS preflight
    body: JSON.stringify({ action, payload, pin: state.pin }),
  });
  if (!res.ok) throw new Error('เชื่อมต่อ Google Sheets ไม่สำเร็จ (' + res.status + ')');
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'เกิดข้อผิดพลาด');
  return data;
}

function demoLoad() {
  try {
    const saved = localStorage.getItem(DEMO_KEY);
    if (saved) return BorrowCore.normalize(JSON.parse(saved));
  } catch { /* ใช้ข้อมูลตัวอย่าง */ }
  const db = BorrowCore.seed(new Date());
  demoSave(db);
  return db;
}
function demoSave(db) {
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(db)); } catch { /* ignore */ }
}

const store = {
  async load() {
    state.db = DEMO ? demoLoad() : BorrowCore.normalize((await remote('load')).state);
  },
  async act(action, payload) {
    $('#loading').hidden = false;
    try {
      if (DEMO) {
        const db = structuredClone(state.db); // ถ้า error กลางทาง ข้อมูลเดิมไม่เสีย
        const result = BorrowCore.run(db, action, payload, { isAdmin: state.pin === DEMO_PIN });
        state.db = db;
        demoSave(db);
        return result;
      }
      const data = await remote(action, payload);
      state.db = BorrowCore.normalize(data.state);
      return data.result;
    } finally {
      $('#loading').hidden = true;
    }
  },
};

// ===================== Derived views =====================
function itemsView() {
  return state.db.items.map((i) => ({ ...i, borrowed_qty: i.total_qty - i.available_qty })).sort((a, b) => a.code.localeCompare(b.code));
}
function itemById(id) {
  return state.db.items.find((i) => i.id === Number(id));
}
function requestView(r) {
  const lines = state.db.request_items.filter((l) => l.request_id === r.id).map((l) => {
    const item = itemById(l.item_id) || { name: '(ลบแล้ว)', code: '', unit: '', available_qty: 0 };
    return { ...l, name: item.name, code: item.code, unit: item.unit, available_qty: item.available_qty };
  });
  return {
    ...r,
    items: lines,
    is_overdue: r.status === 'borrowed' && r.due_date < today(),
    days_overdue: Math.round((new Date(today()) - new Date(r.due_date)) / 86400000),
    item_summary: lines.map((l) => `${l.name} x${l.qty}`).join(', '),
  };
}
function requestsView() {
  return state.db.requests.map(requestView).sort((a, b) => b.id - a.id);
}

// ===================== UI helpers =====================
let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 2500);
}
function openModal(title, html) {
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = html;
  if (!$('#modal').open) $('#modal').showModal();
  return body;
}
const closeModal = () => $('#modal').close();
const safe = (fn) => async (...args) => {
  try { await fn(...args); } catch (e) { toast(e.message, true); }
};
const formData = (form) => Object.fromEntries(new FormData(form).entries());

function options(list, selected, blank) {
  return (blank ? `<option value="">${blank}</option>` : '') +
    list.map((x) => `<option ${x.name === selected ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
}
function statusPill(r) {
  if (r.is_overdue) return '<span class="pill overdue">เกินกำหนดคืน</span>';
  return `<span class="pill ${r.status}">${STATUS[r.status]}</span>`;
}
function movePill(m) {
  const cls = m.qty > 0 ? 'in' : m.type === 'lost' ? 'low' : 'out';
  return `<span class="pill ${cls}">${MOVE[m.type]}</span>`;
}
function bindRowClicks(root) {
  $$('[data-item]', root).forEach((tr) => tr.addEventListener('click', () => showItem(Number(tr.dataset.item))));
  $$('[data-request]', root).forEach((tr) => tr.addEventListener('click', () => showRequest(Number(tr.dataset.request))));
}

function downloadCsv(name, header, rows) {
  const cell = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  const a = Object.assign(document.createElement('a'), {
    href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })),
    download: `${name}-${today()}.csv`,
  });
  a.click();
  URL.revokeObjectURL(a.href);
}

// ===================== Admin mode (PIN) =====================
function renderMode() {
  $('#mode-name').textContent = isAdmin() ? 'เจ้าหน้าที่คลัง' : 'ผู้ใช้ทั่วไป';
  $('#mode-desc').textContent = DEMO ? 'โหมดทดลอง (ข้อมูลในเบราว์เซอร์นี้)' : 'เชื่อมต่อ Google Sheets';
  $('#btn-admin').textContent = isAdmin() ? 'ออกจากโหมดเจ้าหน้าที่' : 'เข้าสู่โหมดเจ้าหน้าที่';
}

$('#btn-admin').addEventListener('click', () => {
  if (isAdmin()) {
    state.pin = '';
    sessionStorage.removeItem('pin');
    renderMode();
    route();
    return;
  }
  const body = openModal('เข้าสู่โหมดเจ้าหน้าที่คลัง', `
    <form id="pin-form" class="form-grid">
      <label class="full">รหัส PIN${DEMO ? ' (โหมดทดลองใช้ 1234)' : ''}<input type="password" name="pin" inputmode="numeric" required autofocus></label>
      <div class="form-actions full"><button class="btn primary">ยืนยัน</button></div>
    </form>`);
  $('#pin-form', body).addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    state.pin = e.target.pin.value;
    try {
      await store.act('checkPin');
    } catch (err) {
      state.pin = '';
      throw err;
    }
    sessionStorage.setItem('pin', state.pin);
    closeModal();
    renderMode();
    route();
    toast('เข้าสู่โหมดเจ้าหน้าที่แล้ว');
  }));
});

// ===================== Routing =====================
const ROUTES = {
  dashboard: { title: 'ภาพรวม', render: renderDashboard },
  items: { title: 'คลังอุปกรณ์ / สต็อกคงเหลือ', render: renderItems },
  borrow: { title: 'ยืมอุปกรณ์', render: renderBorrow },
  requests: { title: 'รายการยืม-คืน', render: renderRequests },
  movements: { title: 'ประวัติการเคลื่อนไหวสต็อก', render: renderMovements, admin: true },
  settings: { title: 'ข้อมูลพื้นฐาน', render: renderSettings, admin: true },
};

function currentRoute() {
  const key = location.hash.replace(/^#\//, '').split('?')[0];
  return ROUTES[key] && (!ROUTES[key].admin || isAdmin()) ? key : 'dashboard';
}
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');

function renderNav() {
  const reqs = requestsView();
  const badge = reqs.filter((r) => r.is_overdue || (isAdmin() && r.status === 'pending')).length;
  const links = [
    ['dashboard', 'ภาพรวม'],
    ['items', 'คลังอุปกรณ์'],
    ['borrow', 'ยืมอุปกรณ์', state.cart.length],
    ['requests', 'รายการยืม-คืน', badge],
    ['movements', 'ประวัติสต็อก'],
    ['settings', 'ข้อมูลพื้นฐาน'],
  ].filter(([k]) => !ROUTES[k].admin || isAdmin());
  const cur = currentRoute();
  $('#nav').innerHTML = links.map(([k, label, n]) =>
    `<a href="#/${k}" class="${k === cur ? 'active' : ''}">${label}${n ? `<span class="badge">${n}</span>` : ''}</a>`).join('');
}

function render() {
  const key = currentRoute();
  $('#page-title').textContent = ROUTES[key].title;
  renderNav();
  const page = $('#page');
  page.innerHTML = DEMO ? '<div class="banner">โหมดทดลอง: ข้อมูลเก็บเฉพาะในเบราว์เซอร์เครื่องนี้ ถ้าจะใช้ร่วมกันหลายเครื่อง ให้เชื่อม Google Sheets ตามคู่มือใน README</div>' : '';
  const container = document.createElement('div');
  container.style.cssText = 'display:flex;flex-direction:column;gap:18px';
  page.appendChild(container);
  ROUTES[key].render(container);
}

let lastSnapshot = '';
async function route() {
  $('#sidebar').classList.remove('open');
  render();
  // โหมด Google Sheets: ดึงข้อมูลล่าสุดเบื้องหลัง แล้ววาดใหม่ถ้ามีคนอื่นแก้ไข
  if (!DEMO && !$('#modal').open) {
    try {
      await store.load();
      const snap = JSON.stringify(state.db);
      if (snap !== lastSnapshot) { lastSnapshot = snap; if (!$('#modal').open) render(); }
    } catch (e) { toast(e.message, true); }
  }
}
window.addEventListener('hashchange', route);
$('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

// วาดหน้าปัจจุบันใหม่หลังบันทึกข้อมูล
function refresh() {
  lastSnapshot = JSON.stringify(state.db);
  render();
}

// ===================== Dashboard =====================
function renderDashboard(page) {
  const items = itemsView().filter((i) => i.active);
  const reqs = requestsView();
  const total = items.reduce((s, i) => s + i.total_qty, 0);
  const available = items.reduce((s, i) => s + i.available_qty, 0);
  const low = items.filter((i) => i.available_qty <= i.min_qty);
  const overdue = reqs.filter((r) => r.is_overdue).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const recent = state.db.movements.slice().sort((a, b) => b.id - a.id).slice(0, 10);
  page.innerHTML = `
    <div class="stats">
      <a class="card stat" href="#/items"><div class="label">อุปกรณ์ในระบบ</div>
        <div class="value">${fmtNum(items.length)}</div><div class="sub">รายการ · รวม ${fmtNum(total)} หน่วย</div></a>
      <a class="card stat ok" href="#/items"><div class="label">พร้อมให้ยืม (คงเหลือ)</div>
        <div class="value">${fmtNum(available)}</div><div class="sub">หน่วย</div></a>
      <a class="card stat" href="#/requests?status=borrowed"><div class="label">กำลังถูกยืม</div>
        <div class="value">${fmtNum(total - available)}</div><div class="sub">หน่วย · ${reqs.filter((r) => r.status === 'borrowed').length} คำขอ</div></a>
      <a class="card stat warn" href="#/requests?status=pending"><div class="label">รออนุมัติ</div>
        <div class="value">${reqs.filter((r) => r.status === 'pending').length}</div><div class="sub">คำขอ</div></a>
      <a class="card stat danger" href="#/requests?status=overdue"><div class="label">เกินกำหนดคืน</div>
        <div class="value">${overdue.length}</div><div class="sub">คำขอ</div></a>
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>สต็อกใกล้หมด / ต่ำกว่าจุดขั้นต่ำ</h3><a href="#/items?low=1" class="link">ดูทั้งหมด</a></div>
        <div class="table-wrap"><table>
          <thead><tr><th>อุปกรณ์</th><th class="num">คงเหลือ</th><th class="num">ขั้นต่ำ</th></tr></thead>
          <tbody>${low.map((i) => `<tr class="clickable" data-item="${i.id}"><td>${esc(i.name)}<div class="muted small">${esc(i.code)}</div></td>
            <td class="num"><span class="pill low">${fmtNum(i.available_qty)} / ${fmtNum(i.total_qty)}</span></td><td class="num">${fmtNum(i.min_qty)}</td></tr>`).join('') ||
            '<tr><td colspan="3" class="empty">สต็อกทุกรายการอยู่ในระดับปกติ</td></tr>'}</tbody>
        </table></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>เกินกำหนดคืน</h3><a href="#/requests?status=overdue" class="link">ดูทั้งหมด</a></div>
        <div class="table-wrap"><table>
          <thead><tr><th>เลขที่ / ผู้ยืม</th><th>กำหนดคืน</th><th class="num">เกิน</th></tr></thead>
          <tbody>${overdue.map((r) => `<tr class="clickable" data-request="${r.id}"><td>${esc(r.request_no)}<div class="muted small">${esc(r.borrower_name)} · ${esc(r.department)}</div></td>
            <td>${fmtDate(r.due_date)}</td><td class="num"><span class="pill overdue">${r.days_overdue} วัน</span></td></tr>`).join('') ||
            '<tr><td colspan="3" class="empty">ไม่มีรายการเกินกำหนด</td></tr>'}</tbody>
        </table></div>
      </section>
    </div>
    <section class="card">
      <div class="card-head"><h3>ความเคลื่อนไหวสต็อกล่าสุด</h3></div>
      <div class="table-wrap"><table>
        <thead><tr><th>วันเวลา</th><th>อุปกรณ์</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th>อ้างอิง</th></tr></thead>
        <tbody>${recent.map((m) => `<tr><td>${fmtDateTime(m.created_at)}</td><td>${esc(itemById(m.item_id)?.name)}</td><td>${movePill(m)}</td>
          <td class="num">${m.qty > 0 ? '+' : ''}${fmtNum(m.qty)}</td><td class="num">${fmtNum(m.available_after)}</td><td>${esc(m.request_no)}</td></tr>`).join('') ||
          '<tr><td colspan="6" class="empty">ยังไม่มีข้อมูล</td></tr>'}</tbody>
      </table></div>
    </section>`;
  bindRowClicks(page);
}

// ===================== Items / Stock =====================
function renderItems(page) {
  const params = hashParams();
  page.innerHTML = `
    <div class="card card-pad toolbar">
      <input type="search" id="f-q" placeholder="ค้นหาชื่อ รหัส หรือสถานที่เก็บ..." value="${esc(params.get('q') || '')}">
      <select id="f-cat">${options(state.db.categories, params.get('cat'), 'ทุกหมวดหมู่')}</select>
      <label class="checkbox"><input type="checkbox" id="f-low" ${params.get('low') === '1' ? 'checked' : ''}> เฉพาะสต็อกต่ำ</label>
      <span class="spacer"></span>
      <button class="btn" id="btn-export">ส่งออก CSV</button>
      ${isAdmin() ? '<button class="btn primary" id="btn-add">+ เพิ่มอุปกรณ์</button>' : ''}
    </div>
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th>รหัส</th><th>อุปกรณ์</th><th>หมวดหมู่</th><th class="num">คงเหลือ / ทั้งหมด</th><th class="num">ถูกยืม</th><th>สถานที่เก็บ</th><th></th></tr></thead>
      <tbody id="items-body"></tbody>
    </table></div></section>`;

  const filtered = () => {
    const q = $('#f-q').value.trim().toLowerCase();
    const cat = $('#f-cat').value;
    const low = $('#f-low').checked;
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (cat) qs.set('cat', cat);
    if (low) qs.set('low', '1');
    history.replaceState(null, '', `#/items${qs.toString() ? '?' + qs : ''}`);
    return itemsView().filter((i) => (i.active || isAdmin()) &&
      (!q || [i.name, i.code, i.location].some((s) => s.toLowerCase().includes(q))) &&
      (!cat || i.category === cat) && (!low || i.available_qty <= i.min_qty));
  };

  const draw = () => {
    $('#items-body').innerHTML = filtered().map((i) => {
      const low = i.available_qty <= i.min_qty;
      const pct = i.total_qty ? Math.round((i.available_qty / i.total_qty) * 100) : 0;
      return `<tr class="clickable" data-item="${i.id}">
        <td>${esc(i.code)}</td>
        <td>${esc(i.name)}${low ? ' <span class="pill low">สต็อกต่ำ</span>' : ''}${i.active ? '' : ' <span class="pill cancelled">ปิดใช้งาน</span>'}</td>
        <td>${esc(i.category || '-')}</td>
        <td class="num"><strong>${fmtNum(i.available_qty)}</strong> / ${fmtNum(i.total_qty)} ${esc(i.unit)}
          <div class="qty-bar ${low ? 'low' : ''}"><span style="width:${pct}%"></span></div></td>
        <td class="num">${fmtNum(i.borrowed_qty)}</td>
        <td>${esc(i.location || '-')}</td>
        <td><button class="btn sm primary" data-add-cart="${i.id}" ${i.available_qty > 0 && i.active ? '' : 'disabled'}>ยืม</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">ไม่พบรายการ</td></tr>';
    bindRowClicks($('#items-body'));
    $$('[data-add-cart]').forEach((b) => b.addEventListener('click', (e) => { e.stopPropagation(); addToCart(Number(b.dataset.addCart)); }));
  };

  $('#f-q').addEventListener('input', draw);
  $('#f-cat').addEventListener('change', draw);
  $('#f-low').addEventListener('change', draw);
  $('#btn-export').addEventListener('click', () => downloadCsv('stock',
    ['รหัส', 'ชื่อ', 'หมวดหมู่', 'หน่วย', 'จำนวนทั้งหมด', 'คงเหลือ', 'ถูกยืม', 'จุดสั่งซื้อขั้นต่ำ', 'สถานที่เก็บ'],
    filtered().map((i) => [i.code, i.name, i.category, i.unit, i.total_qty, i.available_qty, i.borrowed_qty, i.min_qty, i.location])));
  if (isAdmin()) $('#btn-add').addEventListener('click', () => itemForm(null));
  draw();
}

function addToCart(itemId) {
  const line = state.cart.find((l) => l.item_id === itemId);
  if (line) line.qty++;
  else state.cart.push({ item_id: itemId, qty: 1 });
  renderNav();
  toast('เพิ่มในรายการยืมแล้ว — ไปที่เมนู "ยืมอุปกรณ์" เพื่อส่งคำขอ');
}

function showItem(id) {
  const i = itemsView().find((x) => x.id === id);
  if (!i) return;
  const borrowers = requestsView().filter((r) => r.status === 'borrowed')
    .flatMap((r) => r.items.filter((l) => l.item_id === id && l.qty > l.returned_qty + l.lost_qty)
      .map((l) => ({ ...r, outstanding: l.qty - l.returned_qty - l.lost_qty })));
  const moves = state.db.movements.filter((m) => m.item_id === id).sort((a, b) => b.id - a.id).slice(0, 100);
  const body = openModal(`${i.code} · ${i.name}`, `
    <dl class="info">
      <dt>หมวดหมู่</dt><dd>${esc(i.category || '-')}</dd>
      <dt>คงเหลือในคลัง</dt><dd><strong>${fmtNum(i.available_qty)}</strong> ${esc(i.unit)}
        ${i.available_qty <= i.min_qty ? '<span class="pill low">ต่ำกว่าจุดขั้นต่ำ</span>' : ''}</dd>
      <dt>ถูกยืมอยู่</dt><dd>${fmtNum(i.borrowed_qty)} ${esc(i.unit)}</dd>
      <dt>จำนวนทั้งหมด</dt><dd>${fmtNum(i.total_qty)} ${esc(i.unit)}</dd>
      <dt>จุดสั่งซื้อขั้นต่ำ</dt><dd>${fmtNum(i.min_qty)} ${esc(i.unit)}</dd>
      <dt>สถานที่เก็บ</dt><dd>${esc(i.location || '-')}</dd>
    </dl>
    <div class="toolbar">
      <button class="btn primary" id="i-cart" ${i.available_qty > 0 && i.active ? '' : 'disabled'}>เพิ่มในรายการยืม</button>
      ${isAdmin() ? `<button class="btn ok" data-stock="receive">รับเข้า</button>
        <button class="btn" data-stock="adjust">ตรวจนับ/ปรับยอด</button>
        <button class="btn" data-stock="lost">ตัดชำรุด/สูญหาย</button>
        <button class="btn" id="i-edit">แก้ไขข้อมูล</button>` : ''}
    </div>
    <h4 style="margin:6px 0 0">ผู้ที่กำลังยืม</h4>
    <div class="table-wrap card"><table>
      <thead><tr><th>เลขที่</th><th>ผู้ยืม / หน่วยงาน</th><th>กำหนดคืน</th><th class="num">ค้างคืน</th></tr></thead>
      <tbody>${borrowers.map((b) => `<tr class="clickable" data-request="${b.id}"><td>${esc(b.request_no)}</td>
        <td>${esc(b.borrower_name)}<div class="muted small">${esc(b.department)}</div></td><td>${fmtDate(b.due_date)}</td>
        <td class="num">${b.outstanding}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">ไม่มี</td></tr>'}</tbody>
    </table></div>
    <h4 style="margin:6px 0 0">ประวัติสต็อก</h4>
    <div class="table-wrap card"><table>
      <thead><tr><th>วันเวลา</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th>อ้างอิง / หมายเหตุ</th></tr></thead>
      <tbody>${moves.map((m) => `<tr><td>${fmtDateTime(m.created_at)}</td><td>${movePill(m)}</td>
        <td class="num">${m.qty > 0 ? '+' : ''}${fmtNum(m.qty)}</td><td class="num">${fmtNum(m.available_after)}</td>
        <td>${esc(m.request_no)} ${m.note ? `<div class="muted small">${esc(m.note)}</div>` : ''}</td></tr>`).join('') ||
        '<tr><td colspan="5" class="empty">ไม่มี</td></tr>'}</tbody>
    </table></div>`);
  $('#i-cart', body).addEventListener('click', () => { addToCart(i.id); closeModal(); });
  bindRowClicks(body);
  if (isAdmin()) {
    $('#i-edit', body).addEventListener('click', () => itemForm(i));
    $$('[data-stock]', body).forEach((b) => b.addEventListener('click', () => stockForm(i, b.dataset.stock)));
  }
}

function itemForm(item) {
  const body = openModal(item ? 'แก้ไขข้อมูลอุปกรณ์' : 'เพิ่มอุปกรณ์ใหม่', `
    <form id="item-form" class="form-grid">
      <label>รหัสอุปกรณ์ *<input name="code" required value="${esc(item?.code)}"></label>
      <label>หน่วยนับ<input name="unit" value="${esc(item?.unit || 'ชิ้น')}"></label>
      <label class="full">ชื่ออุปกรณ์ *<input name="name" required value="${esc(item?.name)}"></label>
      <label>หมวดหมู่<select name="category">${options(state.db.categories, item?.category, '- ไม่ระบุ -')}</select></label>
      <label>จุดสั่งซื้อขั้นต่ำ (เตือนเมื่อคงเหลือ ≤)<input name="min_qty" type="number" min="0" value="${item?.min_qty ?? 0}"></label>
      ${item ? '' : '<label>จำนวนเริ่มต้น<input name="initial_qty" type="number" min="0" value="0"></label>'}
      <label class="${item ? 'full' : ''}">สถานที่เก็บ<input name="location" value="${esc(item?.location)}"></label>
      ${item ? `<label class="checkbox full"><input type="checkbox" name="active" ${item.active ? 'checked' : ''}> เปิดใช้งาน (ให้ยืมได้)</label>` : ''}
      <div class="form-actions full"><button class="btn primary">บันทึก</button></div>
    </form>`);
  $('#item-form', body).addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    if (item) { data.id = item.id; data.active = e.target.active.checked; }
    const id = await store.act('saveItem', data);
    toast('บันทึกเรียบร้อย');
    refresh();
    showItem(id);
  }));
}

function stockForm(item, type) {
  const titles = { receive: 'รับเข้าสต็อก', adjust: 'ตรวจนับ / ปรับยอดคงเหลือ', lost: 'ตัดชำรุด / สูญหาย' };
  const field = type === 'adjust'
    ? `<label class="full">ยอดคงเหลือในคลังที่นับได้จริง (${esc(item.unit)})<input name="counted_qty" type="number" min="0" required value="${item.available_qty}"></label>
       <p class="muted small full" style="margin:0">ยอดในระบบ ${fmtNum(item.available_qty)} ${esc(item.unit)} (ไม่รวม ${fmtNum(item.borrowed_qty)} ที่ถูกยืมอยู่)</p>`
    : `<label class="full">จำนวน (${esc(item.unit)})<input name="qty" type="number" min="1" ${type === 'lost' ? `max="${item.available_qty}"` : ''} required></label>`;
  const body = openModal(`${titles[type]} · ${item.name}`, `
    <form id="stock-form" class="form-grid">
      ${field}
      <label class="full">หมายเหตุ / เลขที่เอกสาร<input name="note"></label>
      <div class="form-actions full"><button class="btn primary">บันทึก</button></div>
    </form>`);
  $('#stock-form', body).addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    await store.act('stock', { item_id: item.id, type, ...formData(e.target) });
    toast('ปรับปรุงสต็อกเรียบร้อย');
    refresh();
    showItem(item.id);
  }));
}

// ===================== Borrow =====================
function renderBorrow(page) {
  const items = itemsView().filter((i) => i.active);
  state.cart = state.cart.filter((l) => itemById(l.item_id));
  const lastDept = localStorage.getItem('last-dept') || '';
  page.innerHTML = `
    <form id="borrow-form" class="grid-2" style="align-items:start">
      <section class="card card-pad">
        <h3 style="margin-bottom:14px">ข้อมูลผู้ยืม</h3>
        <div class="form-grid">
          <label class="full">ชื่อผู้ยืม *<input name="borrower_name" required value="${esc(localStorage.getItem('last-name') || '')}"></label>
          <label>เบอร์โทร / เบอร์ภายใน<input name="phone"></label>
          <label>หน่วยงาน *<select name="department" required>${options(state.db.departments, lastDept, '-- เลือกหน่วยงาน --')}</select></label>
          <label>วันที่ยืม *<input type="date" name="borrow_date" required value="${today()}"></label>
          <label>กำหนดคืน *<input type="date" name="due_date" required value="${addDays(7)}"></label>
          <label class="full">วัตถุประสงค์<input name="purpose" placeholder="เช่น ใช้ในหอผู้ป่วย เตียง 12 (ไม่ต้องระบุชื่อผู้ป่วย)"></label>
          <label class="full">หมายเหตุ<textarea name="note"></textarea></label>
        </div>
      </section>
      <section class="card card-pad">
        <h3 style="margin-bottom:14px">รายการอุปกรณ์ที่ต้องการยืม</h3>
        <div class="toolbar">
          <select id="pick-item" style="flex:1;min-width:0">
            <option value="">-- เลือกอุปกรณ์ --</option>
            ${items.map((i) => `<option value="${i.id}" ${i.available_qty > 0 ? '' : 'disabled'}>${esc(i.code)} ${esc(i.name)} (คงเหลือ ${i.available_qty} ${esc(i.unit)})</option>`).join('')}
          </select>
          <button type="button" class="btn" id="pick-add">เพิ่ม</button>
        </div>
        <div id="cart" style="margin-top:10px"></div>
        ${isAdmin() ? '<label class="checkbox" style="margin-top:12px"><input type="checkbox" name="issue_now"> จ่ายอุปกรณ์ทันที (ไม่ต้องรออนุมัติ)</label>' : ''}
        <div class="form-actions"><button class="btn primary">ส่งคำขอยืม</button></div>
      </section>
    </form>`;

  function drawCart() {
    $('#cart').innerHTML = state.cart.map((l, idx) => {
      const i = itemById(l.item_id);
      const over = l.qty > i.available_qty;
      return `<div class="cart-line">
        <div>${esc(i.name)}<div class="small ${over ? 'error' : 'muted'}">คงเหลือ ${i.available_qty} ${esc(i.unit)}${over ? ' — เกินจำนวนคงเหลือ' : ''}</div></div>
        <input type="number" min="1" max="${i.available_qty}" value="${l.qty}" data-qty="${idx}">
        <button type="button" class="btn sm" data-remove="${idx}">ลบ</button>
      </div>`;
    }).join('') || '<div class="empty">ยังไม่ได้เลือกอุปกรณ์</div>';
    $$('[data-qty]').forEach((inp) => inp.addEventListener('change', () => {
      const qty = Math.max(1, Number(inp.value) || 1);
      if (state.cart[inp.dataset.qty].qty === qty) return;
      state.cart[inp.dataset.qty].qty = qty;
      setTimeout(drawCart); // วาดใหม่หลัง event จบ ไม่ให้ชนกับ blur ของช่องที่กำลังแก้
    }));
    $$('[data-remove]').forEach((b) => b.addEventListener('click', () => {
      state.cart.splice(Number(b.dataset.remove), 1);
      drawCart();
      renderNav();
    }));
  }
  drawCart();

  $('#pick-add').addEventListener('click', () => {
    const id = Number($('#pick-item').value);
    if (!id) return;
    if (!state.cart.some((l) => l.item_id === id)) state.cart.push({ item_id: id, qty: 1 });
    $('#pick-item').value = '';
    drawCart();
    renderNav();
  });

  $('#borrow-form').addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    if (!state.cart.length) throw new Error('กรุณาเลือกอุปกรณ์อย่างน้อย 1 รายการ');
    const data = formData(e.target);
    data.items = state.cart;
    const id = await store.act('createRequest', data);
    if (e.target.issue_now?.checked) await store.act('approve', { id });
    localStorage.setItem('last-name', data.borrower_name);
    localStorage.setItem('last-dept', data.department);
    state.cart = [];
    toast('บันทึกคำขอเรียบร้อย');
    lastSnapshot = JSON.stringify(state.db);
    location.hash = '#/requests';
    showRequest(id);
  }));
}

// ===================== Requests =====================
function renderRequests(page) {
  let status = hashParams().get('status') || '';
  const tabs = [['', 'ทั้งหมด'], ['pending', 'รออนุมัติ'], ['borrowed', 'กำลังยืม'], ['overdue', 'เกินกำหนดคืน'],
    ['returned', 'คืนแล้ว'], ['rejected', 'ไม่อนุมัติ'], ['cancelled', 'ยกเลิก']];
  page.innerHTML = `
    <div class="card card-pad toolbar">
      <div class="tabs" id="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div>
      <span class="spacer"></span>
      <input type="search" id="r-q" placeholder="ค้นหาเลขที่ ผู้ยืม หน่วยงาน หรืออุปกรณ์..." style="max-width:280px">
      <button class="btn" id="r-export">ส่งออก CSV</button>
    </div>
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th>เลขที่</th><th>ผู้ยืม / หน่วยงาน</th><th>อุปกรณ์</th><th>วันที่ยืม</th><th>กำหนดคืน</th><th>สถานะ</th></tr></thead>
      <tbody id="req-body"></tbody>
    </table></div></section>`;

  const filtered = () => {
    const q = $('#r-q').value.trim().toLowerCase();
    return requestsView().filter((r) =>
      (!status || (status === 'overdue' ? r.is_overdue : r.status === status)) &&
      (!q || [r.request_no, r.borrower_name, r.department, r.item_summary].some((s) => s.toLowerCase().includes(q))));
  };
  const draw = () => {
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === status));
    history.replaceState(null, '', `#/requests${status ? '?status=' + status : ''}`);
    $('#req-body').innerHTML = filtered().map((r) => `
      <tr class="clickable" data-request="${r.id}">
        <td><strong>${esc(r.request_no)}</strong><div class="muted small">${fmtDateTime(r.created_at)}</div></td>
        <td>${esc(r.borrower_name)}<div class="muted small">${esc(r.department)}</div></td>
        <td>${esc(r.item_summary)}</td><td>${fmtDate(r.borrow_date)}</td><td>${fmtDate(r.due_date)}</td><td>${statusPill(r)}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">ไม่พบรายการ</td></tr>';
    bindRowClicks($('#req-body'));
  };
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => { status = b.dataset.tab; draw(); }));
  $('#r-q').addEventListener('input', draw);
  $('#r-export').addEventListener('click', () => downloadCsv('borrow',
    ['เลขที่คำขอ', 'ผู้ยืม', 'หน่วยงาน', 'วันที่ยืม', 'กำหนดคืน', 'สถานะ', 'วันที่คืนครบ', 'รหัสอุปกรณ์', 'อุปกรณ์', 'จำนวนยืม', 'คืนแล้ว', 'ชำรุด/สูญหาย'],
    filtered().flatMap((r) => r.items.map((l) => [r.request_no, r.borrower_name, r.department, r.borrow_date, r.due_date,
      r.is_overdue ? 'เกินกำหนดคืน' : STATUS[r.status], r.returned_at, l.code, l.name, l.qty, l.returned_qty, l.lost_qty]))));
  draw();
}

function showRequest(id) {
  const raw = state.db.requests.find((r) => r.id === id);
  if (!raw) return;
  const r = requestView(raw);
  const outstanding = (l) => l.qty - l.returned_qty - l.lost_qty;
  const canReturn = isAdmin() && r.status === 'borrowed';
  const body = openModal(`คำขอยืม ${r.request_no}`, `
    <div>${statusPill(r)}</div>
    <dl class="info">
      <dt>ผู้ยืม</dt><dd>${esc(r.borrower_name)} ${r.phone ? `(โทร ${esc(r.phone)})` : ''}</dd>
      <dt>หน่วยงาน</dt><dd>${esc(r.department)}</dd>
      <dt>วันที่ยืม</dt><dd>${fmtDate(r.borrow_date)}</dd>
      <dt>กำหนดคืน</dt><dd>${fmtDate(r.due_date)}</dd>
      ${r.purpose ? `<dt>วัตถุประสงค์</dt><dd>${esc(r.purpose)}</dd>` : ''}
      ${r.note ? `<dt>หมายเหตุ</dt><dd>${esc(r.note)}</dd>` : ''}
      <dt>วันที่ส่งคำขอ</dt><dd>${fmtDateTime(r.created_at)}</dd>
      ${r.approved_at ? `<dt>${r.status === 'rejected' ? 'วันที่ไม่อนุมัติ' : 'วันที่อนุมัติ/จ่าย'}</dt><dd>${fmtDateTime(r.approved_at)}</dd>` : ''}
      ${r.returned_at ? `<dt>คืนครบเมื่อ</dt><dd>${fmtDateTime(r.returned_at)}</dd>` : ''}
    </dl>
    <div class="table-wrap card"><table>
      <thead><tr><th>อุปกรณ์</th><th class="num">ยืม</th><th class="num">คืนแล้ว</th><th class="num">ชำรุด/หาย</th><th class="num">ค้างคืน</th>
        ${canReturn ? '<th>รับคืน</th><th>ชำรุด/หาย</th>' : r.status === 'pending' ? '<th class="num">คงเหลือในคลัง</th>' : ''}</tr></thead>
      <tbody>${r.items.map((l) => `<tr>
        <td>${esc(l.name)}<div class="muted small">${esc(l.code)}</div></td>
        <td class="num">${l.qty}</td><td class="num">${l.returned_qty}</td><td class="num">${l.lost_qty}</td>
        <td class="num">${r.status === 'borrowed' ? outstanding(l) : '-'}</td>
        ${canReturn ? `
          <td><input type="number" min="0" max="${outstanding(l)}" value="${outstanding(l)}" data-ret="${l.item_id}" style="width:80px" ${outstanding(l) ? '' : 'disabled'}></td>
          <td><input type="number" min="0" max="${outstanding(l)}" value="0" data-lost="${l.item_id}" style="width:80px" ${outstanding(l) ? '' : 'disabled'}></td>`
          : r.status === 'pending' ? `<td class="num ${l.available_qty < l.qty ? 'error' : ''}">${l.available_qty}</td>` : ''}
      </tr>`).join('')}</tbody>
    </table></div>
    ${canReturn ? '<label>หมายเหตุการคืน<input id="return-note" placeholder="เช่น สภาพปกติ / สายชำรุด"></label>' : ''}
    <div class="toolbar">
      <button class="btn" id="rq-print">พิมพ์ใบยืม</button>
      <span class="spacer"></span>
      ${r.status === 'pending' ? '<button class="btn" id="rq-cancel">ยกเลิกคำขอ</button>' : ''}
      ${isAdmin() && r.status === 'pending' ? '<button class="btn danger" id="rq-reject">ไม่อนุมัติ</button><button class="btn ok" id="rq-approve">อนุมัติและจ่ายอุปกรณ์</button>' : ''}
      ${canReturn ? '<button class="btn primary" id="rq-return">บันทึกรับคืน</button>' : ''}
    </div>`);

  const done = (msg) => { toast(msg); refresh(); showRequest(id); };
  $('#rq-print', body).addEventListener('click', () => printRequest(r));
  $('#rq-cancel', body)?.addEventListener('click', safe(async () => {
    if (!confirm('ยืนยันยกเลิกคำขอนี้?')) return;
    await store.act('cancelRequest', { id });
    done('ยกเลิกคำขอแล้ว');
  }));
  $('#rq-approve', body)?.addEventListener('click', safe(async () => {
    await store.act('approve', { id });
    done('อนุมัติและตัดสต็อกเรียบร้อย');
  }));
  $('#rq-reject', body)?.addEventListener('click', safe(async () => {
    const note = prompt('เหตุผลที่ไม่อนุมัติ (ถ้ามี)');
    if (note === null) return;
    await store.act('reject', { id, note });
    done('บันทึกไม่อนุมัติแล้ว');
  }));
  $('#rq-return', body)?.addEventListener('click', safe(async () => {
    const items = r.items.map((l) => ({
      item_id: l.item_id,
      returned_qty: Number($(`[data-ret="${l.item_id}"]`, body).value) || 0,
      lost_qty: Number($(`[data-lost="${l.item_id}"]`, body).value) || 0,
    }));
    await store.act('returnItems', { id, items, note: $('#return-note', body).value });
    done('บันทึกรับคืนและคืนสต็อกเรียบร้อย');
  }));
}

function printRequest(r) {
  $('#print-area').innerHTML = `
    <h2>ใบยืมอุปกรณ์ ${esc(CONFIG.HOSPITAL_NAME || '')}</h2>
    <p style="text-align:center">เลขที่ ${esc(r.request_no)} · สถานะ: ${STATUS[r.status]}</p>
    <p>ผู้ยืม: <strong>${esc(r.borrower_name)}</strong> ${r.phone ? `โทร ${esc(r.phone)}` : ''}<br>
      หน่วยงาน: ${esc(r.department)}<br>
      วันที่ยืม: ${fmtDate(r.borrow_date)} &nbsp; กำหนดคืน: ${fmtDate(r.due_date)}<br>
      ${r.purpose ? `วัตถุประสงค์: ${esc(r.purpose)}` : ''}</p>
    <table><thead><tr><th>ลำดับ</th><th>รหัส</th><th>รายการ</th><th>จำนวน</th><th>คืนแล้ว</th></tr></thead>
      <tbody>${r.items.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.code)}</td><td>${esc(l.name)}</td>
        <td>${l.qty} ${esc(l.unit)}</td><td>${l.returned_qty}</td></tr>`).join('')}</tbody></table>
    <div class="sign-row">
      <div>ลงชื่อ ...................................... ผู้ยืม<br>(${esc(r.borrower_name)})</div>
      <div>ลงชื่อ ...................................... ผู้จ่าย<br>(......................................)</div>
    </div>`;
  window.print();
}

// ===================== Movements =====================
function renderMovements(page) {
  const items = itemsView();
  page.innerHTML = `
    <div class="card card-pad toolbar">
      <select id="m-item"><option value="">ทุกอุปกรณ์</option>${items.map((i) => `<option value="${i.id}">${esc(i.code)} ${esc(i.name)}</option>`).join('')}</select>
      <select id="m-type"><option value="">ทุกประเภท</option>${Object.entries(MOVE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <label class="checkbox">ตั้งแต่ <input type="date" id="m-from"></label>
      <label class="checkbox">ถึง <input type="date" id="m-to"></label>
      <span class="spacer"></span>
      <button class="btn" id="m-export">ส่งออก CSV</button>
    </div>
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th>วันเวลา</th><th>อุปกรณ์</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th class="num">ยอดรวม</th><th>อ้างอิง / หมายเหตุ</th></tr></thead>
      <tbody id="m-body"></tbody>
    </table></div></section>`;
  const filtered = () => {
    const item = Number($('#m-item').value), type = $('#m-type').value, from = $('#m-from').value, to = $('#m-to').value;
    return state.db.movements.filter((m) => (!item || m.item_id === item) && (!type || m.type === type) &&
      (!from || m.created_at.slice(0, 10) >= from) && (!to || m.created_at.slice(0, 10) <= to)).sort((a, b) => b.id - a.id);
  };
  const draw = () => {
    $('#m-body').innerHTML = filtered().slice(0, 1000).map((m) => {
      const i = itemById(m.item_id);
      return `<tr><td>${fmtDateTime(m.created_at)}</td><td>${esc(i?.name)}<div class="muted small">${esc(i?.code)}</div></td>
        <td>${movePill(m)}</td><td class="num">${m.qty > 0 ? '+' : ''}${fmtNum(m.qty)}</td>
        <td class="num">${fmtNum(m.available_after)}</td><td class="num">${fmtNum(m.total_after)}</td>
        <td>${esc(m.request_no)} ${m.note ? `<div class="muted small">${esc(m.note)}</div>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">ไม่พบรายการ</td></tr>';
  };
  ['#m-item', '#m-type', '#m-from', '#m-to'].forEach((s) => $(s).addEventListener('change', draw));
  $('#m-export').addEventListener('click', () => downloadCsv('stock-movements',
    ['วันเวลา', 'รหัส', 'อุปกรณ์', 'ประเภท', 'จำนวน', 'คงเหลือหลังทำรายการ', 'ยอดรวมหลังทำรายการ', 'เลขที่คำขอ', 'หมายเหตุ'],
    filtered().map((m) => [m.created_at, itemById(m.item_id)?.code, itemById(m.item_id)?.name, MOVE[m.type], m.qty, m.available_after, m.total_after, m.request_no, m.note])));
  draw();
}

// ===================== Settings =====================
function renderSettings(page) {
  const card = (table, title) => `
    <section class="card">
      <div class="card-head"><h3>${title}</h3>
        <form class="toolbar" data-add="${table}"><input name="name" placeholder="เพิ่มใหม่..." required><button class="btn sm primary">เพิ่ม</button></form></div>
      <div class="table-wrap"><table><tbody>${state.db[table].map((x) => `<tr><td>${esc(x.name)}</td>
        <td class="num"><button class="link" data-remove-${table}="${esc(x.name)}">ลบ</button></td></tr>`).join('') ||
        '<tr><td class="empty">ยังไม่มีข้อมูล</td></tr>'}</tbody></table></div>
    </section>`;
  page.innerHTML = `<div class="grid-2" style="align-items:start">${card('departments', 'หน่วยงาน / แผนก')}${card('categories', 'หมวดหมู่อุปกรณ์')}</div>
    ${DEMO ? `<section class="card card-pad"><h3>โหมดทดลอง</h3>
      <p class="muted">ล้างข้อมูลที่ทดลองไว้ในเบราว์เซอร์นี้ แล้วกลับไปใช้ข้อมูลตัวอย่าง</p>
      <button class="btn danger" id="reset-demo">ล้างข้อมูลทดลอง</button></section>`
      : `<section class="card card-pad"><h3>Google Sheets</h3><p class="muted" style="margin:0">ข้อมูลทั้งหมดอยู่ใน Google Sheet ที่เชื่อมไว้
        แก้ชื่อ/สถานที่เก็บใน Sheet ได้โดยตรง แต่ควรปรับ <strong>จำนวน</strong> ผ่านเว็บนี้เพื่อให้มีประวัติสต็อกครบ</p></section>`}`;

  $$('[data-add]').forEach((f) => f.addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    await store.act('addMaster', { table: f.dataset.add, name: f.name.value });
    toast('เพิ่มเรียบร้อย');
    refresh();
  })));
  for (const table of ['departments', 'categories']) {
    $$(`[data-remove-${table}]`).forEach((b) => b.addEventListener('click', safe(async () => {
      if (!confirm('ยืนยันการลบ?')) return;
      await store.act('removeMaster', { table, name: b.getAttribute(`data-remove-${table}`) });
      toast('ลบเรียบร้อย');
      refresh();
    })));
  }
  $('#reset-demo')?.addEventListener('click', () => {
    if (!confirm('ล้างข้อมูลทดลองทั้งหมด?')) return;
    localStorage.removeItem(DEMO_KEY);
    state.db = demoLoad();
    toast('รีเซ็ตข้อมูลแล้ว');
    refresh();
  });
}

// ===================== Boot =====================
(async () => {
  document.title = `ระบบยืม-คืนอุปกรณ์ ${CONFIG.HOSPITAL_NAME || ''}`.trim();
  renderMode();
  $('#page').innerHTML = '<div class="muted">กำลังโหลดข้อมูล...</div>';
  try {
    await store.load();
    lastSnapshot = JSON.stringify(state.db);
    render();
  } catch (e) {
    $('#page').innerHTML = `<div class="card card-pad error">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}<br>
      ตรวจสอบ API_URL ใน config.js และการ Deploy ของ Google Apps Script</div>`;
  }
})();
