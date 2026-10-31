'use strict';

/*
 * สร้างใบเบิกพัสดุและสรุปรายเดือนเป็น PDF ในเบราว์เซอร์
 * ใช้ html2pdf.js (html2canvas + jsPDF) ให้เบราว์เซอร์วาดภาษาไทยเอง สระและวรรณยุกต์จึงไม่เพี้ยน
 * ไลบรารีอยู่ใน vendor/ และโหลดเมื่อต้องสร้าง PDF ครั้งแรกเท่านั้น
 */
const PdfDoc = (() => {
  const LIB_URL = 'vendor/html2pdf.bundle.min.js';
  const MIN_ROWS = 8; // เติมแถวว่างให้ตารางดูเป็นแบบฟอร์ม
  let libPromise = null;
  // iPadOS แสดงตัวเองเป็น Mac จึงต้องดูจากจอสัมผัสด้วย
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const thaiDate = (s) => (s ? new Date(s.slice(0, 10) + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '-');
  // วันเวลาถึงวินาที เช่น 24 ต.ค. 2569 09:15:42 (ข้อมูลเก่าที่ไม่มีวินาทีแสดงแค่นาที)
  const thaiDateTime = (s) => {
    const d = new Date(String(s).replace(' ', 'T'));
    const sec = /\d{2}:\d{2}:\d{2}/.test(s);
    return isNaN(d) ? s : d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', ...(sec ? { second: '2-digit' } : {}) });
  };
  const thaiTime = (s) => (/\d{2}:\d{2}(:\d{2})?/.exec(s || '') || [''])[0];

  const money = (n) => Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // จำนวนเงินเป็นตัวอักษร เช่น 1,250.50 → หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์ (แบบ BAHTTEXT ของ Excel)
  const DIGIT = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  const PLACE = ['', 'สิบ', 'ร้อย', 'พัน', 'หมื่น', 'แสน'];
  function readThai(x) {
    x = String(x).replace(/^0+/, '');
    if (!x) return '';
    if (x.length > 6) return readThai(x.slice(0, -6)) + 'ล้าน' + readThai(x.slice(-6));
    let out = '';
    for (let i = 0; i < x.length; i++) {
      const d = Number(x[i]);
      const pos = x.length - i - 1;
      if (!d) continue;
      if (pos === 1 && d === 1) out += 'สิบ';
      else if (pos === 1 && d === 2) out += 'ยี่สิบ';
      else if (pos === 0 && d === 1 && x.length > 1) out += 'เอ็ด';
      else out += DIGIT[d] + PLACE[pos];
    }
    return out;
  }
  function bahtText(n) {
    const satang = Math.round(Number(n || 0) * 100);
    if (!satang) return 'ศูนย์บาทถ้วน';
    const baht = Math.floor(satang / 100);
    const st = satang % 100;
    return (baht ? readThai(baht) + 'บาท' : '') + (st ? readThai(st) + 'สตางค์' : 'ถ้วน');
  }

  function loadLib() {
    if (window.html2pdf) return Promise.resolve();
    libPromise ||= new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = LIB_URL;
      s.onload = resolve;
      s.onerror = () => { libPromise = null; reject(new Error('โหลดตัวสร้าง PDF ไม่สำเร็จ กรุณาลองใหม่')); };
      document.head.appendChild(s);
    });
    return libPromise;
  }

  // r = requestView() จาก app.js (มี items พร้อมชื่อ/หน่วย) · staff = ชื่อเจ้าหน้าที่พัสดุในช่องลงชื่อ
  function template(r, org, staff) {
    const rows = r.items.map((l, i) => `<tr>
      <td class="c">${i + 1}</td><td>${esc(l.code)}</td><td>${esc(l.name)}</td>
      <td class="r">${Number(l.qty).toLocaleString('th-TH')}</td><td class="c">${esc(l.unit)}</td>
      <td class="r">${l.price > 0 ? money(l.price) : '-'}</td><td class="r">${l.price > 0 ? money(l.value) : '-'}</td></tr>`);
    for (let i = rows.length; i < MIN_ROWS; i++) rows.push('<tr class="blank"><td></td><td></td><td></td><td></td><td></td><td></td><td></td></tr>');
    const total = r.total || 0;
    const dept = esc(r.department_full || r.department);
    const statement = `ข้าพเจ้าขอเบิกพัสดุตามรายการต่อไปนี้ เพื่อใช้ใน${dept}`;
    // วันที่ใต้ช่องลงชื่อทั้งสองฝั่ง = วันที่เบิก เช่น 24 / 10 / 2569
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(r.created_at || '');
    const signDate = ymd ? `${Number(ymd[3])} / ${Number(ymd[2])} / ${Number(ymd[1]) + 543}` : '........ / ........ / ........';
    const sign = (role, name) => `<div class="pdf-sign-box">
      <div>ลงชื่อ .......................................... ${role}</div>
      <div>( ${name ? esc(name) : '..........................................'} )</div>
      <div>วันที่ ${signDate}</div></div>`;
    return `<div class="pdf-page">
      <div class="pdf-head">
        <div><div class="pdf-org">${esc(org || 'ระบบเบิกพัสดุ')}</div>
          <div class="pdf-title">ใบเบิกพัสดุ</div></div>
        <div class="pdf-meta"><div>เลขที่ <b>${esc(r.request_no)}</b></div><div>วันที่ ${thaiDate(r.created_at)}</div><div>เวลา ${esc(thaiTime(r.created_at))} น.</div>
          ${r.edited_at ? `<div class="pdf-edited">ฉบับแก้ไข ${esc(thaiDateTime(r.edited_at))} น.</div>` : ''}</div>
      </div>
      <table class="pdf-info">
        <tr><th>ชื่อผู้เบิก</th><td>${esc(r.borrower_name)}</td><th>แผนก</th><td>${dept}</td></tr>
        <tr><th>วันเวลาที่เบิก</th><td colspan="3">${esc(thaiDateTime(r.created_at))} น.</td></tr>
        ${r.note || r.purpose ? `<tr><th>หมายเหตุ</th><td colspan="3">${esc([r.purpose, r.note].filter(Boolean).join(' · '))}</td></tr>` : ''}
      </table>
      <p class="pdf-statement">${statement}</p>
      <table class="pdf-items">
        <thead><tr><th style="width:8%">ลำดับ</th><th style="width:13%">รหัส</th><th>รายการ</th>
          <th style="width:9%">จำนวน</th><th style="width:9%">หน่วย</th><th style="width:13%">ราคา/หน่วย</th><th style="width:14%">จำนวนเงิน</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
        <tfoot><tr class="pdf-total"><td colspan="5" class="c">( ${bahtText(total)} )</td><th>รวมเป็นเงิน</th><td class="r"><b>${money(total)}</b></td></tr></tfoot>
      </table>
      <div class="pdf-sign">${sign('ผู้เบิก', r.borrower_name)}${sign('เจ้าหน้าที่พัสดุ', staff)}</div>
      <div class="pdf-foot">ออกโดยระบบเบิกพัสดุ · บันทึกเมื่อ ${esc(thaiDateTime(r.created_at))}${r.edited_at ? ` · แก้ไขล่าสุด ${esc(thaiDateTime(r.edited_at))}` : ''}</div>
    </div>`;
  }

  // ภาษาไทยไม่เว้นวรรคระหว่างคำ html2canvas จึงตัดบรรทัดภาษาไทยไม่ได้ (ข้อความที่ขึ้นบรรทัดใหม่ถูกวาดซ้อนกันบรรทัดเดียว)
  // ใส่ตัวแบ่งคำที่มองไม่เห็น (U+200B) ระหว่างคำด้วยตัวตัดคำภาษาไทยของเบราว์เซอร์ ก่อนวาด
  const THAI = /[\u0E00-\u0E7F]/;
  function markThaiWords(root) {
    if (typeof Intl === 'undefined' || !Intl.Segmenter) return;
    const seg = new Intl.Segmenter('th', { granularity: 'word' });
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) if (THAI.test(walker.currentNode.nodeValue)) nodes.push(walker.currentNode);
    nodes.forEach((n) => { n.nodeValue = [...seg.segment(n.nodeValue)].map((x) => x.segment).join('\u200B'); });
  }

  // ---------- แบ่งหน้า A4 เอง ----------
  // เนื้อหาเรียงเป็นบล็อก (หัวกระดาษ ตาราง หัวข้อ ช่องลงชื่อ) ใส่ทีละบล็อกลงแผ่นสูง 1 หน้า
  // ตารางยาวเกินหน้า: ตัดแบ่งทีละแถว แล้ว**ใส่หัวตารางซ้ำ**ทุกหน้า (พร้อมหัวข้อ "(ต่อ)") · ช่องลงชื่อไม่ถูกตัดครึ่ง ย้ายไปหน้าถัดไปทั้งบล็อก
  // บล็อก .pdf-pagefoot (เช่น ช่องลงชื่อกรรมการ) แสดงซ้ำท้ายทุกหน้า
  function paginate(stage, src) {
    const foot = src.querySelector(':scope > .pdf-pagefoot');
    foot?.remove();
    const blocks = [...src.children];
    src.remove();
    const pages = [];
    let page, bottom;
    const newPage = () => {
      const sheet = src.cloneNode(false);
      sheet.classList.add('pdf-sheet');
      stage.appendChild(sheet);
      pages.push(sheet);
      if (foot) {
        // เนื้อหาอยู่ในกล่องด้านบน ช่องท้ายหน้าอยู่ล่างสุด
        sheet.classList.add('has-foot');
        page = document.createElement('div');
        page.className = 'pdf-body';
        sheet.append(page, foot.cloneNode(true));
        bottom = page.getBoundingClientRect().bottom;
        return;
      }
      page = sheet;
      const r = page.getBoundingClientRect();
      bottom = r.top + page.clientHeight - parseFloat(getComputedStyle(page).paddingBottom);
    };
    const fits = (el) => el.getBoundingClientRect().bottom <= bottom + 0.5;
    // หัวข้อที่อยู่ท้ายหน้า ย้ายไปพร้อมเนื้อหาของมัน
    const takeHeading = () => {
      const prev = page.lastElementChild;
      if (prev && prev.matches('.pdf-h2')) { prev.remove(); return prev; }
      return null;
    };
    const moveToNewPage = (el) => {
      el.remove();
      const h = takeHeading();
      newPage();
      if (h) page.appendChild(h);
      page.appendChild(el);
    };
    let title = '';
    const splitTable = (t) => {
      const body = t.tBodies[0];
      const rows = [...body.rows];
      const foot = t.tFoot;
      body.innerHTML = '';
      if (foot) foot.remove();
      const shell = () => {
        const c = t.cloneNode(false);
        const cols = t.querySelector(':scope > colgroup');
        if (cols) c.appendChild(cols.cloneNode(true)); // ความกว้างคอลัมน์เท่าหน้าแรก
        if (t.tHead) c.appendChild(t.tHead.cloneNode(true));
        c.appendChild(document.createElement('tbody'));
        return c;
      };
      const continued = () => {
        newPage();
        if (title) page.insertAdjacentHTML('beforeend', `<div class="pdf-cont">${esc(title)} (ต่อ)</div>`);
        const c = shell();
        page.appendChild(c);
        return c;
      };
      let cur = t;
      for (const r of rows) {
        cur.tBodies[0].appendChild(r);
        if (fits(cur)) continue;
        r.remove();
        if (!cur.tBodies[0].rows.length && page.children.length > 1) { moveToNewPage(cur); cur.tBodies[0].appendChild(r); continue; }
        if (!cur.tBodies[0].rows.length) { cur.tBodies[0].appendChild(r); continue; } // แถวเดียวยาวเกินหน้า: ปล่อยไว้
        cur = continued();
        cur.tBodies[0].appendChild(r);
      }
      if (foot) {
        cur.appendChild(foot);
        if (!fits(cur)) {
          // แถวรวมไม่พอ: ยกแถวสุดท้ายไปหน้าใหม่พร้อมแถวรวม
          foot.remove();
          const last = cur.tBodies[0].lastElementChild;
          if (last && cur.tBodies[0].rows.length > 1) last.remove();
          cur = continued();
          if (last && !last.isConnected) cur.tBodies[0].appendChild(last);
          cur.appendChild(foot);
        }
      }
    };
    newPage();
    for (const b of blocks) {
      if (b.matches('.pdf-h2')) title = (b.firstChild?.textContent || '').trim();
      page.appendChild(b);
      if (fits(b)) continue;
      if (b.tagName === 'TABLE' && b.tBodies[0]?.rows.length && !b.classList.contains('pdf-keep')) splitTable(b);
      else if (page.children.length > 1) moveToNewPage(b);
    }
    return pages;
  }

  // แปลง HTML เป็น PDF (A4) ทีละหน้า · เลขหน้ามุมขวาล่างเมื่อมีหลายหน้า
  // ตัวเลขที่ยาวเกินช่อง (เช่น มูลค่าหลักแสน) ย่อตัวอักษรเฉพาะช่องนั้นให้พอดี ช่องอื่นคงขนาดเดิม · อ่านขนาดทุกช่องก่อนแล้วค่อยแก้ (คำนวณ layout รอบเดียว)
  function fitCells(root, selector, min = 11) {
    const cells = [...root.querySelectorAll(selector)];
    const over = cells.map((td) => {
      const pad = parseFloat(getComputedStyle(td).paddingLeft) + parseFloat(getComputedStyle(td).paddingRight);
      return td.scrollWidth > td.clientWidth + 0.5 ? (td.clientWidth - pad) / (td.scrollWidth - pad) : 0;
    });
    cells.forEach((td, i) => {
      if (!over[i]) return;
      const size = parseFloat(getComputedStyle(td).fontSize);
      td.style.fontSize = Math.max(min, Math.floor(size * over[i] * 2) / 2 - 0.5) + 'px';
    });
  }

  async function render(html, { pageNumbers = false, landscape = false } = {}) {
    await loadLib();
    const fonts = ['400 16px Sarabun', '600 16px Sarabun', '700 16px Sarabun'];
    if (html.includes('pdf-ledger')) fonts.push('400 16px "TH SarabunPSK"', '700 16px "TH SarabunPSK"');
    await Promise.all(fonts.map((f) => document.fonts.load(f, 'กขค 0123').catch(() => null)));
    const stage = document.createElement('div');
    stage.className = 'pdf-stage';
    stage.innerHTML = html;
    markThaiWords(stage);
    document.body.appendChild(stage);
    try {
      fitCells(stage, '.lg-table td.r');
      const pages = paginate(stage, stage.firstElementChild);
      const opt = {
        margin: 0,
        image: { type: 'jpeg', quality: 0.96 },
        // scrollX/scrollY = 0 ป้องกันเนื้อหาเลื่อนลงในกระดาษเมื่อหน้าเว็บถูกเลื่อนอยู่
        html2canvas: { scale: 2, backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: landscape ? 'landscape' : 'portrait' },
      };
      const W = landscape ? 297 : 210, H = landscape ? 210 : 297;
      const pdf = await window.html2pdf().set(opt).from(pages[0]).toPdf().get('pdf');
      for (const page of pages.slice(1)) {
        const canvas = await window.html2pdf().set(opt).from(page).toCanvas().get('canvas');
        pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/jpeg', 0.96), 'JPEG', 0, 0, W, (canvas.height * W) / canvas.width);
      }
      const n = pdf.internal.getNumberOfPages();
      if (pageNumbers || n > 1) {
        for (let i = 1; i <= n; i++) {
          pdf.setPage(i);
          pdf.setFontSize(9);
          pdf.setTextColor(120);
          pdf.text(`${i} / ${n}`, W - 14, H - 7, { align: 'right' });
        }
      }
      return pdf.output('blob');
    } finally {
      stage.remove();
    }
  }

  const build = (r, org, staff) => render(template(r, org, staff));

  // ---------- สรุปรายเดือน / รายปี ----------
  const num = (n) => Number(n || 0).toLocaleString('th-TH');
  const monthName = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

  // sum = BorrowCore.monthlySummary(db, 'YYYY-MM' | 'YYYY', แผนก) · extra = { deptFull(name), lines(r) -> [{name, qty, unit}], staff = ชื่อผู้จัดทำรายงาน }
  function reportTemplate(sum, org, extra) {
    const t = sum.totals;
    const dept = sum.department;
    const empty = (cols) => `<tr><td colspan="${cols}" class="c muted">ไม่มีรายการ</td></tr>`;
    const stat = (label, value, sub) => `<td><div class="pdf-stat-l">${label}</div><div class="pdf-stat-v">${value}</div><div class="pdf-stat-s">${sub}</div></td>`;
    const period = sum.yearly ? `ประจำปี พ.ศ. ${Number(sum.period) + 543}` : `ประจำเดือน${monthName(sum.period)}`;
    let n = 0;
    const h2 = (title, note = '') => `<h2 class="pdf-h2">${++n}. ${title}${note ? ` <span>${note}</span>` : ''}</h2>`;
    const sections = [];
    sections.push(`${h2('พัสดุที่ถูกเบิก', '(เรียงจากจำนวนมากไปน้อย · ราคาต่อหน่วย ณ วันที่เบิก)')}
      <table class="pdf-grid"><thead><tr><th style="width:6%">ลำดับ</th><th style="width:11%">รหัส</th><th>รายการ</th>
        <th style="width:9%">จำนวน</th><th style="width:8%">หน่วย</th><th style="width:8%">ใบเบิก</th><th style="width:12%">ราคา/หน่วย</th><th style="width:14%">มูลค่า (บาท)</th></tr></thead>
        <tbody>${sum.withdrawn.map((x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(x.code)}</td><td>${esc(x.name)}</td>
          <td class="r">${num(x.qty)}</td><td class="c">${esc(x.unit)}</td><td class="r">${num(x.times)}</td>
          <td class="r">${x.price ? money(x.price) : '-'}</td><td class="r">${x.value ? money(x.value) : '-'}</td></tr>`).join('') || empty(8)}</tbody>
        <tfoot><tr class="pdf-total"><th colspan="3">รวมทั้งสิ้น</th><td class="r">${num(t.withdraw_qty)}</td><td></td><td class="r">${num(t.withdraw_docs)}</td><td></td><td class="r"><b>${money(t.withdraw_value)}</b></td></tr></tfoot></table>`);
    if (sum.yearly) {
      sections.push(`${h2('สรุปรายเดือน')}
      <table class="pdf-grid"><thead><tr><th>เดือน</th><th style="width:16%">ใบเบิก</th><th style="width:18%">หน่วยที่เบิก</th><th style="width:20%">มูลค่า (บาท)</th></tr></thead>
        <tbody>${sum.months.map((m) => `<tr><td>${esc(monthName(m.month))}</td><td class="r">${num(m.withdraw_docs)}</td>
          <td class="r">${num(m.withdraw_qty)}</td><td class="r">${money(m.withdraw_value)}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="pdf-total"><th>รวมทั้งปี</th><td class="r">${num(t.withdraw_docs)}</td><td class="r">${num(t.withdraw_qty)}</td><td class="r"><b>${money(t.withdraw_value)}</b></td></tr></tfoot></table>`);
    }
    if (!dept) {
      sections.push(`${h2('สรุปตามแผนก', '(เรียงจากจำนวนมากไปน้อย)')}
      <table class="pdf-grid"><thead><tr><th>แผนก</th><th style="width:16%">ใบเบิก</th><th style="width:18%">หน่วยที่เบิก</th><th style="width:20%">มูลค่า (บาท)</th></tr></thead>
        <tbody>${sum.departments.map((d) => `<tr><td>${esc(extra.deptFull(d.name))}</td><td class="r">${num(d.withdraw_docs)}</td>
          <td class="r">${num(d.withdraw_qty)}</td><td class="r">${money(d.withdraw_value)}</td></tr>`).join('') || empty(4)}</tbody></table>`);
    }
    sections.push(`${h2('รายการใบเบิกทั้งหมด')}
      <table class="pdf-grid pdf-small"><thead><tr><th style="width:16%">วันเวลาที่เบิก</th><th style="width:11%">เลขที่</th>
        <th style="width:16%">ผู้เบิก</th>${dept ? '' : '<th style="width:11%">แผนก</th>'}<th>พัสดุ</th><th style="width:12%">มูลค่า (บาท)</th></tr></thead>
        <tbody>${sum.requests.map((r) => `<tr><td>${esc(thaiDateTime(r.created_at)).replace(/ (\d{1,2}:\d{2}(:\d{2})?)$/, '<br>$1')}</td><td>${esc(r.request_no)}</td>
          <td>${esc(r.borrower_name)}</td>${dept ? '' : `<td>${esc(r.department)}</td>`}
          <td>${extra.lines(r).map((l) => `${esc(l.name)} ×${num(l.qty)} ${esc(l.unit)}`).join('<br>')}</td><td class="r">${money(sum.values[r.id])}</td></tr>`).join('') || empty(dept ? 5 : 6)}</tbody></table>`);
    return `<div class="pdf-report">
      <div class="pdf-head">
        <div><div class="pdf-org">${esc(org || 'ระบบเบิกพัสดุ')}</div>
          <div class="pdf-title">สรุปการเบิกพัสดุ ${esc(period)}</div>
          ${dept ? `<div class="pdf-sub">แผนก ${esc(extra.deptFull(dept))}</div>` : ''}</div>
        <div class="pdf-meta">ข้อมูล ณ ${esc(thaiDateTime(extra.generatedAt))}</div>
      </div>
      <table class="pdf-stats pdf-keep"><tr>
        ${stat('ใบเบิก', num(t.withdraw_docs) + ' ใบ', sum.yearly ? 'ทั้งปี' : 'ทั้งเดือน')}
        ${stat('จำนวนที่เบิก', num(t.withdraw_qty) + ' หน่วย', num(sum.withdrawn.length) + ' รายการพัสดุ')}
        ${stat('มูลค่ารวม', money(t.withdraw_value), 'บาท')}
        ${dept ? stat('ผู้เบิก', num(new Set(sum.requests.map((r) => r.borrower_name)).size) + ' คน', 'ในแผนกนี้') : stat('แผนก', num(sum.departments.length) + ' แผนก', 'ที่มาเบิก')}
      </tr></table>
      <p class="pdf-baht">มูลค่าการเบิกรวม ${money(t.withdraw_value)} บาท ( ${bahtText(t.withdraw_value)} )</p>
      ${sections.join('\n')}

      <div class="pdf-sign pdf-keep">
        <div class="pdf-sign-box"><div>ลงชื่อ .......................................... ผู้จัดทำรายงาน</div>
          <div>( ${extra.staff ? esc(extra.staff) : '..........................................'} )</div><div>วันที่ ........ / ........ / ........</div></div>
        <div class="pdf-sign-box"><div>ลงชื่อ .......................................... หัวหน้างานพัสดุ</div>
          <div>( .......................................... )</div><div>วันที่ ........ / ........ / ........</div></div>
      </div>
    </div>`;
  }

  const buildReport = (sum, org, extra) => render(reportTemplate(sum, org, extra), { pageNumbers: true });
  // ชื่อไฟล์ภาษาอังกฤษ: เบราว์เซอร์บางตัวตัดชื่อไฟล์ภาษาไทยเหลือ "download"
  // summary-2569-10.pdf · summary-2569.pdf (รายปี) · summary-2569-10-ICU.pdf / summary-2569-10-dept3.pdf (เฉพาะแผนก)
  function reportFileName(sum, deptNo) {
    const p = typeof sum === 'string' ? sum : sum.period;
    const dept = typeof sum === 'string' ? '' : sum.department;
    const slug = dept ? '-' + (dept.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'dept' + (deptNo || '')) : '';
    return `summary-${Number(p.slice(0, 4)) + 543}${p.length > 4 ? '-' + p.slice(5, 7) : ''}${slug}.pdf`;
  }

  // ---------- รายงานพัสดุคงเหลือ (รายเดือน / รายปี) ----------
  // sum = BorrowCore.stockSummary() · extra = { generatedAt, asOf (YYYY-MM-DD ยอด ณ วันที่), staff }
  function stockTemplate(sum, org, extra) {
    const t = sum.totals;
    const period = sum.yearly ? `ประจำปี พ.ศ. ${Number(sum.period) + 543}` : `ประจำเดือน${monthName(sum.period)}`;
    const empty = (cols) => `<tr><td colspan="${cols}" class="c muted">ไม่มีรายการ</td></tr>`;
    const stat = (label, value, sub) => `<td><div class="pdf-stat-l">${label}</div><div class="pdf-stat-v">${value}</div><div class="pdf-stat-s">${sub}</div></td>`;
    const m = (v) => (v ? money(v) : '-');
    return `<div class="pdf-report">
      <div class="pdf-head">
        <div><div class="pdf-org">${esc(org || 'ระบบเบิกพัสดุ')}</div>
          <div class="pdf-title">รายงานพัสดุคงเหลือ ${esc(period)}</div>
          <div class="pdf-sub">ยอดคงเหลือ ณ วันที่ ${esc(thaiDate(extra.asOf))}</div></div>
        <div class="pdf-meta">ข้อมูล ณ ${esc(thaiDateTime(extra.generatedAt))}</div>
      </div>
      <table class="pdf-stats pdf-keep"><tr>
        ${stat('จ่ายออก', num(t.issued_qty) + ' หน่วย', num(t.issued_items) + ' รายการพัสดุ')}
        ${stat('มูลค่าที่จ่ายออก', money(t.issued_value), 'บาท')}
        ${stat('คงเหลือ', num(t.balance_qty) + ' หน่วย', num(t.items) + ' รายการพัสดุ')}
        ${stat('มูลค่าคงเหลือ', money(t.balance_value), 'บาท')}
      </tr></table>
      <p class="pdf-baht">จ่ายออกรวม ${money(t.issued_value)} บาท ( ${bahtText(t.issued_value)} ) · คงเหลือรวม ${money(t.balance_value)} บาท ( ${bahtText(t.balance_value)} )</p>

      <h2 class="pdf-h2">1. พัสดุที่จ่ายออก <span>(เรียงจากจำนวนมากไปน้อย · มูลค่าตามราคา ณ วันที่เบิก)</span></h2>
      <table class="pdf-grid"><thead><tr><th style="width:6%">ลำดับ</th><th style="width:11%">รหัส</th><th>รายการ</th>
        <th style="width:8%">หน่วย</th><th style="width:12%">ราคา/หน่วย</th><th style="width:10%">จ่ายออก</th><th style="width:14%">มูลค่า (บาท)</th></tr></thead>
        <tbody>${sum.issued.map((x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td class="c">${esc(x.unit)}</td>
          <td class="r">${m(x.price)}</td><td class="r">${num(x.issued)}</td><td class="r">${m(x.issued_value)}</td></tr>`).join('') || empty(7)}</tbody>
        <tfoot><tr class="pdf-total"><th colspan="5">รวมจ่ายออก</th><td class="r">${num(t.issued_qty)}</td><td class="r"><b>${money(t.issued_value)}</b></td></tr></tfoot></table>

      <h2 class="pdf-h2">2. ยอดคงเหลือทุกรายการ <span>(ณ สิ้นงวด · มูลค่าตามราคาปัจจุบัน)</span></h2>
      <table class="pdf-grid pdf-small"><thead><tr><th style="width:5%">ลำดับ</th><th style="width:10%">รหัส</th><th>รายการ</th>
        <th style="width:7%">หน่วย</th><th style="width:10%">ราคา/หน่วย</th><th style="width:8%">รับเข้า</th><th style="width:8%">จ่ายออก</th>
        <th style="width:9%">คงเหลือ</th><th style="width:12%">มูลค่าคงเหลือ</th></tr></thead>
        <tbody>${sum.items.map((x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td class="c">${esc(x.unit)}</td>
          <td class="r">${m(x.price)}</td><td class="r">${x.received ? num(x.received) : '-'}</td><td class="r">${x.issued ? num(x.issued) : '-'}</td>
          <td class="r">${num(x.balance)}</td><td class="r">${m(x.balance_value)}</td></tr>`).join('') || empty(9)}</tbody>
        <tfoot><tr class="pdf-total"><th colspan="5">รวม ${num(t.items)} รายการ</th><td class="r">${num(t.received_qty)}</td><td class="r">${num(t.issued_qty)}</td>
          <td class="r">${num(t.balance_qty)}</td><td class="r"><b>${money(t.balance_value)}</b></td></tr></tfoot></table>

      <div class="pdf-sign pdf-keep">
        <div class="pdf-sign-box"><div>ลงชื่อ .......................................... ผู้จัดทำรายงาน</div>
          <div>( ${extra.staff ? esc(extra.staff) : '..........................................'} )</div><div>วันที่ ........ / ........ / ........</div></div>
        <div class="pdf-sign-box"><div>ลงชื่อ .......................................... หัวหน้างานพัสดุ</div>
          <div>( .......................................... )</div><div>วันที่ ........ / ........ / ........</div></div>
      </div>
    </div>`;
  }
  const buildStockReport = (sum, org, extra) => render(stockTemplate(sum, org, extra), { pageNumbers: true });
  const stockFileName = (p) => `stock-${Number(p.slice(0, 4)) + 543}${p.length > 4 ? '-' + p.slice(5, 7) : ''}.pdf`;

  // ---------- รายงานบัญชีวัสดุประจำปี (แบบฟอร์มตรวจสอบพัสดุ แนวนอน) ----------
  // L = BorrowCore.ledgerSummary() · f = { year (พ.ศ.), fiscal, org, payCode, type, chair: {name, pos}, members: [{name, pos} × 6], generatedAt }
  const thMonth = (ymd) => new Date(ymd + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  const thShort = (ymd) => new Date(ymd + 'T00:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
  // ความกว้างคอลัมน์ (%) ตามแบบฟอร์มรายงานบัญชีวัสดุ (คอลัมน์ A–O ในไฟล์ Excel)
  const LEDGER_COLS = [6.2, 9, 25, 13.7, 8.5, 13.7, 9.7, 8.5, 13.7, 9, 8.5, 13.2, 9.2, 8.5, 16.7].map((w, _, a) => +(w * 100 / a.reduce((x, y) => x + y)).toFixed(2));
  function ledgerTemplate(L, f) {
    const t = L.totals;
    const q = (v) => (v ? num(v) : '-');
    const m = (v) => (v ? money(v) : '-');
    const fill = (v, w = 14) => (v ? `<span class="lg-fill">${esc(v)}</span>` : `<span class="lg-dots">${'.'.repeat(w * 3)}</span>`);
    const sign = (role, p) => `<div class="lg-sign"><div>ลงชื่อ.......................................................${role}</div>
      <div>( ${p && p.name ? esc(p.name) : '...................................................'} )</div><div>${p && p.pos ? esc(p.pos) : '&nbsp;'}</div></div>`;
    const members = f.members || [];
    const group = (title, sub, k) => [`จำนวนยอด<br>${sub}`, 'ราคา<br>ต่อหน่วย<br>(บาท)', `ราคารวม<br>${title}<br>(บาท) (${k})`];
    // วันที่ในหัวตาราง: วัน-เดือน / ปี คนละบรรทัด (คอลัมน์จำนวนแคบตามแบบฟอร์ม)
    const day = (d) => esc(thShort(d)).replace(/ (\d{4})$/, '<br>$1');
    const heads = [
      ...group('คงเหลือยกมา', `ยกมา<br>${day(L.start)}`, 1),
      ...group('จัดซื้อ', 'จัดซื้อ', 2),
      ...group('ใช้ไป', 'ใช้ไป', 3),
      ...group('คงเหลือ', `คงเหลือ<br>${day(L.end)}`, 4),
    ];
    return `<div class="pdf-report pdf-ledger">
      <div class="lg-head">
        <div class="lg-title">รายงานบัญชีวัสดุประจำปี ${esc(f.year)}</div>
        <div>ชื่อหน่วยงาน${fill(f.org)} รหัสหน่วยเบิกจ่าย${fill(f.payCode, 10)}</div>
        <div>ประเภทวัสดุ${fill(f.type)}</div>
        <div class="lg-period">${f.fiscal ? 'ปีงบประมาณ' : 'ปี'} พ.ศ. ${esc(f.year)} · ตั้งแต่วันที่ ${esc(thMonth(L.start))} ถึงวันที่ ${esc(thMonth(L.end))}</div>
      </div>
      <table class="pdf-grid lg-table">
        <colgroup>${LEDGER_COLS.map((w) => `<col style="width:${w}%">`).join('')}</colgroup>
        <thead>
          <tr><th rowspan="2">ลำดับ</th><th rowspan="2">รหัสวัสดุ</th><th rowspan="2">รายการวัสดุ</th>
            <th colspan="3">ยอดยกมา</th><th colspan="3">รับ</th><th colspan="3">จ่าย</th><th colspan="3">ยอดคงเหลือ</th></tr>
          <tr>${heads.map((h) => `<th>${h}</th>`).join('')}</tr>
        </thead>
        <tbody>${L.items.map((r, i) => `<tr><td class="c b">${i + 1}</td><td class="b">${esc(r.code)}</td><td class="b">${esc(r.name)}</td>
          <td class="r">${q(r.open_qty)}</td><td class="r">${m(r.price)}</td><td class="r">${m(r.open_value)}</td>
          <td class="r">${q(r.in_qty)}</td><td class="r">${m(r.price)}</td><td class="r">${m(r.in_value)}</td>
          <td class="r">${q(r.out_qty)}</td><td class="r">${m(r.price)}</td><td class="r">${m(r.out_value)}</td>
          <td class="r lg-close">${q(r.close_qty)}</td><td class="r">${m(r.price)}</td><td class="r b">${m(r.close_value)}</td></tr>`).join('')}</tbody>
        <tfoot><tr class="pdf-total"><th colspan="3">ยอดรวมสุทธิ</th>
          <td colspan="3" class="r"><b>${money(t.open_value)} บาท</b></td><td colspan="3" class="r"><b>${money(t.in_value)} บาท</b></td>
          <td colspan="3" class="r"><b>${money(t.out_value)} บาท</b></td><td colspan="3" class="r"><b>${money(t.close_value)} บาท</b></td></tr></tfoot>
      </table>
      <p class="lg-count pdf-keep">ถูกต้องครบถ้วน จำนวน ......${num(L.items.length)}...... รายการ &nbsp;&nbsp;&nbsp; เสื่อมสภาพ จำนวน ............ รายการ &nbsp;&nbsp;&nbsp; สูญหาย จำนวน ............ รายการ</p>
      <div class="lg-notes pdf-keep"><b>หมายเหตุ</b> 1. ช่องรวมบรรทัดสุดท้ายคิดเฉพาะยอดเงินเท่านั้น<br>
        &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;2. วิธีการคิดยอดรวมราคาคงเหลือ (1) ยอดยกมา + (2) ยอดจัดซื้อหรือรับจากกรม − (3) ยอดจ่ายไป = (4) ยอดคงเหลือประจำปีงบประมาณ</div>
      <div class="pdf-pagefoot lg-signs">
        ${sign('ประธานกรรมการ', f.chair)}${sign('กรรมการ', members[0])}${sign('กรรมการ', members[1])}${sign('กรรมการ', members[2])}
        ${sign('กรรมการ', members[3])}${sign('กรรมการ', members[4])}${sign('กรรมการ', members[5])}
      </div>
    </div>`;
  }
  const buildLedger = (L, f) => render(ledgerTemplate(L, f), { pageNumbers: true, landscape: true });
  const ledgerFileName = (f) => `material-ledger-${f.year}.pdf`;

  // ---------- สรุปมูลค่ารับเข้า / จ่ายออก ----------
  // sum = BorrowCore.flowSummary() · kind = 'both' | 'in' | 'out' · extra = { generatedAt, staff }
  const FLOW_TITLE = { both: 'สรุปมูลค่ารับเข้า–จ่ายออกพัสดุ', in: 'สรุปมูลค่ารับเข้าพัสดุ', out: 'สรุปมูลค่าจ่ายออกพัสดุ' };
  function flowTemplate(sum, kind, org, extra) {
    const t = sum.totals;
    const IN = kind !== 'out';
    const OUT = kind !== 'in';
    const period = sum.yearly ? `ประจำปี พ.ศ. ${Number(sum.period) + 543}` : `ประจำเดือน${monthName(sum.period)}`;
    const empty = (cols) => `<tr><td colspan="${cols}" class="c muted">ไม่มีรายการ</td></tr>`;
    const stat = (label, value, sub) => `<td><div class="pdf-stat-l">${label}</div><div class="pdf-stat-v">${value}</div><div class="pdf-stat-s">${sub}</div></td>`;
    const m = (v) => (v ? money(v) : '-');
    const q = (v) => (v ? num(v) : '-');
    let n = 0;
    const h2 = (title, note = '') => `<h2 class="pdf-h2">${++n}. ${title}${note ? ` <span>${note}</span>` : ''}</h2>`;
    const items = sum.items.filter((x) => (IN && x.in_qty) || (OUT && x.out_qty));
    const sections = [];
    if (sum.yearly) {
      sections.push(`${h2('สรุปรายเดือน')}
      <table class="pdf-grid"><thead><tr><th>เดือน</th>${IN ? '<th style="width:14%">รับเข้า (หน่วย)</th><th style="width:18%">มูลค่ารับเข้า</th>' : ''}${OUT ? '<th style="width:14%">จ่ายออก (หน่วย)</th><th style="width:18%">มูลค่าจ่ายออก</th>' : ''}</tr></thead>
        <tbody>${sum.months.map((x) => `<tr><td>${esc(monthName(x.month))}</td>${IN ? `<td class="r">${q(x.in_qty)}</td><td class="r">${money(x.in_value)}</td>` : ''}${OUT ? `<td class="r">${q(x.out_qty)}</td><td class="r">${money(x.out_value)}</td>` : ''}</tr>`).join('')}</tbody>
        <tfoot><tr class="pdf-total"><th>รวมทั้งปี</th>${IN ? `<td class="r">${num(t.in_qty)}</td><td class="r"><b>${money(t.in_value)}</b></td>` : ''}${OUT ? `<td class="r">${num(t.out_qty)}</td><td class="r"><b>${money(t.out_value)}</b></td>` : ''}</tr></tfoot></table>`);
    }
    sections.push(`${h2('สรุปตามรายการพัสดุ', '(เรียงตามรหัส)')}
      <table class="pdf-grid${IN && OUT ? ' pdf-small' : ''}"><thead><tr><th style="width:6%">ลำดับ</th><th style="width:11%">รหัส</th><th>รายการ</th><th style="width:7%">หน่วย</th>
        ${IN ? '<th style="width:9%">รับเข้า</th><th style="width:13%">มูลค่ารับเข้า</th>' : ''}${OUT ? '<th style="width:9%">จ่ายออก</th><th style="width:13%">มูลค่าจ่ายออก</th>' : ''}</tr></thead>
        <tbody>${items.map((x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(x.code)}</td><td>${esc(x.name)}</td><td class="c">${esc(x.unit)}</td>
          ${IN ? `<td class="r">${q(x.in_qty)}</td><td class="r">${m(x.in_value)}</td>` : ''}${OUT ? `<td class="r">${q(x.out_qty)}</td><td class="r">${m(x.out_value)}</td>` : ''}</tr>`).join('') || empty(4 + (IN ? 2 : 0) + (OUT ? 2 : 0))}</tbody>
        <tfoot><tr class="pdf-total"><th colspan="4">รวม ${num(items.length)} รายการ</th>${IN ? `<td class="r">${num(t.in_qty)}</td><td class="r"><b>${money(t.in_value)}</b></td>` : ''}${OUT ? `<td class="r">${num(t.out_qty)}</td><td class="r"><b>${money(t.out_value)}</b></td>` : ''}</tr></tfoot></table>`);
    if (IN) {
      sections.push(`${h2('รายการรับเข้าทั้งหมด', '(เรียงตามวันที่ · ราคาต่อหน่วยของล็อตที่รับเข้า)')}
      <table class="pdf-grid pdf-small"><thead><tr><th style="width:13%">วันที่</th><th>รายการ</th><th style="width:8%">จำนวน</th><th style="width:10%">ราคา/หน่วย</th>
        <th style="width:11%">มูลค่า</th><th style="width:18%">บริษัท</th><th style="width:11%">เลขใบส่งของ</th></tr></thead>
        <tbody>${sum.receipts.map((x) => `<tr><td>${esc(thaiDateTime(x.created_at)).replace(/ (\d{1,2}:\d{2}(:\d{2})?)$/, '<br>$1')}</td><td>${esc(x.name)}<br><span class="muted">${esc(x.code)}</span></td>
          <td class="r">${num(x.qty)} ${esc(x.unit)}</td><td class="r">${m(x.price)}</td><td class="r">${m(x.value)}</td><td>${esc(x.supplier || '-')}</td><td>${esc(x.delivery_no || '-')}</td></tr>`).join('') || empty(7)}</tbody>
        <tfoot><tr class="pdf-total"><th colspan="4">รวมรับเข้า ${num(t.in_count)} ครั้ง</th><td class="r"><b>${money(t.in_value)}</b></td><td colspan="2"></td></tr></tfoot></table>`);
    }
    const stats = [];
    if (IN) stats.push(stat('รับเข้า', num(t.in_qty) + ' หน่วย', num(t.in_items) + ' รายการ · ' + num(t.in_count) + ' ครั้ง'), stat('มูลค่ารับเข้า', money(t.in_value), 'บาท'));
    if (OUT) stats.push(stat('จ่ายออก', num(t.out_qty) + ' หน่วย', num(t.out_items) + ' รายการ · ' + num(t.out_count) + ' ใบเบิก'), stat('มูลค่าจ่ายออก', money(t.out_value), 'บาท'));
    const baht = [IN && `รับเข้ารวม ${money(t.in_value)} บาท ( ${bahtText(t.in_value)} )`, OUT && `จ่ายออกรวม ${money(t.out_value)} บาท ( ${bahtText(t.out_value)} )`].filter(Boolean).join(' · ');
    return `<div class="pdf-report">
      <div class="pdf-head">
        <div><div class="pdf-org">${esc(org || 'ระบบเบิกพัสดุ')}</div>
          <div class="pdf-title">${FLOW_TITLE[kind]} ${esc(period)}</div></div>
        <div class="pdf-meta">ข้อมูล ณ ${esc(thaiDateTime(extra.generatedAt))}</div>
      </div>
      <table class="pdf-stats pdf-keep"><tr>${stats.join('')}</tr></table>
      <p class="pdf-baht">${baht}</p>
      ${sections.join('\n')}
      <div class="pdf-sign pdf-keep">
        <div class="pdf-sign-box"><div>ลงชื่อ .......................................... ผู้จัดทำรายงาน</div>
          <div>( ${extra.staff ? esc(extra.staff) : '..........................................'} )</div><div>วันที่ ........ / ........ / ........</div></div>
        <div class="pdf-sign-box"><div>ลงชื่อ .......................................... หัวหน้างานพัสดุ</div>
          <div>( .......................................... )</div><div>วันที่ ........ / ........ / ........</div></div>
      </div>
    </div>`;
  }
  const buildFlowReport = (sum, kind, org, extra) => render(flowTemplate(sum, kind, org, extra), { pageNumbers: true });
  const flowFileName = (p, kind) => `${{ both: 'in-out', in: 'receive', out: 'issue' }[kind]}-${Number(p.slice(0, 4)) + 543}${p.length > 4 ? '-' + p.slice(5, 7) : ''}.pdf`;

  // ต้องเรียกจาก click ของผู้ใช้โดยตรง (เตรียม blob ไว้ก่อน) เพื่อให้เบราว์เซอร์ยอมเปิดหน้าต่างบันทึกไฟล์
  // คืนค่า false ถ้าผู้ใช้กดยกเลิก
  async function save(blob, filename) {
    // iPhone / iPad: เปิดเมนูแชร์ของระบบ เลือก "บันทึกไปยังไฟล์" / พิมพ์ / AirDrop ได้
    // (การดาวน์โหลดไฟล์ blob บน iOS ไม่เสถียร โดยเฉพาะเมื่อเปิดจากไอคอนบนหน้าจอโฮม)
    if (isIOS && typeof navigator.canShare === 'function') {
      const file = new File([blob], filename, { type: 'application/pdf' });
      if (navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: filename });
          return true;
        } catch (e) {
          if (e.name === 'AbortError') return false;
          // แชร์ไม่ได้ ใช้การดาวน์โหลดปกติแทน
        }
      }
    }
    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [{ description: 'เอกสาร PDF', accept: { 'application/pdf': ['.pdf'] } }],
        });
        const w = await handle.createWritable();
        await w.write(blob);
        await w.close();
        return true;
      } catch (e) {
        if (e.name === 'AbortError') return false;
        // เปิดหน้าต่างบันทึกไม่ได้ (เช่น อยู่ใน iframe) ใช้การดาวน์โหลดปกติแทน
      }
    }
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return true;
  }

  const preload = () => { loadLib().catch(() => {}); };
  return { build, buildReport, buildStockReport, stockFileName, buildFlowReport, flowFileName, buildLedger, ledgerFileName, save, preload, isIOS, monthName, reportFileName, bahtText, fileName: (r) => `${r.request_no}.pdf` };
})();
