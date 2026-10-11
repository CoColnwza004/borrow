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
    const statement = withdraw
      ? `ข้าพเจ้าขอเบิกพัสดุตามรายการต่อไปนี้ เพื่อใช้ในงานของ${esc(r.department)}`
      : `ข้าพเจ้าขอยืมพัสดุตามรายการต่อไปนี้ เพื่อใช้ในงานของ${esc(r.department)} และจะส่งคืนภายในวันที่ <b>${thaiDate(r.due_date)}</b>
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
        <tr><th>ชื่อ${who}</th><td>${esc(r.borrower_name)}</td><th>แผนก</th><td>${esc(r.department)}</td></tr>
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

  async function build(r, org) {
    await loadLib();
    await Promise.all(['400 16px Sarabun', '600 16px Sarabun', '700 16px Sarabun'].map((f) => document.fonts.load(f).catch(() => null)));
    const stage = document.createElement('div');
    stage.className = 'pdf-stage';
    stage.innerHTML = template(r, org);
    document.body.appendChild(stage);
    try {
      return await window.html2pdf().set({
        margin: 0,
        image: { type: 'jpeg', quality: 0.96 },
        // scrollX/scrollY = 0 ป้องกันเนื้อหาเลื่อนลงในกระดาษเมื่อหน้าเว็บถูกเลื่อนอยู่
        html2canvas: { scale: 2, backgroundColor: '#ffffff', logging: false, scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css'], avoid: 'tr' },
      }).from(stage.firstElementChild).outputPdf('blob');
    } finally {
      stage.remove();
    }
  }

  // ต้องเรียกจาก click ของผู้ใช้โดยตรง (เตรียม blob ไว้ก่อน) เพื่อให้เบราว์เซอร์ยอมเปิดหน้าต่างบันทึกไฟล์
  // คืนค่า false ถ้าผู้ใช้กดยกเลิก
  async function save(blob, filename) {
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

  return { build, save, fileName: (r) => `${r.request_no}.pdf` };
})();
