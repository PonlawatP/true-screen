# True Screen Phase 1 prototype runbook

เอกสารนี้เป็นวิธีทดลอง prototype บน Fedora 44, GNOME 50 และ Wayland โดยยังไม่ใช่
แพ็กเกจสำหรับผู้ใช้ทั่วไป

## 1. ตรวจ prerequisites

ต้องมีคำสั่งเหล่านี้จากระบบ:

```bash
gjs --version
gnome-shell --version
gnome-extensions version
```

ตัว GUI ใช้ GJS, GTK 4 และ Libadwaita ส่วน extension รองรับ GNOME Shell 50 ตาม
`metadata.json`

## 2. รัน automated tests

จาก root ของ repository:

```bash
npm test
./scripts/test-app.sh
./scripts/run-headless-spike.sh
./scripts/test-extension-routing.sh
```

สองคำสั่งท้ายเปิด GNOME Shell test session แบบแยกจาก desktop ปัจจุบัน จึงไม่ควร
ย้าย cursor ของ session ที่กำลังใช้งาน

## 3. ติดตั้ง extension สำหรับ session จริง

```bash
./scripts/install-extension.sh
```

ถ้าเป็นการติดตั้ง UUID นี้ครั้งแรก GNOME Shell ที่กำลังรันมักยังไม่เห็น extension
ใหม่ ให้ logout แล้ว login กลับเข้ามาหนึ่งครั้ง จากนั้นรัน:

```bash
gnome-extensions enable true-screen@plutostudio.io
gnome-extensions info true-screen@plutostudio.io
```

ตั้งแต่ extension version 4 เป็นต้นไป `extension.js` เป็น stable bootstrap ซึ่งโหลด
implementation ด้วย cache-busting การแก้โค้ด implementation รอบถัดไปใช้คำสั่งเดิม:

```bash
./scripts/install-extension.sh
```

installer จะ hot-deploy และ reload เฉพาะ True Screen โดยไม่ restart GNOME Shell หรือ
ปิดแอปใน session คำสั่ง reload implementation ที่ติดตั้งไว้แล้วโดยตรงคือ
`./scripts/reload-extension.sh` การแก้ bootstrap/metadata เองยังอาจต้อง login ใหม่ แต่
ควรเกิดขึ้นน้อยมาก

## 4. เปิด GUI และ Apply to desktop

```bash
./scripts/run-app.sh
```

1. ลากการ์ดเพื่อจัดตำแหน่งจอตามตำแหน่งจริงบนโต๊ะ
2. ลาก handle สีเหลืองมุมขวาล่างเพื่อปรับขนาดโดยคง aspect ratio
3. ปรับ X, Y, Width และ Height หน่วยมิลลิเมตรจาก inspector ได้
4. หากต้องการเทียบสองจอ ให้เลือกจอหลัก เลือกอีกจอใน `Measure selected monitor
   against` แล้วเปิด `Ruler overlay`
5. อ่านแถบสีบน ruler แกน X/Y และค่า origin delta, gap, overlap ด้านล่าง canvas;
   ค่าจะเปลี่ยนทันทีระหว่างลากหรือ resize
6. เปิด `Remap cursor` เฉพาะเมื่อต้องการให้ extension แก้ตำแหน่ง cursor ตอนข้ามจอ
7. กด `Apply to desktop` เพื่อส่ง layout, สถานะ cursor และ desktop ruler ไปยัง
   extension พร้อมกัน

แอปเขียน `$XDG_CONFIG_HOME/true-screen/layout.json` และ extension จะ reload ไฟล์
อัตโนมัติ การกด Apply ครั้งต่อไปไม่ต้อง restart GNOME Shell เมื่อเปิด ruler แล้ว
จอสองใบที่เลือกจะมีกรอบและสเกลโปร่งใสแสดงบน desktop จริง โดย overlay ไม่รับ click
และไม่ขวางการใช้งานหน้าต่าง

mini-map มุมขวาบน highlight จอที่กำลังแสดง overlay อยู่ ส่วนแถบสีเขียว `MAPPED
EDGE` คือช่วงขอบที่จอสองใบแตะกันใน physical layout และ cursor remap ทำงาน หากไม่มี
แถบนี้ให้กลับไปลากจอสองใบให้ขอบแตะกันแล้ว Apply ใหม่

ตรวจสถานะ router หลังลองข้ามจอ 2–3 ครั้งด้วย:

```bash
./scripts/inspect-extension-state.js
```

ค่า `warps` ต้องเพิ่มเมื่อข้ามแถบ `MAPPED EDGE`; `lastRoute.action` เป็น `warp`
เมื่อแก้พิกัดสำเร็จ หรือเป็น `block` พร้อม `reason: not-adjacent` เมื่อ layout ยังมี gap
ค่า `edgePushes` จะเพิ่มเมื่อ extension สร้างเส้นทางข้ามเองในช่วง physical mapping ที่
อยู่นอก native overlap ของ GNOME ซึ่งทำให้เส้นทางไปและกลับสมมาตรแม้ปรับขนาดจอ

สรุปลำดับคือ **จัด draft → เลือก Remap cursor/Ruler overlay → Apply to desktop**
ไม่จำเป็นต้องเปิด Remap cursor เพื่อใช้ ruler และไม่จำเป็นต้องเปิด ruler เพื่อ remap
cursor

ควรทดลองช้า ๆ ที่กลางขอบจอก่อน แล้วจึงทดสอบตำแหน่งบน/ล่างของขอบซึ่งมีการจัด
offset ไว้

## 5. หยุดและกู้คืน

ปิด `Remap cursor` แล้วกด `Apply to desktop` เพื่อให้ extension ยังเปิดอยู่แต่ไม่แก้ cursor
หรือหยุดทันทีจาก terminal ด้วย:

```bash
gnome-extensions disable true-screen@plutostudio.io
```

ถอน development extension ด้วย:

```bash
./scripts/uninstall-extension.sh
```

หาก layout ผิดจนควบคุม cursor ลำบาก ให้ใช้ keyboard เปิด terminal แล้ว disable
extension ด้วยคำสั่งด้านบน ขณะนี้ prototype ยังไม่มี global emergency shortcut

## 6. สิ่งที่ prototype รอบนี้ทำได้

- อ่าน active monitors จาก Mutter DisplayConfig รวม scale และ rotation transform
- หมุน physical width/height ตาม transform เช่นจอ `90°` จะใช้สัดส่วน portrait
- อ่าน physical size จาก EDID เมื่อระบบเปิดเผยข้อมูล และมี fallback
- แสดงจอตามสัดส่วนจริง พร้อม drag, snap, resize และ numeric editing
- เปิด ruler overlay สำหรับจอสองใบ พร้อม scale, span, offset, gap และ overlap
- map จุดข้ามของจอซึ่งขนาด/ความละเอียดต่างกันด้วยหน่วย physical millimetres
- remap เฉพาะช่วงขอบที่มี physical overlap; ช่วงอื่น fail-open ให้ GNOME ข้ามตามปกติ
  เพื่อไม่ให้ cursor ถูกกักหรือดึงกลับจอเดิม
- วาด ruler overlay แบบ non-interactive บน desktop จริงของจอสองใบที่เลือก
- highlight current screen ใน pair mini-map และช่วง mapped edge บนจอจริง
- reload layout หลัง Apply to desktop โดยอัตโนมัติ

## 7. Known limitations

- ยังต้อง logout/login หนึ่งครั้งหลังติดตั้ง extension UUID ใหม่ครั้งแรก
- routing ทำงานเมื่อ Mutter ส่ง transition ไปยัง logical monitor ข้างเคียงก่อน จึงยัง
  สร้างทางข้ามใหม่ระหว่างจอที่ GNOME วางไม่ติดกันไม่ได้
- ยังไม่มี emergency shortcut, validation UI, profile, hot-plug recovery เต็มรูปแบบ
  หรือแพ็กเกจ RPM/Flatpak
- เกมที่ใช้ locked/relative pointer, remote desktop, stylus และ multi-seat ยังไม่รองรับ
- D-Bus debug endpoint ของ M0 ยังอยู่สำหรับ integration test และต้องเอาออกหรือจำกัด
  สิทธิ์ก่อนใช้งาน production
- automated tests ผ่านแล้ว แต่ยังไม่ถือว่าผ่าน real-monitor soak test 30 นาที
