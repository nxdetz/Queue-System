const express = require('express'), fs = require('fs'), path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ====== ตั้งค่า (แก้ได้ตามร้าน) ======
const PIN = process.env.ADMIN_PIN || '1234';
const SHOP = process.env.SHOP_NAME || 'Queue';
const SERVICES = [
  { id: 'A', name: 'บริการทั่วไป', icon: '🧾' },
  { id: 'B', name: 'ชำระเงิน', icon: '💳' },
  { id: 'C', name: 'สอบถามข้อมูล', icon: '💬' },
];
const COUNTERS = [1, 2, 3];
// =====================================

const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'queue.json');
fs.mkdirSync(DIR, { recursive: true });
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
const fresh = () => ({ id: 0, seq: {}, tickets: [], day: today() });
let db = fresh();
try { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (d.seq) db = d; } catch {}
const save = () => fs.writeFile(FILE, JSON.stringify(db), () => {});
app.use((q, r, n) => { if (db.day !== today()) { db = fresh(); save(); } n(); }); // รีเซ็ตทุกวันอัตโนมัติ

const by = s => db.tickets.filter(t => t.status === s);
const avg = () => {
  const d = db.tickets.filter(t => t.status === 'done' && t.doneAt && t.calledAt);
  return d.length ? Math.max(1, Math.round(d.reduce((a, t) => a + t.doneAt - t.calledAt, 0) / d.length / 6000) / 10) : 5;
};
const brief = t => ({ code: t.code, counter: t.counter, service: t.service, calledAt: t.calledAt, name: t.name });
const pub = () => ({
  shop: SHOP, services: SERVICES, counters: COUNTERS,
  waiting: Object.fromEntries(SERVICES.map(s => [s.id, by('waiting').filter(t => t.service === s.id).length])),
  serving: by('serving').map(brief),
  recent: db.tickets.filter(t => t.calledAt).sort((a, b) => b.calledAt - a.calledAt).slice(0, 6).map(brief),
  stats: { total: db.tickets.length, waiting: by('waiting').length, done: by('done').length, skipped: by('skipped').length, avg: avg() },
});
const view = t => {
  const ahead = t.status === 'waiting' ? by('waiting').filter(x => x.service === t.service && x.id < t.id).length : 0;
  return { ...t, ahead, eta: Math.ceil((ahead + 1) * avg() / COUNTERS.length) };
};

app.get('/api/state', (q, r) => r.json(pub()));
app.post('/api/ticket', (q, r) => {
  const sv = SERVICES.find(s => s.id === q.body.service) || SERVICES[0];
  db.seq[sv.id] = (db.seq[sv.id] || 0) + 1;
  const t = { id: ++db.id, service: sv.id, code: sv.id + String(db.seq[sv.id]).padStart(3, '0'),
    name: String(q.body.name || '').trim().slice(0, 30), status: 'waiting', at: Date.now() };
  db.tickets.push(t); save(); r.json(view(t));
});
app.get('/api/ticket/:id', (q, r) => {
  const t = db.tickets.find(x => x.id == q.params.id);
  t ? r.json({ ...view(t), ...pub() }) : r.status(404).json({ error: 'not found' });
});
app.post('/api/ticket/:id/cancel', (q, r) => {
  const t = db.tickets.find(x => x.id == q.params.id);
  if (t && t.status === 'waiting') { t.status = 'cancelled'; save(); }
  r.json({ ok: 1 });
});

// ====== พนักงาน ======
const auth = (q, r, n) => q.get('x-pin') === PIN ? n() : r.status(401).json({ error: 'pin' });
const finish = (c, st) => { const t = by('serving').find(x => x.counter == c); if (t) { t.status = st; t.doneAt = Date.now(); } };
const callNext = (c, sv) => {
  const n = by('waiting').filter(t => !sv || t.service === sv).sort((a, b) => a.id - b.id)[0];
  if (n) Object.assign(n, { status: 'serving', counter: +c, calledAt: Date.now() });
};
app.get('/api/admin/list', auth, (q, r) => r.json({ ...pub(), queue: by('waiting').map(t => ({ code: t.code, service: t.service, name: t.name, at: t.at })) }));
app.post('/api/admin/call', auth, (q, r) => { finish(q.body.counter, 'done'); callNext(q.body.counter, q.body.service); save(); r.json(pub()); });
app.post('/api/admin/done', auth, (q, r) => { finish(q.body.counter, 'done'); save(); r.json(pub()); });
app.post('/api/admin/skip', auth, (q, r) => { finish(q.body.counter, 'skipped'); callNext(q.body.counter, q.body.service); save(); r.json(pub()); });
app.post('/api/admin/recall', auth, (q, r) => { const t = by('serving').find(x => x.counter == q.body.counter); if (t) t.calledAt = Date.now(); save(); r.json(pub()); });
app.post('/api/admin/reset', auth, (q, r) => { db = fresh(); save(); r.json(pub()); });

app.listen(process.env.PORT || 3000, () => console.log('Queue system running'));
