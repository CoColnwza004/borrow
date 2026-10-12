# รัน: python3 scripts/draw-hospital.py → เขียน docs/hospital.svg (ภาพพื้นหลังหน้าแรก)
# วาดภาพประกอบโรงพยาบาล (SVG) สำหรับพื้นหลังหน้าแรก
W, H = 1600, 1000
DY = 360  # เลื่อนตัวอาคารลง ให้ด้านบนเป็นท้องฟ้าว่างสำหรับข้อความ
out = []
a = out.append
a(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMax slice">')
a('''<defs>
<linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e3efff" stop-opacity="0"/><stop offset="1" stop-color="#e3efff"/></linearGradient>
<linearGradient id="glass" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#d6e8fc"/><stop offset="1" stop-color="#b9d5f5"/></linearGradient>
<linearGradient id="wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef4fb"/></linearGradient>
<linearGradient id="lawn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dcefe0"/><stop offset="1" stop-color="#eef7f0"/></linearGradient>
</defs>''')
a(f'<rect width="{W}" height="{H}" fill="url(#sky)"/>')
a(f'<g transform="translate(0 {DY})">')
# ตึกไกล ๆ
for x, w, h in [(90, 150, 210), (1360, 170, 240), (1180, 110, 170), (250, 110, 160)]:
    a(f'<rect x="{x}" y="{560-h}" width="{w}" height="{h}" rx="6" fill="#dbe7f5" opacity=".75"/>')
# ปีกซ้าย/ขวา
for x0, x1 in [(330, 650), (950, 1270)]:
    a(f'<rect x="{x0}" y="270" width="{x1-x0}" height="290" rx="10" fill="url(#wall)" stroke="#cfdff1" stroke-width="3"/>')
    a(f'<rect x="{x0}" y="270" width="{x1-x0}" height="18" rx="9" fill="#e2edf9"/>')
    for row in range(4):
        for col in range(5):
            wx = x0 + 26 + col * ((x1 - x0 - 52) / 5)
            wy = 305 + row * 58
            a(f'<rect x="{wx:.0f}" y="{wy}" width="{(x1-x0-52)/5-16:.0f}" height="36" rx="5" fill="url(#glass)"/>')
# อาคารกลาง
a('<rect x="650" y="130" width="300" height="430" rx="12" fill="url(#wall)" stroke="#cfdff1" stroke-width="3"/>')
a('<rect x="650" y="130" width="300" height="22" rx="11" fill="#e2edf9"/>')
for row in range(6):
    for col in range(4):
        a(f'<rect x="{674 + col*66}" y="{230 + row*44}" width="50" height="28" rx="5" fill="url(#glass)"/>')
# ป้ายกากบาท
a('<rect x="752" y="152" width="96" height="62" rx="14" fill="#0071e3"/>')
a('<rect x="791" y="160" width="18" height="46" rx="4" fill="#fff"/><rect x="777" y="174" width="46" height="18" rx="4" fill="#fff"/>')
# ทางเข้า
a('<rect x="690" y="486" width="220" height="16" rx="8" fill="#0071e3" opacity=".85"/>')
a('<rect x="724" y="502" width="152" height="58" rx="4" fill="#bcd7f5"/><rect x="798" y="502" width="4" height="58" fill="#e9f2fc"/>')
# พื้น
a(f'<rect x="0" y="556" width="{W}" height="{640-556}" fill="url(#lawn)"/>')
a(f'<path d="M640 640 L720 560 L880 560 L960 640 Z" fill="#eef2f7"/>')
a(f'<rect x="0" y="600" width="{W}" height="22" fill="#eef2f7"/>')
# ต้นไม้
for x, s in [(200, 1.1), (275, .85), (560, .8), (1040, .8), (1330, 1.05), (1410, .85)]:
    a(f'<g transform="translate({x} 560) scale({s})"><rect x="-6" y="-60" width="12" height="60" rx="4" fill="#c8b59c"/>'
      f'<circle cx="0" cy="-92" r="46" fill="#b9e2c3"/><circle cx="-26" cy="-70" r="30" fill="#a6d8b3"/><circle cx="26" cy="-72" r="32" fill="#a6d8b3"/></g>')
# รถพยาบาล
a('''<g transform="translate(1090 520)">
<rect x="0" y="0" width="120" height="48" rx="8" fill="#fff" stroke="#cfdff1" stroke-width="3"/>
<path d="M120 14 h26 l18 18 v16 h-44 z" fill="#fff" stroke="#cfdff1" stroke-width="3"/>
<rect x="124" y="18" width="20" height="14" rx="3" fill="#bcd7f5"/>
<rect x="0" y="28" width="164" height="6" fill="#ff6b6b" opacity=".8"/>
<rect x="44" y="6" width="8" height="22" rx="2" fill="#ff6b6b"/><rect x="37" y="13" width="22" height="8" rx="2" fill="#ff6b6b"/>
<circle cx="30" cy="50" r="11" fill="#5b6b7d"/><circle cx="132" cy="50" r="11" fill="#5b6b7d"/>
<circle cx="30" cy="50" r="4" fill="#dbe3ec"/><circle cx="132" cy="50" r="4" fill="#dbe3ec"/>
<rect x="56" y="-8" width="18" height="8" rx="3" fill="#0071e3"/></g>''')
a('</g>')
a('</svg>')
open(__import__('os').path.join(__import__('os').path.dirname(__file__), '..', 'docs', 'hospital.svg'), 'w').write('\n'.join(out))
