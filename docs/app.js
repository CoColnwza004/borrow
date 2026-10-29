'use strict';

// ===================== Config & state =====================
const CONFIG = window.APP_CONFIG || {};
// เว็บทดสอบ = ลิงก์ preview ของ Cloudflare ที่ build จาก branch อื่น (ไม่ใช่ branch หลัก) ดู scripts/cf-headers.js
// ไม่แตะ Google Sheet จริง: ใช้ชีตสำเนา TEST_API_URL ถ้าตั้งไว้ ไม่งั้นใช้โหมดทดลอง (ข้อมูลอยู่ในเบราว์เซอร์)
const BUILD = window.BUILD_INFO || {};
const TEST_SITE = BUILD.test === true;
const API_URL = ((TEST_SITE ? CONFIG.TEST_API_URL : CONFIG.API_URL) || '').trim();
const DEMO = !API_URL;
const DEMO_KEY = 'supply-demo-db-v3';
const DEMO_PIN = '1234';
// สต็อก/แผนกล่าสุด (ข้อมูลสาธารณะเท่านั้น) เก็บไว้ในเครื่อง เพื่อเปิดหน้าได้ทันทีโดยไม่ต้องรอ Google Sheets
const CACHE_KEY = 'supply-public-cache-v1';
const { STATUS, MOVE } = BorrowCore;

const state = {
  db: null,
  pin: sessionStorage.getItem('pin') || '',
  // ฟอร์มเบิก: จำนวนที่เลือกต่อพัสดุ { [item_id]: qty }
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
const motionOK = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;
// เด้งเบา ๆ เมื่อค่าเปลี่ยน (เช่น จำนวนในแถบยืนยัน)
const bump = (el) => { if (!el || !motionOK()) return; el.classList.remove('bump'); void el.offsetWidth; el.classList.add('bump'); };

// th-TH แสดงปี พ.ศ. อัตโนมัติ
function fmtDate(s) {
  if (!s) return '-';
  return new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}
function fmtDateTime(s) {
  if (!s) return '-';
  const d = new Date(s.replace(' ', 'T'));
  // วันเวลาที่เบิกแสดงถึงวินาที (ข้อมูลเก่าที่ไม่มีวินาทีแสดงแค่นาที)
  const sec = /\d{2}:\d{2}:\d{2}/.test(s);
  return isNaN(d) ? s : d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}) });
}

// ไอคอนปุ่มจำนวน (คมชัด อยู่กึ่งกลางพอดี)
const IC = {
  minus: '<svg viewBox="0 0 24 24"><path d="M5 11h14v2H5z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M9 3h6l1 2h4v2H4V5h4l1-2ZM6 9h12l-1 11a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2L6 9Z"/></svg>',
};
const TOAST_IC = {
  ok: '<svg viewBox="0 0 24 24"><path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4L9 16.2Z"/></svg>',
  err: '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-2h2v2Zm0-4h-2V7h2v6Z"/></svg>',
};
const ICON = {
  box: '<svg viewBox="0 0 24 24"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3L18.7 8 12 11.7 5.3 8 12 4.3ZM5 9.7l6 3.3v6.6l-6-3.3V9.7Zm8 9.9V13l6-3.3v6.6l-6 3.3Z"/></svg>',
  withdraw: '<svg viewBox="0 0 24 24"><path d="M5 20h14v-2H5v2Zm7-3 6-6-1.4-1.4-3.6 3.6V3h-2v10.2L7.4 9.6 6 11l6 6Z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.8l-.3-.3A6.5 6.5 0 1 0 14 15.5l.3.3v.8l5 5 1.5-1.5-5-5Zm-6 0a4.5 4.5 0 1 1 0-9 4.5 4.5 0 0 1 0 9Z"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M9.3 6.7 10.7 5.3 17.4 12l-6.7 6.7-1.4-1.4 5.3-5.3-5.3-5.3Z"/></svg>',
  doc: '<svg viewBox="0 0 24 24"><path d="M6 2h8l6 6v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Zm7 1.5V9h5.5L13 3.5ZM8 13v2h8v-2H8Zm0 4v2h5v-2H8Z"/></svg>',
  sheet: '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Zm-1 1.8L18.2 9H13V3.8ZM7 11h10v8H7v-8Zm1.5 1.5v1.5h3v-1.5h-3Zm4.5 0v1.5h2.5v-1.5H13Zm-4.5 3V17h3v-1.5h-3Zm4.5 0V17h2.5v-1.5H13Z"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M5 3h11a3 3 0 0 1 3 3v15H7a2 2 0 0 1-2-2V3Zm2 14v2h10v-2H7Zm0-12v10h10V6a1 1 0 0 0-1-1H7Zm2 2h6v2H9V7Zm0 3h6v2H9v-2Z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M12 2.6 7.3 7.3l1.4 1.4L11 6.4V15h2V6.4l2.3 2.3 1.4-1.4L12 2.6ZM5 10v10a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V10h-3v2h1v8H7v-8h1v-2H5Z"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/></svg>',
  ext: '<svg viewBox="0 0 24 24"><path d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3ZM5 5h6v2H5v12h12v-6h2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><path d="M7 2h2v2h6V2h2v2h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2V2ZM5 9v10h14V9H5Zm2 2h4v4H7v-4Z"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 8V7a3 3 0 1 1 6 0v3H9Z"/></svg>',
  bell: '<svg viewBox="0 0 24 24"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5.5-6.84V3.5a1.5 1.5 0 0 0-3 0v.66A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg>',
};

// ===================== Data layer =====================
// โหมดทดลอง: เก็บใน localStorage / โหมดจริง: เรียก Google Apps Script
// ข้อความบอกสาเหตุที่พบบ่อยเมื่อเชื่อม Apps Script ไม่ได้ ให้เจ้าหน้าที่แก้ได้เอง
const DEPLOY_HINT = 'ตรวจใน Apps Script: Deploy → Manage deployments → "ดำเนินการในฐานะ" = ฉัน (Me) และ "ผู้ที่มีสิทธิ์เข้าถึง" = ทุกคน (Anyone)';
async function remote(action, payload) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // text/plain เพื่อไม่ให้ติด CORS preflight
      body: JSON.stringify({ action, payload, pin: state.pin }),
    });
  } catch {
    // Google ส่งหน้าเข้าสู่ระบบแทนข้อมูล (สิทธิ์ไม่ใช่ Anyone) หรืออินเทอร์เน็ตหลุด
    throw new Error(navigator.onLine === false ? 'ไม่มีการเชื่อมต่ออินเทอร์เน็ต' : 'เชื่อมต่อ Google Sheets ไม่ได้ — ' + DEPLOY_HINT);
  }
  if (!res.ok) throw new Error('เชื่อมต่อ Google Sheets ไม่สำเร็จ (' + res.status + ') — ' + DEPLOY_HINT);
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(/doPost|function not found|ไม่พบฟังก์ชัน/i.test(text)
      ? 'Apps Script ไม่มีฟังก์ชัน doPost — วางโค้ด AllInOne.gs ให้ครบทั้งไฟล์ บันทึก แล้ว Deploy ใหม่'
      : 'Apps Script ตอบกลับไม่ใช่ข้อมูลของระบบ — ' + DEPLOY_HINT);
  }
  if (!data.ok) {
    const msg = data.error || 'เกิดข้อผิดพลาด';
    throw new Error(/ไม่รู้จักคำสั่ง/.test(msg) ? msg + ' — Apps Script ยังเป็นเวอร์ชันเก่า: วาง AllInOne.gs ล่าสุด แล้ว Deploy → Manage deployments → New version' : msg);
  }
  if (data.sheet) state.sheet = data.sheet; // ลิงก์ Google Sheet ส่งมาเฉพาะคำขอที่มี PIN เจ้าหน้าที่
  // Apps Script เวอร์ชันเก่า (ก่อนมีแท็บบริษัท) ส่งข้อมูลเจ้าหน้าที่มาโดยไม่มี suppliers
  if (state.pin && data.state) state.oldServer = !('suppliers' in data.state);
  return data;
}

// ข้อมูลพัสดุตั้งต้น (52 KB) ใช้เฉพาะโหมดทดลอง จึงโหลดเมื่อจำเป็นเท่านั้น
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error('โหลดไฟล์ ' + src + ' ไม่สำเร็จ'));
    document.head.appendChild(s);
  });
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

// โหมดทดลอง: demoDb = ข้อมูลเต็ม ส่วน state.db = สิ่งที่ผู้ใช้คนนี้เห็น (เหมือนที่ Apps Script ส่งมา)
let demoDb = null;
const demoView = (keep) => structuredClone(state.pin === DEMO_PIN ? demoDb : BorrowCore.publicView(demoDb, keep));

const store = {
  async load() {
    if (DEMO) {
      if (typeof SEED_DATA === 'undefined') await loadScript('seed-data.js');
      demoDb = demoLoad();
      state.db = demoView(0);
    } else {
      state.db = BorrowCore.normalize((await remote('load')).state);
      state.syncedAt = new Date();
      if (!state.pin) lsSet(CACHE_KEY, JSON.stringify(state.db));
    }
  },
  async act(action, payload, { quiet = false } = {}) {
    if (!quiet) $('#loading').hidden = false;
    try {
      if (DEMO) {
        const db = structuredClone(demoDb); // ถ้า error กลางทาง ข้อมูลเดิมไม่เสีย
        const result = BorrowCore.run(db, action, payload, { isAdmin: state.pin === DEMO_PIN });
        demoDb = db;
        demoSave(db);
        state.db = demoView(action === 'createRequest' ? result : 0);
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
  return state.db.items.slice().sort((a, b) => a.code.localeCompare(b.code));
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
  el.innerHTML = `${isError ? TOAST_IC.err : TOAST_IC.ok}<span>${esc(msg)}</span>`;
  el.className = 'toast' + (isError ? ' error' : '');
  el.hidden = true;
  void el.offsetWidth; // เล่นอนิเมชันเข้าใหม่ทุกครั้ง
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.add('out');
    toastTimer = setTimeout(() => { el.hidden = true; }, 200);
  }, isError ? 5000 : 2600);
}
const modal = $('#modal');
let closeTimer;
const modalOpen = () => modal.open && !modal.classList.contains('closing');
function openModal(title, html, { wide = false } = {}) {
  modal.classList.remove('closing');
  clearTimeout(closeTimer);
  $('#modal-title').textContent = title;
  $('#modal').classList.toggle('wide', wide);
  const body = $('#modal-body');
  body.innerHTML = html;
  if (!$('#modal').open) $('#modal').showModal();
  body.scrollTop = 0;
  return body;
}
// ปิดแบบมีจังหวะออก (ย่อ+จาง / เลื่อนลงบนมือถือ) แล้วค่อยปิดจริง
function closeModal() {
  if (!modal.open) return;
  if (!motionOK()) { modal.close(); return; }
  modal.classList.add('closing');
  clearTimeout(closeTimer);
  closeTimer = setTimeout(() => { if (modal.classList.contains('closing')) { modal.classList.remove('closing'); modal.close(); } }, 230);
}
modal.addEventListener('cancel', (e) => { e.preventDefault(); closeModal(); });
$('.sheet-head').addEventListener('submit', (e) => { e.preventDefault(); closeModal(); });
const safe = (fn) => async (...args) => {
  try { await fn(...args); } catch (e) { toast(e.message, true); }
};
// ช่องกรอกที่ผิด: ขอบแดง + สั่นเบา ๆ จนกว่าจะแก้
function flag(inp) {
  inp.focus();
  const f = inp.closest('.field');
  if (!f) return;
  f.classList.remove('invalid');
  void f.offsetWidth;
  f.classList.add('invalid');
  const clear = () => f.classList.remove('invalid');
  inp.addEventListener('input', clear, { once: true });
  inp.addEventListener('change', clear, { once: true });
}
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
const statusPill = (r) => `<span class="pill ${r.status}">${STATUS[r.status] || esc(r.status)}</span>`;
function movePill(m) {
  const cls = m.qty > 0 ? 'in' : m.type === 'withdraw' ? 'withdraw' : 'out';
  return `<span class="pill ${cls}">${MOVE[m.type] || esc(m.type)}</span>`;
}
// แถบระดับสต็อก: เต็มเมื่อมีของตั้งแต่ 2 เท่าของจุดสั่งซื้อขึ้นไป
function stockBar(i) {
  const max = Math.max(i.min_qty * 2, i.available_qty, 1);
  const pct = Math.max(0, Math.round((i.available_qty / max) * 100));
  return `<div class="bar ${i.available_qty <= 0 ? 'empty-stock' : isLow(i) ? 'low' : ''}"><span style="width:${pct}%"></span></div>`;
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
// แถบบอกว่าเป็นเว็บทดสอบ รุ่นไหน (branch / commit / เวลา build) และข้อมูลไปเก็บที่ไหน
function testBanner() {
  const built = BUILD.builtAt ? new Date(BUILD.builtAt).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const ver = [BUILD.commit && 'รุ่น ' + BUILD.commit, built && 'อัปเดต ' + built].filter(Boolean).join(' · ');
  return `<div class="banner test-banner"><b>เว็บทดสอบ</b> ${ver ? `<span class="test-ver">${esc(ver)}</span>` : ''}
    <span>${DEMO ? 'ลองเบิก/ดาวน์โหลด PDF ได้เต็มที่ ข้อมูลเก็บในเบราว์เซอร์นี้เท่านั้น <b>ไม่เข้า Google Sheet จริง</b> · หน้าเจ้าหน้าที่พัสดุใช้ PIN 1234'
      : 'ข้อมูลบันทึกลง <b>Google Sheet สำหรับทดสอบ</b> ไม่ใช่ชีตจริง'}</span></div>`;
}

function renderMode() {
  if (TEST_SITE && !$('.test-badge')) $('.brand').insertAdjacentHTML('beforeend', '<span class="test-badge">ทดสอบ</span>');
  const btn = $('#btn-admin');
  btn.textContent = isAdmin() ? 'เจ้าหน้าที่พัสดุ · ออก' : 'เจ้าหน้าที่พัสดุ';
  btn.classList.toggle('on', isAdmin());
  btn.title = isAdmin() ? 'ออกจากโหมดเจ้าหน้าที่พัสดุ' : 'เข้าสู่โหมดเจ้าหน้าที่พัสดุ';
}

$('#btn-admin').addEventListener('click', safe(async () => {
  if (isAdmin()) {
    state.pin = '';
    state.sheet = null;
    sessionStorage.removeItem('pin');
    renderMode();
    await store.load();
    refresh();
    toast('ออกจากโหมดเจ้าหน้าที่พัสดุแล้ว');
    return;
  }
  pinForm();
}));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ใส่รหัสแบบหน้าจอล็อก iPhone: จุดบอกจำนวนหลัก ปุ่มตัวเลขวงกลม ใส่ครบจำนวนหลัก (PIN_LENGTH) แล้วตรวจเอง
// ถูก → หน้าใส่รหัสหายไป → ป๊อปอัป "กำลังเข้าสู่ระบบ" → "เข้าสู่ระบบสำเร็จ" · ผิด → เปิดหน้าใส่รหัสใหม่ จุดสั่น + แจ้งว่ารหัสไม่ถูกต้อง
const PIN_LENGTH = Math.max(1, Math.min(12, Number(CONFIG.PIN_LENGTH) || 4));
const PIN_KEYS = [['1', ''], ['2', 'ABC'], ['3', 'DEF'], ['4', 'GHI'], ['5', 'JKL'], ['6', 'MNO'], ['7', 'PQRS'], ['8', 'TUV'], ['9', 'WXYZ']];
function pinForm(error = '') {
  $('dialog.passcode')?.remove();
  const d = document.createElement('dialog');
  d.className = 'passcode';
  d.tabIndex = -1;
  d.setAttribute('aria-label', 'ใส่รหัสเจ้าหน้าที่พัสดุ');
  d.innerHTML = `
    <div class="pc-top">
      <span class="pc-lock" aria-hidden="true">${ICON.lock}</span>
      <h2>ใส่รหัสเจ้าหน้าที่พัสดุ</h2>
      <p class="pc-msg${error ? ' err' : ''}" role="alert">${error ? esc(error) : DEMO ? 'โหมดทดลอง: รหัส 1234' : 'สำหรับรับเข้า ตรวจนับ และจัดการพัสดุ'}</p>
      <div class="pc-dots${error ? ' shake' : ''}" aria-hidden="true">${'<i></i>'.repeat(PIN_LENGTH)}</div>
      <span class="vh" aria-live="polite" id="pc-count"></span>
    </div>
    <div class="pc-pad">
      ${PIN_KEYS.map(([n, l]) => `<button type="button" class="pc-key" data-k="${n}" aria-label="${n}"><b>${n}</b><small>${l}</small></button>`).join('')}
      <span></span>
      <button type="button" class="pc-key" data-k="0" aria-label="0"><b>0</b><small></small></button>
      <button type="button" class="pc-txt" data-right>ยกเลิก</button>
    </div>`;
  document.body.append(d);
  let pin = '';
  let busy = false;
  const dots = $$('.pc-dots i', d);
  const right = $('[data-right]', d);
  const draw = () => {
    dots.forEach((x, i) => x.classList.toggle('on', i < pin.length));
    right.textContent = pin ? 'ลบ' : 'ยกเลิก';
    $('#pc-count', d).textContent = pin ? `ใส่แล้ว ${pin.length} จาก ${PIN_LENGTH} หลัก` : '';
  };
  const close = (then) => {
    if (!d.open) return;
    const done = () => { d.close(); d.remove(); then?.(); };
    if (!motionOK()) return done();
    d.classList.add('closing');
    setTimeout(done, 220);
  };
  const flash = (k) => {
    const b = $(`[data-k="${k}"]`, d);
    if (!b) return;
    b.classList.add('press');
    setTimeout(() => b.classList.remove('press'), 140);
  };
  const press = (k) => {
    if (busy || pin.length >= PIN_LENGTH) return;
    pin += k;
    draw();
    if (pin.length === PIN_LENGTH) {
      busy = true;
      // ให้เห็นจุดสุดท้ายเต็มก่อนหน้าใส่รหัสหายไป
      setTimeout(() => close(() => login(pin)), motionOK() ? 160 : 0);
    }
  };
  const back = () => { if (busy) return; if (pin) { pin = pin.slice(0, -1); draw(); } else close(); };
  $$('.pc-key', d).forEach((b) => b.addEventListener('click', () => press(b.dataset.k)));
  right.addEventListener('click', back);
  d.addEventListener('keydown', (e) => {
    if (/^\d$/.test(e.key)) { e.preventDefault(); flash(e.key); press(e.key); } else if (e.key === 'Backspace') { e.preventDefault(); back(); }
  });
  d.addEventListener('cancel', (e) => { e.preventDefault(); if (!busy) close(); });
  draw();
  d.showModal();
  d.focus();
  if (error && motionOK()) navigator.vibrate?.([70, 50, 70]);
}

async function login(pin) {
  const hud = loginHud();
  state.pin = pin;
  try {
    // แสดง "กำลังเข้าสู่ระบบ" อย่างน้อยครู่หนึ่ง ไม่ให้กะพริบหายเร็วเกินไป
    await Promise.all([store.act('checkPin', undefined, { quiet: true }), sleep(700)]);
  } catch (err) {
    state.pin = '';
    await hud.fail(/PIN/.test(err.message) ? 'รหัสไม่ถูกต้อง ลองอีกครั้ง' : err.message);
    pinForm(/PIN/.test(err.message) ? 'รหัสไม่ถูกต้อง ลองอีกครั้ง' : err.message);
    return;
  }
  sessionStorage.setItem('pin', state.pin);
  renderMode();
  route();
  hud.success();
}

// ป๊อปอัปกลางจอ: "กำลังเข้าสู่ระบบ" → "เข้าสู่ระบบสำเร็จ" แสดง 5 วินาที (แตะหรือกด Esc เพื่อปิดก่อนได้)
function loginHud() {
  $('.hud')?.remove();
  const el = document.createElement('div');
  el.className = 'hud';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<div class="hud-card" data-state="loading" tabindex="-1">
      <span class="hud-spin" aria-hidden="true"></span>
      <h3>กำลังเข้าสู่ระบบ</h3>
      <p>กำลังตรวจสอบรหัส PIN…</p>
    </div>`;
  document.body.append(el);
  const card = $('.hud-card', el);
  let timer;
  const close = () => {
    if (!el.isConnected || el.classList.contains('out')) return;
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    el.classList.add('out');
    setTimeout(() => el.remove(), motionOK() ? 260 : 0);
  };
  const onKey = (e) => { if (e.key === 'Escape' && card.dataset.state === 'ok') close(); };
  card.addEventListener('click', () => { if (card.dataset.state === 'ok') close(); });
  document.addEventListener('keydown', onKey);
  const swap = (state, html) => {
    card.dataset.state = state;
    card.innerHTML = html;
    if (motionOK()) card.animate([{ transform: 'scale(.96)' }, { transform: 'scale(1.02)' }, { transform: 'none' }], { duration: 380, easing: 'cubic-bezier(.34,1.56,.64,1)' });
  };
  return {
    success() {
      swap('ok', `
        <span class="hud-ic" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/><path d="M20 33.5 28.5 42 45 24"/></svg></span>
        <h3>เข้าสู่ระบบสำเร็จ</h3>
        <p>ยินดีต้อนรับ เจ้าหน้าที่พัสดุ</p>
        <div class="hud-tags"><span>พัสดุคงเหลือ</span><span>ประวัติเบิก</span><span>ภาพรวม</span><span>Google Sheet</span><span>ตั้งค่า</span></div>
        <p class="hud-hint">${$('#nav-bar').classList.contains('compact') ? 'เปิดเมนูเจ้าหน้าที่พัสดุได้ที่ปุ่ม ☰ มุมขวาบน' : 'เมนูเจ้าหน้าที่พัสดุอยู่ที่แถบด้านบน'}</p>
        <span class="hud-bar" aria-hidden="true"><i></i></span>`);
      timer = setTimeout(close, 5000);
    },
    async fail(msg) {
      swap('error', `
        <span class="hud-ic" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/><path d="M23 23 41 41M41 23 23 41"/></svg></span>
        <h3>เข้าสู่ระบบไม่สำเร็จ</h3>
        <p>${esc(msg)}</p>`);
      await sleep(1500);
      close();
      await sleep(motionOK() ? 260 : 0);
    },
  };
}

// ปุ่มกระจก (Liquid Glass): แสงวงกลมตามตำแหน่งเมาส์ (เฉพาะอุปกรณ์ที่มีเมาส์)
if (matchMedia('(hover: hover) and (pointer: fine)').matches) {
  addEventListener('pointermove', (e) => {
    const b = e.target.closest?.('.btn');
    if (!b) return;
    const r = b.getBoundingClientRect();
    b.style.setProperty('--mx', `${Math.round(e.clientX - r.left)}px`);
    b.style.setProperty('--my', `${Math.round(e.clientY - r.top)}px`);
  }, { passive: true });
}

// ===================== Routing =====================
// ผู้ใช้ทั่วไปเห็นหน้าแรก หน้าเบิกพัสดุ และพัสดุคงเหลือ (ดูอย่างเดียว) หน้าอื่นเปิดได้หลังเข้าสู่ระบบเจ้าหน้าที่
const ROUTES = {
  home: { title: 'หน้าแรก', render: renderHome },
  request: { title: 'เบิกพัสดุ', render: renderRequestForm },
  items: { title: 'พัสดุคงเหลือ', render: renderItems },
  requests: { title: 'ประวัติเบิก', render: renderRequests, admin: true },
  dashboard: { title: 'ภาพรวม', render: renderDashboard, admin: true },
  movements: { title: 'ประวัติสต็อก', render: renderMovements, admin: true },
  settings: { title: 'ตั้งค่า', render: renderSettings, admin: true },
  sheet: { title: 'Google Sheet', render: renderSheet, admin: true },
  help: { title: 'วิธีใช้งาน', render: renderHelp },
};

function currentRoute() {
  const key = location.hash.replace(/^#\/?/, '').split('?')[0] || 'home';
  return ROUTES[key] && (!ROUTES[key].admin || isAdmin()) ? key : 'home';
}
const hashParams = () => new URLSearchParams(location.hash.split('?')[1] || '');

function renderNav() {
  const links = [['home', 'หน้าแรก'], ['request', 'เบิกพัสดุ'], ['items', 'พัสดุคงเหลือ'], ['help', 'วิธีใช้งาน'], ['requests', 'ประวัติเบิก'], ['dashboard', 'ภาพรวม'], ['movements', 'ประวัติสต็อก'], ['sheet', 'Google Sheet'], ['settings', 'ตั้งค่า']];
  const cur = currentRoute();
  const a = ([k, label, n]) => `<a href="#/${k === 'home' ? '' : k}" class="${k === cur ? 'active' : ''}">${label}${n ? `<span class="badge">${n}</span>` : ''}</a>`;
  $('#nav-links').innerHTML = (isAdmin() ? links.filter(([k]) => k !== 'help') : links.slice(0, 4)).map(a).join('');
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
  slidePill();
}
// แถบเทาใต้เมนูหน้าปัจจุบัน เลื่อนจากตำแหน่งเดิมไปหน้าใหม่
function slidePill() {
  const nl = $('#nav-links');
  const act = $('a.active', nl);
  if ($('#nav-bar').classList.contains('compact') || !act) { nl.classList.remove('has-thumb', 'thumb-live'); return; }
  const x = act.offsetLeft, w = act.offsetWidth;
  const px = parseFloat(nl.style.getPropertyValue('--tx')), pw = parseFloat(nl.style.getPropertyValue('--tw'));
  // FLIP: ความกว้างเปลี่ยนทันที แล้วเลื่อน/ยืดด้วย transform อย่างเดียว (ลื่นเต็มรีเฟรชเรตจอ)
  if (nl.classList.contains('thumb-live') && pw && (px !== x || pw !== w)) {
    nl.classList.remove('thumb-live');
    nl.style.setProperty('--tw', w + 'px');
    nl.style.setProperty('--tx', px + 'px');
    nl.style.setProperty('--sx', pw / w);
    void getComputedStyle(nl, '::before').transform;
    nl.classList.add('thumb-live');
  }
  nl.style.setProperty('--tx', x + 'px');
  nl.style.setProperty('--tw', w + 'px');
  nl.style.setProperty('--sx', 1);
  if (!nl.classList.contains('has-thumb')) {
    nl.classList.add('has-thumb');
    requestAnimationFrame(() => requestAnimationFrame(() => nl.classList.add('thumb-live')));
  }
}
window.addEventListener('resize', fitNav);
document.fonts?.ready.then(fitNav);

function setMenu(open) {
  $('#nav-bar').classList.toggle('open', open);
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
}
$('#menu-toggle').addEventListener('click', () => setMenu(!$('#nav-bar').classList.contains('open')));
$('#nav-links').addEventListener('click', (e) => { if (e.target.closest('a')) setMenu(false); });

// ปุ่ม "สรุปรายเดือน" ในหน้าภาพรวม / ประวัติ
document.addEventListener('click', (e) => { const b = e.target.closest('[data-monthly]'); if (b && isAdmin()) showMonthlyReport(b.dataset.month); });

// องค์ประกอบที่ค่อย ๆ ลอยขึ้นตามลำดับการอ่าน เมื่อเปลี่ยนหน้า (ไม่เล่นซ้ำตอนซิงก์ข้อมูล/พิมพ์ค้นหา)
const ENTER = '.page > .banner, .hero > *, .choice, .stat-strip, .page > .page-head, #rf > .page-head, .page > .page-head-row, .page > .toolbar, #rf > .group, .item-card, .rows > li, .stats > .stat, .grid-2 > .card, .page > section.card';
let enterTimer;
function choreograph(page) {
  if (!motionOK()) return;
  $$(ENTER, page).filter((el) => !(el.matches('section.card') && el.querySelector('.rows'))).slice(0, 14)
    .forEach((el, i) => { el.classList.add('in'); el.style.setProperty('--i', i); });
  page.classList.add('enter');
  clearTimeout(enterTimer);
  enterTimer = setTimeout(() => page.classList.remove('enter'), 1400);
}
// ตัวเลขบนหน้าแรกนับขึ้นสั้น ๆ (ค่าจริงอยู่ใน HTML เสมอ)
function countUp(root) {
  if (!motionOK() || navigator.webdriver || document.hidden) return;
  const strip = $('.stat-strip', root);
  if (!strip) return;
  const delay = (Number(strip.style.getPropertyValue('--i')) || 0) * 40 + 120;
  const els = $$('.v', strip).map((el) => ({ el, txt: el.textContent, n: Number(el.textContent.replace(/\D/g, '')) })).filter((x) => x.n > 1);
  if (!els.length) return;
  let t0;
  const tick = (t) => {
    t0 ??= t + delay;
    const p = Math.min(1, Math.max(0, (t - t0) / 700));
    const e = 1 - (1 - p) ** 3;
    for (const x of els) if (x.el.isConnected) x.el.textContent = p < 1 ? fmtNum(Math.round(x.n * e)) : x.txt;
    if (p < 1 && els[0].el.isConnected) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function render(enter = false) {
  const key = currentRoute();
  document.title = `${TEST_SITE ? '[ทดสอบ] ' : ''}${ROUTES[key].title} · ระบบเบิกพัสดุ`;
  renderNav();
  const page = $('#page');
  page.classList.remove('enter');
  page.innerHTML = '';
  $('.scroll-hint')?.remove();
  if (TEST_SITE) {
    page.insertAdjacentHTML('beforeend', testBanner());
  } else if (DEMO) {
    page.insertAdjacentHTML('beforeend', '<div class="banner">โหมดทดลอง — ข้อมูลเก็บเฉพาะในเบราว์เซอร์เครื่องนี้ เชื่อม Google Sheets ตามคู่มือใน README เพื่อใช้ร่วมกันทุกเครื่อง</div>');
  }
  document.body.classList.toggle('home-bg', key === 'home');
  page.classList.toggle('wide', key === 'request'); // หน้าเบิกกว้างกว่าปกติ (2 คอลัมน์บนคอม/iPad แนวนอน)
  ROUTES[key].render(page);
  if (enter) { choreograph(page); if (key === 'home') countUp(page); }
}

let lastSnapshot = '';
let lastRoute = '';
// View Transitions (Chrome/Edge 111+, Safari 18+): หน้าเฟดสลับ, แถบนำทางนิ่ง, หัวการ์ดลอยไปเป็นหัวเรื่องฟอร์ม
// เบราว์เซอร์ที่ไม่รองรับ / ลดการเคลื่อนไหว / มีหน้าต่างเปิดอยู่ → วาดหน้าตามปกติ
async function route() {
  setMenu(false);
  const key = currentRoute(), from = lastRoute, changed = key !== from;
  lastRoute = key;
  const useVT = changed && !!document.startViewTransition && motionOK() && !modalOpen();
  // หัวการ์ด "เบิกพัสดุ" ในหน้าแรกลอยไปเป็นหัวเรื่องของฟอร์ม (และลอยกลับ)
  let morph = null;
  const mark = (el) => { if (el) { el.style.viewTransitionName = 'page-title'; morph = el; } };
  const update = () => {
    if (changed) window.scrollTo(0, 0);
    render(changed);
    if (useVT && from === 'request' && key === 'home') {
      const h = $('.choice.withdraw h2');
      mark(h);
      h?.closest('.choice')?.classList.remove('in');
    }
    if (morph && key === 'request') $('#rf-title')?.closest('.page-head')?.classList.remove('in');
  };
  if (useVT) {
    if (from === 'home' && key === 'request') mark($('.choice.withdraw h2'));
    document.documentElement.classList.add('vt');
    let vt;
    try { vt = document.startViewTransition(update); } catch { document.documentElement.classList.remove('vt'); update(); }
    if (vt) {
      vt.finished.finally(() => {
        document.documentElement.classList.remove('vt');
        if (morph?.isConnected) morph.style.viewTransitionName = '';
      });
      await vt.updateCallbackDone.catch(() => {});
    }
  } else update();
  await syncFromSheet();
}

// โหมด Google Sheets: ดึงข้อมูลล่าสุดเบื้องหลัง แล้ววาดใหม่ถ้ามีการแก้ไข (จากเครื่องอื่นหรือแก้ในชีตโดยตรง)
// หน้าฟอร์มเบิก วาดเฉพาะรายการพัสดุใหม่ ข้อมูลที่กรอกไว้ไม่หาย
// หน้าพัสดุคงเหลือ: วาดเฉพาะตารางใหม่ (ช่องค้นหา/ตัวกรองที่กำลังใช้ไม่หาย)
let redrawItems = null;
let syncing = false;
const liveText = () => state.syncedAt
  ? 'อัปเดตอัตโนมัติ · ล่าสุด ' + state.syncedAt.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' น.'
  : 'กำลังดึงยอดล่าสุด…';
function showLive(busy) {
  const live = $('#live');
  if (!live) return;
  live.classList.toggle('busy', !!busy);
  $('#live-text').textContent = busy ? 'กำลังดึงยอดล่าสุด…' : liveText();
}
async function syncFromSheet({ manual = false } = {}) {
  if (DEMO || modalOpen() || syncing) return;
  const key = currentRoute();
  syncing = true;
  showLive(true);
  try {
    await store.load();
    const snap = JSON.stringify(state.db);
    if (snap === lastSnapshot) { if (manual) toast('ยอดเป็นปัจจุบันแล้ว'); return; }
    lastSnapshot = snap;
    if (modalOpen() || currentRoute() !== key) return;
    if (key === 'request') redrawPickList?.();
    else if (key === 'items' && redrawItems) redrawItems();
    else render();
  } catch (e) { toast(e.message, true); } finally {
    syncing = false;
    showLive(false);
  }
}
// ดึงยอดจาก Google Sheet ทุก 45 วินาทีขณะมีคนใช้งานหน้าเว็บอยู่ (แท็บเปิดอยู่และมีการแตะ/เลื่อนภายใน 5 นาที)
// หยุดเองเมื่อไม่มีใครใช้ เพื่อไม่ให้ใช้โควตา Apps Script เกินจำเป็น
let lastActive = Date.now();
['pointerdown', 'keydown', 'scroll', 'touchstart', 'mousemove'].forEach((ev) =>
  addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true, capture: true }));
setInterval(() => {
  const idle = Date.now() - lastActive;
  if (document.visibilityState !== 'visible' || idle > 5 * 60e3 || idle < 2000) return; // ไม่ดึงระหว่างกำลังกดปุ่ม
  // เฉพาะหน้าที่วาดใหม่ได้โดยไม่ทำให้สิ่งที่กำลังพิมพ์หาย
  if (['home', 'request', 'items', 'dashboard'].includes(currentRoute())) syncFromSheet();
}, 45e3);
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
  const ready = items.filter((i) => i.available_qty > 0);
  const low = items.filter(isLow);
  const todayTh = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long' });
  // กดตัวเลขเพื่อดูหน้าพัสดุคงเหลือ
  const stat = (v, l, q = '', warn = false) =>
    `<a href="#/items${q}" class="${warn ? 'warn' : ''}"><span class="v">${v}</span><span class="l">${l}</span></a>`;
  page.insertAdjacentHTML('beforeend', `
    <section class="hero">
      <p class="eyebrow">${esc(CONFIG.HOSPITAL_NAME || 'ระบบพัสดุ')} <span class="eyebrow-date">· ${esc(todayTh)}</span></p>
      <h1>เบิกพัสดุ<br><span class="gradient-text">ง่าย ๆ ด้วยคลิกเดียว</span></h1>
      <p class="lead">เลือกพัสดุ กรอกชื่อและแผนก แล้วรับใบเบิกเป็นไฟล์ PDF ได้ทันที</p>
    </section>
    ${helpNotice()}
    <div class="choice-grid single">
      <a class="choice withdraw" href="#/request">
        <span class="choice-icon">${ICON.withdraw}</span>
        <h2>เบิกพัสดุ</h2>
        <p>เวชภัณฑ์และวัสดุสิ้นเปลือง เบิกไปใช้ในหน่วยงานได้ทันที</p>
        <span class="cta">เริ่มเบิกพัสดุ</span>
      </a>
    </div>
    <div class="stat-strip">
      ${stat(fmtNum(items.length), 'รายการพัสดุ')}
      ${stat(fmtNum(ready.length), 'มีของพร้อมเบิก')}
      ${stat(fmtNum(low.length), 'หมด / ใกล้หมด', '?low=1', low.length > 0)}
    </div>`);
}

// ===================== Request form (เบิก) =====================
let redrawPickList = null;
const MAX_QTY = 9999;
let rfObservers = [];

function renderRequestForm(page) {
  rfObservers.forEach((o) => o.disconnect());
  rfObservers = [];
  const params = hashParams();
  // มาจากปุ่ม "เบิก" ในหน้าพัสดุคงเหลือ: เลือกรายการนั้นไว้ให้
  const pre = itemById(params.get('item'));
  if (pre && pre.active && !state.picks[pre.id]) state.picks[pre.id] = 1;
  if (params.toString()) history.replaceState(null, '', '#/request');
  const todayTh = new Date().toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  page.insertAdjacentHTML('beforeend', `
    <form id="rf" class="wd" novalidate>
      <div class="page-head wd-head">
        <p class="eyebrow">${esc(CONFIG.HOSPITAL_NAME || 'ระบบพัสดุ')} <span class="eyebrow-date">· ${esc(todayTh)}</span></p>
        <h1 id="rf-title">เบิกพัสดุ</h1>
        <p class="lead" id="rf-lead">เลือกพัสดุ กรอกชื่อและแผนก แล้วรับใบเบิกเป็นไฟล์ PDF ได้ทันที</p>
        ${helpNotice(true)}
      </div>
      <aside class="group slip">
        <div class="slip-head">
          <span class="slip-ic" aria-hidden="true">${ICON.withdraw}</span>
          <div><h2>ใบเบิกพัสดุ</h2><p class="slip-sub">ข้อมูลผู้เบิก</p></div>
        </div>
        <div class="fields">
          <label class="field">ชื่อ-นามสกุล <span class="req">*</span>
            <input name="borrower_name" required autocomplete="name" placeholder="เช่น สมชาย ใจดี" value="${esc(lsGet('last-name'))}"></label>
          <label class="field">แผนก <span class="req">*</span>
            <select name="department" required>${deptOptions(lsGet('last-dept'))}</select></label>
          <label class="field full" id="rf-note">หมายเหตุ <span class="hint">(ไม่บังคับ)</span>
            <input name="note" placeholder="เช่น ใช้ทดแทนชั่วคราวระหว่างรอของ"></label>
        </div>
        <div class="slip-items" id="rf-slip" aria-live="polite"></div>
        <div class="checkout">
          <div class="sum"><strong id="rf-count"></strong><span id="rf-detail"></span></div>
          <button class="btn primary lg" id="rf-submit"></button>
        </div>
      </aside>
      <section class="group pick-col">
        <div class="group-head"><h2>เลือกพัสดุ</h2></div>
        <div class="pick-tools">
          <div class="search">${ICON.search}<input type="search" id="rf-q" autocomplete="off" placeholder="ค้นหา เช่น airway, ถุงมือ, NSO-010"></div>
          <div class="pick-filter">
            <div class="segmented" id="rf-show">
              <button type="button" data-show="all">ทั้งหมด</button>
              <button type="button" data-show="ready">มีของ</button>
              <button type="button" data-show="picked">ที่เลือก<span class="seg-count" id="rf-picked-n"></span></button>
            </div>
            <span class="muted small" id="rf-shown"></span>
          </div>
          <div class="az" id="rf-az"></div>
        </div>
        <div id="rf-list"></div>
      </section>
    </form>`);

  const form = $('#rf');
  const navH = () => $('#nav-bar').offsetHeight;
  const tools = $('.pick-tools');
  let spy = null;
  // เส้นใต้แถบค้นหาขึ้นเฉพาะตอนแถบติดอยู่ใต้เมนู
  if ('IntersectionObserver' in window) {
    const st = new IntersectionObserver(([e]) => tools.classList.toggle('stuck', !e.isIntersecting && e.boundingClientRect.top < navH()),
      { rootMargin: `-${navH()}px 0px 0px 0px` });
    st.observe(tools.previousElementSibling);
    rfObservers.push(st);
  }
  // ไฮไลต์ตัวอักษรของกลุ่มที่กำลังดูอยู่ในแถบ A–Z
  function markLetter(idx) {
    const az = $('#rf-az');
    let on;
    $$('button', az).forEach((b) => { const m = b.dataset.jump === idx; b.classList.toggle('on', m); if (m) on = b; });
    if (on) az.scrollTo({ left: on.offsetLeft - (az.clientWidth - on.offsetWidth) / 2, behavior: motionOK() ? 'smooth' : 'auto' });
  }
  const allowed = () => itemsView().filter((i) => i.active);

  function drawSummary() {
    const chosen = Object.entries(state.picks).map(([id, q]) => ({ item: itemById(id), q })).filter((x) => x.item);
    $('#rf-count').textContent = chosen.length ? `${chosen.length} รายการ · ${fmtNum(chosen.reduce((s, x) => s + x.q, 0))} ชิ้น` : 'ยังไม่ได้เลือกพัสดุ';
    $('#rf-detail').textContent = chosen.length ? chosen.map((x) => `${x.item.name} ×${x.q}`).join(', ') : 'เลือกพัสดุที่ต้องการเบิกจากรายการด้านบน';
    $('#rf-submit').textContent = 'ยืนยันการเบิก';
    form.classList.toggle('has-picks', chosen.length > 0);
    // ใบเบิกด้านขวา (จอกว้าง): รายการที่เลือกพร้อมปุ่มปรับจำนวน
    $('#rf-slip').innerHTML = chosen.length
      ? `<ul class="slip-list">${chosen.map(({ item: i, q }) => `<li>
          <div class="slip-name"><span>${esc(i.name)}</span><small>${esc(i.code)} · ${esc(i.unit)}${q > i.available_qty ? ' · <em class="neg">ยอดจะติดลบ</em>' : ''}</small></div>
          <div class="mini-step">
            <button type="button" data-dec="${i.id}" aria-label="${q === 1 ? 'นำออก' : 'ลด'} ${esc(i.name)}">${q === 1 ? IC.trash : IC.minus}</button>
            <b>${fmtNum(q)}</b>
            <button type="button" data-inc="${i.id}" aria-label="เพิ่ม ${esc(i.name)}" ${q >= MAX_QTY ? 'disabled' : ''}>${IC.plus}</button>
          </div></li>`).join('')}</ul>`
      : `<div class="slip-empty">${ICON.box}<span>ยังไม่ได้เลือกพัสดุ<br><small>แตะ "+ เลือก" ที่รายการด้านซ้าย</small></span></div>`;
  }

  // ค้นหาแบบไม่สนตัวพิมพ์เล็ก/ใหญ่ ช่องว่าง และวงเล็บ: "airway100" เจอ "Airway 100mm"
  const norm = (v) => String(v).toLowerCase().replace(/[\s\-_.,()/*"]/g, '');
  // หัวข้อกลุ่มตามตัวอักษรแรก (ภาษาไทยข้ามสระหน้า เ แ โ ใ ไ)
  const groupKey = (name) => {
    const c = name.trim().replace(/^[เแโใไ]/, '').charAt(0);
    if (/[a-z]/i.test(c)) return c.toUpperCase();
    if (/[\u0E01-\u0E2E]/.test(c)) return c;
    return '#';
  };
  let show = 'all';
  let wasEmpty = false;
  let tick = null; // การเปลี่ยนจำนวนล่าสุด ใช้เล่นอนิเมชันหลังวาดรายการใหม่
  // เบิกของที่หมดได้ ยอดจะติดลบ (ค้างจ่าย) แล้วหักล้างเมื่อรับเข้าครั้งถัดไป
  const stockBadge = (i) => i.available_qty < 0 ? `<span class="stock out">ติดลบ ${fmtNum(-i.available_qty)} ${esc(i.unit)}</span>`
    : i.available_qty === 0 ? '<span class="stock out">หมด</span>'
    : `<span class="stock ${isLow(i) ? 'low' : 'ok'}">${isLow(i) ? 'เหลือน้อย' : 'เหลือ'} ${fmtNum(i.available_qty)} ${esc(i.unit)}</span>`;

  function drawList() {
    const q = norm($('#rf-q').value.trim());
    const all = allowed();
    let items = all;
    if (show === 'ready') items = items.filter((i) => i.available_qty > 0 || state.picks[i.id]);
    if (show === 'picked') items = items.filter((i) => state.picks[i.id]);
    if (q) items = items.filter((i) => norm(i.name + ' ' + i.code).includes(q));
    const pickedN = Object.keys(state.picks).length;
    $$('#rf-show button').forEach((b) => b.classList.toggle('active', b.dataset.show === show));
    const pn = pickedN ? ` ${pickedN}` : '';
    if ($('#rf-picked-n').textContent !== pn) { $('#rf-picked-n').textContent = pn; bump($('#rf-picked-n')); }
    $('#rf-shown').textContent = `${fmtNum(items.length)} / ${fmtNum(all.length)} รายการ`;

    const groups = new Map();
    for (const i of items) {
      const k = groupKey(i.name);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(i);
    }
    const keys = [...groups.keys()];
    const row = (i) => {
      const n = state.picks[i.id] || 0;
      const out = i.available_qty <= 0;
      return `<li class="pick ${out ? 'out' : ''} ${n ? 'selected' : ''}">
        <div class="pick-body">
          <div class="pick-name">${esc(i.name)}</div>
          <div class="pick-meta"><span class="code">${esc(i.code)}</span>${stockBadge(i)}</div>
        </div>
        ${n ? `<div class="stepper">
            <button type="button" data-dec="${i.id}" class="${n === 1 ? 'rm' : ''}" aria-label="${n === 1 ? 'นำออก' : 'ลด'}">${n === 1 ? IC.trash : IC.minus}</button>
            <input type="number" inputmode="numeric" min="0" max="${MAX_QTY}" value="${n}" data-qty="${i.id}" aria-label="จำนวน">
            <button type="button" data-inc="${i.id}" aria-label="เพิ่ม" ${n >= MAX_QTY ? 'disabled' : ''}>${IC.plus}</button>
          </div>`
          : `<button type="button" class="btn add-btn" data-inc="${i.id}">+ เลือก</button>`}
      </li>`;
    };
    // แสดงหัวข้อ A B C … ก ข ค เฉพาะตอนดูรายการยาว ๆ
    const grouped = !q && show !== 'picked' && keys.length > 3;
    $('#rf-az').innerHTML = grouped ? keys.map((k, idx) => `<button type="button" data-jump="${idx}">${esc(k)}</button>`).join('') : '';
    $('#rf-az').hidden = !grouped;
    // หน้าว่างพร้อมปุ่มแก้ได้ในแตะเดียว
    const E = (ic, t, h, acts) => `<div class="empty${wasEmpty ? '' : ' enter'}"><span class="empty-ic">${ic}</span><p class="empty-t">${t}</p>${h ? `<p class="empty-h">${h}</p>` : ''}${acts ? `<div class="empty-act">${acts}</div>` : ''}</div>`;
    const qv = esc($('#rf-q').value.trim());
    $('#rf-list').innerHTML = items.length
      ? (grouped
        ? keys.map((k, idx) => `<div class="pick-group" data-group="${idx}"><div class="pick-letter">${esc(k)}</div>
            <ul class="list">${groups.get(k).map(row).join('')}</ul></div>`).join('')
        : `<ul class="list">${items.map(row).join('')}</ul>`)
      : (show === 'picked'
        ? E(ICON.box, 'ยังไม่ได้เลือกพัสดุ', 'แตะ "+ เลือก" ที่รายการพัสดุ', '<button type="button" class="btn sm" data-show-set="ready">ดูรายการที่มีของ</button>')
        : q && show === 'ready'
          ? E(ICON.search, `ไม่พบ "${qv}" ในรายการที่มีของ`, '', '<button type="button" class="btn sm" data-show-set="all">ค้นในทั้งหมด</button><button type="button" class="btn sm plain" data-clear-q>ล้างคำค้น</button>')
          : q
            ? E(ICON.search, `ไม่พบ "${qv}"`, 'ลองพิมพ์ชื่อสั้นลง หรือค้นด้วยรหัส เช่น NSO-010', '<button type="button" class="btn sm plain" data-clear-q>ล้างคำค้น</button>')
            : E(ICON.box, 'ยังไม่มีรายการพัสดุ', '', ''));
    wasEmpty = !items.length;
    drawSummary();
    if (spy) { spy.disconnect(); rfObservers = rfObservers.filter((o) => o !== spy); spy = null; }
    if (grouped && 'IntersectionObserver' in window) {
      const top = navH() + tools.offsetHeight + 4;
      spy = new IntersectionObserver((es) => { for (const e of es) if (e.isIntersecting) markLetter(e.target.dataset.group); },
        { rootMargin: `-${top}px 0px -${Math.max(0, innerHeight - top - 2)}px 0px` });
      $$('#rf-list .pick-group').forEach((g) => spy.observe(g));
      rfObservers.push(spy);
    }
    if (tick) { const t = tick; tick = null; afterChange(t); }
  }
  redrawPickList = drawList;

  const setQty = (id, qty, rect = null) => {
    const i = itemById(id);
    const from = state.picks[id] || 0;
    qty = Math.max(0, Math.min(MAX_QTY, Math.floor(Number(qty) || 0)));
    if (qty) state.picks[id] = qty; else delete state.picks[id];
    if (qty) PdfDoc.preload(); // โหลดตัวสร้าง PDF (900 KB) ไว้ก่อน ใบเบิกจะพร้อมเร็วขึ้นหลังกดยืนยัน
    const ae = document.activeElement;
    tick = { id: String(id), from, to: qty, rect, zone: ae?.closest?.('#rf-slip') ? '#rf-slip' : '#rf-list',
      focus: ae?.matches?.('[data-dec]') ? 'dec' : ae?.matches?.('[data-inc]') ? 'inc' : ae?.matches?.('[data-qty]') ? 'qty' : null };
    drawList();
  };
  // หลังวาดใหม่: คืนโฟกัสปุ่มเดิม + อนิเมชัน (ตัวเลขเลื่อน, แถวเด้งเข้า/ออก, จำนวนในแถบยืนยันเด้ง)
  function afterChange({ id, from, to, focus, rect, zone }) {
    const q = (a, z = '#rf-list') => $(`${z} [${a}="${id}"]`);
    if (focus) [q(`data-${focus}`, zone), q('data-inc', zone), q('data-dec', zone), q('data-qty', zone)].find((el) => el && !el.disabled)?.focus({ preventScroll: true });
    if (!motionOK() || from === to) return;
    const li = (q('data-inc') || q('data-dec'))?.closest('.pick');
    if (!from) { li?.classList.add('just-on'); if (!(rect && flyToCheckout(rect))) bump($('#rf-count')); }
    else if (!to) { li?.classList.add('just-off'); bump($('#rf-count')); }
    else { q('data-qty')?.classList.add(to > from ? 'roll-up' : 'roll-down'); bump($('#rf-count')); }
  }
  // จุดสีลอยโค้งจากปุ่ม "+ เลือก" เข้าแถบยืนยัน (เฉพาะการเลือกครั้งแรกของรายการนั้น)
  function flyToCheckout(a) {
    const to = $('#rf-count');
    const bar = $('.checkout');
    if (!to || !bar || !motionOK() || +getComputedStyle(bar).opacity < 0.5) return false;
    const b = to.getBoundingClientRect();
    const x0 = a.left + a.width / 2, y0 = a.top + a.height / 2;
    const dx = b.left + 12 - x0, dy = b.top + b.height / 2 - y0;
    const o = document.createElement('i');
    o.className = 'fly';
    o.innerHTML = '<i></i>';
    o.style.left = x0 + 'px';
    o.style.top = y0 + 'px';
    document.body.append(o);
    o.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dx}px)` }], { duration: 480, easing: 'cubic-bezier(.3,0,.6,1)', fill: 'forwards' });
    o.firstChild.animate([{ transform: 'translateY(0) scale(1)' }, { transform: `translateY(${dy}px) scale(.5)`, opacity: 0.5 }],
      { duration: 480, easing: 'cubic-bezier(.5,-0.6,.8,.6)', fill: 'forwards' }).finished.then(() => { o.remove(); bump($('#rf-count')); }, () => o.remove());
    return true;
  }
  $('#rf-list').addEventListener('click', (e) => {
    const ss = e.target.closest('[data-show-set]');
    if (ss) { show = ss.dataset.showSet; drawList(); return; }
    if (e.target.closest('[data-clear-q]')) { $('#rf-q').value = ''; drawList(); $('#rf-q').focus(); return; }
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    if (inc) setQty(inc.dataset.inc, (state.picks[inc.dataset.inc] || 0) + 1, inc.classList.contains('add-btn') ? inc.getBoundingClientRect() : null);
    if (dec) setQty(dec.dataset.dec, (state.picks[dec.dataset.dec] || 0) - 1);
  });
  $('#rf-list').addEventListener('change', (e) => {
    const inp = e.target.closest('[data-qty]');
    if (inp) setQty(inp.dataset.qty, inp.value);
  });
  // พิมพ์ค้นหาเร็ว ๆ วาดรายการใหม่ครั้งเดียวต่อเฟรม (ไม่วาด 301 แถวทุกตัวอักษร)
  let qFrame = 0;
  $('#rf-q').addEventListener('input', () => { cancelAnimationFrame(qFrame); qFrame = requestAnimationFrame(drawList); });
  $$('#rf-show button').forEach((b) => b.addEventListener('click', () => { show = b.dataset.show; drawList(); }));
  // กดตัวอักษร → เลื่อนไปที่กลุ่มนั้น (เผื่อความสูงแถบเมนูและแถบค้นหาที่ติดอยู่ด้านบน)
  $('#rf-az').addEventListener('click', (e) => {
    const b = e.target.closest('[data-jump]');
    const g = b && $(`[data-group="${b.dataset.jump}"]`);
    if (!g) return;
    const offset = $('#nav-bar').offsetHeight + $('.pick-tools').offsetHeight + 8;
    window.scrollTo({ top: g.getBoundingClientRect().top + window.scrollY - offset, behavior: 'smooth' });
    const L = $('.pick-letter', g);
    if (L && motionOK()) { L.classList.remove('hit'); void L.offsetWidth; L.classList.add('hit'); }
  });
  $('#rf-slip').addEventListener('click', (e) => {
    const inc = e.target.closest('[data-inc]');
    const dec = e.target.closest('[data-dec]');
    if (inc) setQty(inc.dataset.inc, (state.picks[inc.dataset.inc] || 0) + 1);
    if (dec) setQty(dec.dataset.dec, (state.picks[dec.dataset.dec] || 0) - 1);
  });

  form.addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const data = formData(form);
    if (!data.borrower_name.trim()) { flag(form.borrower_name); throw new Error('กรุณากรอกชื่อ-นามสกุล'); }
    if (!data.department) { flag(form.department); throw new Error('กรุณาเลือกแผนก'); }
    const items = Object.entries(state.picks).map(([item_id, qty]) => ({ item_id: Number(item_id), qty }));
    if (!items.length) throw new Error('กรุณาเลือกพัสดุอย่างน้อย 1 รายการ');
    primeSound();
    const btn = $('#rf-submit');
    btn.disabled = true;
    btn.classList.add('busy');
    try {
      let id;
      try {
        // type: 'withdraw' ให้ Apps Script เวอร์ชันเก่า (ก่อนตัดระบบยืม) ยังรับใบเบิกได้จนกว่าจะอัปเดต
        id = await store.act('createRequest', { ...data, type: 'withdraw', items });
      } catch (err) {
        // Apps Script เวอร์ชันเก่ายังไม่ให้เบิกของที่หมด (ยอดติดลบ)
        if (/คงเหลือไม่พอ/.test(err.message)) {
          throw new Error(err.message + ' — ระบบใน Google Sheet ยังเป็นเวอร์ชันเก่า ให้เจ้าหน้าที่พัสดุอัปเดต Apps Script (Deploy → New version) แล้วจะเบิกของที่หมดได้');
        }
        throw err;
      }
      lsSet('last-name', data.borrower_name.trim());
      lsSet('last-dept', data.department);
      state.picks = {};
      lastSnapshot = JSON.stringify(state.db);
      form.note.value = '';
      $('#rf-q').value = '';
      drawList();
      showSuccess(id);
    } finally {
      btn.disabled = false;
      btn.classList.remove('busy');
    }
  }));

  // ตัดรายการที่ถูกลบ/ปิดใช้งานออกจากที่เลือกไว้
  for (const id of Object.keys(state.picks)) if (!itemById(id)?.active) delete state.picks[id];
  drawList();
}

// ===================== Google Sheet (เจ้าหน้าที่) =====================
// ลิงก์ไปชีตที่เว็บเชื่อมอยู่: Apps Script ส่ง URL มาให้เฉพาะคำขอที่มี PIN (หรือใส่ SHEET_URL ใน config.js เอง)
const SHEET_TABS = [
  ['รายการเบิก', 'ทุกรายการที่ถูกเบิก 1 แถวต่อพัสดุ: วันที่เวลา เลขที่ ผู้เบิก แผนก ชื่อพัสดุ จำนวน (ล่าสุดอยู่บน)', 'view'],
  ['อุปกรณ์', 'รายชื่อพัสดุและยอดคงเหลือ แก้คอลัมน์ available_qty (คงเหลือ) ชื่อ หน่วย ที่เก็บ ได้ · เพิ่มพัสดุใหม่: พิมพ์แถวใหม่ท้ายตาราง ใส่ code, name, unit, available_qty (เว้น id ว่างไว้ ระบบตั้งให้)', 'edit'],
  ['หน่วยงาน', 'รายชื่อแผนกที่ให้เลือกในฟอร์ม เพิ่ม/แก้ได้', 'edit'],
  ['หมวดหมู่', 'หมวดหมู่ของพัสดุ', 'edit'],
  ['ประวัติสต็อก', 'ทุกการเคลื่อนไหวของสต็อก ใช้ตรวจสอบย้อนหลัง', 'keep'],
  ['ประวัติการเบิก', 'ใบเบิกทั้งหมด 1 แถวต่อใบ ล่าสุดอยู่บน: เลขที่ วันที่เวลา ผู้เบิก แผนก รายการพัสดุ จำนวนรวม · คอลัมน์หัวสีเทาท้ายตารางเป็นข้อมูลระบบ', 'keep'],
  ['รายการในคำขอ', 'ข้อมูลระบบ: พัสดุแต่ละชิ้นในใบเบิก', 'keep'],
];
function renderSheet(page) {
  const sh = state.sheet || (CONFIG.SHEET_URL ? { url: CONFIG.SHEET_URL, name: '' } : null);
  const url = sh && /^https:\/\/docs\.google\.com\//.test(sh.url) ? sh.url : '';
  const tag = { view: '<span class="pill">ดูอย่างเดียว</span>', edit: '<span class="pill in">แก้ได้</span>', keep: '<span class="pill low">ไม่ควรแก้</span>' };
  page.insertAdjacentHTML('beforeend', `
    <div class="page-head"><h1>Google Sheet</h1><p class="lead">ข้อมูลพัสดุ สต็อก และใบเบิกทั้งหมดของเว็บนี้บันทึกอยู่ในชีตนี้</p></div>
    <section class="card sheet-card">
      <span class="sheet-ic" aria-hidden="true">${ICON.sheet}</span>
      <div class="sheet-main">
        ${url ? `<h2>${esc(sh.name || 'Google Sheet ที่เชื่อมอยู่')}</h2>
          <p class="sheet-url">${esc(url)}</p>
          <div class="sheet-actions">
            <a class="btn primary lg" href="${esc(url)}" target="_blank" rel="noopener noreferrer">เปิด Google Sheet ${ICON.ext}</a>
            <button type="button" class="btn lg" id="sheet-copy">คัดลอกลิงก์</button>
          </div>
          <p class="muted small">เปิดได้เฉพาะบัญชี Google ที่ได้รับสิทธิ์ในชีตนี้ (ตั้งค่าที่ปุ่ม แชร์ ใน Google Sheet)</p>`
        : DEMO ? `<h2>ยังไม่ได้เชื่อม Google Sheet</h2>
          <p class="muted">ตอนนี้เป็นโหมดทดลอง ข้อมูลเก็บในเบราว์เซอร์เครื่องนี้เท่านั้น ทำตามคู่มือใน README หัวข้อ "เชื่อม Google Sheets" เพื่อใช้ข้อมูลร่วมกันทุกเครื่อง</p>`
        : `<h2>ยังไม่พบลิงก์ของชีต</h2>
          <p class="muted">อัปเดตโค้ด Apps Script เป็นไฟล์ AllInOne.gs ล่าสุด แล้ว Deploy → Manage deployments → New version
            ลิงก์จะแสดงที่นี่อัตโนมัติ (หรือใส่ SHEET_URL ใน config.js)</p>`}
      </div>
    </section>
    <section class="card">
      <div class="card-head"><h3>แท็บในชีต</h3></div>
      <ul class="rows sheet-tabs">${SHEET_TABS.map(([n, d, k]) => `<li><div class="sheet-tab"><b>${esc(n)}</b>${tag[k]}</div><p>${esc(d)}</p></li>`).join('')}</ul>
      <p class="muted small sheet-note">คอลัมน์ที่หัวเป็นสีฟ้าอ่อน ระบบเขียนให้อัตโนมัติ แก้แล้วจะถูกเขียนทับ ·
        แก้ยอดในชีตโดยตรงจะไม่ถูกบันทึกในประวัติสต็อก (ใช้ปุ่ม รับเข้า / ตรวจนับ บนเว็บถ้าต้องการประวัติครบ)</p>
    </section>`);
  $('#sheet-copy')?.addEventListener('click', safe(async () => {
    await navigator.clipboard.writeText(url);
    toast('คัดลอกลิงก์แล้ว');
  }));
}

// ===================== Success + PDF =====================
// สร้าง PDF รอไว้ก่อน กดบันทึกแล้วถามว่าต้องการคำแนะนำไหม → (ภาพสาธิต) → บันทึก → ป๊อปอัปกลางจอเมื่อบันทึกแล้ว
function showSuccess(id) {
  const r = requestView(state.db.requests.find((x) => x.id === id));
  const body = openModal('', `
    <div class="success">
      <span class="done" aria-hidden="true"><svg class="check-anim" viewBox="0 0 76 76"><circle cx="38" cy="38" r="34"/><path d="M23 39.5 33.5 50 54 28"/></svg></span>
      <h2>เบิกพัสดุเรียบร้อย</h2>
      <p class="doc-no"><span class="doc-label">เลขที่เอกสาร</span><b class="doc-id">${esc(r.request_no)}</b><span>${r.items.length} รายการ · ${esc(fmtDateTime(r.created_at))}</span></p>
      <div class="permission">
        <span class="file-icon">PDF</span>
        <div>
          <p id="pdf-q">กำลังจัดทำใบเบิกพัสดุ...</p>
          <p class="muted" id="pdf-sub"><span class="spinner" style="width:12px;height:12px"></span> กรุณารอสักครู่</p>
        </div>
      </div>
      <div class="actions">
        <button class="btn lg" id="pdf-skip">ไม่ใช่ตอนนี้</button>
        <button class="btn primary lg" id="pdf-save" disabled>${PdfDoc.isIOS ? 'บันทึก PDF' : 'ดาวน์โหลด PDF'}</button>
      </div>
      <button type="button" class="save-alert" id="save-demo">
        <span class="save-alert-ic" aria-hidden="true">${ICON.bell}</span>
        <span class="save-alert-txt"><b>สำคัญ! อย่าลืมบันทึกใบเบิก</b><span>ดูภาพสาธิตวิธีบันทึกและพิมพ์ (iPhone · Android · คอม)</span></span>
        <span class="save-alert-go">ดูวิธี ›</span>
      </button>
      <a class="help-link" href="#/help?s=save" data-close-help>${ICON.book} อ่านวิธีบันทึกและพิมพ์แบบละเอียด</a>
    </div>`);
  let blob = null;
  const fileName = PdfDoc.fileName(r);
  // ต้องเรียกตรงจากการแตะของผู้ใช้ (ส่วนก่อน await แรก) เบราว์เซอร์จึงยอมเปิดหน้าต่างบันทึก/แชร์
  const save = safe(async () => {
    if (!blob) { toast('กำลังจัดทำไฟล์ PDF รอสักครู่แล้วกดบันทึกอีกครั้ง'); pointToSave(); return; }
    if (await PdfDoc.save(blob, fileName)) {
      closeModal();
      savedPopup(fileName);
    }
  });
  $('[data-close-help]', body).addEventListener('click', (e) => { e.preventDefault(); closeModal(); setTimeout(() => { location.hash = '#/help?s=save'; }, 240); });
  $('#save-demo', body).addEventListener('click', () => showSaveGuide({ onFinish: save, point: true }));
  // สัญญาณเตือนให้บันทึกใบเบิก: เสียงสั้น ๆ + สั่น
  setTimeout(() => { if ($('#save-demo') && modalOpen()) alertSignal(); }, 1100);
  PdfDoc.build(r, CONFIG.HOSPITAL_NAME, CONFIG.STAFF_NAME).then((b) => {
    blob = b;
    $('#pdf-q', body).innerHTML = `อนุญาตให้บันทึก <b>${esc(fileName)}</b> ลงในเครื่องนี้หรือไม่?`;
    $('#pdf-sub', body).textContent = 'ใช้พิมพ์และลงลายมือชื่อผู้เบิกและเจ้าหน้าที่พัสดุ · ควรเก็บไฟล์ไว้ (เจ้าหน้าที่พัสดุออกให้ใหม่ได้)';
    $('#pdf-save', body).disabled = false;
    $('.permission', body).classList.add('ready');
    $('#pdf-save', body).classList.add('ready');
    if (motionOK()) navigator.vibrate?.(12);
  }).catch((e) => {
    $('#pdf-q', body).textContent = 'สร้างไฟล์ PDF ไม่สำเร็จ';
    $('#pdf-sub', body).textContent = e.message + ' — แจ้งเจ้าหน้าที่พัสดุให้ออกเอกสารจากหน้าประวัติ';
  });
  $('#pdf-skip', body).addEventListener('click', closeModal);
  $('#pdf-save', body).addEventListener('click', () => askGuide(save));
}

// หน้าต่างเล็กถามก่อนบันทึก: ใช่ = เปิดภาพสาธิต (ปุ่มสุดท้ายบันทึกไฟล์ให้) · ไม่ต้อง = บันทึกทันที
function askGuide(save) {
  if ($('dialog.ask')) return;
  const d = document.createElement('dialog');
  d.className = 'ask';
  d.setAttribute('aria-labelledby', 'ask-t');
  d.innerHTML = `
    <span class="ask-ic" aria-hidden="true">${ICON.book}</span>
    <h3 id="ask-t">ต้องการให้แนะนำวิธีการใช้งานหรือไม่?</h3>
    <p>ดูภาพสาธิตวิธีบันทึกไฟล์และพิมพ์ใบเบิกทีละขั้น (iPhone · Android · คอมพิวเตอร์)</p>
    <div class="ask-actions">
      <button type="button" class="btn lg" data-ask="no">ไม่ต้อง บันทึกเลย</button>
      <button type="button" class="btn primary lg" data-ask="yes">ใช่ แนะนำวิธี</button>
    </div>`;
  document.body.append(d);
  const close = () => {
    if (!motionOK()) { d.close(); d.remove(); return; }
    d.classList.add('closing');
    setTimeout(() => { d.close(); d.remove(); }, 180);
  };
  $('[data-ask="no"]', d).addEventListener('click', () => { close(); save(); });
  $('[data-ask="yes"]', d).addEventListener('click', () => { close(); showSaveGuide({ onFinish: save, point: true }); });
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.showModal();
  $('[data-ask="yes"]', d).focus();
}

// ป๊อปอัปกลางจอเมื่อบันทึกไฟล์แล้ว (แตะเพื่อปิด หรือปิดเองใน 6 วินาที)
function savedPopup(name) {
  const where = {
    ios: 'ถ้าเลือก "บันทึกไปยังไฟล์" เปิดดูได้ที่แอป ไฟล์ (Files) → Downloads',
    android: 'ไฟล์อยู่ในโฟลเดอร์ ดาวน์โหลด (Download) เปิดได้ที่แอป Files / ไฟล์ของฉัน',
    pc: 'ไฟล์อยู่ในโฟลเดอร์ที่เลือกไว้ (ปกติคือ ดาวน์โหลด / Downloads)',
  }[DEVICE];
  $('.hud')?.remove();
  const el = document.createElement('div');
  el.className = 'hud saved';
  el.setAttribute('role', 'status');
  el.setAttribute('aria-live', 'polite');
  el.innerHTML = `<div class="hud-card" data-state="ok" tabindex="-1">
      <span class="hud-ic ok" aria-hidden="true"><svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="30"/><path d="M20 33.5 28.5 42 45 24"/></svg></span>
      <h3>บันทึกไฟล์เรียบร้อย</h3>
      <p class="saved-file"><span class="file-icon">PDF</span><b>${esc(name)}</b></p>
      <p>${esc(where)}</p>
      <button type="button" class="btn primary lg saved-ok">ตกลง</button>
      <span class="hud-bar" aria-hidden="true"><i style="animation-duration:6s"></i></span>
    </div>`;
  document.body.append(el);
  const close = () => {
    if (!el.isConnected || el.classList.contains('out')) return;
    clearTimeout(timer);
    document.removeEventListener('keydown', onKey);
    el.classList.add('out');
    setTimeout(() => el.remove(), motionOK() ? 260 : 0);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  const timer = setTimeout(close, 6000);
  $('.hud-card', el).addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  $('.saved-ok', el).focus({ preventScroll: true });
  if (motionOK()) navigator.vibrate?.(30);
}

async function downloadPdf(r, btn) {
  const label = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> กำลังสร้าง PDF';
  try {
    const blob = await PdfDoc.build(r, CONFIG.HOSPITAL_NAME, CONFIG.STAFF_NAME);
    // การสร้างอาจใช้เวลา เบราว์เซอร์อาจไม่ยอมเปิดหน้าต่างบันทึกโดยไม่มีการคลิกใหม่ จึงให้กดยืนยันอีกครั้ง
    btn.innerHTML = `${ICON.doc} บันทึก ${esc(PdfDoc.fileName(r))}`;
    btn.disabled = false;
    btn.onclick = safe(async () => {
      if (await PdfDoc.save(blob, PdfDoc.fileName(r))) { closeModal(); savedPopup(PdfDoc.fileName(r)); }
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
      <div class="page-head"><h1>พัสดุคงเหลือ</h1><p class="lead">ยอดคงเหลือจาก Google Sheet อัปเดตให้อัตโนมัติ</p></div>
      ${isAdmin() ? '<button class="btn primary" id="btn-add">+ เพิ่มพัสดุ</button>' : ''}
    </div>
    ${DEMO ? '' : `<div class="live" id="live"><span class="live-dot" aria-hidden="true"></span>
      <span id="live-text">${liveText()}</span>
      <button type="button" class="btn sm" id="live-refresh">รีเฟรช</button></div>`}
    <div class="toolbar">
      <div class="search">${ICON.search}<input type="search" id="f-q" placeholder="ค้นหาชื่อ รหัส หรือสถานที่เก็บ" value="${esc(params.get('q') || '')}"></div>
      <select id="f-cat" style="width:auto">${options(state.db.categories, params.get('cat'), 'ทุกหมวดหมู่')}</select>
      <label class="check"><input type="checkbox" id="f-low" ${params.get('low') === '1' ? 'checked' : ''}> ใกล้หมด</label>
      <span class="spacer"></span>
      ${isAdmin() ? '<button class="btn" id="btn-export">ส่งออก CSV</button>' : ''}
    </div>
    <div class="item-grid" id="items-grid"></div>`);

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
      (!cat || i.category === cat) && (!low || isLow(i)));
  };

  const actionBtns = (i) => `<a class="btn sm primary" href="#/request?item=${i.id}" ${i.active ? '' : 'hidden'}>เบิก</a>`;

  // จำยอดที่แสดงอยู่ เมื่อดึงจาก Google Sheet แล้วยอดเปลี่ยน การ์ดนั้นจะกะพริบให้เห็น
  let shown = null;
  const draw = () => {
    const prev = shown;
    shown = {};
    $('#items-grid').innerHTML = filtered().map((i) => {
      shown[i.id] = i.available_qty;
      const changed = prev && i.id in prev && prev[i.id] !== i.available_qty;
      return `
      <div class="item-card${i.available_qty <= 0 ? ' out' : ''}${changed ? ' changed' : ''}" data-item="${i.id}">
        <div class="top">
          <span class="pick-icon">${ICON.box}</span>
          <div style="flex:1;min-width:0"><div class="name">${esc(i.name)}</div><div class="code">${esc(i.code)} · ${esc(i.category || 'ไม่ระบุหมวด')}</div></div>
        </div>
        ${(() => {
          const p = (i.available_qty < 0 ? `<span class="pill out">ติดลบ ${fmtNum(-i.available_qty)}</span>` : i.available_qty === 0 ? '<span class="pill out">หมด</span>' : isLow(i) ? '<span class="pill low">ใกล้หมด</span>' : '') +
            (i.active ? '' : '<span class="pill">ปิดใช้งาน</span>');
          return p ? `<div class="item-pills">${p}</div>` : '';
        })()}
        <div class="qty"><b>${fmtNum(i.available_qty)}</b><span>${esc(i.unit)} คงเหลือ</span><span class="spacer"></span>
          <span class="actions">${actionBtns(i)}</span></div>
        ${stockBar(i)}
      </div>`;
    }).join('') || '<div class="card empty" style="grid-column:1/-1">ไม่พบรายการ</div>';
    bindRowClicks($('#items-grid'));
    $$('#items-grid a.btn').forEach((a) => a.addEventListener('click', (e) => e.stopPropagation()));
  };

  $('#f-q').addEventListener('input', draw);
  $('#f-cat').addEventListener('change', draw);
  $('#f-low').addEventListener('change', draw);
  $('#btn-export')?.addEventListener('click', () => downloadCsv('stock',
    ['รหัส', 'ชื่อ', 'หมวดหมู่', 'หน่วย', 'คงเหลือ', 'จุดสั่งซื้อขั้นต่ำ', 'สถานที่เก็บ'],
    filtered().map((i) => [i.code, i.name, i.category, i.unit, i.available_qty, i.min_qty, i.location])));
  if (isAdmin()) $('#btn-add').addEventListener('click', () => itemForm(null));
  $('#live-refresh')?.addEventListener('click', () => syncFromSheet({ manual: true }));
  redrawItems = draw;
  draw();
}

function showItem(id) {
  const i = itemsView().find((x) => x.id === id);
  if (!i) return;
  const moves = state.db.movements.filter((m) => m.item_id === id).sort((a, b) => b.id - a.id).slice(0, 100);
  const body = openModal(i.name, `
    <dl class="info">
      <dt>รหัส</dt><dd>${esc(i.code)}</dd>
      <dt>หมวดหมู่</dt><dd>${esc(i.category || '-')}</dd>
      <dt>คงเหลือในคลัง</dt><dd>${fmtNum(i.available_qty)} ${esc(i.unit)} ${isLow(i) ? '<span class="pill low">ต่ำกว่าจุดขั้นต่ำ</span>' : ''}</dd>
      <dt>จุดสั่งซื้อขั้นต่ำ</dt><dd>${fmtNum(i.min_qty)} ${esc(i.unit)}</dd>
      <dt>สถานที่เก็บ</dt><dd>${esc(i.location || '-')}</dd>
    </dl>
    <div class="toolbar">
      ${i.active ? `<a class="btn primary" href="#/request?item=${i.id}" data-close>เบิกรายการนี้</a>` : ''}
      ${isAdmin() ? `<span class="spacer"></span><button class="btn ok" data-stock="receive">รับเข้า</button>
        <button class="btn" data-stock="adjust">ตรวจนับ</button>
        <button class="btn" data-stock="lost">ตัดชำรุด</button>
        <button class="btn" id="i-edit">แก้ไข</button>` : ''}
    </div>
    ${isAdmin() ? `<h4>ประวัติสต็อก</h4>
    <div class="sub-card table-wrap"><table>
      <thead><tr><th>วันเวลา</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th>อ้างอิง</th></tr></thead>
      <tbody>${moves.map((m) => `<tr><td>${fmtDateTime(m.created_at)}</td><td>${movePill(m)}</td>
        <td class="num">${m.qty > 0 ? '+' : ''}${fmtNum(m.qty)}</td><td class="num">${fmtNum(m.available_after)}</td>
        <td>${esc(m.request_no)} ${m.note ? `<div class="muted small">${esc(m.note)}</div>` : ''}${lotInfo(m)}</td></tr>`).join('') ||
        '<tr><td colspan="5" class="empty">ไม่มี</td></tr>'}</tbody>
    </table></div>` : ''}`, { wide: isAdmin() });
  $$('[data-close]', body).forEach((a) => a.addEventListener('click', closeModal));
  bindRowClicks(body);
  if (isAdmin()) {
    $('#i-edit', body).addEventListener('click', () => itemForm(i));
    $$('[data-stock]', body).forEach((b) => b.addEventListener('click', () => stockForm(i, b.dataset.stock)));
  }
}

// ข้อมูลล็อตที่รับเข้า: บริษัท (เลือกจากรายการ หรือเพิ่มใหม่ลง Google Sheet ได้ทันที) · วันหมดอายุ (เลือกจากปฏิทินเท่านั้น) · เลขใบส่งของ
const ADD_SUPPLIER = '__add__';
function supplierOptions(selected) {
  return '<option value="">- ไม่ระบุ -</option>' +
    (state.db.suppliers || []).map((s) => `<option ${s.name === selected ? 'selected' : ''}>${esc(s.name)}</option>`).join('') +
    `<option value="${ADD_SUPPLIER}">+ เพิ่มบริษัทใหม่…</option>`;
}
function lotFields() {
  return `
    ${oldServerNote()}
    <label class="field full">บริษัท / ผู้จำหน่าย<select name="supplier">${supplierOptions(lsGet('last-supplier'))}</select></label>
    <div class="field full add-supplier" hidden>
      <span>ชื่อบริษัทใหม่ <span class="hint">(บันทึกลงรายการบริษัทใน Google Sheet ด้วย)</span></span>
      <div class="inline-add">
        <input id="new-supplier" placeholder="เช่น บริษัท เอ บี ซี จำกัด" autocomplete="off">
        <button type="button" class="btn primary" id="add-supplier">เพิ่ม</button>
        <button type="button" class="btn" id="cancel-supplier">ยกเลิก</button>
      </div>
    </div>
    <label class="field">วันหมดอายุ <span class="hint">(แตะเพื่อเลือกวัน)</span>
      <span class="date-wrap"><input name="expiry_date" type="date" class="date-pick" min="${today()}"><button type="button" class="link date-clear" hidden>ล้าง</button></span></label>
    <label class="field">เลขใบส่งของ<input name="delivery_no" placeholder="เช่น IV-2569/0012" autocomplete="off"></label>`;
}
function bindLotFields(form) {
  const sel = form.supplier;
  const box = $('.add-supplier', form);
  const inp = $('#new-supplier', form);
  let prev = sel.value;
  sel.addEventListener('change', () => {
    if (sel.value === ADD_SUPPLIER) { box.hidden = false; inp.focus(); return; }
    prev = sel.value;
    box.hidden = true;
  });
  $('#cancel-supplier', form).addEventListener('click', () => { box.hidden = true; inp.value = ''; sel.value = prev; });
  const add = safe(async () => {
    const name = inp.value.trim();
    if (!name) { inp.focus(); throw new Error('กรุณาพิมพ์ชื่อบริษัท'); }
    if (state.oldServer) throw new Error(OLD_SERVER_MSG);
    if (!(state.db.suppliers || []).some((s) => s.name === name)) await store.act('addMaster', { table: 'suppliers', name }, { quiet: true });
    sel.innerHTML = supplierOptions(name);
    prev = name;
    box.hidden = true;
    inp.value = '';
    toast('เพิ่มบริษัท ' + name + ' แล้ว');
  });
  $('#add-supplier', form).addEventListener('click', add);
  inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  // วันหมดอายุ: เปิดปฏิทินเมื่อแตะ พิมพ์เองไม่ได้ (Backspace / Delete = ล้างค่า)
  const d = form.expiry_date;
  const clear = $('.date-clear', form);
  const sync = () => { clear.hidden = !d.value; };
  const open = () => { try { d.showPicker?.(); } catch { /* เบราว์เซอร์เก่า: ใช้ปฏิทินของช่องวันที่ตามปกติ */ } };
  d.addEventListener('click', open);
  d.addEventListener('keydown', (e) => {
    if (e.key === 'Tab' || e.key === 'Escape') return;
    e.preventDefault();
    if (e.key === 'Backspace' || e.key === 'Delete') { d.value = ''; sync(); } else if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') open();
  });
  d.addEventListener('paste', (e) => e.preventDefault());
  d.addEventListener('change', sync);
  clear.addEventListener('click', () => { d.value = ''; sync(); });
}
// ค่าล็อตจากฟอร์ม (ไม่ส่งตัวเลือก "+ เพิ่มบริษัทใหม่")
function lotData(form) {
  const supplier = form.supplier.value === ADD_SUPPLIER ? '' : form.supplier.value;
  if (supplier) lsSet('last-supplier', supplier);
  return { supplier, expiry_date: form.expiry_date.value, delivery_no: form.delivery_no.value.trim() };
}
// บริษัท · เลขใบส่งของ · วันหมดอายุ ของรายการรับเข้า (แสดงใต้ประวัติสต็อก)
function lotInfo(m) {
  const parts = [m.supplier && esc(m.supplier), m.delivery_no && 'ใบส่งของ ' + esc(m.delivery_no), m.expiry_date && 'หมดอายุ ' + fmtDate(m.expiry_date)].filter(Boolean);
  return parts.length ? `<div class="muted small lot">${parts.join(' · ')}</div>` : '';
}
// Apps Script ที่ยังไม่อัปเดต (ไม่มีแท็บบริษัท) จะไม่บันทึกข้อมูลบริษัท/วันหมดอายุ/เลขใบส่งของ
const OLD_SERVER_MSG = 'Apps Script ยังเป็นเวอร์ชันเก่า: วาง AllInOne.gs ล่าสุด แล้ว Deploy → Manage deployments → New version ก่อน จึงจะบันทึกบริษัท วันหมดอายุ และเลขใบส่งของได้';
const oldServerNote = () => (state.oldServer ? `<p class="banner full">${OLD_SERVER_MSG}</p>` : '');

function itemForm(item) {
  // พัสดุใหม่: ระบบตั้งรหัสถัดไปให้เอง (เช่น NSO-302) เจ้าหน้าที่ไม่ต้องกรอก
  const nextCode = BorrowCore.nextItemCode(state.db.items);
  const body = openModal(item ? 'แก้ไขข้อมูลพัสดุ' : 'เพิ่มพัสดุใหม่', `
    <form id="item-form" class="fields">
      ${item
        ? `<label class="field">รหัสพัสดุ <span class="req">*</span><input name="code" required value="${esc(item.code)}"></label>`
        : `<label class="field">รหัสพัสดุ <span class="hint">(ระบบตั้งให้อัตโนมัติ)</span><input value="${esc(nextCode)}" readonly class="auto-code" tabindex="-1" aria-readonly="true"></label>`}
      <label class="field">หน่วยนับ<input name="unit" value="${esc(item?.unit || 'ชิ้น')}"></label>
      <label class="field full">ชื่อพัสดุ <span class="req">*</span><input name="name" required value="${esc(item?.name)}"></label>
      <label class="field full">หมวดหมู่<select name="category">${options(state.db.categories, item?.category, '- ไม่ระบุ -')}</select></label>
      <label class="field">จุดสั่งซื้อขั้นต่ำ <span class="hint">(เตือนเมื่อคงเหลือ ≤)</span><input name="min_qty" type="number" min="0" value="${item?.min_qty ?? 0}"></label>
      ${item ? '' : '<label class="field">จำนวนเริ่มต้น<input name="initial_qty" type="number" min="0" value="0"></label>'}
      <label class="field ${item ? '' : 'full'}">สถานที่เก็บ<input name="location" value="${esc(item?.location)}"></label>
      ${item ? `<label class="check full"><input type="checkbox" name="active" ${item.active ? 'checked' : ''}> เปิดใช้งาน (ให้เบิกได้)</label>`
        : `<p class="form-sec full">รับเข้าครั้งแรก <span class="hint">(ใส่เมื่อมีจำนวนเริ่มต้น)</span></p>${lotFields()}`}
      <div class="actions full"><button class="btn primary lg">บันทึก</button></div>
    </form>`);
  const form = $('#item-form', body);
  if (!item) bindLotFields(form);
  form.addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    if (item) { data.id = item.id; data.active = e.target.active.checked; }
    else {
      Object.assign(data, lotData(form));
      // Apps Script เวอร์ชันเก่ายังต้องการรหัส: ส่งรหัสที่คำนวณไว้ให้ (เวอร์ชันใหม่ตั้งให้เองที่เซิร์ฟเวอร์ ไม่ชนกันแม้เพิ่มพร้อมกัน)
      if (state.oldServer) data.code = nextCode;
    }
    delete data[ADD_SUPPLIER];
    const id = await store.act('saveItem', data);
    toast(item ? 'บันทึกเรียบร้อย' : `เพิ่มพัสดุ ${itemById(id)?.code || ''} เรียบร้อย`);
    refresh();
    showItem(id);
  }));
}

function stockForm(item, type) {
  const titles = { receive: 'รับเข้าสต็อก', adjust: 'ตรวจนับ / ปรับยอดคงเหลือ', lost: 'ตัดชำรุด / สูญหาย' };
  const field = type === 'adjust'
    ? `<label class="field full">ยอดคงเหลือในคลังที่นับได้จริง (${esc(item.unit)})<input name="counted_qty" type="number" min="0" required value="${item.available_qty}"></label>
       <p class="muted small full">ยอดในระบบ ${fmtNum(item.available_qty)} ${esc(item.unit)}</p>`
    : `<label class="field full">จำนวน (${esc(item.unit)})<input name="qty" type="number" min="1" ${type === 'lost' ? `max="${item.available_qty}"` : ''} required></label>`;
  const body = openModal(`${titles[type]} · ${item.name}`, `
    <form id="stock-form" class="fields">
      ${field}
      ${type === 'receive' ? lotFields() : ''}
      <label class="field full">หมายเหตุ${type === 'receive' ? '' : ' / เลขที่เอกสาร'}<input name="note"></label>
      <div class="actions full"><button class="btn primary lg">บันทึก</button></div>
    </form>`);
  const form = $('#stock-form', body);
  if (type === 'receive') bindLotFields(form);
  form.addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const data = { item_id: item.id, type, ...formData(e.target), ...(type === 'receive' ? lotData(form) : {}) };
    await store.act('stock', data);
    toast('ปรับปรุงสต็อกเรียบร้อย');
    refresh();
    showItem(item.id);
  }));
}

// ===================== Requests (history) =====================
// ช่วงเวลา: ทุกเดือน / วันนี้ / เลือกเดือน (YYYY-MM)
function renderRequests(page) {
  const params = hashParams();
  const thisMonth = today().slice(0, 7);
  let when = params.get('m') || (params.get('tab') === 'today' ? 'today' : params.get('tab') === 'month' ? thisMonth : '');
  const counts = {};
  state.db.requests.forEach((r) => { const m = r.created_at.slice(0, 7); counts[m] = (counts[m] || 0) + 1; });
  const months = [...new Set([thisMonth, ...Object.keys(counts), ...(/^\d{4}-\d{2}$/.test(when) ? [when] : [])])].sort().reverse();
  page.insertAdjacentHTML('beforeend', `
    <div class="page-head"><h1>ประวัติเบิก</h1><p class="lead">ดูใบเบิกย้อนหลัง เลือกเดือน ดาวน์โหลดใบเบิกเป็น PDF หรือลบใบที่บันทึกผิด</p></div>
    <div class="toolbar">
      <label class="month-pick">${ICON.cal}<select id="r-month" aria-label="เลือกเดือน">
        <option value="">ทุกเดือน</option><option value="today">วันนี้</option>
        ${months.map((m) => `<option value="${m}">${esc(PdfDoc.monthName(m))} (${fmtNum(counts[m] || 0)} ใบ)</option>`).join('')}
      </select></label>
      <div class="search">${ICON.search}<input type="search" id="r-q" placeholder="ค้นหาเลขที่ ชื่อ แผนก หรือพัสดุ"></div>
      <button class="btn" id="r-export">ส่งออก CSV</button>
      <button class="btn primary" data-monthly id="r-monthly">${ICON.doc} สรุปรายเดือน (PDF)</button>
    </div>
    <p class="muted small" id="r-sum"></p>
    <section class="card"><ul class="rows" id="req-body"></ul></section>`);
  $('#r-month').value = when;

  const match = (r) => !when || r.created_at.startsWith(when === 'today' ? today() : when);
  const filtered = () => {
    const q = $('#r-q').value.trim().toLowerCase();
    return requestsView().filter((r) => match(r) &&
      (!q || [r.request_no, r.borrower_name, r.department, r.item_summary].some((s) => s.toLowerCase().includes(q))));
  };
  const draw = () => {
    history.replaceState(null, '', `#/requests${when === 'today' ? '?tab=today' : when ? '?m=' + when : ''}`);
    // สรุปรายเดือนเปิดที่เดือนที่เลือกไว้
    $('#r-monthly').dataset.month = /^\d{4}-\d{2}$/.test(when) ? when : when === 'today' ? thisMonth : '';
    const rows = filtered();
    const qty = rows.reduce((s, r) => s + r.items.reduce((n, l) => n + l.qty, 0), 0);
    $('#r-sum').textContent = `${fmtNum(rows.length)} ใบ · ${fmtNum(qty)} หน่วย`;
    $('#req-body').innerHTML = rows.map((r) => `
      <li><div class="row" data-request="${r.id}">
        <span class="pick-icon">${ICON.withdraw}</span>
        <div class="row-body">
          <div class="row-title">${esc(r.borrower_name)} <span class="muted small" style="font-weight:400">· ${esc(r.department)}</span></div>
          <div class="row-sub">${esc(r.request_no)} · ${esc(r.item_summary)}</div>
        </div>
        <div class="row-end"><span>${fmtDateTime(r.created_at)}</span></div>
        <span class="chev">${ICON.chev}</span>
      </div></li>`).join('') || `<li class="empty">${when ? 'ไม่มีใบเบิกในช่วงเวลานี้' : 'ไม่พบรายการ'}</li>`;
    bindRowClicks($('#req-body'));
  };
  $('#r-month').addEventListener('change', (e) => { when = e.target.value; draw(); });
  $('#r-q').addEventListener('input', draw);
  $('#r-export').addEventListener('click', () => downloadCsv('requests' + (when ? '-' + when : ''),
    ['เลขที่', 'วันเวลาที่เบิก', 'ผู้เบิก', 'แผนก', 'หมายเหตุ', 'รหัสพัสดุ', 'พัสดุ', 'จำนวน', 'หน่วย'],
    filtered().flatMap((r) => r.items.map((l) => [r.request_no, r.created_at, r.borrower_name, r.department, r.note, l.code, l.name, l.qty, l.unit]))));
  draw();
}

function showRequest(id) {
  const raw = state.db.requests.find((r) => r.id === id);
  if (!raw) return;
  const r = requestView(raw);
  const body = openModal(`ใบเบิก ${r.request_no}`, `
    <dl class="info">
      <dt>ผู้เบิก</dt><dd>${esc(r.borrower_name)} ${r.phone ? `(โทร ${esc(r.phone)})` : ''}</dd>
      <dt>แผนก</dt><dd>${esc(r.department_full)}</dd>
      <dt>วันเวลาที่เบิก</dt><dd>${fmtDateTime(r.created_at)}</dd>
      ${r.purpose ? `<dt>วัตถุประสงค์</dt><dd>${esc(r.purpose)}</dd>` : ''}
      ${r.note ? `<dt>หมายเหตุ</dt><dd>${esc(r.note)}</dd>` : ''}
    </dl>
    <div class="sub-card table-wrap"><table>
      <thead><tr><th>พัสดุ</th><th class="num">จำนวน</th></tr></thead>
      <tbody>${r.items.map((l) => `<tr>
        <td>${esc(l.name)}<div class="muted small">${esc(l.code)}</div></td>
        <td class="num">${l.qty} ${esc(l.unit)}</td>
      </tr>`).join('')}</tbody>
    </table></div>
    <div class="actions">
      ${isAdmin() ? `<button class="btn danger-soft" id="rq-delete">${IC.trash} ลบใบเบิก</button>` : ''}
      <span class="spacer"></span>
      <button class="btn primary" id="rq-pdf">${ICON.doc} ดาวน์โหลด PDF</button>
    </div>`);
  $('#rq-pdf', body).addEventListener('click', safe(() => downloadPdf(r, $('#rq-pdf', body))), { once: true });
  $('#rq-delete', body)?.addEventListener('click', () => confirmDeleteRequest(r));
}

// ป๊อปอัปยืนยันก่อนลบใบเบิก: เลือกได้ว่าจะคืนจำนวนพัสดุเข้าสต็อกหรือไม่
function confirmDeleteRequest(r) {
  const qty = r.items.reduce((n, l) => n + l.qty, 0);
  confirmBox({
    title: `ลบใบเบิก ${r.request_no} ใช่ไหม?`,
    html: `<p>${esc(r.borrower_name)} · ${esc(r.department)} · ${fmtDateTime(r.created_at)}<br>${fmtNum(r.items.length)} รายการ รวม ${fmtNum(qty)} หน่วย</p>
      <label class="check confirm-check"><input type="checkbox" name="restock" checked> คืนจำนวนพัสดุในใบนี้เข้าสต็อก</label>
      <p class="muted small">ลบแล้วย้อนกลับไม่ได้ · เลขที่ ${esc(r.request_no)} จะไม่ถูกนำมาใช้ซ้ำ</p>`,
    ok: 'ลบใบเบิก',
    onOk: async (d) => {
      const restock = $('[name=restock]', d).checked;
      if (state.oldServer) throw new Error(OLD_SERVER_MSG.replace('จึงจะบันทึกบริษัท วันหมดอายุ และเลขใบส่งของได้', 'จึงจะลบใบเบิกได้'));
      await store.act('deleteRequest', { id: r.id, restock });
      closeModal();
      toast(`ลบใบเบิก ${r.request_no} แล้ว${restock ? ' และคืนพัสดุเข้าสต็อก' : ''}`);
      refresh();
    },
  });
}

// ป๊อปอัปยืนยันกลางจอ (ปุ่มยืนยันสีแดง) onOk ทำงานเสร็จจึงปิด ถ้า error แสดงข้อความแล้วค้างไว้ให้ลองใหม่
function confirmBox({ title, html = '', ok = 'ยืนยัน', onOk }) {
  $('dialog.ask')?.remove();
  const d = document.createElement('dialog');
  d.className = 'ask confirm';
  d.setAttribute('aria-labelledby', 'confirm-t');
  d.innerHTML = `
    <span class="ask-ic danger" aria-hidden="true">${IC.trash}</span>
    <h3 id="confirm-t">${esc(title)}</h3>
    ${html}
    <div class="ask-actions">
      <button type="button" class="btn lg" data-c="no">ยกเลิก</button>
      <button type="button" class="btn danger lg" data-c="ok">${esc(ok)}</button>
    </div>`;
  document.body.append(d);
  const close = () => {
    if (!motionOK()) { d.close(); d.remove(); return; }
    d.classList.add('closing');
    setTimeout(() => { d.close(); d.remove(); }, 180);
  };
  $('[data-c="no"]', d).addEventListener('click', close);
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  const okBtn = $('[data-c="ok"]', d);
  okBtn.addEventListener('click', async () => {
    okBtn.disabled = true;
    try { await onOk(d); close(); } catch (e) { toast(e.message, true); okBtn.disabled = false; }
  });
  d.showModal();
  $('[data-c="no"]', d).focus();
}

// ===================== สรุปรายเดือน (เจ้าหน้าที่) =====================
function showMonthlyReport(pick) {
  const months = [...new Set([today().slice(0, 7), ...(pick ? [pick] : []), ...state.db.requests.map((r) => r.created_at.slice(0, 7))])].filter(Boolean).sort().reverse();
  const body = openModal('สรุปรายเดือน (PDF)', `
    <label class="field">เลือกเดือน
      <select id="mr-month">${months.map((m) => `<option value="${m}" ${m === pick ? 'selected' : ''}>${esc(PdfDoc.monthName(m))}</option>`).join('')}</select></label>
    <div id="mr-preview"></div>
    <div class="actions"><button class="btn primary lg" id="mr-pdf">${ICON.doc} สร้าง PDF</button></div>`);
  let sum;
  const preview = () => {
    sum = BorrowCore.monthlySummary(state.db, $('#mr-month', body).value);
    const t = sum.totals;
    const top = (rows, unit) => rows.slice(0, 5).map((x) => `<li>${esc(x.name)} <b>${fmtNum(unit ? x.qty : x.withdraw_qty)}</b> ${esc(unit ? x.unit : 'หน่วย')}</li>`).join('') || '<li class="muted">ไม่มี</li>';
    $('#mr-preview', body).innerHTML = `
      <div class="stats">
        <div class="card stat"><span class="label">ใบเบิก</span><span class="value">${fmtNum(t.withdraw_docs)}</span><span class="sub">ใบ</span></div>
        <div class="card stat"><span class="label">จำนวนที่เบิก</span><span class="value">${fmtNum(t.withdraw_qty)}</span><span class="sub">หน่วย</span></div>
        <div class="card stat"><span class="label">แผนกที่เบิก</span><span class="value">${fmtNum(sum.departments.length)}</span><span class="sub">แผนก</span></div>
      </div>
      <div class="grid-2" style="margin-top:14px">
        <div><h4>เบิกมากที่สุด</h4><ol class="top-list">${top(sum.withdrawn, true)}</ol></div>
        <div><h4>แผนกที่เบิกมากที่สุด</h4><ol class="top-list">${top(sum.departments, false)}</ol></div>
      </div>
      <p class="muted small">PDF มี: ยอดรวม · พัสดุที่ถูกเบิก · สรุปตามแผนก · รายการใบเบิกทั้งหมด ${fmtNum(sum.requests.length)} ใบ</p>`;
    const btn = $('#mr-pdf', body);
    btn.innerHTML = `${ICON.doc} สร้าง PDF`;
    btn.classList.add('primary');
    btn.onclick = safe(build);
  };
  // สร้างก่อน แล้วให้กดบันทึกอีกครั้ง (เบราว์เซอร์ต้องการการกดจากผู้ใช้ตอนเปิดหน้าต่างบันทึก)
  async function build() {
    const btn = $('#mr-pdf', body);
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> กำลังสร้าง PDF';
    try {
      const blob = await PdfDoc.buildReport(sum, CONFIG.HOSPITAL_NAME, {
        generatedAt: nowStamp(),
        staff: CONFIG.STAFF_NAME,
        deptFull,
        lines: (r) => requestView(r).items,
      });
      const name = PdfDoc.reportFileName(sum.month);
      btn.innerHTML = `${ICON.doc} บันทึก ${esc(name)}`;
      btn.onclick = safe(async () => { if (await PdfDoc.save(blob, name)) { closeModal(); savedPopup(name); } });
    } catch (e) {
      btn.innerHTML = `${ICON.doc} สร้าง PDF`;
      throw e;
    } finally {
      btn.disabled = false;
    }
  }
  $('#mr-month', body).addEventListener('change', preview);
  preview();
}
// เวลาปัจจุบันแบบที่บันทึกในระบบ เช่น 2026-10-24 09:15:42
function nowStamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${today()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ===================== Dashboard (เจ้าหน้าที่) =====================
function renderDashboard(page) {
  const items = itemsView().filter((i) => i.active);
  const reqs = requestsView();
  const low = items.filter(isLow);
  const month = today().slice(0, 7);
  const thisMonth = reqs.filter((r) => r.created_at.startsWith(month)).length;
  const todayN = reqs.filter((r) => r.created_at.startsWith(today())).length;
  const negative = items.filter((i) => i.available_qty < 0).length;
  const recentReqs = reqs.slice(0, 8);
  const recent = state.db.movements.slice().sort((a, b) => b.id - a.id).slice(0, 10);
  page.insertAdjacentHTML('beforeend', `
    <div class="page-head-row">
      <div class="page-head"><h1>ภาพรวม</h1><p class="lead">สรุปสต็อกและการเบิกพัสดุ</p></div>
      <button class="btn primary" data-monthly>${ICON.doc} สรุปรายเดือน (PDF)</button>
    </div>
    <div class="stats">
      <a class="card stat" href="#/items"><span class="label">พัสดุในระบบ</span><span class="value">${fmtNum(items.length)}</span><span class="sub">รายการ</span></a>
      <a class="card stat" href="#/requests?tab=today"><span class="label">เบิกวันนี้</span><span class="value">${fmtNum(todayN)}</span><span class="sub">ใบเบิก</span></a>
      <a class="card stat" href="#/requests?tab=month"><span class="label">เบิกเดือนนี้</span><span class="value">${fmtNum(thisMonth)}</span><span class="sub">ใบเบิก</span></a>
      <a class="card stat warn" href="#/items?low=1"><span class="label">ใกล้หมด</span><span class="value">${fmtNum(low.length)}</span><span class="sub">รายการ</span></a>
      <a class="card stat danger" href="#/items?low=1"><span class="label">ยอดติดลบ (ค้างจ่าย)</span><span class="value">${fmtNum(negative)}</span><span class="sub">รายการ</span></a>
    </div>
    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>ใกล้หมด</h3><a href="#/items?low=1" class="link">ดูทั้งหมด</a></div>
        <div class="table-wrap"><table>
          <thead><tr><th>พัสดุ</th><th class="num">คงเหลือ</th><th class="num">ขั้นต่ำ</th></tr></thead>
          <tbody>${low.map((i) => `<tr class="clickable" data-item="${i.id}"><td>${esc(i.name)}<div class="muted small">${esc(i.code)}</div></td>
            <td class="num"><span class="pill ${i.available_qty < 0 ? 'out' : 'low'}">${fmtNum(i.available_qty)} ${esc(i.unit)}</span></td><td class="num">${fmtNum(i.min_qty)}</td></tr>`).join('') ||
            '<tr><td colspan="3" class="empty">สต็อกทุกรายการอยู่ในระดับปกติ</td></tr>'}</tbody>
        </table></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>ใบเบิกล่าสุด</h3><a href="#/requests" class="link">ดูทั้งหมด</a></div>
        <div class="table-wrap"><table>
          <thead><tr><th>เลขที่ / ผู้เบิก</th><th>วันเวลา</th><th class="num">รายการ</th></tr></thead>
          <tbody>${recentReqs.map((r) => `<tr class="clickable" data-request="${r.id}"><td>${esc(r.request_no)}<div class="muted small">${esc(r.borrower_name)} · ${esc(r.department)}</div></td>
            <td>${fmtDateTime(r.created_at)}</td><td class="num">${fmtNum(r.items.length)}</td></tr>`).join('') ||
            '<tr><td colspan="3" class="empty">ยังไม่มีใบเบิก</td></tr>'}</tbody>
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
      <thead><tr><th>วันเวลา</th><th>พัสดุ</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th>อ้างอิง / หมายเหตุ</th></tr></thead>
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
        <td class="num">${fmtNum(m.available_after)}</td>
        <td>${esc(m.request_no)} ${m.note ? `<div class="muted small">${esc(m.note)}</div>` : ''}${lotInfo(m)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty">ไม่พบรายการ</td></tr>';
  };
  ['#m-item', '#m-type', '#m-from', '#m-to'].forEach((s) => $(s).addEventListener('change', draw));
  $('#m-export').addEventListener('click', () => downloadCsv('stock-movements',
    ['วันเวลา', 'รหัส', 'พัสดุ', 'ประเภท', 'จำนวน', 'คงเหลือหลังทำรายการ', 'เลขที่เอกสาร', 'หมายเหตุ', 'บริษัท', 'วันหมดอายุ', 'เลขใบส่งของ'],
    filtered().map((m) => [m.created_at, itemById(m.item_id)?.code, itemById(m.item_id)?.name, MOVE[m.type] || m.type, m.qty, m.available_after, m.request_no, m.note, m.supplier, m.expiry_date, m.delivery_no])));
  draw();
}

// ===================== Settings =====================
function renderSettings(page) {
  const isDept = (table) => table === 'departments';
  const card = (table, title) => `
    <section class="card">
      <div class="card-head"><h3>${title}</h3></div>
      <form class="toolbar" data-add="${table}" style="padding:4px 24px 12px">
        <input name="name" placeholder="${isDept(table) ? 'ชื่อย่อ เช่น ICU' : table === 'suppliers' ? 'เช่น บริษัท เอ บี ซี จำกัด' : 'เพิ่มใหม่...'}" required style="flex:1;min-width:120px">
        ${isDept(table) ? '<input name="full_name" placeholder="ชื่อเต็ม (ถ้ามี)" style="flex:2;min-width:160px">' : ''}
        <button class="btn primary">เพิ่ม</button></form>
      <div class="table-wrap"><table><tbody>${state.db[table].map((x) => `<tr><td>${esc(x.name)}${x.full_name ? `<div class="muted small">${esc(x.full_name)}</div>` : ''}</td>
        <td class="num"><button class="link" data-remove-${table}="${esc(x.name)}">ลบ</button></td></tr>`).join('') ||
        '<tr><td class="empty">ยังไม่มีข้อมูล</td></tr>'}</tbody></table></div>
    </section>`;
  page.insertAdjacentHTML('beforeend', `
    <div class="page-head"><h1>ตั้งค่า</h1><p class="lead">รายชื่อแผนกจะแสดงในฟอร์มเบิก</p></div>
    <div class="grid-2">${card('departments', 'แผนก')}${card('categories', 'หมวดหมู่พัสดุ')}</div>
    ${oldServerNote()}
    ${card('suppliers', 'บริษัท / ผู้จำหน่าย (เลือกตอนรับเข้าพัสดุ)')}
    ${DEMO ? `<section class="card card-pad" style="display:flex;flex-direction:column;gap:12px;align-items:flex-start"><h3>โหมดทดลอง</h3>
      <p class="muted">ล้างข้อมูลที่ทดลองไว้ในเบราว์เซอร์นี้ แล้วกลับไปใช้ข้อมูลตัวอย่าง</p>
      <button class="btn danger" id="reset-demo">ล้างข้อมูลทดลอง</button></section>`
      : `<section class="card card-pad" style="display:flex;flex-direction:column;gap:8px"><h3>Google Sheets</h3><p class="muted">ข้อมูลทั้งหมดอยู่ใน Google Sheet ที่เชื่อมไว้
        แก้ชื่อ/สถานที่เก็บใน Sheet ได้โดยตรง แต่ควรปรับ <strong>จำนวน</strong> ผ่านเว็บนี้เพื่อให้มีประวัติสต็อกครบ</p></section>`}`);

  $$('[data-add]').forEach((f) => f.addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    if (f.dataset.add === 'suppliers' && state.oldServer) throw new Error(OLD_SERVER_MSG);
    await store.act('addMaster', { table: f.dataset.add, name: f.name.value, full_name: f.full_name?.value });
    toast('เพิ่มเรียบร้อย');
    refresh();
  })));
  for (const table of ['departments', 'categories', 'suppliers']) {
    $$(`[data-remove-${table}]`).forEach((b) => b.addEventListener('click', () => {
      const name = b.getAttribute(`data-remove-${table}`);
      confirmBox({
        title: `ลบ "${name}" ใช่ไหม?`,
        html: '<p class="muted small">ข้อมูลเดิมที่เคยบันทึกชื่อนี้ไว้ยังอยู่ครบ</p>',
        ok: 'ลบ',
        onOk: async () => {
          await store.act('removeMaster', { table, name });
          toast('ลบเรียบร้อย');
          refresh();
        },
      });
    }));
  }
  $('#reset-demo')?.addEventListener('click', () => {
    if (!confirm('ล้างข้อมูลทดลองทั้งหมด?')) return;
    try { localStorage.removeItem(DEMO_KEY); } catch { /* ignore */ }
    state.db = demoLoad();
    toast('รีเซ็ตข้อมูลแล้ว');
    refresh();
  });
}

// ===================== หน้าวิธีใช้งาน =====================
// แถบแจ้งเตือนให้อ่านวิธีใช้งาน (หน้าแรกเป็นการ์ดใหญ่ หน้าเบิกเป็นแถบเล็ก)
function helpNotice(slim = false) {
  return slim
    ? `<a class="help-notice slim" href="#/help">${ICON.book}<span><b>ใช้งานครั้งแรก?</b> อ่านวิธีเบิก เลือกหลายรายการ และบันทึก/พิมพ์ PDF</span><span class="help-go">อ่านเลย ›</span></a>`
    : `<a class="help-notice" href="#/help">
        <span class="help-ic" aria-hidden="true">${ICON.book}</span>
        <span class="help-txt"><b>โปรดอ่านวิธีใช้งานก่อนเบิกพัสดุ</b>
          <span>ขั้นตอนการเบิก · เบิกหลายรายการในใบเดียว · วิธีบันทึกและพิมพ์ใบเบิกบน iPhone และ Android</span></span>
        <span class="btn help-btn">อ่านวิธีใช้งาน</span>
      </a>`;
}

const DEVICE = PdfDoc.isIOS ? 'ios' : /Android/i.test(navigator.userAgent) ? 'android' : 'pc';
// ขั้นตอนบันทึก/พิมพ์ PDF แยกตามอุปกรณ์ (ตรงกับการทำงานของปุ่มใน pdf.js)
const SAVE_GUIDE = {
  ios: {
    label: 'iPhone / iPad', short: 'iPhone',
    save: [
      'หลังกด <b>ยืนยันการเบิก</b> รอจนปุ่ม <span class="kbd primary">บันทึก PDF</span> เป็นสีฟ้า (ระบบกำลังทำใบเบิก 1–3 วินาที)',
      `แตะ <span class="kbd primary">บันทึก PDF</span> หน้าต่าง <b>แชร์</b> ของ iPhone จะเลื่อนขึ้นมาจากด้านล่าง`,
      'เลื่อนรายการด้านล่างลงมา แล้วแตะ <span class="kbd">บันทึกไปยังไฟล์</span> (Save to Files)',
      'เลือกที่เก็บ เช่น <b>บน iPhone ของฉัน</b> → โฟลเดอร์ <b>Downloads</b> (หรือ iCloud Drive) แล้วแตะ <span class="kbd">บันทึก</span> มุมขวาบน',
      'เปิดดูไฟล์ได้ทุกเมื่อที่แอป <b>ไฟล์</b> (Files) ไอคอนโฟลเดอร์สีฟ้า → ชื่อไฟล์คือเลขที่ใบเบิก เช่น WD69-001.pdf',
    ],
    print: [
      `แตะ <span class="kbd primary">บันทึก PDF</span> แล้วในหน้าต่างแชร์ เลื่อนลงมาแตะ <span class="kbd">พิมพ์</span> (Print)`,
      'แตะ <span class="kbd">เครื่องพิมพ์</span> แล้วเลือกเครื่องพิมพ์ของหน่วยงาน (ต้องเป็นเครื่องที่รองรับ AirPrint และ iPhone ต่อ Wi-Fi เดียวกับเครื่องพิมพ์)',
      'ตั้ง <b>จำนวนสำเนา</b> (แนะนำ 2 ชุด: ผู้เบิก 1 ชุด เจ้าหน้าที่พัสดุ 1 ชุด)',
      'แตะ <span class="kbd primary">พิมพ์</span> มุมขวาบน',
      `ถ้าบันทึกไฟล์ไว้แล้ว: เปิดแอป <b>ไฟล์</b> → แตะไฟล์ใบเบิก → แตะไอคอนแชร์ <span class="kbd icon">${ICON.share}</span> มุมซ้ายล่าง → <span class="kbd">พิมพ์</span>`,
    ],
    tips: [
      'ถ้าเปิดเว็บจากลิงก์ใน <b>LINE</b> ให้แตะ <span class="kbd icon">' + ICON.dots + '</span> หรือ <span class="kbd">⋯</span> มุมบน → <b>เปิดใน Safari</b> ก่อน ปุ่มบันทึกจะทำงานได้ถูกต้อง',
      'ส่งไฟล์ให้หัวหน้าหรือเจ้าหน้าที่พัสดุทาง LINE ได้: ในหน้าต่างแชร์แตะไอคอน <b>LINE</b> แล้วเลือกห้องแชต',
    ],
  },
  android: {
    label: 'Android', short: 'Android',
    save: [
      'หลังกด <b>ยืนยันการเบิก</b> รอจนปุ่ม <span class="kbd primary">ดาวน์โหลด PDF</span> เป็นสีฟ้า (ระบบกำลังทำใบเบิก 1–3 วินาที)',
      'แตะ <span class="kbd primary">ดาวน์โหลด PDF</span> Chrome จะดาวน์โหลดไฟล์ทันที และขึ้นแถบแจ้งด้านล่างจอว่าดาวน์โหลดเสร็จแล้ว',
      'แตะ <span class="kbd">เปิด</span> ในแถบนั้นเพื่อดูใบเบิกได้ทันที (ถ้าแถบหายไปแล้ว ดูขั้นถัดไป)',
      `ไฟล์อยู่ในโฟลเดอร์ <b>ดาวน์โหลด</b> (Download): เปิดแอป <b>Files</b> / <b>ไฟล์ของฉัน</b> → ดาวน์โหลด หรือใน Chrome แตะ <span class="kbd icon">${ICON.dots}</span> มุมขวาบน → <b>ดาวน์โหลด</b>`,
      'ชื่อไฟล์คือเลขที่ใบเบิก เช่น WD69-001.pdf',
    ],
    print: [
      'เปิดไฟล์ใบเบิก (แตะ <span class="kbd">เปิด</span> หลังดาวน์โหลด หรือแตะไฟล์ในโฟลเดอร์ดาวน์โหลด) ไฟล์จะเปิดในแอปดู PDF เช่น Google Drive',
      `แตะ <span class="kbd icon">${ICON.dots}</span> มุมขวาบน → <span class="kbd">พิมพ์</span> (บางรุ่นอยู่ในเมนู <b>แชร์</b> → <b>พิมพ์</b>)`,
      'แตะแถบชื่อเครื่องพิมพ์ด้านบน → เลือกเครื่องพิมพ์ของหน่วยงาน (มือถือต้องต่อ Wi-Fi เดียวกับเครื่องพิมพ์)',
      'ตั้ง <b>จำนวนสำเนา</b> (แนะนำ 2 ชุด) แล้วแตะปุ่ม <span class="kbd primary">พิมพ์</span> (ไอคอนเครื่องพิมพ์สีน้ำเงิน)',
      'ถ้าไม่เห็นเครื่องพิมพ์: เข้า <b>การตั้งค่า</b> → ค้นหา “การพิมพ์” → เปิด <b>บริการพิมพ์เริ่มต้น</b> หรือติดตั้งแอปเสริมของยี่ห้อเครื่องพิมพ์',
    ],
    tips: [
      'ถ้าเปิดเว็บจากลิงก์ใน <b>LINE</b> ให้แตะ <span class="kbd icon">' + ICON.dots + '</span> มุมบน → <b>เปิดในเบราว์เซอร์อื่น / Chrome</b> ก่อน จะดาวน์โหลดไฟล์ได้',
      'ส่งไฟล์ให้หัวหน้าหรือเจ้าหน้าที่พัสดุ: เปิดไฟล์ → แชร์ → LINE',
    ],
  },
  pc: {
    label: 'คอมพิวเตอร์', short: 'คอม',
    save: [
      'หลังกด <b>ยืนยันการเบิก</b> รอจนปุ่ม <span class="kbd primary">ดาวน์โหลด PDF</span> เป็นสีฟ้า',
      'คลิก <span class="kbd primary">ดาวน์โหลด PDF</span> จะมีหน้าต่างให้เลือกที่เก็บไฟล์ (Chrome/Edge) เลือกโฟลเดอร์แล้วกด <span class="kbd">บันทึก</span> · เบราว์เซอร์อื่นจะบันทึกลงโฟลเดอร์ ดาวน์โหลด อัตโนมัติ',
    ],
    print: [
      'ดับเบิลคลิกเปิดไฟล์ใบเบิก แล้วกด <span class="kbd">Ctrl</span> + <span class="kbd">P</span> (Mac: <span class="kbd">⌘</span> + <span class="kbd">P</span>)',
      'เลือกเครื่องพิมพ์ ขนาดกระดาษ A4 จำนวน 2 ชุด แล้วกด <span class="kbd primary">พิมพ์</span>',
    ],
    tips: [],
  },
};

function renderHelp(page) {
  const want = hashParams().get('s');
  let dev = DEVICE;
  const step = (n, t, d, img, note) => `
    <li class="help-step">
      <img src="tour/${img}.jpg" alt="${esc(t)}" width="393" height="460" loading="lazy">
      <div><span class="help-n">${n}</span><h3>${t}</h3><p>${d}</p>${note ? `<p class="tour-note">${note}</p>` : ''}</div>
    </li>`;
  page.insertAdjacentHTML('beforeend', `
    <div class="page-head"><h1>วิธีใช้งาน</h1>
      <p class="lead">เบิกพัสดุผ่านเว็บใน 4 ขั้นตอน และวิธีบันทึก/พิมพ์ใบเบิกบน iPhone และ Android</p></div>
    <nav class="help-toc" aria-label="หัวข้อ">
      <button type="button" data-go="h-steps">ขั้นตอนการเบิก</button>
      <button type="button" data-go="h-multi">เบิกหลายรายการ</button>
      <button type="button" data-go="h-save">บันทึกและพิมพ์ PDF</button>
      <button type="button" data-tour>ดูแบบสไลด์</button>
    </nav>
    <section class="card help-sec" id="h-steps">
      <h2>ขั้นตอนการเบิกพัสดุ</h2>
      <ol class="help-steps">
        ${step(1, 'กด "เบิกพัสดุ"', 'ที่หน้าแรกกดการ์ด <b>เบิกพัสดุ</b> หรือเมนู <b>เบิกพัสดุ</b> ด้านบน', '2-start')}
        ${step(2, 'กรอกชื่อและเลือกแผนก', 'ใส่ <b>ชื่อ-นามสกุล</b> และเลือก <b>แผนก</b> ของคุณ (หมายเหตุไม่บังคับ) ครั้งต่อไประบบจำชื่อและแผนกไว้ให้', '3-form')}
        ${step(3, 'เลือกพัสดุและจำนวน', 'พิมพ์ค้นหา (เช่น airway, ถุงมือ หรือรหัส NSO-010) หรือแตะตัวอักษร A–Z เพื่อข้ามไปหมวดนั้น กด <b>+ เลือก</b> แล้วปรับจำนวนด้วยปุ่ม <b>−</b> <b>+</b> (ปุ่มถังขยะ = เอาออก)', '4-pick', '(พัสดุที่ขึ้นว่า "หมด" ก็กดเลือกเบิกได้ ระบบจะบันทึกยอดในคลังเป็นติดลบไว้ก่อน)')}
        ${step(4, 'กด "ยืนยันการเบิก"', 'ตรวจจำนวนรายการและจำนวนชิ้นที่แถบด้านล่าง แล้วกดปุ่มสีฟ้า <b>ยืนยันการเบิก</b>', '5-confirm')}
        ${step(5, 'รับใบเบิก PDF', 'จะได้ <b>เลขที่เอกสาร</b> (เช่น WD69-001) และปุ่มบันทึกใบเบิก ดูวิธีบันทึกและพิมพ์ด้านล่าง', '6-pdf')}
      </ol>
    </section>
    <section class="card help-sec" id="h-multi">
      <h2>เบิกหลายรายการในใบเบิกเดียว</h2>
      <div class="help-split">
        <img src="tour/4b-multi.jpg" alt="เลือกพัสดุ 3 รายการในใบเบิกเดียว" width="393" height="460" loading="lazy">
        <ul class="help-list">
          <li><b>เลือกได้หลายรายการ ไม่จำกัด</b> กด <b>+ เลือก</b> ที่พัสดุทุกชิ้นที่ต้องการ ก่อนกดยืนยัน</li>
          <li>ปรับจำนวนของ<b>แต่ละรายการ</b>แยกกันได้ด้วยปุ่ม − +</li>
          <li>แถบด้านล่างบอกจำนวนรวม เช่น <b>3 รายการ · 5 ชิ้น</b></li>
          <li>กดแถบ <b>ที่เลือก</b> เพื่อดูเฉพาะรายการที่เลือกไว้ ตรวจให้ครบก่อนยืนยัน</li>
          <li>กด <b>ยืนยันการเบิก</b> ครั้งเดียว จะได้ <b>ใบเบิก 1 ใบ</b> ที่มีครบทุกรายการ ไม่ต้องส่งทีละชิ้น</li>
        </ul>
      </div>
    </section>
    <section class="card help-sec" id="h-save">
      <h2>บันทึกและพิมพ์ใบเบิก (PDF)</h2>
      <button type="button" class="save-alert" data-save-demo>
        <span class="save-alert-ic" aria-hidden="true">${ICON.bell}</span>
        <span class="save-alert-txt"><b>ดูภาพสาธิตวิธีบันทึกไฟล์</b><span>สไลด์ภาพทีละขั้น สำหรับ iPhone และ Android</span></span>
        <span class="save-alert-go">ดูภาพ ›</span>
      </button>
      <p class="muted">หรืออ่านขั้นตอนแบบข้อความ เลือกอุปกรณ์ที่ใช้อยู่ (ระบบเลือกให้ตามเครื่องนี้แล้ว)</p>
      <div class="segmented big" id="help-dev" role="tablist">
        ${Object.entries(SAVE_GUIDE).map(([k, g]) => `<button type="button" role="tab" data-dev="${k}"><span class="l-long">${g.label}</span><span class="l-short" aria-hidden="true">${g.short}</span></button>`).join('')}
      </div>
      <div id="help-dev-body"></div>
    </section>
    <div class="help-end">
      <a class="btn primary lg" href="#/request">เริ่มเบิกพัสดุ</a>
      <p class="muted small">ลืมบันทึกไฟล์หรือไฟล์หาย แจ้งเจ้าหน้าที่พัสดุพร้อมเลขที่ใบเบิก เจ้าหน้าที่พัสดุดาวน์โหลดใบเบิกให้ใหม่ได้จากหน้าประวัติเบิก</p>
    </div>`);
  const drawDev = () => {
    const g = SAVE_GUIDE[dev];
    $$('#help-dev button').forEach((b) => { b.classList.toggle('active', b.dataset.dev === dev); b.setAttribute('aria-selected', String(b.dataset.dev === dev)); });
    $('#help-dev-body').innerHTML = `
      <div class="help-cols">
        <div class="help-box"><h3><span class="help-badge">1</span>บันทึกไฟล์ลงเครื่อง</h3><ol class="help-ol">${g.save.map((x) => `<li>${x}</li>`).join('')}</ol></div>
        <div class="help-box"><h3><span class="help-badge">2</span>พิมพ์ใบเบิก</h3><ol class="help-ol">${g.print.map((x) => `<li>${x}</li>`).join('')}</ol></div>
      </div>
      ${g.tips.length ? `<div class="help-tips"><b>เคล็ดลับ</b><ul>${g.tips.map((x) => `<li>${x}</li>`).join('')}</ul></div>` : ''}`;
  };
  $$('#help-dev button').forEach((b) => b.addEventListener('click', () => { dev = b.dataset.dev; drawDev(); }));
  drawDev();
  const go = (id) => {
    const el = document.getElementById(id);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + scrollY - $('#nav-bar').offsetHeight - 12, behavior: motionOK() ? 'smooth' : 'auto' });
  };
  $$('.help-toc [data-go]').forEach((b) => b.addEventListener('click', () => go(b.dataset.go)));
  $('.help-toc [data-tour]').addEventListener('click', showTour);
  $('[data-save-demo]').addEventListener('click', () => showSaveGuide());
  if (want === 'save') requestAnimationFrame(() => go('h-save'));
  scrollHint();
}

// ปุ่มลูกศรลอยด้านล่างจอ บอกว่าเลื่อนลงอ่านต่อได้ · เลื่อนแล้วย่อเหลือแค่ลูกศร · ถึงท้ายหน้าแล้วหายไป
// แตะ = เลื่อนลงทีละประมาณ 3/4 จอ · อยู่นอก #page (กันตำแหน่งเพี้ยนระหว่างแอนิเมชันเปลี่ยนหน้า) ลบทิ้งใน render()
function scrollHint() {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'scroll-hint';
  b.setAttribute('aria-label', 'เลื่อนลงอ่านต่อ');
  b.innerHTML = '<span class="scroll-hint-txt">เลื่อนลงอ่านต่อ</span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.7 8.3 5.3 9.7 12 16.4l6.7-6.7-1.4-1.4-5.3 5.3-5.3-5.3Z"/></svg>';
  document.body.append(b);
  const update = () => {
    if (!b.isConnected) { removeEventListener('scroll', update); removeEventListener('resize', update); return; }
    const left = document.documentElement.scrollHeight - (scrollY + innerHeight);
    b.classList.toggle('gone', left < 140);
    b.classList.toggle('mini', scrollY > 160);
  };
  addEventListener('scroll', update, { passive: true });
  addEventListener('resize', update);
  b.addEventListener('click', () => scrollBy({ top: Math.round(innerHeight * 0.75), behavior: motionOK() ? 'smooth' : 'auto' }));
  update();
}

// ===================== วิธีใช้งาน (ป๊อปอัปสอนใช้งาน) =====================
// แสดงเองทุกครั้งที่เปิดเว็บ (ปิดได้ทันทีด้วยปุ่ม ปิด) เปิดดูอีกได้ที่ปุ่ม ? มุมขวาบน ภาพประกอบอยู่ใน docs/tour/
const TOUR = [
  { img: '1-home', t: 'ยินดีต้อนรับสู่ระบบเบิกพัสดุ', d: 'เบิกพัสดุได้ง่าย ๆ ใน 4 ขั้นตอน ไม่ต้องเขียนใบเบิกเอง ระบบออกใบเบิกเป็นไฟล์ PDF ให้อัตโนมัติ' },
  { img: '2-start', t: 'ขั้นที่ 1 · กด "เบิกพัสดุ"', d: 'ที่หน้าแรกกดการ์ด เบิกพัสดุ (หรือเมนู เบิกพัสดุ ด้านบน)' },
  { img: '3-form', t: 'ขั้นที่ 2 · กรอกชื่อและเลือกแผนก', d: 'ใส่ชื่อ-นามสกุล แล้วเลือกแผนกของคุณ ครั้งต่อไประบบจำไว้ให้' },
  { img: '4-pick', t: 'ขั้นที่ 3 · เลือกพัสดุและจำนวน', d: 'พิมพ์ค้นหาหรือเลื่อนหา กด "+ เลือก" แล้วปรับจำนวนด้วยปุ่ม − +', note: '(พัสดุที่ขึ้นว่า "หมด" ก็กดเลือกเบิกได้ ระบบจะบันทึกยอดในคลังเป็นติดลบไว้ก่อน)' },
  { img: '4b-multi', t: 'เลือกได้หลายรายการในใบเบิกเดียว', d: 'กด "+ เลือก" ได้หลายรายการ และปรับจำนวนแต่ละรายการได้ แล้วกดยืนยันครั้งเดียว จะได้ใบเบิก 1 ใบที่มีครบทุกรายการ', note: 'กดแถบ "ที่เลือก" เพื่อตรวจรายการทั้งหมดก่อนยืนยัน' },
  { img: '5-confirm', t: 'ขั้นที่ 4 · กด "ยืนยันการเบิก"', d: 'ตรวจจำนวนรายการด้านล่าง แล้วกดปุ่มสีฟ้า ยืนยันการเบิก' },
  { img: '6-pdf', t: 'เสร็จแล้ว! บันทึกใบเบิก PDF', d: 'จะได้เลขที่เอกสาร กดปุ่ม บันทึก PDF (iPhone) หรือ ดาวน์โหลด PDF (Android/คอม) เพื่อเก็บไว้พิมพ์และลงลายมือชื่อ', link: ['#save-demo', 'ดูภาพสาธิตวิธีบันทึกไฟล์ iPhone / Android'] },
  { img: '7-stock', t: 'ดูยอดพัสดุคงเหลือ', d: 'เมนู พัสดุคงเหลือ แสดงยอดในคลังล่าสุด อัปเดตให้อัตโนมัติ เปิดวิธีใช้งานนี้อีกครั้งได้ที่ปุ่ม ? มุมขวาบน', link: ['#/help', 'อ่านวิธีใช้งานฉบับเต็ม (เมนู วิธีใช้งาน)'] },
];
// ป๊อปอัปสไลด์ภาพทีละขั้น ใช้ทั้ง "วิธีใช้งาน" และ "วิธีบันทึกใบเบิก"
// steps() คืนรายการขั้น { img, t, d, s?, note?, link? } · head = HTML เพิ่มเหนือภาพ · onClose เรียกทุกครั้งที่ปิด
// onFinish = กดปุ่มสุดท้าย (เรียกทันทีในจังหวะที่แตะ ใช้เปิดหน้าต่างบันทึกไฟล์ได้) แทน onClose
function slideDialog({ cls = '', label, steps, head = '', tag = '', finish = 'เริ่มใช้งาน', onClose, onFinish }) {
  if ($('dialog.tour')) return null;
  let i = 0;
  let list = steps();
  const d = document.createElement('dialog');
  d.className = `tour ${cls}`.trim();
  d.setAttribute('aria-label', label);
  d.innerHTML = `
    <button type="button" class="tour-x" aria-label="ปิด${label}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.4 5 5 6.4 10.6 12 5 17.6 6.4 19l5.6-5.6 5.6 5.6 1.4-1.4-5.6-5.6L19 6.4 17.6 5 12 10.6 6.4 5Z"/></svg>ปิด</button>
    ${head}
    <div class="tour-shot"><img alt="" width="393" height="460">${tag ? `<span class="tour-tag">${tag}</span>` : ''}</div>
    <div class="tour-body" aria-live="polite">
      <p class="tour-step"></p>
      <h3 class="tour-title"></h3>
      <p class="tour-text"></p>
      <p class="tour-note"></p>
      <a class="tour-link" href="#/help"></a>
    </div>
    <div class="tour-dots" aria-hidden="true"></div>
    <div class="tour-actions">
      <button type="button" class="btn lg" id="tour-back"></button>
      <button type="button" class="btn primary lg" id="tour-next"></button>
    </div>`;
  document.body.append(d);
  const img = $('img', d);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    const done = () => { d.close(); d.remove(); onClose?.(); };
    if (!motionOK()) return done();
    d.classList.add('closing');
    setTimeout(done, 220);
  };
  const draw = (dir = 0) => {
    const s = list[i];
    img.src = `tour/${s.img}.jpg`;
    img.alt = s.t;
    $('.tour-step', d).textContent = `${i + 1} / ${list.length}${s.s ? ` · ${s.s}` : ''}`;
    $('.tour-title', d).textContent = s.t;
    $('.tour-text', d).textContent = s.d;
    $('.tour-note', d).textContent = s.note || '';
    $('.tour-note', d).hidden = !s.note;
    const tl = $('.tour-link', d);
    tl.hidden = !s.link;
    if (s.link) { tl.href = s.link[0]; tl.textContent = s.link[1] + ' →'; }
    const dots = $('.tour-dots', d);
    if (dots.children.length !== list.length) dots.innerHTML = list.map(() => '<i></i>').join('');
    [...dots.children].forEach((dot, k) => dot.classList.toggle('on', k === i));
    $('#tour-back', d).textContent = i ? 'ย้อนกลับ' : 'ข้าม';
    $('#tour-next', d).textContent = i === list.length - 1 ? finish : 'ถัดไป';
    if (list[i + 1]) new Image().src = `tour/${list[i + 1].img}.jpg`; // โหลดภาพถัดไปรอไว้
    if (dir && motionOK()) {
      [$('.tour-shot', d), $('.tour-body', d)].forEach((el) => el.animate(
        [{ opacity: 0, transform: `translateX(${dir * 24}px)` }, { opacity: 1, transform: 'none' }],
        { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)' }));
    }
  };
  const go = (n) => {
    if (n >= list.length && onFinish) { onClose = null; close(); onFinish(); return; }
    if (n < 0 || n >= list.length) return close();
    const dir = n > i ? 1 : -1;
    i = n;
    draw(dir);
  };
  $('#tour-next', d).addEventListener('click', () => go(i + 1));
  $('#tour-back', d).addEventListener('click', () => (i ? go(i - 1) : close()));
  $('.tour-x', d).addEventListener('click', close);
  $('.tour-link', d).addEventListener('click', (e) => {
    e.preventDefault();
    const h = e.currentTarget.getAttribute('href');
    close();
    setTimeout(() => { if (h === '#save-demo') showSaveGuide(); else location.hash = h; }, 240);
  });
  d.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  d.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') go(i + 1);
    if (e.key === 'ArrowLeft' && i) go(i - 1);
  });
  // ปัดซ้าย/ขวาบนมือถือ
  let sx = null;
  d.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  d.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 50) { if (dx < 0) go(i + 1); else if (i) go(i - 1); }
  });
  draw();
  d.showModal();
  $('#tour-next', d).focus();
  return { d, reset: () => { list = steps(); i = 0; draw(1); } };
}
function showTour() {
  slideDialog({ label: 'วิธีใช้งาน', steps: () => TOUR });
}

// ===================== ภาพสาธิตวิธีบันทึกใบเบิก =====================
// ภาพจำลองหน้าจอ iPhone / Android / คอมพิวเตอร์ อยู่ใน docs/tour/save/ · เปิดเมื่อกด "ใช่" ตอนถามก่อนบันทึก PDF
const LINE_NOTE = 'เปิดจากลิงก์ใน LINE? แตะ ⋯ มุมบน → เปิดใน Safari / Chrome ก่อน';
const SAVE_DEMO = {
  ios: [
    { img: 'save/ios-1-button', s: 'บันทึกไฟล์', t: 'แตะปุ่ม "บันทึก PDF"', d: 'หลังเบิกเสร็จ รอจนปุ่มเป็นสีฟ้า (1–3 วินาที) แล้วแตะ บันทึก PDF', note: LINE_NOTE },
    { img: 'save/ios-2-share', s: 'บันทึกไฟล์', t: 'แตะ "บันทึกไปยังไฟล์"', d: 'หน้าต่างแชร์จะเลื่อนขึ้นมาจากด้านล่าง เลื่อนลงแล้วแตะ บันทึกไปยังไฟล์ (Save to Files)' },
    { img: 'save/ios-3-save', s: 'บันทึกไฟล์', t: 'เลือกโฟลเดอร์ แล้วแตะ "บันทึก"', d: 'เลือก บน iPhone ของฉัน → Downloads แล้วแตะ บันทึก มุมขวาบน' },
    { img: 'save/ios-4-filesapp', s: 'บันทึกไฟล์', t: 'เปิดดูไฟล์ได้ที่แอป "ไฟล์"', d: 'ไฟล์อยู่ในโฟลเดอร์ Downloads ชื่อตามเลขที่ใบเบิก เช่น WD69-001.pdf' },
    { img: 'save/ios-5-print', s: 'พิมพ์', t: 'ต้องการพิมพ์: แตะ "พิมพ์"', d: 'แตะ บันทึก PDF อีกครั้ง แล้วในหน้าต่างแชร์แตะ พิมพ์' },
    { img: 'save/ios-6-printopts', s: 'พิมพ์', t: 'เลือกเครื่องพิมพ์ แล้วแตะ "พิมพ์"', d: 'เลือกเครื่องพิมพ์ของหน่วยงาน (Wi-Fi เดียวกัน) ตั้ง 2 สำเนา แล้วแตะ พิมพ์ มุมขวาบน' },
  ],
  android: [
    { img: 'save/and-1-button', s: 'บันทึกไฟล์', t: 'แตะปุ่ม "ดาวน์โหลด PDF"', d: 'หลังเบิกเสร็จ รอจนปุ่มเป็นสีฟ้า (1–3 วินาที) แล้วแตะ ดาวน์โหลด PDF', note: LINE_NOTE },
    { img: 'save/and-2-download', s: 'บันทึกไฟล์', t: 'ดาวน์โหลดเสร็จ แตะ "เปิด"', d: 'แถบด้านล่างจอบอกว่าดาวน์โหลดแล้ว แตะ เปิด เพื่อดูใบเบิก' },
    { img: 'save/and-3-files', s: 'บันทึกไฟล์', t: 'ไฟล์อยู่ในโฟลเดอร์ "ดาวน์โหลด"', d: 'เปิดแอป Files / ไฟล์ของฉัน → ดาวน์โหลด ชื่อไฟล์คือเลขที่ใบเบิก เช่น WD69-001.pdf' },
    { img: 'save/and-4-menu', s: 'พิมพ์', t: 'ต้องการพิมพ์: แตะ ⋮ → "พิมพ์"', d: 'เปิดไฟล์ใบเบิก แตะ ⋮ มุมขวาบน แล้วแตะ พิมพ์' },
    { img: 'save/and-5-print', s: 'พิมพ์', t: 'เลือกเครื่องพิมพ์ แล้วแตะปุ่มพิมพ์', d: 'แตะแถบด้านบนเลือกเครื่องพิมพ์ของหน่วยงาน ตั้ง 2 สำเนา แล้วแตะปุ่มเครื่องพิมพ์สีน้ำเงิน' },
  ],
  pc: [
    { img: 'save/pc-1-button', s: 'บันทึกไฟล์', t: 'คลิกปุ่ม "ดาวน์โหลด PDF"', d: 'หลังเบิกเสร็จ รอจนปุ่มเป็นสีฟ้า (1–3 วินาที) แล้วคลิก ดาวน์โหลด PDF' },
    { img: 'save/pc-2-savedialog', s: 'บันทึกไฟล์', t: 'เลือกโฟลเดอร์ แล้วกด "บันทึก"', d: 'Chrome / Edge เปิดหน้าต่างบันทึก เลือกโฟลเดอร์ เช่น Downloads แล้วกด บันทึก (เบราว์เซอร์อื่นบันทึกลง Downloads ให้เอง)' },
    { img: 'save/pc-3-downloads', s: 'บันทึกไฟล์', t: 'เปิดไฟล์ใบเบิก', d: 'คลิกไอคอนดาวน์โหลดมุมขวาบนของเบราว์เซอร์ หรือเปิดโฟลเดอร์ Downloads แล้วดับเบิลคลิก WD69-001.pdf' },
    { img: 'save/pc-4-open', s: 'พิมพ์', t: 'ต้องการพิมพ์: กด Ctrl + P', d: 'เมื่อเปิดไฟล์แล้ว กด Ctrl + P (Mac: ⌘ + P) หรือคลิกไอคอนเครื่องพิมพ์มุมขวาบน' },
    { img: 'save/pc-5-print', s: 'พิมพ์', t: 'เลือกเครื่องพิมพ์ แล้วกด "พิมพ์"', d: 'เลือกเครื่องพิมพ์ของหน่วยงาน กระดาษ A4 จำนวน 2 ชุด แล้วกด พิมพ์' },
  ],
};
// onFinish = ปุ่มสุดท้าย "เข้าใจแล้ว บันทึกไฟล์เลย" บันทึกไฟล์ให้ทันที · point = ปิดแล้วชี้ไปที่ปุ่มบันทึก PDF
function showSaveGuide({ onFinish = null, point = false } = {}) {
  let dev = DEVICE;
  const ui = slideDialog({
    cls: 'save-guide',
    label: 'วิธีบันทึกใบเบิก',
    tag: 'ภาพจำลอง',
    finish: onFinish ? 'เข้าใจแล้ว บันทึกเลย' : 'เข้าใจแล้ว',
    onFinish,
    steps: () => SAVE_DEMO[dev],
    head: `
      <div class="save-head" role="alert">
        <span class="save-bell" aria-hidden="true">${ICON.bell}</span>
        <div><b>สำคัญ! บันทึกใบเบิกก่อนปิดหน้านี้</b><span>ดูภาพสาธิตทีละขั้น ใช้เวลาไม่ถึง 1 นาที</span></div>
      </div>
      <div class="save-bar">
        <div class="segmented save-dev" role="tablist" aria-label="อุปกรณ์">
          <button type="button" role="tab" data-dev="ios">iPhone</button>
          <button type="button" role="tab" data-dev="android">Android</button>
          <button type="button" role="tab" data-dev="pc">คอม</button>
        </div>
      </div>`,
    onClose: point ? pointToSave : null,
  });
  if (!ui) return;
  $('.save-bar', ui.d).append($('.tour-x', ui.d)); // ปุ่มปิดอยู่แถวเดียวกับแถบเลือกอุปกรณ์ หัวข้อสีแดงจะได้ไม่ถูกบัง
  const mark = () => $$('.save-dev button', ui.d).forEach((b) => {
    b.classList.toggle('active', b.dataset.dev === dev);
    b.setAttribute('aria-selected', String(b.dataset.dev === dev));
  });
  $$('.save-dev button', ui.d).forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.dev === dev) return;
    dev = b.dataset.dev;
    mark();
    ui.reset();
  }));
  mark();
}
// กระพริบปุ่มบันทึก PDF ในหน้าเบิกสำเร็จ
function pointToSave() {
  const b = $('#pdf-save');
  if (!b || !modalOpen()) return;
  b.classList.remove('attn');
  void b.offsetWidth;
  b.classList.add('attn');
  b.scrollIntoView({ block: 'nearest' });
}
// เสียงเตือนสั้น ๆ (ติ๊ง-ต่อง) — iPhone อนุญาตให้เล่นเสียงได้ต่อเมื่อเปิดระหว่างการแตะ จึงเตรียมไว้ตอนกดยืนยันการเบิก
let audioCtx = null;
function primeSound() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch { audioCtx = null; }
}
function alertSignal() {
  buzz([90, 60, 90]);
  if (!audioCtx || audioCtx.state !== 'running') return;
  try {
    const t = audioCtx.currentTime;
    [[880, 0], [660, 0.2]].forEach(([f, at]) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + at);
      g.gain.exponentialRampToValueAtTime(0.2, t + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.45);
      o.connect(g).connect(audioCtx.destination);
      o.start(t + at);
      o.stop(t + at + 0.5);
    });
  } catch { /* ไม่มีเสียงก็ไม่เป็นไร */ }
}
$('#btn-help').addEventListener('click', showTour);
// เปิดเองทุกครั้งที่เข้าเว็บ (ไม่แสดงซ้อนหน้าต่างอื่น · ข้ามเมื่อเป็นการทดสอบอัตโนมัติ)
function autoTour() {
  if (navigator.webdriver) return;
  if (modalOpen() || $('.hud')) { setTimeout(autoTour, 1500); return; }
  showTour();
  buzzWhenTouched($('dialog.tour'));
}
// สั่นเบา ๆ เตือนว่ามีป๊อปอัป · Android ใช้ Vibration API · iPhone (iOS 18+) ไม่มี API นี้
// จึงใช้สวิตช์ของ Safari ที่ทำให้เครื่องสั่นสั้น ๆ เมื่อถูกแตะ · ทั้งสองแบบต้องเกิดระหว่างที่ผู้ใช้แตะจอ
const BUZZ = [70, 60, 70];
function buzz(pattern = BUZZ) {
  if (!motionOK()) return;
  if (navigator.vibrate) { navigator.vibrate(pattern); return; }
  if (!PdfDoc.isIOS) return;
  const l = document.createElement('label');
  l.setAttribute('aria-hidden', 'true');
  l.style.display = 'none';
  l.innerHTML = '<input type="checkbox" switch>';
  document.head.append(l);
  l.click();
  l.remove();
}
// เบราว์เซอร์ยอมให้เว็บสั่นได้หลังผู้ใช้แตะหน้าเว็บแล้วเท่านั้น: ถ้าแตะแล้วสั่นทันที ไม่งั้นสั่นตอนแตะครั้งแรก (ยกเว้นแตะปุ่มปิด)
function buzzWhenTouched(d) {
  if (!d) return;
  if (navigator.vibrate && navigator.userActivation?.hasBeenActive) { buzz(); return; }
  const once = (e) => {
    document.removeEventListener('click', once, true);
    if (d.isConnected && !e.target.closest('.tour-x')) buzz();
  };
  document.addEventListener('click', once, true);
}

// ===================== Boot =====================
(async () => {
  renderMode();
  setTimeout(autoTour, 800);
  $('#page').innerHTML = '<div class="skel" role="status"><span class="vh">กำลังโหลดข้อมูล...</span><i class="sk sk-h1"></i><i class="sk sk-lead"></i><div class="sk-grid"><i class="sk sk-card"></i><i class="sk sk-card"></i></div></div>';
  // เปิดหน้าทันทีจากข้อมูลที่เก็บไว้ครั้งก่อน แล้วดึงยอดล่าสุดจาก Google Sheets ตามมา (ฟอร์มที่กรอกไว้ไม่หาย)
  if (!DEMO && !state.pin) {
    try {
      const cached = JSON.parse(lsGet(CACHE_KEY) || 'null');
      if (cached?.items?.length) {
        state.db = BorrowCore.normalize(cached);
        lastSnapshot = JSON.stringify(state.db);
        lastRoute = currentRoute();
        render(true);
        await syncFromSheet();
        return;
      }
    } catch { /* ใช้วิธีปกติด้านล่าง */ }
  }
  try {
    if (state.pin) {
      try { await store.act('checkPin'); } catch { state.pin = ''; sessionStorage.removeItem('pin'); renderMode(); }
    }
    if (!state.pin) await store.load();
    lastSnapshot = JSON.stringify(state.db);
    lastRoute = currentRoute();
    render(true);
  } catch (e) {
    $('#page').innerHTML = `<div class="card card-pad error">โหลดข้อมูลไม่สำเร็จ: ${esc(e.message)}<br>
      ตรวจสอบ API_URL ใน config.js และการ Deploy ของ Google Apps Script</div>`;
  }
})();
