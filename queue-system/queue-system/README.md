# ระบบจัดการคิว (Queue System)

ระบบคิวแบบมินิมอล ใช้งานง่าย
- `/` หน้าลูกค้า: รับบัตรคิว ดูคิวปัจจุบัน และดูว่ารออีกกี่คิว (อัปเดตอัตโนมัติ)
- `/admin.html` หน้าพนักงาน: เรียกคิวถัดไป / ข้าม / รีเซ็ต (ใช้ PIN)

## รันในเครื่อง
```bash
npm install
ADMIN_PIN=1234 npm start   # เปิด http://localhost:3000
```

## อัปขึ้น GitHub
```bash
git init && git add . && git commit -m "init queue system"
git branch -M main
git remote add origin https://github.com/<username>/queue-system.git
git push -u origin main
```

## Deploy บน Railway
1. เข้า railway.app → **New Project** → **Deploy from GitHub repo** → เลือก repo นี้
2. ไปที่ **Variables** เพิ่ม `ADMIN_PIN` = รหัสที่ต้องการ (อย่าใช้ 1234)
3. **Settings → Networking → Generate Domain** เพื่อรับลิงก์
4. (แนะนำ) เก็บข้อมูลไม่ให้หายตอน redeploy: **+ New → Volume** mount ที่ `/data` แล้วเพิ่มตัวแปร `DATA_DIR=/data`

ทุกครั้งที่ `git push` Railway จะ deploy ให้อัตโนมัติ
