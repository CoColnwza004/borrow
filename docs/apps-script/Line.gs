/**
 * แจ้งเตือนผ่าน LINE Official Account (Messaging API)
 * - มีผู้เบิกพัสดุ: แจ้งทันที (หรือสรุปทุกชั่วโมง ประหยัดโควตา)
 * - ทุกเช้า: ล็อตใกล้หมดอายุ และของใกล้หมดสต็อก (ไม่มีอะไรต้องแจ้ง = ไม่ส่ง)
 *
 * ตั้งค่า (ทำครั้งเดียว) — วิธีละเอียดอยู่ใน README หัวข้อ "แจ้งเตือนผ่าน LINE OA"
 * 1. Apps Script → ตั้งค่าโปรเจ็กต์ (⚙) → คุณสมบัติของสคริปต์ → เพิ่ม LINE_TOKEN = Channel access token (long-lived)
 * 2. ตั้ง Webhook URL ของ LINE OA เป็นลิงก์ /exec ของเว็บแอปนี้ แล้วเปิด Use webhook
 * 3. เพิ่ม LINE OA เป็นเพื่อน (หรือเชิญเข้ากลุ่ม LINE ของเจ้าหน้าที่) แล้วพิมพ์ "เชื่อมต่อ <รหัส PIN>"
 * 4. เลือกฟังก์ชัน setupLine แล้วกด เรียกใช้ (ตั้งเวลาส่งสรุปทุกเช้า) · ทดสอบด้วย testLine
 *
 * คุณสมบัติของสคริปต์ที่ปรับได้ (ไม่ใส่ = ค่าตั้งต้น):
 *   LINE_NOTIFY_REQUESTS = instant (แจ้งทันทีทุกใบ) | hourly (สรุปทุกชั่วโมง) | off (ไม่แจ้ง)
 *   LINE_DAILY_HOUR = 8 (ส่งสรุปประจำวันราว 8 โมงเช้า) · LINE_EXPIRY_MONTHS = 8 (เตือนก่อนหมดอายุกี่เดือน)
 * โควตา LINE OA แบบฟรีนับ 1 ข้อความต่อผู้รับ 1 คน (ส่งเข้ากลุ่ม = นับตามจำนวนสมาชิก) ดูยอดที่ใช้ได้ใน LINE OA Manager
 */
var LINE_API = 'https://api.line.me/v2/bot/message/';

function lineProps_() { return PropertiesService.getScriptProperties(); }
function lineTargets_() {
  try { return JSON.parse(lineProps_().getProperty('LINE_TARGETS') || '[]'); } catch (e) { return []; }
}
function lineSaveTargets_(list) { lineProps_().setProperty('LINE_TARGETS', JSON.stringify(list)); }
function lineMode_() { return lineProps_().getProperty('LINE_NOTIFY_REQUESTS') || 'instant'; }

// สถานะสำหรับหน้าเว็บของเจ้าหน้าที่ (ไม่ส่ง token หรือรหัสผู้รับ)
function lineStatus_() {
  var p = lineProps_();
  return { configured: !!p.getProperty('LINE_TOKEN'), targets: lineTargets_().length, mode: lineMode_(),
    daily_hour: Number(p.getProperty('LINE_DAILY_HOUR') || 8), daily_on: ScriptApp.getProjectTriggers().some(function (t) { return t.getHandlerFunction() === 'lineDailySummary'; }) };
}

function lineCall_(kind, payload) {
  var token = lineProps_().getProperty('LINE_TOKEN');
  if (!token) return { ok: false, error: 'ยังไม่ได้ตั้ง LINE_TOKEN' };
  var res = UrlFetchApp.fetch(LINE_API + kind, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + token }, payload: JSON.stringify(payload),
  });
  var code = res.getResponseCode();
  return code === 200 ? { ok: true } : { ok: false, error: 'LINE ' + code + ': ' + res.getContentText().slice(0, 300) };
}

// ส่งถึงผู้รับทุกคน/ทุกกลุ่มที่เชื่อมต่อไว้ · ข้อความยาวเกินตัดท้าย (LINE รับได้ 5,000 ตัวอักษร)
function linePush_(text) {
  if (!text) return 0;
  var sent = 0;
  lineTargets_().forEach(function (t) {
    var r = lineCall_('push', { to: t.id, messages: [{ type: 'text', text: text.slice(0, 4900) }] });
    if (r.ok) sent++; else Logger.log('ส่ง LINE ไม่สำเร็จ (' + t.name + '): ' + r.error);
  });
  return sent;
}

// ปุ่มลัดใต้ข้อความตอบกลับ (กดแล้วส่งคำสั่งให้เอง)
function lineQuickReply_() {
  return { items: BorrowCore.LINE_MENU.map(function (t) { return { type: 'action', action: { type: 'message', label: t, text: t } }; }) };
}
function lineToday_() {
  return Utilities.formatDate(new Date(), SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), 'yyyy-MM-dd');
}

// Webhook จาก LINE: พิมพ์ "เชื่อมต่อ <PIN>" = รับแจ้งเตือน · "ยกเลิกแจ้งเตือน" · "สถานะ"
// แชตที่เชื่อมต่อแล้วพิมพ์ค้นหาได้: เมนู · เช็ค <ชื่อ> · สรุป · ใกล้หมดอายุ · ใกล้หมด · เบิกวันนี้ · ยังไม่รับ
// (Apps Script อ่าน header X-Line-Signature ไม่ได้ จึงใช้ PIN เป็นตัวยืนยันก่อนเพิ่มผู้รับ · แชตที่ยังไม่เชื่อมต่อค้นหาข้อมูลไม่ได้)
function lineWebhook_(body) {
  (body.events || []).forEach(function (ev) {
    if (ev.type !== 'message' || !ev.message || ev.message.type !== 'text') return;
    var src = ev.source || {};
    var id = src.groupId || src.roomId || src.userId;
    if (!id) return;
    var text = String(ev.message.text || '').trim();
    var list = lineTargets_();
    var has = list.some(function (t) { return t.id === id; });
    var reply = '';
    var quick = false;
    var m = /^(เชื่อมต่อ|connect)\s*(\S+)$/i.exec(text);
    if (m) {
      if (m[2] !== adminPin_()) reply = 'รหัสไม่ถูกต้อง';
      else {
        if (!has) list.push({ id: id, type: src.type || 'user', name: src.type === 'group' ? 'กลุ่ม' : src.type === 'room' ? 'ห้องแชต' : 'ผู้ใช้', at: new Date().toISOString() });
        lineSaveTargets_(list);
        reply = 'เชื่อมต่อแล้ว ✅ จะได้รับแจ้งเตือนเมื่อมีผู้เบิกพัสดุ และสรุปของใกล้หมดอายุ/ใกล้หมดสต็อกทุกเช้า\n' +
          'พิมพ์ "เมนู" เพื่อดูคำสั่งค้นหา เช่น "เช็ค ถุงมือ" · พิมพ์ "ยกเลิกแจ้งเตือน" เพื่อหยุดรับ';
        quick = true;
      }
    } else if (/^ยกเลิกแจ้งเตือน$/.test(text) && has) {
      lineSaveTargets_(list.filter(function (t) { return t.id !== id; }));
      reply = 'หยุดส่งแจ้งเตือนมาที่นี่แล้ว';
    } else if (/^สถานะ$/.test(text) && has) {
      var s = lineStatus_();
      reply = 'รับแจ้งเตือนอยู่ · ผู้รับทั้งหมด ' + s.targets + ' · ใบเบิก: ' + ({ instant: 'แจ้งทันที', hourly: 'สรุปทุกชั่วโมง', off: 'ปิด' }[s.mode] || s.mode) +
        ' · สรุปประจำวัน: ' + (s.daily_on ? 'ราว ' + s.daily_hour + ':00 น.' : 'ยังไม่ได้ตั้ง (เรียกใช้ setupLine)') + '\nพิมพ์ "เมนู" เพื่อดูคำสั่งค้นหา';
      quick = true;
    } else if (has) {
      try {
        reply = BorrowCore.lineQueryText(loadDb_(), text, lineToday_(), Number(lineProps_().getProperty('LINE_EXPIRY_MONTHS') || 8));
      } catch (e) { reply = 'ค้นหาไม่สำเร็จ: ' + e.message; }
      quick = !!reply;
    } else if (/^(เมนู|ช่วย|help|menu)$/i.test(text)) {
      reply = 'แชตนี้ยังไม่ได้เชื่อมต่อ พิมพ์ "เชื่อมต่อ <รหัส PIN เจ้าหน้าที่>" ก่อน แล้วจึงค้นหาพัสดุได้';
    }
    // ตอบกลับ (reply) ไม่นับโควตาข้อความ
    if (reply && ev.replyToken) {
      var msg = { type: 'text', text: reply.slice(0, 4900) };
      if (quick) msg.quickReply = lineQuickReply_();
      lineCall_('reply', { replyToken: ev.replyToken, messages: [msg] });
    }
  });
  return json_({ ok: true });
}

// หลังบันทึกใบเบิก: ส่งทันที หรือเก็บไว้รอสรุปทุกชั่วโมง · ส่งไม่สำเร็จไม่กระทบการเบิก
function lineOnRequest_(db, requestId) {
  try {
    if (!lineTargets_().length) return;
    var mode = lineMode_();
    if (mode === 'instant') linePush_(BorrowCore.lineRequestText(db, requestId));
    else if (mode === 'hourly') {
      var p = lineProps_();
      var pending = JSON.parse(p.getProperty('LINE_PENDING') || '[]');
      pending.push(requestId);
      p.setProperty('LINE_PENDING', JSON.stringify(pending));
    }
  } catch (e) { Logger.log('แจ้งเตือน LINE ไม่สำเร็จ: ' + e.message); }
}

// ทริกเกอร์ทุกชั่วโมง (โหมด hourly): รวมใบเบิกที่รอไว้เป็นข้อความเดียว
function lineHourly() {
  var p = lineProps_();
  var pending = JSON.parse(p.getProperty('LINE_PENDING') || '[]');
  if (!pending.length) return;
  p.setProperty('LINE_PENDING', '[]');
  linePush_(BorrowCore.lineRequestsDigest(loadDb_(), pending));
}

// ทริกเกอร์ทุกเช้า: ล็อตใกล้หมดอายุ + ของใกล้หมดสต็อก
function lineDailySummary() {
  var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
  var today = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  var months = Number(lineProps_().getProperty('LINE_EXPIRY_MONTHS') || 8);
  var text = BorrowCore.lineDailyText(loadDb_(), today, months);
  if (text) linePush_(text);
}

// เรียกใช้ครั้งเดียวหลังตั้ง LINE_TOKEN: ตั้งเวลาส่งสรุปทุกเช้า (และทุกชั่วโมงถ้าเลือกโหมด hourly) แล้วบอกสถานะ
function setupLine() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['lineDailySummary', 'lineHourly'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  var hour = Number(lineProps_().getProperty('LINE_DAILY_HOUR') || 8);
  ScriptApp.newTrigger('lineDailySummary').timeBased().everyDays(1).atHour(hour).create();
  if (lineMode_() === 'hourly') ScriptApp.newTrigger('lineHourly').timeBased().everyHours(1).create();
  var s = lineStatus_();
  Logger.log((s.configured ? 'ตั้ง LINE_TOKEN แล้ว' : 'ยังไม่ได้ตั้ง LINE_TOKEN (คุณสมบัติของสคริปต์)') + ' · ผู้รับที่เชื่อมต่อ ' + s.targets +
    ' · ใบเบิก: ' + s.mode + ' · สรุปประจำวันราว ' + hour + ':00 น.' + (s.targets ? '' : ' — เพิ่ม LINE OA เป็นเพื่อน/เชิญเข้ากลุ่ม แล้วพิมพ์ "เชื่อมต่อ <PIN>"'));
}

// ทดสอบส่งข้อความ + สรุปประจำวันตอนนี้
function testLine() {
  var n = linePush_('ทดสอบแจ้งเตือนจากระบบเบิกพัสดุ ✅');
  Logger.log('ส่งถึง ' + n + ' จาก ' + lineTargets_().length + ' ผู้รับ');
  lineDailySummary();
}
