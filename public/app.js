'use strict';

// ===================== State & helpers =====================
const state = {
  token: localStorage.getItem('token'),
  user: null,
  departments: [],
  categories: [],
  cart: [], // [{ item_id, qty }]
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isAdmin = () => state.user?.role === 'admin';

const STATUS = {
  pending: 'รออนุมัติ',
  borrowed: 'กำลังยืม',
  returned: 'คืนแล้ว',
  rejected: 'ไม่อนุมัติ',
  cancelled: 'ยกเลิก',
};
const MOVE = {
  receive: 'รับเข้า',
  borrow: 'ยืมออก',
  return: 'รับคืน',
  adjust: 'ปรับปรุงยอด',
  lost: 'ชำรุด/สูญหาย',
};

function localDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function fmtDate(s) {
  if (!s) return '-';
  const d = new Date(s.length === 10 ? s + 'T00:00:00' : s.replace(' ', 'T'));
  return d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' });
}

function fmtDateTime(s) {
  if (!s) return '-';
  const d = new Date(s.replace(' ', 'T'));
  return d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const fmtNum = (n) => Number(n || 0).toLocaleString('th-TH');

function statusPill(r) {
  if (r.status === 'borrowed' && r.is_overdue) return '<span class="pill overdue">เกินกำหนดคืน</span>';
  return `<span class="pill ${r.status}">${STATUS[r.status]}</span>`;
}

function movePill(m) {
  const cls = m.qty > 0 ? 'in' : m.type === 'lost' ? 'low' : 'out';
  return `<span class="pill ${cls}">${MOVE[m.type]}</span>`;
}

async function api(method, url, body) {
  const opts = { method, headers: {} };
  if (state.token) opts.headers.authorization = `Bearer ${state.token}`;
  if (body !== undefined) {
    if (typeof body === 'string') {
      opts.headers['content-type'] = 'text/csv';
      opts.body = body;
    } else {
      opts.headers['content-type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
  }
  const res = await fetch('/api' + url, opts);
  if (res.status === 401 && url !== '/login') {
    logout();
    throw new Error('หมดเวลาการใช้งาน กรุณาเข้าสู่ระบบใหม่');
  }
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(data?.error || `เกิดข้อผิดพลาด (${res.status})`);
  return data;
}

async function download(url) {
  const res = await fetch('/api' + url, { headers: { authorization: `Bearer ${state.token}` } });
  if (!res.ok) return toast('ดาวน์โหลดไม่สำเร็จ', true);
  const name = /filename="?([^"]+)"?/.exec(res.headers.get('content-disposition') || '')?.[1] || 'export.csv';
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(await res.blob()), download: name });
  a.click();
  URL.revokeObjectURL(a.href);
}

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
  const dlg = $('#modal');
  if (!dlg.open) dlg.showModal();
  return body;
}
const closeModal = () => $('#modal').close();

// ห่อ handler ให้แสดง error เป็น toast อัตโนมัติ
const safe = (fn) => async (...args) => {
  try { await fn(...args); } catch (e) { toast(e.message, true); }
};

function formData(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function deptOptions(selected, { blank } = {}) {
  return (blank ? `<option value="">${blank}</option>` : '') +
    state.departments.map((d) => `<option value="${d.id}" ${d.id == selected ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
}
function catOptions(selected, { blank } = {}) {
  return (blank ? `<option value="">${blank}</option>` : '') +
    state.categories.map((c) => `<option value="${c.id}" ${c.id == selected ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
}

async function loadMaster() {
  [state.departments, state.categories] = await Promise.all([api('GET', '/departments'), api('GET', '/categories')]);
}

// ===================== Auth =====================
function showLogin() {
  $('#app-view').hidden = true;
  $('#login-view').hidden = false;
  $('#login-form [name=username]').focus();
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('token');
  if ($('#modal').open) closeModal();
  showLogin();
}

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#login-error');
  err.hidden = true;
  try {
    const { token, user } = await api('POST', '/login', formData(e.target));
    state.token = token;
    state.user = user;
    localStorage.setItem('token', token);
    e.target.reset();
    await startApp();
  } catch (ex) {
    err.textContent = ex.message;
    err.hidden = false;
  }
});

$('#btn-logout').addEventListener('click', logout);

$('#btn-password').addEventListener('click', () => {
  const body = openModal('เปลี่ยนรหัสผ่าน', `
    <form id="pw-form" class="form-grid">
      <label class="full">รหัสผ่านเดิม<input type="password" name="old_password" required></label>
      <label class="full">รหัสผ่านใหม่ (อย่างน้อย 6 ตัวอักษร)<input type="password" name="new_password" minlength="6" required></label>
      <div class="form-actions full"><button class="btn primary">บันทึก</button></div>
    </form>`);
  $('#pw-form', body).addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    await api('POST', '/me/password', formData(e.target));
    closeModal();
    toast('เปลี่ยนรหัสผ่านเรียบร้อย');
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

function renderNav(badges = {}) {
  const links = [
    ['dashboard', 'ภาพรวม'],
    ['items', 'คลังอุปกรณ์'],
    ['borrow', 'ยืมอุปกรณ์', state.cart.length],
    ['requests', 'รายการยืม-คืน', badges.requests],
    ['movements', 'ประวัติสต็อก'],
    ['settings', 'ข้อมูลพื้นฐาน'],
  ].filter(([key]) => !ROUTES[key].admin || isAdmin());
  const current = currentRoute();
  $('#nav').innerHTML = links.map(([key, label, badge]) =>
    `<a href="#/${key}" class="${key === current ? 'active' : ''}">${label}${badge ? `<span class="badge">${badge}</span>` : ''}</a>`
  ).join('');
}

let lastBadges = {};
async function refreshBadges() {
  try {
    const d = await api('GET', '/dashboard');
    lastBadges = { requests: isAdmin() ? d.requests.pending + d.requests.overdue : d.requests.overdue };
  } catch { /* ignore */ }
  renderNav(lastBadges);
}

function currentRoute() {
  const key = location.hash.replace(/^#\//, '').split('?')[0];
  return ROUTES[key] && (!ROUTES[key].admin || isAdmin()) ? key : 'dashboard';
}

async function route() {
  if (!state.user) return;
  const key = currentRoute();
  const r = ROUTES[key];
  $('#page-title').textContent = r.title;
  $('#sidebar').classList.remove('open');
  window.reloadRequests = null;
  renderNav(lastBadges);
  const page = $('#page');
  page.innerHTML = '<div class="muted">กำลังโหลด...</div>';
  try {
    await r.render(page);
  } catch (e) {
    page.innerHTML = `<div class="card card-pad error">${esc(e.message)}</div>`;
  }
  refreshBadges();
}

window.addEventListener('hashchange', route);
$('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

async function startApp() {
  if (!state.user) state.user = await api('GET', '/me');
  await loadMaster();
  $('#login-view').hidden = true;
  $('#app-view').hidden = false;
  $('#user-name').textContent = state.user.full_name;
  $('#user-dept').textContent = `${state.user.department_name || '-'} · ${isAdmin() ? 'เจ้าหน้าที่คลัง' : 'ผู้ใช้หน่วยงาน'}`;
  await route();
}

// ===================== Dashboard =====================
async function renderDashboard(page) {
  const d = await api('GET', '/dashboard');
  const s = d.stock;
  page.innerHTML = `
    <div class="stats">
      <a class="card stat" href="#/items"><div class="label">อุปกรณ์ในระบบ</div>
        <div class="value">${fmtNum(s.item_count)}</div><div class="sub">รายการ · รวม ${fmtNum(s.total_qty)} หน่วย</div></a>
      <a class="card stat ok" href="#/items"><div class="label">พร้อมให้ยืม (คงเหลือ)</div>
        <div class="value">${fmtNum(s.available_qty)}</div><div class="sub">หน่วย</div></a>
      <a class="card stat" href="#/requests?status=borrowed"><div class="label">กำลังถูกยืม</div>
        <div class="value">${fmtNum(s.borrowed_qty)}</div><div class="sub">หน่วย · ${fmtNum(d.requests.borrowed)} คำขอ</div></a>
      <a class="card stat warn" href="#/requests?status=pending"><div class="label">รออนุมัติ</div>
        <div class="value">${fmtNum(d.requests.pending)}</div><div class="sub">คำขอ</div></a>
      <a class="card stat danger" href="#/requests?status=overdue"><div class="label">เกินกำหนดคืน</div>
        <div class="value">${fmtNum(d.requests.overdue)}</div><div class="sub">คำขอ</div></a>
    </div>

    <div class="grid-2">
      <section class="card">
        <div class="card-head"><h3>สต็อกใกล้หมด / ต่ำกว่าจุดขั้นต่ำ</h3><a href="#/items?low=1" class="link">ดูทั้งหมด</a></div>
        <div class="table-wrap"><table>
          <thead><tr><th>อุปกรณ์</th><th class="num">คงเหลือ</th><th class="num">ขั้นต่ำ</th></tr></thead>
          <tbody>${d.low_stock.map((i) => `
            <tr class="clickable" data-item="${i.id}"><td>${esc(i.name)}<div class="muted small">${esc(i.code)}</div></td>
            <td class="num"><span class="pill low">${fmtNum(i.available_qty)} / ${fmtNum(i.total_qty)}</span></td>
            <td class="num">${fmtNum(i.min_qty)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">สต็อกทุกรายการอยู่ในระดับปกติ</td></tr>'}
          </tbody></table></div>
      </section>

      <section class="card">
        <div class="card-head"><h3>เกินกำหนดคืน</h3><a href="#/requests?status=overdue" class="link">ดูทั้งหมด</a></div>
        <div class="table-wrap"><table>
          <thead><tr><th>เลขที่ / ผู้ยืม</th><th>กำหนดคืน</th><th class="num">เกิน</th></tr></thead>
          <tbody>${d.overdue.map((r) => `
            <tr class="clickable" data-request="${r.id}"><td>${esc(r.request_no)}<div class="muted small">${esc(r.borrower_name)} · ${esc(r.department_name)}</div></td>
            <td>${fmtDate(r.due_date)}</td><td class="num"><span class="pill overdue">${r.days_overdue} วัน</span></td></tr>`).join('') || '<tr><td colspan="3" class="empty">ไม่มีรายการเกินกำหนด</td></tr>'}
          </tbody></table></div>
      </section>
    </div>

    <section class="card">
      <div class="card-head"><h3>ความเคลื่อนไหวสต็อกล่าสุด</h3>${isAdmin() ? '<a href="#/movements" class="link">ดูทั้งหมด</a>' : ''}</div>
      <div class="table-wrap"><table>
        <thead><tr><th>วันเวลา</th><th>อุปกรณ์</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th>อ้างอิง</th></tr></thead>
        <tbody>${d.recent_movements.map((m) => `
          <tr><td>${fmtDateTime(m.created_at)}</td><td>${esc(m.item_name)}</td><td>${movePill(m)}</td>
          <td class="num">${m.qty > 0 ? '+' : ''}${fmtNum(m.qty)}</td><td class="num">${fmtNum(m.available_after)}</td>
          <td>${esc(m.request_no || '')}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">ยังไม่มีข้อมูล</td></tr>'}
        </tbody></table></div>
    </section>`;
  bindRowClicks(page);
}

function bindRowClicks(root) {
  $$('[data-item]', root).forEach((tr) => tr.addEventListener('click', () => showItem(tr.dataset.item)));
  $$('[data-request]', root).forEach((tr) => tr.addEventListener('click', () => showRequest(tr.dataset.request)));
}

function hashParams() {
  return new URLSearchParams(location.hash.split('?')[1] || '');
}

// ===================== Items / Stock =====================
async function renderItems(page) {
  const params = hashParams();
  page.innerHTML = `
    <div class="card card-pad toolbar">
      <input type="search" id="f-q" placeholder="ค้นหาชื่อ รหัส หรือสถานที่เก็บ..." value="${esc(params.get('q') || '')}">
      <select id="f-cat">${catOptions(params.get('category_id'), { blank: 'ทุกหมวดหมู่' })}</select>
      <label class="checkbox"><input type="checkbox" id="f-low" ${params.get('low') === '1' ? 'checked' : ''}> เฉพาะสต็อกต่ำ</label>
      <span class="spacer"></span>
      <button class="btn" id="btn-export">ส่งออก CSV</button>
      ${isAdmin() ? '<button class="btn" id="btn-import">นำเข้า CSV</button><button class="btn primary" id="btn-add">+ เพิ่มอุปกรณ์</button>' : ''}
    </div>
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th>รหัส</th><th>อุปกรณ์</th><th>หมวดหมู่</th><th class="num">คงเหลือ / ทั้งหมด</th><th class="num">ถูกยืม</th><th>สถานที่เก็บ</th><th></th></tr></thead>
      <tbody id="items-body"></tbody>
    </table></div></section>`;

  const load = safe(async () => {
    const qs = new URLSearchParams();
    if ($('#f-q').value) qs.set('q', $('#f-q').value);
    if ($('#f-cat').value) qs.set('category_id', $('#f-cat').value);
    if ($('#f-low').checked) qs.set('low', '1');
    history.replaceState(null, '', `#/items${qs.toString() ? '?' + qs : ''}`);
    const items = await api('GET', '/items?' + qs);
    $('#items-body').innerHTML = items.map((i) => {
      const low = i.available_qty <= i.min_qty;
      const pct = i.total_qty ? Math.round((i.available_qty / i.total_qty) * 100) : 0;
      return `<tr class="clickable" data-item="${i.id}">
        <td>${esc(i.code)}</td>
        <td>${esc(i.name)}${low ? ' <span class="pill low">สต็อกต่ำ</span>' : ''}</td>
        <td>${esc(i.category_name || '-')}</td>
        <td class="num"><strong>${fmtNum(i.available_qty)}</strong> / ${fmtNum(i.total_qty)} ${esc(i.unit)}
          <div class="qty-bar ${low ? 'low' : ''}"><span style="width:${pct}%"></span></div></td>
        <td class="num">${fmtNum(i.borrowed_qty)}</td>
        <td>${esc(i.location || '-')}</td>
        <td><button class="btn sm primary" data-add-cart="${i.id}" ${i.available_qty > 0 ? '' : 'disabled'}>ยืม</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="7" class="empty">ไม่พบรายการ</td></tr>';
    bindRowClicks($('#items-body'));
    $$('[data-add-cart]').forEach((b) => b.addEventListener('click', (e) => {
      e.stopPropagation();
      addToCart(Number(b.dataset.addCart));
    }));
  });

  let timer;
  $('#f-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  $('#f-cat').addEventListener('change', load);
  $('#f-low').addEventListener('change', load);
  $('#btn-export').addEventListener('click', () => download('/items/export.csv?' + (location.hash.split('?')[1] || '')));
  if (isAdmin()) {
    $('#btn-add').addEventListener('click', () => itemForm(null, load));
    $('#btn-import').addEventListener('click', () => importForm(load));
  }
  await load();
}

function addToCart(itemId) {
  const line = state.cart.find((l) => l.item_id === itemId);
  if (line) line.qty++;
  else state.cart.push({ item_id: itemId, qty: 1 });
  renderNav(lastBadges);
  toast('เพิ่มในรายการยืมแล้ว — ไปที่เมนู "ยืมอุปกรณ์" เพื่อส่งคำขอ');
}

async function showItem(id, afterChange) {
  const i = await api('GET', '/items/' + id);
  const body = openModal(`${i.code} · ${i.name}`, `
    <dl class="info">
      <dt>หมวดหมู่</dt><dd>${esc(i.category_name || '-')}</dd>
      <dt>คงเหลือในคลัง</dt><dd><strong>${fmtNum(i.available_qty)}</strong> ${esc(i.unit)}
        ${i.available_qty <= i.min_qty ? '<span class="pill low">ต่ำกว่าจุดขั้นต่ำ</span>' : ''}</dd>
      <dt>ถูกยืมอยู่</dt><dd>${fmtNum(i.borrowed_qty)} ${esc(i.unit)}</dd>
      <dt>จำนวนทั้งหมด</dt><dd>${fmtNum(i.total_qty)} ${esc(i.unit)}</dd>
      <dt>จุดสั่งซื้อขั้นต่ำ</dt><dd>${fmtNum(i.min_qty)} ${esc(i.unit)}</dd>
      <dt>สถานที่เก็บ</dt><dd>${esc(i.location || '-')}</dd>
      ${i.description ? `<dt>รายละเอียด</dt><dd>${esc(i.description)}</dd>` : ''}
      ${i.active ? '' : '<dt>สถานะ</dt><dd><span class="pill cancelled">ปิดใช้งาน</span></dd>'}
    </dl>
    <div class="toolbar">
      <button class="btn primary" id="i-cart" ${i.available_qty > 0 ? '' : 'disabled'}>เพิ่มในรายการยืม</button>
      ${isAdmin() ? `
        <button class="btn ok" data-stock="receive">รับเข้า</button>
        <button class="btn" data-stock="adjust">ตรวจนับ/ปรับยอด</button>
        <button class="btn" data-stock="lost">ตัดชำรุด/สูญหาย</button>
        <button class="btn" id="i-edit">แก้ไขข้อมูล</button>` : ''}
    </div>
    <h4 style="margin:6px 0 0">ผู้ที่กำลังยืม</h4>
    <div class="table-wrap card"><table>
      <thead><tr><th>เลขที่</th><th>ผู้ยืม / หน่วยงาน</th><th>กำหนดคืน</th><th class="num">ค้างคืน</th></tr></thead>
      <tbody>${i.borrowers.map((b) => `<tr class="clickable" data-request="${b.id}"><td>${esc(b.request_no)}</td>
        <td>${esc(b.borrower_name)}<div class="muted small">${esc(b.department_name)}</div></td>
        <td>${fmtDate(b.due_date)}</td><td class="num">${fmtNum(b.outstanding)}</td></tr>`).join('') ||
        '<tr><td colspan="4" class="empty">ไม่มี</td></tr>'}</tbody>
    </table></div>
    <h4 style="margin:6px 0 0">ประวัติสต็อก (100 รายการล่าสุด)</h4>
    <div class="table-wrap card"><table>
      <thead><tr><th>วันเวลา</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th>อ้างอิง / หมายเหตุ</th></tr></thead>
      <tbody>${i.movements.map((m) => `<tr><td>${fmtDateTime(m.created_at)}</td><td>${movePill(m)}</td>
        <td class="num">${m.qty > 0 ? '+' : ''}${fmtNum(m.qty)}</td><td class="num">${fmtNum(m.available_after)}</td>
        <td>${esc(m.request_no || m.note || '')}<div class="muted small">${esc(m.user_name || '')}</div></td></tr>`).join('') ||
        '<tr><td colspan="5" class="empty">ไม่มี</td></tr>'}</tbody>
    </table></div>`);

  const refresh = () => { showItem(id, afterChange); afterChange?.(); };
  $('#i-cart', body).addEventListener('click', () => { addToCart(i.id); closeModal(); });
  bindRowClicks(body);
  if (isAdmin()) {
    $('#i-edit', body).addEventListener('click', () => itemForm(i, refresh));
    $$('[data-stock]', body).forEach((b) => b.addEventListener('click', () => stockForm(i, b.dataset.stock, refresh)));
  }
}

function itemForm(item, done) {
  const body = openModal(item ? 'แก้ไขข้อมูลอุปกรณ์' : 'เพิ่มอุปกรณ์ใหม่', `
    <form id="item-form" class="form-grid">
      <label>รหัสอุปกรณ์ *<input name="code" required value="${esc(item?.code)}"></label>
      <label>หน่วยนับ<input name="unit" value="${esc(item?.unit || 'ชิ้น')}"></label>
      <label class="full">ชื่ออุปกรณ์ *<input name="name" required value="${esc(item?.name)}"></label>
      <label>หมวดหมู่<select name="category_id">${catOptions(item?.category_id, { blank: '- ไม่ระบุ -' })}</select></label>
      <label>จุดสั่งซื้อขั้นต่ำ (แจ้งเตือนเมื่อคงเหลือ ≤)<input name="min_qty" type="number" min="0" value="${item?.min_qty ?? 0}"></label>
      ${item ? '' : '<label>จำนวนเริ่มต้น<input name="initial_qty" type="number" min="0" value="0"></label>'}
      <label class="${item ? 'full' : ''}">สถานที่เก็บ<input name="location" value="${esc(item?.location)}"></label>
      <label class="full">รายละเอียด / Serial No.<textarea name="description">${esc(item?.description)}</textarea></label>
      ${item ? `<label class="checkbox full"><input type="checkbox" name="active" ${item.active ? 'checked' : ''}> เปิดใช้งาน (ให้ยืมได้)</label>` : ''}
      <div class="form-actions full"><button class="btn primary">บันทึก</button></div>
    </form>`);
  $('#item-form', body).addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const data = formData(e.target);
    if (item) {
      data.active = !!e.target.active.checked;
      await api('PUT', '/items/' + item.id, data);
    } else {
      await api('POST', '/items', data);
    }
    toast('บันทึกเรียบร้อย');
    closeModal();
    done?.();
  }));
}

function stockForm(item, type, done) {
  const titles = { receive: 'รับเข้าสต็อก', adjust: 'ตรวจนับ / ปรับยอดคงเหลือ', lost: 'ตัดชำรุด / สูญหาย' };
  const field = type === 'adjust'
    ? `<label class="full">ยอดคงเหลือในคลังที่นับได้จริง (${esc(item.unit)})<input name="counted_qty" type="number" min="0" required value="${item.available_qty}"></label>
       <p class="muted small full" style="margin:0">ยอดในระบบปัจจุบัน ${fmtNum(item.available_qty)} ${esc(item.unit)} — ไม่รวม ${fmtNum(item.borrowed_qty)} ${esc(item.unit)} ที่ถูกยืมอยู่</p>`
    : `<label class="full">จำนวน (${esc(item.unit)})<input name="qty" type="number" min="1" ${type === 'lost' ? `max="${item.available_qty}"` : ''} required></label>`;
  const body = openModal(`${titles[type]} · ${item.name}`, `
    <form id="stock-form" class="form-grid">
      ${field}
      <label class="full">หมายเหตุ / เลขที่เอกสาร<input name="note" placeholder="${type === 'receive' ? 'เช่น เลขที่ใบส่งของ, ผู้จำหน่าย' : ''}"></label>
      <div class="form-actions full"><button class="btn primary">บันทึก</button></div>
    </form>`);
  $('#stock-form', body).addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    await api('POST', `/items/${item.id}/stock`, { type, ...formData(e.target) });
    toast('ปรับปรุงสต็อกเรียบร้อย');
    done?.();
  }));
}

function importForm(done) {
  const body = openModal('นำเข้าข้อมูลสต็อกจาก CSV', `
    <p class="muted" style="margin:0">ใช้สำหรับเชื่อม/อัปเดตยอดจากระบบคลังเดิมหรือไฟล์ Excel (บันทึกเป็น CSV UTF-8)
      คอลัมน์ตามลำดับ: <strong>รหัส, ชื่อ, หมวดหมู่, หน่วย, จำนวนทั้งหมด, จุดสั่งซื้อขั้นต่ำ, สถานที่เก็บ</strong><br>
      รหัสที่มีอยู่แล้วจะถูกอัปเดตยอดรวม (บันทึกเป็นการปรับปรุงยอด) รหัสใหม่จะถูกเพิ่มเป็นอุปกรณ์ใหม่</p>
    <form id="import-form" class="form-grid">
      <label class="full">เลือกไฟล์ CSV<input type="file" name="file" accept=".csv,text/csv" required></label>
      <div class="form-actions full"><button class="btn primary">นำเข้า</button></div>
    </form>
    <div id="import-result"></div>`);
  $('#import-form', body).addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    const text = await e.target.file.files[0].text();
    const r = await api('POST', '/items/import', text);
    $('#import-result', body).innerHTML = `
      <div class="card card-pad">เพิ่มใหม่ ${r.created} รายการ · อัปเดต ${r.updated} รายการ
      ${r.errors.length ? `<ul class="error">${r.errors.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>`;
    done?.();
  }));
}

// ===================== Borrow form =====================
async function renderBorrow(page) {
  const items = await api('GET', '/items');
  const byId = new Map(items.map((i) => [i.id, i]));
  state.cart = state.cart.filter((l) => byId.has(l.item_id));

  page.innerHTML = `
    <form id="borrow-form" class="grid-2" style="align-items:start">
      <section class="card card-pad">
        <h3 style="margin-bottom:14px">ข้อมูลผู้ยืม</h3>
        <div class="form-grid">
          <label class="full">ชื่อผู้ยืม *<input name="borrower_name" required value="${esc(state.user.full_name)}"></label>
          <label>เบอร์โทร / เบอร์ภายใน<input name="borrower_phone"></label>
          <label>หน่วยงาน *${isAdmin()
            ? `<select name="department_id" required>${deptOptions(state.user.department_id)}</select>`
            : `<input value="${esc(state.user.department_name || '-')}" disabled>`}</label>
          <label>วันที่ยืม *<input type="date" name="borrow_date" required value="${localDate()}"></label>
          <label>กำหนดคืน *<input type="date" name="due_date" required value="${localDate(7)}"></label>
          <label class="full">วัตถุประสงค์ / ใช้กับผู้ป่วย<input name="purpose" placeholder="เช่น ผู้ป่วยเตียง 12 ต้องใช้ Infusion pump"></label>
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
        <div class="form-actions"><button class="btn primary" id="submit-borrow">ส่งคำขอยืม</button></div>
      </section>
    </form>`;

  function drawCart() {
    $('#cart').innerHTML = state.cart.map((l, idx) => {
      const i = byId.get(l.item_id);
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
      renderNav(lastBadges);
    }));
  }
  drawCart();

  $('#pick-add').addEventListener('click', () => {
    const id = Number($('#pick-item').value);
    if (!id) return;
    if (!state.cart.some((l) => l.item_id === id)) state.cart.push({ item_id: id, qty: 1 });
    $('#pick-item').value = '';
    drawCart();
    renderNav(lastBadges);
  });

  $('#borrow-form').addEventListener('submit', safe(async (e) => {
    e.preventDefault();
    if (!state.cart.length) throw new Error('กรุณาเลือกอุปกรณ์อย่างน้อย 1 รายการ');
    const data = formData(e.target);
    data.issue_now = !!e.target.issue_now?.checked;
    data.items = state.cart;
    const r = await api('POST', '/requests', data);
    state.cart = [];
    toast(`บันทึกคำขอ ${r.request_no} เรียบร้อย`);
    location.hash = '#/requests';
    showRequest(r.id);
  }));
}

// ===================== Requests =====================
async function renderRequests(page) {
  const params = hashParams();
  let status = params.get('status') || '';
  const tabs = [['', 'ทั้งหมด'], ['pending', 'รออนุมัติ'], ['borrowed', 'กำลังยืม'], ['overdue', 'เกินกำหนดคืน'],
    ['returned', 'คืนแล้ว'], ['rejected', 'ไม่อนุมัติ'], ['cancelled', 'ยกเลิก']];
  page.innerHTML = `
    <div class="card card-pad toolbar">
      <div class="tabs" id="tabs">${tabs.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div>
      <span class="spacer"></span>
      <input type="search" id="r-q" placeholder="ค้นหาเลขที่ ผู้ยืม หรืออุปกรณ์..." style="max-width:280px">
      <button class="btn" id="r-export">ส่งออก CSV</button>
    </div>
    <section class="card"><div class="table-wrap"><table>
      <thead><tr><th>เลขที่</th><th>ผู้ยืม / หน่วยงาน</th><th>อุปกรณ์</th><th>วันที่ยืม</th><th>กำหนดคืน</th><th>สถานะ</th></tr></thead>
      <tbody id="req-body"></tbody>
    </table></div></section>`;

  const load = safe(async () => {
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === status));
    history.replaceState(null, '', `#/requests${status ? '?status=' + status : ''}`);
    const qs = new URLSearchParams();
    if (status === 'overdue') qs.set('overdue', '1');
    else if (status) qs.set('status', status);
    if ($('#r-q').value) qs.set('q', $('#r-q').value);
    const rows = await api('GET', '/requests?' + qs);
    $('#req-body').innerHTML = rows.map((r) => `
      <tr class="clickable" data-request="${r.id}">
        <td><strong>${esc(r.request_no)}</strong><div class="muted small">${fmtDateTime(r.created_at)}</div></td>
        <td>${esc(r.borrower_name)}<div class="muted small">${esc(r.department_name)}</div></td>
        <td>${esc(r.item_summary)}</td>
        <td>${fmtDate(r.borrow_date)}</td>
        <td>${fmtDate(r.due_date)}</td>
        <td>${statusPill(r)}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="empty">ไม่พบรายการ</td></tr>';
    bindRowClicks($('#req-body'));
  });

  $$('#tabs button').forEach((b) => b.addEventListener('click', () => { status = b.dataset.tab; load(); }));
  let timer;
  $('#r-q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(load, 250); });
  $('#r-export').addEventListener('click', () => download('/requests-export.csv'));
  window.reloadRequests = load;
  await load();
}

async function showRequest(id) {
  const r = await api('GET', '/requests/' + id);
  const outstanding = (l) => l.qty - l.returned_qty - l.lost_qty;
  const canReturn = isAdmin() && r.status === 'borrowed';
  const body = openModal(`คำขอยืม ${r.request_no}`, `
    <div>${statusPill(r)}</div>
    <dl class="info">
      <dt>ผู้ยืม</dt><dd>${esc(r.borrower_name)} ${r.borrower_phone ? `(โทร ${esc(r.borrower_phone)})` : ''}</dd>
      <dt>หน่วยงาน</dt><dd>${esc(r.department_name)}</dd>
      <dt>วันที่ยืม</dt><dd>${fmtDate(r.borrow_date)}</dd>
      <dt>กำหนดคืน</dt><dd>${fmtDate(r.due_date)}</dd>
      ${r.purpose ? `<dt>วัตถุประสงค์</dt><dd>${esc(r.purpose)}</dd>` : ''}
      ${r.note ? `<dt>หมายเหตุ</dt><dd>${esc(r.note)}</dd>` : ''}
      <dt>ผู้บันทึก</dt><dd>${esc(r.created_by_name || '-')} · ${fmtDateTime(r.created_at)}</dd>
      ${r.approved_by_name ? `<dt>${r.status === 'rejected' ? 'ผู้ปฏิเสธ' : 'ผู้อนุมัติ/จ่าย'}</dt><dd>${esc(r.approved_by_name)} · ${fmtDateTime(r.approved_at)}</dd>` : ''}
      ${r.returned_at ? `<dt>คืนครบเมื่อ</dt><dd>${fmtDateTime(r.returned_at)}</dd>` : ''}
    </dl>
    <form id="return-form">
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
      ${canReturn ? '<label style="margin-top:10px">หมายเหตุการคืน<input name="note" placeholder="เช่น สภาพปกติ / สายชำรุด"></label>' : ''}
    </form>
    <div class="toolbar">
      <button class="btn" id="rq-print">พิมพ์ใบยืม</button>
      <span class="spacer"></span>
      ${r.status === 'pending' ? '<button class="btn" id="rq-cancel">ยกเลิกคำขอ</button>' : ''}
      ${isAdmin() && r.status === 'pending' ? '<button class="btn danger" id="rq-reject">ไม่อนุมัติ</button><button class="btn ok" id="rq-approve">อนุมัติและจ่ายอุปกรณ์</button>' : ''}
      ${canReturn ? '<button class="btn primary" id="rq-return">บันทึกรับคืน</button>' : ''}
    </div>`);

  const after = (msg) => { toast(msg); showRequest(id); window.reloadRequests?.(); refreshBadges(); };
  $('#rq-print', body).addEventListener('click', () => printRequest(r));
  $('#rq-cancel', body)?.addEventListener('click', safe(async () => {
    if (!confirm('ยืนยันยกเลิกคำขอนี้?')) return;
    await api('POST', `/requests/${id}/cancel`);
    after('ยกเลิกคำขอแล้ว');
  }));
  $('#rq-approve', body)?.addEventListener('click', safe(async () => {
    await api('POST', `/requests/${id}/approve`);
    after('อนุมัติและตัดสต็อกเรียบร้อย');
  }));
  $('#rq-reject', body)?.addEventListener('click', safe(async () => {
    const note = prompt('เหตุผลที่ไม่อนุมัติ (ถ้ามี)');
    if (note === null) return;
    await api('POST', `/requests/${id}/reject`, { note });
    after('บันทึกไม่อนุมัติแล้ว');
  }));
  $('#rq-return', body)?.addEventListener('click', safe(async () => {
    const items = r.items.map((l) => ({
      item_id: l.item_id,
      returned_qty: Number($(`[data-ret="${l.item_id}"]`, body).value) || 0,
      lost_qty: Number($(`[data-lost="${l.item_id}"]`, body).value) || 0,
    }));
    await api('POST', `/requests/${id}/return`, { items, note: $('#return-form', body).note.value });
    after('บันทึกรับคืนและคืนสต็อกเรียบร้อย');
  }));
}

function printRequest(r) {
  $('#print-area').innerHTML = `
    <h2>ใบยืมอุปกรณ์</h2>
    <p style="text-align:center">เลขที่ ${esc(r.request_no)} · สถานะ: ${STATUS[r.status]}</p>
    <p>ผู้ยืม: <strong>${esc(r.borrower_name)}</strong> ${r.borrower_phone ? `โทร ${esc(r.borrower_phone)}` : ''}<br>
      หน่วยงาน: ${esc(r.department_name)}<br>
      วันที่ยืม: ${fmtDate(r.borrow_date)} &nbsp; กำหนดคืน: ${fmtDate(r.due_date)}<br>
      ${r.purpose ? `วัตถุประสงค์: ${esc(r.purpose)}` : ''}</p>
    <table><thead><tr><th>ลำดับ</th><th>รหัส</th><th>รายการ</th><th>จำนวน</th><th>คืนแล้ว</th></tr></thead>
      <tbody>${r.items.map((l, i) => `<tr><td>${i + 1}</td><td>${esc(l.code)}</td><td>${esc(l.name)}</td>
        <td>${l.qty} ${esc(l.unit)}</td><td>${l.returned_qty}</td></tr>`).join('')}</tbody></table>
    <div class="sign-row">
      <div>ลงชื่อ ...................................... ผู้ยืม<br>(${esc(r.borrower_name)})</div>
      <div>ลงชื่อ ...................................... ผู้จ่าย<br>(${esc(r.approved_by_name || '..............................')})</div>
    </div>`;
  window.print();
}

// ===================== Movements =====================
async function renderMovements(page) {
  const items = await api('GET', '/items?all=1');
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
      <thead><tr><th>วันเวลา</th><th>อุปกรณ์</th><th>ประเภท</th><th class="num">จำนวน</th><th class="num">คงเหลือ</th><th class="num">ยอดรวม</th><th>อ้างอิง / หมายเหตุ</th><th>ผู้ทำรายการ</th></tr></thead>
      <tbody id="m-body"></tbody>
    </table></div></section>`;
  const qs = () => new URLSearchParams(Object.entries({
    item_id: $('#m-item').value, type: $('#m-type').value, from: $('#m-from').value, to: $('#m-to').value,
  }).filter(([, v]) => v));
  const load = safe(async () => {
    const rows = await api('GET', '/movements?' + qs());
    $('#m-body').innerHTML = rows.map((m) => `<tr>
      <td>${fmtDateTime(m.created_at)}</td><td>${esc(m.item_name)}<div class="muted small">${esc(m.code)}</div></td>
      <td>${movePill(m)}</td><td class="num">${m.qty > 0 ? '+' : ''}${fmtNum(m.qty)}</td>
      <td class="num">${fmtNum(m.available_after)}</td><td class="num">${fmtNum(m.total_after)}</td>
      <td>${esc(m.request_no || '')} ${m.note && m.note !== m.request_no ? `<div class="muted small">${esc(m.note)}</div>` : ''}</td>
      <td>${esc(m.user_name || '')}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">ไม่พบรายการ</td></tr>';
  });
  ['#m-item', '#m-type', '#m-from', '#m-to'].forEach((s) => $(s).addEventListener('change', load));
  $('#m-export').addEventListener('click', () => download('/movements-export.csv?' + qs()));
  await load();
}

// ===================== Settings (master data) =====================
async function renderSettings(page) {
  await loadMaster();
  const users = await api('GET', '/users');
  page.innerHTML = `
    <div class="grid-2" style="align-items:start">
      <section class="card">
        <div class="card-head"><h3>หน่วยงาน / แผนก</h3><button class="btn sm primary" id="add-dept">+ เพิ่ม</button></div>
        <div class="table-wrap"><table><thead><tr><th>ชื่อหน่วยงาน</th><th>เบอร์ภายใน</th><th></th></tr></thead>
          <tbody>${state.departments.map((d) => `<tr><td>${esc(d.name)}</td><td>${esc(d.phone || '-')}</td>
            <td class="num"><button class="link" data-edit-dept="${d.id}">แก้ไข</button> · <button class="link" data-del-dept="${d.id}">ลบ</button></td></tr>`).join('')}</tbody>
        </table></div>
      </section>
      <section class="card">
        <div class="card-head"><h3>หมวดหมู่อุปกรณ์</h3><button class="btn sm primary" id="add-cat">+ เพิ่ม</button></div>
        <div class="table-wrap"><table><thead><tr><th>ชื่อหมวดหมู่</th><th></th></tr></thead>
          <tbody>${state.categories.map((c) => `<tr><td>${esc(c.name)}</td>
            <td class="num"><button class="link" data-edit-cat="${c.id}">แก้ไข</button> · <button class="link" data-del-cat="${c.id}">ลบ</button></td></tr>`).join('')}</tbody>
        </table></div>
      </section>
    </div>
    <section class="card">
      <div class="card-head"><h3>ผู้ใช้งาน</h3><button class="btn sm primary" id="add-user">+ เพิ่มผู้ใช้</button></div>
      <div class="table-wrap"><table><thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ-นามสกุล</th><th>หน่วยงาน</th><th>สิทธิ์</th><th>สถานะ</th><th></th></tr></thead>
        <tbody>${users.map((u) => `<tr><td>${esc(u.username)}</td><td>${esc(u.full_name)}</td><td>${esc(u.department_name || '-')}</td>
          <td>${u.role === 'admin' ? 'เจ้าหน้าที่คลัง (อนุมัติ/จัดการสต็อก)' : 'ผู้ใช้หน่วยงาน (ขอยืม)'}</td>
          <td>${u.active ? '<span class="pill returned">ใช้งาน</span>' : '<span class="pill cancelled">ปิดใช้งาน</span>'}</td>
          <td class="num"><button class="link" data-edit-user="${u.id}">แก้ไข</button></td></tr>`).join('')}</tbody>
      </table></div>
    </section>`;

  const reload = () => renderSettings(page);

  function simpleForm(kind, rec) {
    const isDept = kind === 'departments';
    const body = openModal(`${rec ? 'แก้ไข' : 'เพิ่ม'}${isDept ? 'หน่วยงาน' : 'หมวดหมู่'}`, `
      <form id="simple-form" class="form-grid">
        <label class="full">ชื่อ *<input name="name" required value="${esc(rec?.name)}"></label>
        ${isDept ? `<label class="full">เบอร์ภายใน<input name="phone" value="${esc(rec?.phone)}"></label>` : ''}
        <div class="form-actions full"><button class="btn primary">บันทึก</button></div>
      </form>`);
    $('#simple-form', body).addEventListener('submit', safe(async (e) => {
      e.preventDefault();
      await api(rec ? 'PUT' : 'POST', `/${kind}${rec ? '/' + rec.id : ''}`, formData(e.target));
      closeModal();
      toast('บันทึกเรียบร้อย');
      reload();
    }));
  }

  function userForm(u) {
    const body = openModal(u ? 'แก้ไขผู้ใช้' : 'เพิ่มผู้ใช้', `
      <form id="user-form" class="form-grid">
        <label>ชื่อผู้ใช้ *<input name="username" required value="${esc(u?.username)}" ${u ? 'disabled' : ''}></label>
        <label>${u ? 'รหัสผ่านใหม่ (เว้นว่างถ้าไม่เปลี่ยน)' : 'รหัสผ่าน *'}<input name="password" type="password" minlength="6" ${u ? '' : 'required'}></label>
        <label class="full">ชื่อ-นามสกุล *<input name="full_name" required value="${esc(u?.full_name)}"></label>
        <label>หน่วยงาน<select name="department_id">${deptOptions(u?.department_id, { blank: '- ไม่ระบุ -' })}</select></label>
        <label>สิทธิ์<select name="role">
          <option value="staff" ${u?.role === 'staff' ? 'selected' : ''}>ผู้ใช้หน่วยงาน (ขอยืม)</option>
          <option value="admin" ${u?.role === 'admin' ? 'selected' : ''}>เจ้าหน้าที่คลัง (อนุมัติ/จัดการสต็อก)</option>
        </select></label>
        ${u ? `<label class="checkbox full"><input type="checkbox" name="active" ${u.active ? 'checked' : ''}> เปิดใช้งาน</label>` : ''}
        <div class="form-actions full"><button class="btn primary">บันทึก</button></div>
      </form>`);
    $('#user-form', body).addEventListener('submit', safe(async (e) => {
      e.preventDefault();
      const data = formData(e.target);
      if (u) {
        data.active = e.target.active.checked;
        await api('PUT', '/users/' + u.id, data);
      } else {
        await api('POST', '/users', data);
      }
      closeModal();
      toast('บันทึกเรียบร้อย');
      reload();
    }));
  }

  $('#add-dept').addEventListener('click', () => simpleForm('departments'));
  $('#add-cat').addEventListener('click', () => simpleForm('categories'));
  $('#add-user').addEventListener('click', () => userForm());
  $$('[data-edit-dept]').forEach((b) => b.addEventListener('click', () => simpleForm('departments', state.departments.find((d) => d.id == b.dataset.editDept))));
  $$('[data-edit-cat]').forEach((b) => b.addEventListener('click', () => simpleForm('categories', state.categories.find((c) => c.id == b.dataset.editCat))));
  $$('[data-edit-user]').forEach((b) => b.addEventListener('click', () => userForm(users.find((u) => u.id == b.dataset.editUser))));
  for (const [attr, kind] of [['del-dept', 'departments'], ['del-cat', 'categories']]) {
    $$(`[data-${attr}]`).forEach((b) => b.addEventListener('click', safe(async () => {
      if (!confirm('ยืนยันการลบ?')) return;
      await api('DELETE', `/${kind}/${b.getAttribute('data-' + attr)}`);
      toast('ลบเรียบร้อย');
      reload();
    })));
  }
}

// ===================== Boot =====================
(async () => {
  if (!state.token) return showLogin();
  try {
    await startApp();
  } catch {
    logout();
  }
})();
