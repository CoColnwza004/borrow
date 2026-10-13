'use strict';

/*
 * สร้างใบเบิก / ใบยืมพัสดุเป็น PDF ในเบราว์เซอร์
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
  const thaiDateTime = (s) => {
    const d = new Date(String(s).replace(' ', 'T'));
    return isNaN(d) ? s : d.toLocaleString('th-TH', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

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

  // r = requestView() จาก app.js (มี items พร้อมชื่อ/หน่วย)
  function template(r, org) {
    const withdraw = r.type === 'withdraw';
    const who = withdraw ? 'ผู้เบิก' : 'ผู้ยืม';
    const rows = r.items.map((l, i) => `<tr>
      <td class="c">${i + 1}</td><td>${esc(l.code)}</td><td>${esc(l.name)}</td>
      <td class="r">${Number(l.qty).toLocaleString('th-TH')}</td><td class="c">${esc(l.unit)}</td><td></td></tr>`);
    for (let i = rows.length; i < MIN_ROWS; i++) rows.push('<tr class="blank"><td></td><td></td><td></td><td></td><td></td><td></td></tr>');
    const dept = esc(r.department_full || r.department);
    const statement = withdraw
      ? `ข้าพเจ้าขอเบิกพัสดุตามรายการต่อไปนี้ เพื่อใช้ใน${dept}`
      : `ข้าพเจ้าขอยืมพัสดุตามรายการต่อไปนี้ เพื่อใช้ใน${dept} และจะส่งคืนภายในวันที่ <b>${thaiDate(r.due_date)}</b>
         ในสภาพเรียบร้อย หากชำรุดหรือสูญหาย ข้าพเจ้ายินดีรับผิดชอบตามระเบียบ`;
    const sign = (role, name) => `<div class="pdf-sign-box">
      <div>ลงชื่อ .......................................... ${role}</div>
      <div>( ${name ? esc(name) : '..........................................'} )</div>
      <div>วันที่ ........ / ........ / ........</div></div>`;
    return `<div class="pdf-page">
      <div class="pdf-head">
        <div><div class="pdf-org">${esc(org || 'ระบบเบิก-ยืมพัสดุ')}</div>
          <div class="pdf-title">${withdraw ? 'ใบเบิกพัสดุ' : 'ใบยืมพัสดุ'}</div></div>
        <div class="pdf-meta"><div>เลขที่ <b>${esc(r.request_no)}</b></div><div>วันที่ ${thaiDate(r.borrow_date || r.created_at)}</div></div>
      </div>
      <table class="pdf-info">
        <tr><th>ชื่อ${who}</th><td>${esc(r.borrower_name)}</td><th>แผนก</th><td>${dept}</td></tr>
        ${withdraw ? '' : `<tr><th>วันที่ยืม</th><td>${thaiDate(r.borrow_date)}</td><th>กำหนดคืน</th><td><b>${thaiDate(r.due_date)}</b></td></tr>`}
        ${r.note || r.purpose ? `<tr><th>หมายเหตุ</th><td colspan="3">${esc([r.purpose, r.note].filter(Boolean).join(' · '))}</td></tr>` : ''}
      </table>
      <p class="pdf-statement">${statement}</p>
      <table class="pdf-items">
        <thead><tr><th style="width:9%">ลำดับ</th><th style="width:14%">รหัส</th><th>รายการ</th>
          <th style="width:11%">จำนวน</th><th style="width:11%">หน่วย</th><th style="width:15%">หมายเหตุ</th></tr></thead>
        <tbody>${rows.join('')}</tbody>
      </table>
      <div class="pdf-sign">${sign(who, r.borrower_name)}${sign('เจ้าหน้าที่พัสดุ', '')}</div>
      <div class="pdf-foot">ออกโดยระบบเบิก-ยืมพัสดุ · บันทึกเมื่อ ${esc(thaiDateTime(r.created_at))}</div>
    </div>`;
  }

  // แปลง HTML เป็น PDF (A4) margin = [บน, ซ้าย, ล่าง, ขวา] หน่วย มม.
  async function render(html, { margin = 0, pageNumbers = false } = {}) {
    await loadLib();
    await Promise.all(['400 16px Sarabun', '600 16px Sarabun', '700 16px Sarabun'].map((f) => document.fonts.load(f).catch(() => null)));
    const stage = document.createElement('div');
    stage.className = 'pdf-stage';
    stage.innerHTML = html;
    document.body.appendChild(stage);
    try {
      let worker = window.html2pdf().set({
        margin,
        image: { type: 'jpeg', quality: 0.96 },
        // scrollX/scrollY = 0 ป้องกันเนื้อหาเลื่อนลงในกระดาษเมื่อหน้าเว็บถูกเลื่อนอยู่
        html2canvas: { scale: 2, backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css'], avoid: ['tr', '.pdf-keep'] },
      }).from(stage.firstElementChild).toPdf();
      if (pageNumbers) {
        worker = worker.get('pdf').then((pdf) => {
          const n = pdf.internal.getNumberOfPages();
          for (let i = 1; i <= n; i++) {
            pdf.setPage(i);
            pdf.setFontSize(9);
            pdf.setTextColor(120);
            pdf.text(`${i} / ${n}`, 196, 290, { align: 'right' });
          }
        });
      }
      return await worker.outputPdf('blob');
    } finally {
      stage.remove();
    }
  }

  const build = (r, org) => render(template(r, org));

  // ---------- สรุปรายเดือน ----------
  const num = (n) => Number(n || 0).toLocaleString('th-TH');
  const monthName = (m) => new Date(m + '-01T00:00:00').toLocaleDateString('th-TH', { month: 'long', year: 'numeric' });

  // sum = BorrowCore.monthlySummary(), extra = { deptFull(name), lines(r) -> [{name, qty, unit}] }
  function reportTemplate(sum, org, extra) {
    const t = sum.totals;
    const empty = (cols) => `<tr><td colspan="${cols}" class="c muted">ไม่มีรายการ</td></tr>`;
    const stat = (label, value, sub) => `<td><div class="pdf-stat-l">${label}</div><div class="pdf-stat-v">${value}</div><div class="pdf-stat-s">${sub}</div></td>`;
    const status = (r) => (r.type === 'withdraw' ? 'เบิกแล้ว' : r.status === 'returned' ? 'คืนแล้ว' : 'ค้างคืน');
    return `<div class="pdf-report">
      <div class="pdf-head">
        <div><div class="pdf-org">${esc(org || 'ระบบเบิก-ยืมพัสดุ')}</div>
          <div class="pdf-title">สรุปการเบิก-ยืมพัสดุ ประจำเดือน${esc(monthName(sum.month))}</div></div>
        <div class="pdf-meta">ข้อมูล ณ ${esc(thaiDateTime(extra.generatedAt))}</div>
      </div>
      <table class="pdf-stats pdf-keep"><tr>
        ${stat('ใบเบิก', num(t.withdraw_docs) + ' ใบ', 'เบิกรวม ' + num(t.withdraw_qty) + ' หน่วย · ' + num(sum.withdrawn.length) + ' รายการ')}
        ${stat('ใบยืม', num(t.borrow_docs) + ' ใบ', 'ยืมรวม ' + num(t.borrow_qty) + ' หน่วย · ' + num(sum.borrowed.length) + ' รายการ')}
        ${stat('คืนแล้ว', num(t.returned_qty) + ' หน่วย', 'ชำรุด/สูญหาย ' + num(t.lost_qty) + ' หน่วย')}
        ${stat('ยังไม่คืน', num(t.outstanding_qty) + ' หน่วย', 'เกินกำหนดคืน ' + num(t.overdue_docs) + ' ใบ')}
      </tr></table>

      <h2 class="pdf-h2">1. พัสดุที่ถูกเบิก <span>(เรียงจากจำนวนมากไปน้อย)</span></h2>
      <table class="pdf-grid"><thead><tr><th style="width:7%">ลำดับ</th><th style="width:12%">รหัส</th><th>รายการ</th>
        <th style="width:12%">จำนวน</th><th style="width:10%">หน่วย</th><th style="width:11%">จำนวนใบ</th></tr></thead>
        <tbody>${sum.withdrawn.map((x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(x.code)}</td><td>${esc(x.name)}</td>
          <td class="r">${num(x.qty)}</td><td class="c">${esc(x.unit)}</td><td class="r">${num(x.times)}</td></tr>`).join('') || empty(6)}</tbody></table>

      <h2 class="pdf-h2">2. พัสดุที่ถูกยืม</h2>
      <table class="pdf-grid"><thead><tr><th style="width:7%">ลำดับ</th><th style="width:12%">รหัส</th><th>รายการ</th>
        <th style="width:9%">ยืม</th><th style="width:10%">คืนแล้ว</th><th style="width:10%">ชำรุด/หาย</th><th style="width:10%">ยังไม่คืน</th><th style="width:9%">หน่วย</th></tr></thead>
        <tbody>${sum.borrowed.map((x, i) => `<tr><td class="c">${i + 1}</td><td>${esc(x.code)}</td><td>${esc(x.name)}</td>
          <td class="r">${num(x.qty)}</td><td class="r">${num(x.returned)}</td><td class="r">${num(x.lost)}</td>
          <td class="r">${x.outstanding ? `<b>${num(x.outstanding)}</b>` : '0'}</td><td class="c">${esc(x.unit)}</td></tr>`).join('') || empty(8)}</tbody></table>

      <h2 class="pdf-h2">3. สรุปตามแผนก</h2>
      <table class="pdf-grid"><thead><tr><th>แผนก</th><th style="width:12%">ใบเบิก</th><th style="width:14%">หน่วยที่เบิก</th>
        <th style="width:12%">ใบยืม</th><th style="width:14%">หน่วยที่ยืม</th></tr></thead>
        <tbody>${sum.departments.map((d) => `<tr><td>${esc(extra.deptFull(d.name))}</td><td class="r">${num(d.withdraw_docs)}</td>
          <td class="r">${num(d.withdraw_qty)}</td><td class="r">${num(d.borrow_docs)}</td><td class="r">${num(d.borrow_qty)}</td></tr>`).join('') || empty(5)}</tbody></table>

      <h2 class="pdf-h2">4. รายการเอกสารทั้งหมด</h2>
      <table class="pdf-grid pdf-small"><thead><tr><th style="width:12%">วันที่</th><th style="width:13%">เลขที่</th><th style="width:7%">ประเภท</th>
        <th style="width:16%">ผู้ขอ</th><th style="width:11%">แผนก</th><th>พัสดุ</th><th style="width:9%">สถานะ</th></tr></thead>
        <tbody>${sum.requests.map((r) => `<tr><td>${esc(thaiDateTime(r.created_at))}</td><td>${esc(r.request_no)}</td>
          <td class="c">${r.type === 'withdraw' ? 'เบิก' : 'ยืม'}</td><td>${esc(r.borrower_name)}</td><td>${esc(r.department)}</td>
          <td>${extra.lines(r).map((l) => `${esc(l.name)} ×${num(l.qty)}`).join(', ')}</td><td class="c">${status(r)}</td></tr>`).join('') || empty(7)}</tbody></table>

      <div class="pdf-sign pdf-keep">
        <div class="pdf-sign-box"><div>ลงชื่อ .......................................... ผู้จัดทำรายงาน</div>
          <div>( .......................................... )</div><div>วันที่ ........ / ........ / ........</div></div>
        <div class="pdf-sign-box"><div>ลงชื่อ .......................................... หัวหน้างานพัสดุ</div>
          <div>( .......................................... )</div><div>วันที่ ........ / ........ / ........</div></div>
      </div>
    </div>`;
  }

  const buildReport = (sum, org, extra) => render(reportTemplate(sum, org, extra), { margin: [10, 0, 14, 0], pageNumbers: true });
  // ชื่อไฟล์ภาษาอังกฤษ: เบราว์เซอร์บางตัวตัดชื่อไฟล์ภาษาไทยเหลือ "download"
  const reportFileName = (month) => `summary-${Number(month.slice(0, 4)) + 543}-${month.slice(5, 7)}.pdf`;

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
  return { build, buildReport, save, preload, isIOS, monthName, reportFileName, fileName: (r) => `${r.request_no}.pdf` };
})();
