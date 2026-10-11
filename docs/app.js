'use strict';

// ===================== Config & state =====================
const CONFIG = window.APP_CONFIG || {};
const API_URL = (CONFIG.API_URL || '').trim();
const DEMO = !API_URL;
const DEMO_KEY = 'supply-demo-db-v3';
const DEMO_PIN = '1234';
const { STATUS, MOVE, TYPES, KINDS } = BorrowCore;

const state = {
  db: null,
  pin: sessionStorage.getItem('pin') || '',
  // ฟอร์มเบิก/ยืม: จำนวนที่เลือกต่อพัสดุ { [item_id]: qty }
  picks: {},
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isAdmin = () => !!state.pin;
const today = () => BorrowCore.ymd(new Date());
const fmtNum = (n) => Number(n || 0).toLocaleString('th-TH');
const lsGet = (k) => { try { return localStorage.getItem(k) || ''; } catch { return ''; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* ignore */ } };

function addDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return BorrowCore.ymd(d);
}
// th-TH แสดงปี พ.ศ. อัตโนมัติ
function fmtDate(s) {
  if (!s) return '-';
  return new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}
function fmtDateTime(s) {
  if (!s) return '-';
  const d = new Date(s.replace(' ', 'T'));
  return isNaN(d) ? s : d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const ICON = {
  box: '<svg viewBox="0 0 24 24"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3L18.7 8 12 11.7 5.3 8 12 4.3ZM5 9.7l6 3.3v6.6l-6-3.3V9.7Zm8 9.9V13l6-3.3v6.6l-6 3.3Z"/></svg>',
  withdraw: '<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2Zm7-3 6-6-1.4-1.4-3.6 3.6V3h-2v10.2L7.4 9.6 6 11l6 6Z"/></svg>',
  borrow: '<svg viewBox="0 0 24 24"><path d="M12 4V1L8 5l4 4V6a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8Z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5Zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M9.3 6.7 10.7 5.3 17.4 12l-6.7 6.7-1.4-1.4 5.3-5.3-5.3-5.3Z"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5L13 3.5ZM8 13v2h8v-2H8Zm0 4v2h5v-2H8Z"/></svg>',
};

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
  lsSet(DEMO_KEY, JSON.stringify(db));
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
  return state.db.items.map((i) => ({ ...i, borrowed_qty: borrowedQty(i.id) })).sort((a, b) => a.code.localeCompare(b.code));
}
// จำนวนที่ถูกยืมอยู่ (ยังไม่คืน) — ไม่นับของที่เบิกไปแล้ว
function borrowedQty(itemId) {
  const open = new Set(state.db.requests.filter((r) => r.status === 'borrowed').map((r) => r.id));
  return state.db.request_items.filter((l) => l.item_id === itemId && open.has(l.request_id))
    .reduce((s, l) => s + l.qty - l.returned_qty - l.lost_qty, 0);
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
    is_overdue: r.status === 'borrowed' && !!r.due_date && r.due_date < today(),
    days_overdue: Math.round((new Date(today()) - new Date(r.due_date)) / 86400000),
    item_summary: lines.map((l) => `${l.name} ×${l.qty}`).join(', '),
    department_full: deptFull(r.department),
  };
}
function requestsView() {
  return state.db.requests.map(requestView).sort((a, b) => b.id - a.id);
}
const isLow = (i) => i.available_qty <= i.min_qty;

// ===================== UI helpers =====================
let toastTimer;
function toast(msg, isError = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 5000 : 2600);
}
function openModal(title, html, { wide = false } = {}) {
  $('#modal-title').textContent = title;
  $('#modal').classList.toggle('wide', wide);
  const body = $('#modal-body');
  body.innerHTML = html;
  if (!$('#modal').open) $('#modal').showModal();
  body.scrollTop = 0;
  return body;
}
const closeModal = () => $('#modal').close();
const safe = (fn) => async (...args) => {
  try { await fn(...args); } catch (e) { toast(e.message, true); }
};
const formData = (form) => Object.fromEntries(new FormData(form).entries());

// ชื่อเต็มของแผนก เช่น "งานการพยาบาลผู้ป่วยหนัก (ICU)" ใช้ในเอกสาร PDF
function deptFull(name) {
  const d = state.db.departments.find((x) => x.name === name);
  return d && d.full_name && d.full_name !== name ? `${d.full_name} (${name})` : name;
}
function deptOptions(selected) {
  return '<option value="">เลือกแผนก</option>' + state.db.departments.map((d) =>
    `<option value="${esc(d.name)}" ${d.name === selected ? 'selected' : ''}>${esc(d.name)}${d.full_name && d.full_name !== d.name ? ' — ' + esc(d.full_name) : ''}</option>`).join('');
}
function options(list, selected, blank) {
  return (blank ? `<option value="">${blank}</option>` : '') +
    list.map((x) => `<option ${x.name === selected ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
}
function statusPill(r) {
  if (r.is_overdue) return '<span class="pill overdue">เกินกำหนดคืน</span>';
  return `<span class="pill ${r.status}">${STATUS[r.status]}</span>`;
}
const typePill = (t) => `<span class="pill ${t}">${TYPES[t]}</span>`;
function movePill(m) {
  const cls = m.qty > 0 ? 'in' : m.type === 'lost' ? 'out' : m.type === 'withdraw' ? 'withdraw' : 'borrow';
  return `<span class="pill ${cls}">${MOVE[m.type]}</span>`;
}
function stockBar(i) {
  const max = Math.max(i.total_qty, i.available_qty, 1);
  const pct = Math.round((i.available_qty / max) * 100);
  return `<div class="bar ${i.available_qty === 0 ? 'empty-stock' : isLow(i) ? 'low' : ''}"><span style="width:${pct}%"></span></div>`;
}
function bindRowClicks(root) {
  $$('[data-item]', root).forEach((el) => el.addEventListener('click', () => showItem(Number(el.dataset.item))));
  $$('[data-request]', root).forEach((el) => el.addEventListener('click', () => showRequest(Number(el.dataset.request))));
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
  const btn = $('#btn-admin');
  btn.textContent = isAdmin() ? 'เจ้าหน้าที่ · ออก' : 'เจ้าหน้าที่';
  btn.classList.toggle('on', isAdmin());
  btn.title = isAdmin() ? 'ออกจากโหมดเจ้าหน้าที่' : 'เข้าสู่โหมดเจ้าหน้าที่พัสดุ';
}

$('#btn-admin').addEventListener('click', () => {
  if (isAdmin()) {
    state.pin = '';
    sessionStorage.removeItem('pin');
    renderMode();
    route();
    toast('ออกจากโหมดเจ้าหน้าที่แล้ว');
    return;
  }
  const body = openModal('โหมดเจ้าหน้าที่พัสดุ', `
    <p class="muted">ใช้สำหรับรับคืนพัสดุ รับเข้าสต็อก ตรวจนับ และจัดการรายชื่อพัสดุ/แผนก</p>
    <form id="pin-form" class="fields">
      <label class="field full">รหัส PIN${DEMO ? ' <span class="hint">(โหมดทดลองใช้ 1234)</span>' : ''}
        <input type="password" name="pin" inputmode="numeric" autocomplete="off" required autofocus></label>
      <div class="actions full"><button class="btn primary lg block">เข้าสู่ระบบ</button></div>
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
  home: { title: 'หน้าแรก', render: renderHome },
  request: { title: 'เบิก / ยืม', render: renderRequestForm },
  items: { title: 'พัสดุคงเหลือ', render: renderItems },
  requests: { title: 'ประวัติเบิก-ยืม', render: renderRequests },
  dashboard: { title: 'ภาพรวม', render: renderDashboard, admin: true },
  movements: { title: 'ประวัติสต็อก', render: renderMovements, admin: true },
  settings: { title: 'ตั้งค่า', render: renderSettings, admin: true },
};

function currentRoute() {
  const key = location.hash.replace(/^#\/?/, '').split('?')[0] || 'home';
  return ROUTES[key] && (!ROUTES[key].admin || isAdmin()) ? key : 'home';
}
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');

function renderNav() {
  const reqs = requestsView();
  const overdue = reqs.filter((r) => r.is_overdue).length;
  const links = [['home', 'หน้าแรก'], ['request', 'เบิก / ยืม'], ['items', 'พัสดุคงเหลือ'], ['requests', 'ประวัติ', overdue]];
  const admin = [['dashboard', 'ภาพรวม'], ['movements', 'ประวัติสต็อก'], ['settings', 'ตั้งค่า']];
  const cur = currentRoute();
  const a = ([k, label, n]) => `<a href="#/${k === 'home' ? '' : k}" class="${k === cur ? 'active' : ''}">${label}${n ? `<span class="badge">${n}</span>` : ''}</a>`;
  $('#nav-links').innerHTML = links.map(a).join('') + (isAdmin() ? '<span class="divider"></span>' + admin.map(a).join('') : '');
  fitNav();
}

// ย่อเมนูเป็นปุ่ม ☰ เฉพาะเมื่อลิงก์ไม่พอดีกับความกว้างจอ (มือถือ, iPad แนวตั้งในโหมดเจ้าหน้าที่)
function fitNav() {
  const nav = $('#nav-bar');
  const links = $('#nav-links');
  nav.classList.remove('compact');
  const compact = links.scrollWidth > links.clientWidth + 1;
  nav.classList.toggle('compact', compact);
  if (!compact) setMenu(false);
}
window.addEventListener('resize', fitNav);

function setMenu(open) {
  $('#nav-bar').classList.toggle('open', open);
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
}
$('#menu-toggle').addEventListener('click', () => setMenu(!$('#nav-bar').classList.contains('open')));
$('#nav-links').addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });

function render() {
  const key = currentRoute();
  document.title = `${ROUTES[key].title} · ระบบเบิก-ยืมพัสดุ`;
  renderNav();
  const page = $('#page');
  // เล่น animation ใหม่ทุกครั้งที่เปลี่ยนหน้า
  page.style.animation = 'none';
  void page.offsetHeight;
  page.style.animation = '';
  page.innerHTML = '';
  if (DEMO) {
    page.insertAdjacentHTML('beforeend', '<div class="banner">โหมดทดลอง — ข้อมูลเก็บเฉพาะในเบราว์เซอร์เครื่องนี้ เชื่อม Google Sheets ตามคู่มือใน README เพื่อใช้ร่วมกันทุกเครื่อง</div>');
  }
  ROUTES[key].render(page);
}

let lastSnapshot = '';
let lastRoute = '';
async function route() {
  setMenu(false);
  const key = currentRoute();
  if (key !== lastRoute) window.scrollTo(0, 0);
  lastRoute = key;
  render();
  await syncFromSheet();
}

// โหมด Google Sheets: ดึงข้อมูลล่าสุดเบื้องหลัง แล้ววาดใหม่ถ้ามีการแก้ไข (จากเครื่องอื่นหรือแก้ในชีตโดยตรง)
// หน้าฟอร์มเบิก/ยืม วาดเฉพาะรายการพัสดุใหม่ ข้อมูลที่กรอกไว้ไม่หาย
async function syncFromSheet() {
  if (DEMO || $('#modal').open) return;
  const key = currentRoute();
  try {
    await store.load();
    const snap = JSON.stringify(state.db);
    if (snap === lastSnapshot) return;
    lastSnapshot = snap;
    if ($('#modal').open || currentRoute() !== key) return;
    if (key === 'request') redrawPickList?.(); else render();
  } catch (e) { toast(e.message, true); }
}
// กลับมาที่แท็บ / แอปบนมือถือ → ดึงยอดล่าสุด
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncFromSheet(); });
window.addEventListener('hashchange', route);

// วาดหน้าปัจจุบันใหม่หลังบันทึกข้อมูล
function refresh() {
  lastSnapshot = JSON.stringify(state.db);
  render();
}

// ===================== Home =====================
function renderHome(page) {
  const items = state.db.items.filter((i) => i.active);
  const reqs = requestsView();
  const borrowing = reqs.filter((r) => r.status === 'borrowed');
  const overdue = borrowing.filter((r) => r.is_overdue);
  page.insertAdjacentHTML('beforeend', `
    <section class="hero">
      <p class="eyebrow">${esc(CONFIG.HOSPITAL_NAME || 'ระบบพัสดุ')}</p>
      <h1>เบิก หรือ ยืม<br><span class="gradient-text">ง่ายในไม่กี่คลิก</span></h1>
      <p class="lead">เลือกพัสดุ กรอกชื่อและแผนก แล้วรับใบเบิก/ใบยืมเป็นไฟล์ PDF ได้ทันที</p>
    </section>
    <div class="choice-grid">
      <a class="choice withdraw" href="#/request?type=withdraw">
        <span class="choice-icon">${ICON.withdraw}</span>
        <h2>เบิกพัสดุ</h2>
        <p>เวชภัณฑ์และวัสดุสิ้นเปลือง เบิกไปใช้ในหน่วยงานแล้วไม่ต้องนำมาคืน</p>
        <span class="cta">เริ่มเบิกพัสดุ</span>
        <span class="ghost">${ICON.withdraw}</span>
      </a>
      <a class="choice borrow" href="#/request?type=borrow">
        <span class="choice-icon">${ICON.borrow}</span>
        <h2>ยืมพัสดุ</h2>
        <p>ยืมพัสดุไปใช้ก่อนชั่วคราว แล้วนำมาคืนคลังภายในวันที่กำหนด</p>
        <span class="cta">เริ่มยืมพัสดุ</span>
        <span class="ghost">${ICON.borrow}</span>
      </a>
    </div>
    <div class="stat-strip">
      <a href="#/items"><span class="v">${fmtNum(items.length)}</span><span class="l">รายการพัสดุ</span></a>
      <a href="#/requests?tab=borrowed"><span class="v">${fmtNum(borrowing.length)}</span><span class="l">กำลังถูกยืม</span></a>
      <a href="#/requests?tab=overdue" class="${overdue.length ? 'warn' : ''}"><span class="v">${fmtNum(overdue.length)}</span><span class="l">เกินกำหนดคืน</span></a>
    </div>`);
}

// ===================== Request form (เบิก / ยืม) =====================
let redrawPickList = null;

function renderRequestForm(page) {
  const params = hashParams();
  let type = TYPES[params.get('type')] ? params.get('type') : (lsGet('last-type') || 'withdraw');
  // มาจากปุ่ม "เบิก/ยืม" ในหน้าพัสดุ: เลือกรายการนั้นไว้ให้
  const pre = itemById(params.get('item'));
  if (pre && BorrowCore.allows(pre, type) && pre.available_qty > 0 && !state.picks[pre.id]) state.picks[pre.id] = 1;

  page.insertAdjacentHTML('beforeend', `
    <div class="page-head">
      <h1 id="rf-title"></h1>
      <p class="lead" id="rf-lead"></p>
    </div>
    <div class="segmented big" id="rf-type" role="tablist">
      <button type="button" data-type="withdraw" role="tab">เบิกพัสดุ</button>
      <button type="button" data-type="borrow" role="tab">ยืมพัสดุ</button>
    </div>
    <form id="rf" novalidate style="display:flex;flex-direction:column;gap:24px">
      <section class="group">
        <div class="group-head"><h2><span class="step">1</span>ข้อมูลผู้ขอ</h2></div>
        <div class="fields">
          <label class="field">ชื่อ-นามสกุล <span class="req">*</span>
            <input name="borrower_name" required autocomplete="name" placeholder="เช่น สมชาย ใจดี" value="${esc(lsGet('last-name'))}"></label>
          <label class="field">แผนก <span class="req">*</span>
            <select name="department" required>${deptOptions(lsGet('last-dept'))}</select></label>
          <label class="field" id="rf-due">วันคืน <span class="req">*</span>
            <input type="date" name="due_date" min="${today()}" value="${addDays(7)}"></label>
          <label class="field" id="rf-note">หมายเหตุ <span class="hint">(ไม่บังคับ)</span>
            <input name="note" placeholder="เช่น ใช้ทดแทนชั่วคราวระหว่างรอของ"></label>
        </div>
      </section>
      <section class="group">
        <div class="group-head">
          <h2><span class="step">2</span>เลือกพัสดุ</h2>
          <div class="search">${ICON.search}<input type="search" id="rf-q" placeholder="ค้นหาชื่อหรือรหัสพัสดุ"></div>
        </div>
        <ul class="list" id="rf-list"></ul>
      </section>
      <div class="checkout">
        <div class="sum"><strong id="rf-count"></strong><span id="rf-detail"></span></div>
        <button class="btn primary lg" id="rf-submit"></button>
      </div>
    </form>`);

  const form = $('#rf');
  const allowed = () => itemsView().filter((i) => i.active && BorrowCore.allows(i, type));

  function applyType() {
    const w = type === 'withdraw';
    $('#rf-title').textContent = w ? 'เบิกพัสดุ' : 'ยืมพัสดุ';
    $('#rf-lead').textContent = w
      ? 'สำหรับเวชภัณฑ์และวัสดุสิ้นเปลืองที่ใช้แล้วหมดไป ไม่ต้องนำมาคืน'
      : 'ยืมพัสดุไปใช้ชั่วคราว และนำมาคืนคลังภายในวันที่กำหนด';
    $$('#rf-type button').forEach((b) => {
      b.classList.toggle('active', b.dataset.type === type);
      b.setAttribute('aria-selected', String(b.dataset.type === type));
    });
    $('#rf-due').hidden = w;
    form.due_date.required = !w;
    $('#rf-submit').className = 'btn lg ' + (w ? 'primary' : 'borrow');
    // ตัดพัสดุที่ใช้กับประเภทนี้ไม่ได้ออกจากรายการที่เลือก
    for (const id of Object.keys(state.picks)) {
      const i = itemById(id);
      if (!i || !BorrowCore.allows(i, type)) delete state.picks[id];
    }
    history.replaceState(null, '', `#/request?type=${type}`);
    drawList();
  }

  function drawSummary() {
    const chosen = Object.entries(state.picks).map(([id, q]) => ({ item: itemById(id), q })).filter((x) => x.item);
    const verb = type === 'withdraw' ? 'เบิก' : 'ยืม';
    $('#rf-count').textContent = chosen.length ? `${chosen.length} รายการ · ${fmtNum(chosen.reduce((s, x) => s + x.q, 0))} ชิ้น` : 'ยังไม่ได้เลือกพัสดุ';
    $('#rf-detail').textContent = chosen.length ? chosen.map((x) => `${x.item.name} ×${x.q}`).join(', ') : `เลือกพัสดุที่ต้องการ${verb}จากรายการด้านบน`;
    $('#rf-submit').textContent = `ยืนยันการ${verb}`;
  }

  function drawList() {
    const q = $('#rf-q').value.trim().toLowerCase();
    const items = allowed().filter((i) => !q || [i.name, i.code, i.category].some((s) => s.toLowerCase().includes(q)));
    $('#rf-list').innerHTML = items.map((i) => {
      const n = state.picks[i.id] || 0;
      const out = i.available_qty === 0;
      return `<li class="pick ${out ? 'out' : ''} ${n ? 'selected' : ''}">
        <span class="pick-icon ${i.kind === 'borrow' ? 'borrow' : ''}">${i.kind === 'borrow' ? ICON.borrow : ICON.box}</span>
        <div class="pick-body">
          <div class="pick-name">${esc(i.name)}</div>
          <div class="pick-meta">${esc(i.code)} · ${out ? '<span class="error">หมด</span>' :
            `คงเหลือ <span class="${isLow(i) ? 'low' : ''}">${fmtNum(i.available_qty)}</span> ${esc(i.unit)}`}</div>
        </div>
        ${n ? `<div class="stepper">
            <button type="button" data-dec="${i.id}" aria-label="ลด">−</button>
            <input type="number" inputmode="numeric" min="0" max="${i.available_qty}" value="${n}" data-qty="${i.id}" aria-label="จำนวน">
            <button type="button" data-inc="${i.id}" aria-label="เพิ่ม" ${n >= i.available_qty ? 'disabled' : ''}>+</button>
          </div>`
          : `<button type="button" class="btn add-btn" data-inc="${i.id}" ${out ? 'disabled' : ''}>${out ? 'หมด' : 'เลือก'}</button>`}
      </li>`;
    }).join('') || `<li class="empty">${q ? 'ไม่พบพัสดุที่ค้นหา' : 'ยังไม่มีพัสดุสำหรับประเภทนี้'}</li>`;
    drawSummary();
  }
  redrawPickList = drawList;

  const setQty = (id, qty) => {
    const i = itemById(id);
    qty = Math.max(0, Math.min(i.available_qty, Math.floor(Number(qty) || 0)));
    if (qty) state.picks[id] = qty; else delete state.picks[id];
    drawList();
  };
  $('#rf-list').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    if (inc) setQty(inc.dataset.inc, (state.picks[inc.dataset.inc] || 0) + 1);
    if (dec) setQty(dec.dataset.dec, (state.picks[dec.dataset.dec] || 0) - 1);
  });
  $('#rf-list').addEventListener('change', (e) => {
    const inp = e.target.closest('[data-qty]');
    if (inp) setQty(inp.dataset.qty, inp.value);
  });
  $('#rf-q').addEventListener('input', drawList);
  $$('#rf-type button').forEach((b) => b.addEventListener('click', () => { type = b.dataset.type; applyType(); }));

  form.addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const data = formData(form);
    if (!data.borrower_name.trim()) { form.borrower_name.focus(); throw new Error('กรุณากรอกชื่อ-นามสกุล'); }
    if (!data.department) { form.department.focus(); throw new Error('กรุณาเลือกแผนก'); }
    if (type === 'borrow' && (!data.due_date || data.due_date < today())) { form.due_date.focus(); throw new Error('กรุณาเลือกวันคืน (ตั้งแต่วันนี้เป็นต้นไป)'); }
    const items = Object.entries(state.picks).map(([item_id, qty]) => ({ item_id: Number(item_id), qty }));
    if (!items.length) throw new Error('กรุณาเลือกพัสดุอย่างน้อย 1 รายการ');
    const btn = $('#rf-submit');
    btn.disabled = true;
    try {
      const id = await store.act('createRequest', { ...data, type, items });
      lsSet('last-name', data.borrower_name.trim());
      lsSet('last-dept', data.department);
      lsSet('last-type', type);
      state.picks = {};
      lastSnapshot = JSON.stringify(state.db);
      form.note.value = '';
      $('#rf-q').value = '';
      drawList();
      showSuccess(id);
    } finally {
      btn.disabled = false;
    }
  }));

  applyType();
}

// ===================== Success + PDF =====================
// สร้าง PDF รอไว้ก่อน แล้วถามผู้ใช้ว่าจะบันทึกลงเครื่องหรือไม่
function showSuccess(id) {
  const r = requestView(state.db.requests.find((x) => x.id === id));
  const w = r.type === 'withdraw';
  const body = openModal('', `
    <div class="success">
      <svg class="check-anim" viewBox="0 0 76 76"><circle cx="38" cy="38" r="34"/><path d="M23 39.5 33.5 50 54 28"/></svg>
      <h2>${w ? 'เบิกพัสดุเรียบร้อย' : 'ยืมพัสดุเรียบร้อย'}</h2>
      <p class="doc-no">เลขที่ <b>${esc(r.request_no)}</b> · ${r.items.length} รายการ${w ? '' : ` · คืนภายใน ${fmtDate(r.due_date)}`}</p>
      <div class="permission">
        <span class="file-icon">PDF</span>
        <div>
          <p id="pdf-q">กำลังจัดทำ${w ? 'ใบเบิก' : 'ใบยืม'}พัสดุ...</p>
          <p class="muted" id="pdf-sub"><span class="spinner" style="width:12px;height:12px"></span> กรุณารอสักครู่</p>
        </div>
      </div>
      <div class="actions">
        <button class="btn lg" id="pdf-skip">ไม่ใช่ตอนนี้</button>
        <button class="btn primary lg" id="pdf-save" disabled>${PdfDoc.isIOS ? 'บันทึก PDF' : 'ดาวน์โหลด PDF'}</button>
      </div>
    </div>`);
  let blob = null;
  const fileName = PdfDoc.fileName(r);
  PdfDoc.build(r, CONFIG.HOSPITAL_NAME).then((b) => {
    blob = b;
    $('#pdf-q', body).innerHTML = `อนุญาตให้บันทึก <b>${esc(fileName)}</b> ลงในเครื่องนี้หรือไม่?`;
    $('#pdf-sub', body).textContent = PdfDoc.isIOS
      ? 'แตะ "บันทึก PDF" แล้วเลือก "บันทึกไปยังไฟล์" หรือ "พิมพ์" · บันทึกซ้ำได้จากหน้าประวัติ'
      : 'ใช้พิมพ์และลงลายมือชื่อ' + (w ? 'ผู้เบิก' : 'ผู้ยืม') + 'และเจ้าหน้าที่พัสดุ · ดาวน์โหลดซ้ำได้จากหน้าประวัติ';
    $('#pdf-save', body).disabled = false;
  }).catch((e) => {
    $('#pdf-q', body).textContent = 'สร้างไฟล์ PDF ไม่สำเร็จ';
    $('#pdf-sub', body).textContent = e.message + ' — ลองดาวน์โหลดอีกครั้งจากหน้าประวัติ';
  });
  $('#pdf-skip', body).addEventListener('click', closeModal);
  $('#pdf-save', body).addEventListener('click', safe(async () => {
    if (!blob) return;
    if (await PdfDoc.save(blob, fileName)) {
      toast('บันทึกไฟล์ ' + fileName + ' แล้ว');
      closeModal();
    }
  }));
}

async function downloadPdf(r, btn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> กำลังสร้าง PDF';
  try {
    const blob = await PdfDoc.build(r, CONFIG.HOSPITAL_NAME);
    // การสร้างอาจใช้เวลา เบราว์เซอร์อาจไม่ยอมเปิดหน้าต่างบันทึกโดยไม่มีการคลิกใหม่ จึงให้กดยืนยันอีกครั้ง
    btn.innerHTML = `${ICON.doc} บันทึก ${esc(PdfDoc.fileName(r))}`;
    btn.disabled = false;
    btn.onclick = safe(async () => {
      if (await PdfDoc.save(blob, PdfDoc.fileName(r))) toast('บันทึกไฟล์แล้ว');
    });
    btn.classList.add('primary');
  } catch (e) {
    btn.innerHTML = label;
    btn.disabled = false;
    throw e;
  }
}

// ===================== Items / Stock =====================
function renderItems(page) {
  const params = hashParams();
  page.insertAdjacentHTML('beforeend', `
    <div class="page-head-row">
      <div class="page-head"><h1>พัสดุคงเหลือ</h1><p class="lead">ยอดคงเหลือล่าสุดจาก Google Sheet</p></div>
      ${isAdmin() ? '<button class="btn primary" id="btn-add">+ เพิ่มพัสดุ</button>' : ''}
    </div>
    <div class="toolbar">
      <div class="search">${ICON.search}<input type="search" id="f-q" placeholder="ค้นหาชื่อ รหัส หรือสถานที่เก็บ" value="${esc(params.get('q') || '')}"></div>
      <select id="f-cat" style="width:auto">${options(state.db.categories, params.get('cat'), 'ทุกหมวดหมู่')}</select>
      <div class="segmented" id="f-kind">
        <button data-kind="">ทั้งหมด</button><button data-kind="withdraw">เบิกได้</button><button data-kind="borrow">ยืมได้</button>
      </div>
      <label class="check"><input type="checkbox" id="f-low" ${params.get('low') === '1' ? 'checked' : ''}> ใกล้หมด</label>
      <span class="spacer"></span>
      <button class="btn" id="btn-export">ส่งออก CSV</button>
    </div>
    <div class="item-grid" id="items-grid"></div>`);
  let kind = params.get('kind') || '';

  const filtered = () => {
    const q = $('#f-q').value.trim().toLowerCase();
    const cat = $('#f-cat').value;
    const low = $('#f-low').checked;
    const qs = new URLSearchParams();
    if (q) qs.set('q', q);
    if (cat) qs.set('cat', cat);
    if (kind) qs.set('kind', kind);
    if (low) qs.set('low', '1');
    history.replaceState(null, '', `#/items${qs.toString() ? '?' + qs : ''}`);
    return itemsView().filter((i) => (i.active || isAdmin()) &&
      (!q || [i.name, i.code, i.location].some((s) => s.toLowerCase().includes(q))) &&
      (!cat || i.category === cat) && (!kind || BorrowCore.allows(i, kind)) && (!low || isLow(i)));
  };

  const actionBtns = (i) => ['withdraw', 'borrow'].filter((t) => BorrowCore.allows(i, t)).map((t) =>
    `<a class="btn sm ${t === 'withdraw' ? 'primary' : 'borrow'}" href="#/request?type=${t}&item=${i.id}" ${i.available_qty > 0 && i.active ? '' : 'hidden'}>${TYPES[t]}</a>`).join('');

  const draw = () => {
    $$('#f-kind button').forEach((b) => b.classList.toggle('active', b.dataset.kind === kind));
    $('#items-grid').innerHTML = filtered().map((i) => `
      <div class="item-card" data-item="${i.id}">
        <div class="top">
          <span class="pick-icon ${i.kind === 'borrow' ? 'borrow' : ''}">${i.kind === 'borrow' ? ICON.borrow : ICON.box}</span>
          <div style="flex:1;min-width:0"><div class="name">${esc(i.name)}</div><div class="code">${esc(i.code)} · ${esc(i.category || 'ไม่ระบุหมวด')}</div></div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${i.available_qty === 0 ? '<span class="pill out">หมด</span>' : isLow(i) ? '<span class="pill low">ใกล้หมด</span>' : ''}
          ${i.active ? '' : '<span class="pill">ปิดใช้งาน</span>'}
          ${i.borrowed_qty ? `<span class="pill borrow">ถูกยืม ${fmtNum(i.borrowed_qty)}</span>` : ''}
        </div>
        <div class="qty"><b>${fmtNum(i.available_qty)}</b><span>${esc(i.unit)} คงเหลือ</span><span class="spacer"></span>
          <span class="actions">${actionBtns(i)}</span></div>
        ${stockBar(i)}
      </div>`).join('') || '<div class="card empty" style="grid-column:1/-1">ไม่พบรายการ</div>';
    bindRowClicks($('#items-grid'));
    $$('#items-grid a.btn').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  };

  $('#f-q').addEventListener('input', draw);
  $('#f-cat').addEventListener('change', draw);
  $('#f-low').addEventListener('change', draw);
  $$('#f-kind button').forEach((b) => b.addEventListener('click', () => { kind = b.dataset.kind; draw(); }));
  $('#btn-export').addEventListener('click', () => downloadCsv('stock',
    ['รหัส', 'ชื่อ', 'หมวดหมู่', 'หน่วย', 'ประเภท', 'จำนวนทั้งหมด', 'คงเหลือ', 'ถูกยืม', 'จุดสั่งซื้อขั้นต่ำ', 'สถานที่เก็บ'],
    filtered().map((i) => [i.code, i.name, i.category, i.unit, KINDS[i.kind], i.total_qty, i.available_qty, i.borrowed_qty, i.min_qty, i.location])));
  if (isAdmin()) $('#btn-add').addEventListener('click', () => itemForm(null));
  draw();
}

function showItem(id) {
  const i = itemsView().find((x) => x.id === id);
  if (!i) return;
  const borrowers = requestsView().filter((r) => r.status === 'borrowed')
    .flatMap((r) => r.items.filter((l) => l.item_id === id && l.qty > l.returned_qty + l.lost_qty)
      .map((l) => ({ ...r, outstanding: l.qty - l.returned_qty - l.lost_qty })));
  const moves = state.db.movements.filter((m) => m.item_id === id).sort((a, b) => b.id - a.id).slice(0, 100);
  const body = openModal(i.name, `
    <dl class="info">
      <dt>รหัส</dt><dd>${esc(i.code)}</dd>
      <dt>หมวดหมู่</dt><dd>${esc(i.category || '-')}</dd>
      <dt>ประเภท</dt><dd>${KINDS[i.kind]}</dd>
      <dt>คงเหลือในคลัง</dt><dd>${fmtNum(i.available_qty)} ${esc(i.unit)} ${isLow(i) ? '<span class="pill low">ต่ำกว่าจุดขั้นต่ำ</span>' : ''}</dd>
      <dt>ถูกยืมอยู่</dt><dd>${fmtNum(i.borrowed_qty)} ${esc(i.unit)}</dd>
      <dt>จุดสั่งซื้อขั้นต่ำ</dt><dd>${fmtNum(i.min_qty)} ${esc(i.unit)}</dd>
      <dt>สถานที่เก็บ</dt><dd>${esc(i.location || '-')}</dd>
    </dl>
    <div class="toolbar">
      ${['withdraw', 'borrow'].filter((t) => BorrowCore.allows(i, t) && i.available_qty > 0 && i.active)
        .map((t) => `<a class="btn ${t === 'withdraw' ? 'primary' : 'borrow'}" href="#/request?type=${t}&item=${i.id}" data-close>${TYPES[t]}รายการนี้</a>`).join('')}
      ${isAdmin() ? `<span class="spacer"></span><button class="btn ok" data-stock="receive">รับเข้า</button>
        <button class="btn" data-stock="adjust">ตรวจนับ</button>
        <button class="btn" data-stock="lost">ตัดชำรุด</button>
        <button class="btn" id="i-edit">แก้ไข</button>` : ''}
    </div>
    ${borrowers.length ? `<h4>ผู้ที่กำลังยืม</h4>
    <div class="sub-card table-wrap"><table>
      <thead><tr><th>เลขที่</th><th>ผู้ยืม / แผนก</th><th>กำหนดคืน</th><th class="num">ค้างคืน</th></tr></thead>
      <tbody>${borrowers.map((b) => `<tr class="clickable" data-request="${b.id}"><td>${esc(b.request_no)}</td>
        <td>${esc(b.borrower_name)}<div class="muted small">${esc(b.department)}</div></td><td>${fmtDate(b.due_date)}</td>
        <td class="num">${b.outstanding}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    ${isAdmin() ? `<h4>ประวัติสต็อก</h4>
    <div class="sub-card table-wrap"><table>
      <thead><tr><th>วันเวลา</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th>อ้างอิง</th></tr></thead>
      <tbody>${moves.map((m) => `<tr><td>${fmtDateTime(m.created_at)}</td><td>${movePill(m)}</td>
        <td class="num">${m.qty > 0 ? '+' : ''}${fmtNum(m.qty)}</td><td class="num">${fmtNum(m.available_after)}</td>
        <td>${esc(m.request_no)} ${m.note ? `<div class="muted small">${esc(m.note)}</div>` : ''}</td></tr>`).join('') ||
        '<tr><td colspan="5" class="empty">ไม่มี</td></tr>'}</tbody>
    </table></div>` : ''}`, { wide: isAdmin() });
  $$('[data-close]', body).forEach((a) => a.addEventListener('click', closeModal));
  bindRowClicks(body);
  if (isAdmin()) {
    $('#i-edit', body).addEventListener('click', () => itemForm(i));
    $$('[data-stock]', body).forEach((b) => b.addEventListener('click', () => stockForm(i, b.dataset.stock)));
  }
}

function itemForm(item) {
  const kindOpts = Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${(item?.kind || 'withdraw') === k ? 'selected' : ''}>${v}</option>`).join('');
  const body = openModal(item ? 'แก้ไขข้อมูลพัสดุ' : 'เพิ่มพัสดุใหม่', `
    <form id="item-form" class="fields">
      <label class="field">รหัสพัสดุ <span class="req">*</span><input name="code" required value="${esc(item?.code)}"></label>
      <label class="field">หน่วยนับ<input name="unit" value="${esc(item?.unit || 'ชิ้น')}"></label>
      <label class="field full">ชื่อพัสดุ <span class="req">*</span><input name="name" required value="${esc(item?.name)}"></label>
      <label class="field">ประเภทการใช้งาน<select name="kind">${kindOpts}</select></label>
      <label class="field">หมวดหมู่<select name="category">${options(state.db.categories, item?.category, '- ไม่ระบุ -')}</select></label>
      <label class="field">จุดสั่งซื้อขั้นต่ำ <span class="hint">(เตือนเมื่อคงเหลือ ≤)</span><input name="min_qty" type="number" min="0" value="${item?.min_qty ?? 0}"></label>
      ${item ? '' : '<label class="field">จำนวนเริ่มต้น<input name="initial_qty" type="number" min="0" value="0"></label>'}
      <label class="field ${item ? '' : 'full'}">สถานที่เก็บ<input name="location" value="${esc(item?.location)}"></label>
      ${item ? `<label class="check full"><input type="checkbox" name="active" ${item.active ? 'checked' : ''}> เปิดใช้งาน (ให้เบิก/ยืมได้)</label>` : ''}
      <div class="actions full"><button class="btn primary lg">บันทึก</button></div>
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
    ? `<label class="field full">ยอดคงเหลือในคลังที่นับได้จริง (${esc(item.unit)})<input name="counted_qty" type="number" min="0" required value="${item.available_qty}"></label>
       <p class="muted small full">ยอดในระบบ ${fmtNum(item.available_qty)} ${esc(item.unit)} (ไม่รวม ${fmtNum(item.borrowed_qty)} ที่ถูกยืมอยู่)</p>`
    : `<label class="field full">จำนวน (${esc(item.unit)})<input name="qty" type="number" min="1" ${type === 'lost' ? `max="${item.available_qty}"` : ''} required></label>`;
  const body = openModal(`${titles[type]} · ${item.name}`, `
    <form id="stock-form" class="fields">
      ${field}
      <label class="field full">หมายเหตุ / เลขที่เอกสาร<input name="note"></label>
      <div class="actions full"><button class="btn primary lg">บันทึก</button></div>
    </form>`);
  $('#stock-form', body).addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    await store.act('stock', { item_id: item.id, type, ...formData(e.target) });
    toast('ปรับปรุงสต็อกเรียบร้อย');
    refresh();
    showItem(item.id);
  }));
}

// ===================== Requests (history) =====================
function renderRequests(page) {
  let tab = hashParams().get('tab') || '';
  const tabs = [['', 'ทั้งหมด'], ['withdraw', 'เบิก'], ['borrowed', 'กำลังยืม'], ['overdue', 'เกินกำหนด'], ['returned', 'คืนแล้ว']];
  page.insertAdjacentHTML('beforeend', `
    <div class="page-head"><h1>ประวัติเบิก-ยืม</h1><p class="lead">ดูรายการย้อนหลังและดาวน์โหลดใบเบิก/ใบยืมเป็น PDF</p></div>
    <div class="toolbar">
      <div class="segmented" id="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div>
      <div class="search">${ICON.search}<input type="search" id="r-q" placeholder="ค้นหาเลขที่ ชื่อ แผนก หรือพัสดุ"></div>
      <button class="btn" id="r-export">ส่งออก CSV</button>
    </div>
    <section class="card"><ul class="rows" id="req-body"></ul></section>`);

  const match = (r) => !tab || (tab === 'overdue' ? r.is_overdue : tab === 'withdraw' ? r.type === 'withdraw' : r.status === tab);
  const filtered = () => {
    const q = $('#r-q').value.trim().toLowerCase();
    return requestsView().filter((r) => match(r) &&
      (!q || [r.request_no, r.borrower_name, r.department, r.item_summary].some((s) => s.toLowerCase().includes(q))));
  };
  const draw = () => {
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    history.replaceState(null, '', `#/requests${tab ? '?tab=' + tab : ''}`);
    $('#req-body').innerHTML = filtered().map((r) => `
      <li><div class="row" data-request="${r.id}">
        <span class="pick-icon ${r.type === 'borrow' ? 'borrow' : ''}">${r.type === 'borrow' ? ICON.borrow : ICON.withdraw}</span>
        <div class="row-body">
          <div class="row-title">${esc(r.borrower_name)} <span class="muted small" style="font-weight:400">· ${esc(r.department)}</span></div>
          <div class="row-sub">${esc(r.request_no)} · ${esc(r.item_summary)}</div>
        </div>
        <div class="row-end">${statusPill(r)}<span>${r.type === 'borrow' && r.status === 'borrowed' ? 'คืน ' + fmtDate(r.due_date) : fmtDate(r.created_at)}</span></div>
        <span class="chev">${ICON.chev}</span>
      </div></li>`).join('') || '<li class="empty">ไม่พบรายการ</li>';
    bindRowClicks($('#req-body'));
  };
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  $('#r-q').addEventListener('input', draw);
  $('#r-export').addEventListener('click', () => downloadCsv('requests',
    ['เลขที่', 'ประเภท', 'ชื่อ', 'แผนก', 'วันที่', 'กำหนดคืน', 'สถานะ', 'วันที่คืนครบ', 'รหัสพัสดุ', 'พัสดุ', 'จำนวน', 'คืนแล้ว', 'ชำรุด/สูญหาย'],
    filtered().flatMap((r) => r.items.map((l) => [r.request_no, TYPES[r.type], r.borrower_name, r.department, r.borrow_date, r.due_date,
      r.is_overdue ? 'เกินกำหนดคืน' : STATUS[r.status], r.returned_at, l.code, l.name, l.qty, l.returned_qty, l.lost_qty]))));
  draw();
}

function showRequest(id) {
  const raw = state.db.requests.find((r) => r.id === id);
  if (!raw) return;
  const r = requestView(raw);
  const w = r.type === 'withdraw';
  const outstanding = (l) => l.qty - l.returned_qty - l.lost_qty;
  const canReturn = isAdmin() && r.status === 'borrowed';
  const showReturned = !w && r.status !== 'pending';
  const body = openModal(`${w ? 'ใบเบิก' : 'ใบยืม'} ${r.request_no}`, `
    <div style="display:flex;gap:6px">${typePill(r.type)}${statusPill(r)}</div>
    <dl class="info">
      <dt>ชื่อ</dt><dd>${esc(r.borrower_name)} ${r.phone ? `(โทร ${esc(r.phone)})` : ''}</dd>
      <dt>แผนก</dt><dd>${esc(r.department_full)}</dd>
      <dt>วันที่${w ? 'เบิก' : 'ยืม'}</dt><dd>${fmtDateTime(r.created_at)}</dd>
      ${w ? '' : `<dt>กำหนดคืน</dt><dd>${fmtDate(r.due_date)}${r.is_overdue ? ` <span class="pill overdue">เกิน ${r.days_overdue} วัน</span>` : ''}</dd>`}
      ${r.purpose ? `<dt>วัตถุประสงค์</dt><dd>${esc(r.purpose)}</dd>` : ''}
      ${r.note ? `<dt>หมายเหตุ</dt><dd>${esc(r.note)}</dd>` : ''}
      ${r.returned_at ? `<dt>คืนครบเมื่อ</dt><dd>${fmtDateTime(r.returned_at)}</dd>` : ''}
    </dl>
    <div class="sub-card table-wrap"><table>
      <thead><tr><th>พัสดุ</th><th class="num">จำนวน</th>
        ${showReturned ? '<th class="num">คืนแล้ว</th><th class="num">ชำรุด/หาย</th><th class="num">ค้างคืน</th>' : ''}
        ${canReturn ? '<th>รับคืน</th><th>ชำรุด/หาย</th>' : r.status === 'pending' ? '<th class="num">คงเหลือในคลัง</th>' : ''}</tr></thead>
      <tbody>${r.items.map((l) => `<tr>
        <td>${esc(l.name)}<div class="muted small">${esc(l.code)}</div></td>
        <td class="num">${l.qty} ${esc(l.unit)}</td>
        ${showReturned ? `<td class="num">${l.returned_qty}</td><td class="num">${l.lost_qty}</td><td class="num">${r.status === 'borrowed' ? outstanding(l) : '-'}</td>` : ''}
        ${canReturn ? `
          <td><input type="number" min="0" max="${outstanding(l)}" value="${outstanding(l)}" data-ret="${l.item_id}" ${outstanding(l) ? '' : 'disabled'}></td>
          <td><input type="number" min="0" max="${outstanding(l)}" value="0" data-lost="${l.item_id}" ${outstanding(l) ? '' : 'disabled'}></td>`
          : r.status === 'pending' ? `<td class="num ${l.available_qty < l.qty ? 'error' : ''}">${l.available_qty}</td>` : ''}
      </tr>`).join('')}</tbody>
    </table></div>
    ${canReturn ? '<label class="field">หมายเหตุการคืน<input id="return-note" placeholder="เช่น สภาพปกติ / สายชำรุด"></label>' : ''}
    <div class="actions">
      <button class="btn" id="rq-pdf">${ICON.doc} ดาวน์โหลด PDF</button>
      <span class="spacer"></span>
      ${r.status === 'pending' ? '<button class="btn" id="rq-cancel">ยกเลิกคำขอ</button>' : ''}
      ${isAdmin() && r.status === 'pending' ? '<button class="btn danger" id="rq-reject">ไม่อนุมัติ</button><button class="btn ok" id="rq-approve">อนุมัติและจ่าย</button>' : ''}
      ${canReturn ? '<button class="btn primary" id="rq-return">บันทึกรับคืน</button>' : ''}
    </div>`, { wide: canReturn });

  const done = (msg) => { toast(msg); refresh(); showRequest(id); };
  $('#rq-pdf', body).addEventListener('click', safe(() => downloadPdf(r, $('#rq-pdf', body))), { once: true });
  bindRowClicks(body);
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

// ===================== Dashboard (เจ้าหน้าที่) =====================
function renderDashboard(page) {
  const items = itemsView().filter((i) => i.active);
  const reqs = requestsView();
  const low = items.filter(isLow);
  const borrowing = reqs.filter((r) => r.status === 'borrowed');
  const overdue = reqs.filter((r) => r.is_overdue).sort((a, b) => a.due_date.localeCompare(b.due_date));
  const month = today().slice(0, 7);
  const withdrawnThisMonth = reqs.filter((r) => r.type === 'withdraw' && r.created_at.startsWith(month)).length;
  const recent = state.db.movements.slice().sort((a, b) => b.id - a.id).slice(0, 10);
  page.insertAdjacentHTML('beforeend', `
    <div class="page-head"><h1>ภาพรวม</h1><p class="lead">สรุปสต็อกและการเบิก-ยืม</p></div>
    <div class="stats">
      <a class="card stat" href="#/items"><span class="label">พัสดุในระบบ</span><span class="value">${fmtNum(items.length)}</span><span class="sub">รายการ</span></a>
      <a class="card stat" href="#/requests?tab=withdraw"><span class="label">เบิกเดือนนี้</span><span class="value">${fmtNum(withdrawnThisMonth)}</span><span class="sub">ใบเบิก</span></a>
      <a class="card stat" href="#/requests?tab=borrowed"><span class="label">กำลังถูกยืม</span><span class="value">${fmtNum(borrowing.length)}</span><span class="sub">ใบยืม</span></a>
      <a class="card stat warn" href="#/items?low=1"><span class="label">ใกล้หมด</span><span class="value">${fmtNum(low.length)}</span><span class="sub">รายการ</span></a>
      <a class="card stat danger" href="#/requests?tab=overdue"><span class="label">เกินกำหนดคืน</span><span class="value">${fmtNum(overdue.length)}</span><span class="sub">ใบยืม</span></a>
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>ใกล้หมด</h3><a href="#/items?low=1" class="link">ดูทั้งหมด</a></div>
        <div class="table-wrap"><table>
          <thead><tr><th>พัสดุ</th><th class="num">คงเหลือ</th><th class="num">ขั้นต่ำ</th></tr></thead>
          <tbody>${low.map((i) => `<tr class="clickable" data-item="${i.id}"><td>${esc(i.name)}<div class="muted small">${esc(i.code)}</div></td>
            <td class="num"><span class="pill low">${fmtNum(i.available_qty)} ${esc(i.unit)}</span></td><td class="num">${fmtNum(i.min_qty)}</td></tr>`).join('') ||
            '<tr><td colspan="3" class="empty">สต็อกทุกรายการอยู่ในระดับปกติ</td></tr>'}</tbody>
        </table></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>เกินกำหนดคืน</h3><a href="#/requests?tab=overdue" class="link">ดูทั้งหมด</a></div>
        <div class="table-wrap"><table>
          <thead><tr><th>เลขที่ / ผู้ยืม</th><th>กำหนดคืน</th><th class="num">เกิน</th></tr></thead>
          <tbody>${overdue.map((r) => `<tr class="clickable" data-request="${r.id}"><td>${esc(r.request_no)}<div class="muted small">${esc(r.borrower_name)} · ${esc(r.department)}</div></td>
            <td>${fmtDate(r.due_date)}</td><td class="num"><span class="pill overdue">${r.days_overdue} วัน</span></td></tr>`).join('') ||
            '<tr><td colspan="3" class="empty">ไม่มีรายการเกินกำหนด</td></tr>'}</tbody>
        </table></div>
      </section>
    </div>
    <section class="card">
      <div class="card-head"><h3>ความเคลื่อนไหวล่าสุด</h3><a href="#/movements" class="link">ดูทั้งหมด</a></div>
      <div class="table-wrap"><table>
        <thead><tr><th>วันเวลา</th><th>พัสดุ</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th>อ้างอิง</th></tr></thead>
        <tbody>${recent.map((m) => `<tr><td>${fmtDateTime(m.created_at)}</td><td>${esc(itemById(m.item_id)?.name)}</td><td>${movePill(m)}</td>
          <td class="num">${m.qty > 0 ? '+' : ''}${fmtNum(m.qty)}</td><td class="num">${fmtNum(m.available_after)}</td><td>${esc(m.request_no)}</td></tr>`).join('') ||
          '<tr><td colspan="6" class="empty">ยังไม่มีข้อมูล</td></tr>'}</tbody>
      </table></div>
    </section>`);
  bindRowClicks(page);
}

// ===================== Movements =====================
function renderMovements(page) {
  const items = itemsView();
  page.insertAdjacentHTML('beforeend', `
    <div class="page-head"><h1>ประวัติสต็อก</h1><p class="lead">ทุกการเคลื่อนไหว พร้อมยอดคงเหลือหลังทำรายการ</p></div>
    <div class="toolbar">
      <select id="m-item" style="width:auto;max-width:100%"><option value="">ทุกพัสดุ</option>${items.map((i) => `<option value="${i.id}">${esc(i.code)} ${esc(i.name)}</option>`).join('')}</select>
      <select id="m-type" style="width:auto"><option value="">ทุกประเภท</option>${Object.entries(MOVE).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <label class="check">ตั้งแต่ <input type="date" id="m-from" style="width:auto"></label>
      <label class="check">ถึง <input type="date" id="m-to" style="width:auto"></label>
      <span class="spacer"></span>
      <button class="btn" id="m-export">ส่งออก CSV</button>
    </div>
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th>วันเวลา</th><th>พัสดุ</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th class="num">ยอดรวม</th><th>อ้างอิง / หมายเหตุ</th></tr></thead>
      <tbody id="m-body"></tbody>
    </table></div></section>`);
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
    ['วันเวลา', 'รหัส', 'พัสดุ', 'ประเภท', 'จำนวน', 'คงเหลือหลังทำรายการ', 'ยอดรวมหลังทำรายการ', 'เลขที่เอกสาร', 'หมายเหตุ'],
    filtered().map((m) => [m.created_at, itemById(m.item_id)?.code, itemById(m.item_id)?.name, MOVE[m.type], m.qty, m.available_after, m.total_after, m.request_no, m.note])));
  draw();
}

// ===================== Settings =====================
function renderSettings(page) {
  const isDept = (table) => table === 'departments';
  const card = (table, title) => `
    <section class="card">
      <div class="card-head"><h3>${title}</h3></div>
      <form class="toolbar" data-add="${table}" style="padding:4px 24px 12px">
        <input name="name" placeholder="${isDept(table) ? 'ชื่อย่อ เช่น ICU' : 'เพิ่มใหม่...'}" required style="flex:1;min-width:120px">
        ${isDept(table) ? '<input name="full_name" placeholder="ชื่อเต็ม (ถ้ามี)" style="flex:2;min-width:160px">' : ''}
        <button class="btn primary">เพิ่ม</button></form>
      <div class="table-wrap"><table><tbody>${state.db[table].map((x) => `<tr><td>${esc(x.name)}${x.full_name ? `<div class="muted small">${esc(x.full_name)}</div>` : ''}</td>
        <td class="num"><button class="link" data-remove-${table}="${esc(x.name)}">ลบ</button></td></tr>`).join('') ||
        '<tr><td class="empty">ยังไม่มีข้อมูล</td></tr>'}</tbody></table></div>
    </section>`;
  page.insertAdjacentHTML('beforeend', `
    <div class="page-head"><h1>ตั้งค่า</h1><p class="lead">รายชื่อแผนกจะแสดงในฟอร์มเบิก/ยืม</p></div>
    <div class="grid-2">${card('departments', 'แผนก')}${card('categories', 'หมวดหมู่พัสดุ')}</div>
    ${DEMO ? `<section class="card card-pad" style="display:flex;flex-direction:column;gap:12px;align-items:flex-start"><h3>โหมดทดลอง</h3>
      <p class="muted">ล้างข้อมูลที่ทดลองไว้ในเบราว์เซอร์นี้ แล้วกลับไปใช้ข้อมูลตัวอย่าง</p>
      <button class="btn danger" id="reset-demo">ล้างข้อมูลทดลอง</button></section>`
      : `<section class="card card-pad" style="display:flex;flex-direction:column;gap:8px"><h3>Google Sheets</h3><p class="muted">ข้อมูลทั้งหมดอยู่ใน Google Sheet ที่เชื่อมไว้
        แก้ชื่อ/สถานที่เก็บใน Sheet ได้โดยตรง แต่ควรปรับ <strong>จำนวน</strong> ผ่านเว็บนี้เพื่อให้มีประวัติสต็อกครบ</p></section>`}`);

  $$('[data-add]').forEach((f) => f.addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    await store.act('addMaster', { table: f.dataset.add, name: f.name.value, full_name: f.full_name?.value });
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
    try { localStorage.removeItem(DEMO_KEY); } catch { /* ignore */ }
    state.db = demoLoad();
    toast('รีเซ็ตข้อมูลแล้ว');
    refresh();
  });
}

// ===================== Boot =====================
(async () => {
  renderMode();
  $('#page').innerHTML = '<div class="empty"><span class="spinner"></span> กำลังโหลดข้อมูล...</div>';
  try {
    await store.load();
    lastSnapshot = JSON.stringify(state.db);
    lastRoute = currentRoute();
    render();
  } catch (e) {
    $('#page').innerHTML = `<div class="card card-pad error">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}<br>
      ตรวจสอบ API_URL ใน config.js และการ Deploy ของ Google Apps Script</div>`;
  }
})();
