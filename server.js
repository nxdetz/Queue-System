const express = require('express');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { Server } = require('socket.io');

const PORT = process.env.PORT || 3000;
const PIN = String(process.env.STAFF_PIN || '1234');
const TZ = process.env.TZ_NAME || 'Asia/Bangkok';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const FILE = path.join(DATA_DIR, 'db.json');

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
const defaults = () => ({
  date: today(), nextId: 1, counts: {}, tickets: [], history: [],
  settings: { org: 'ศูนย์บริการลูกค้า', avgMin: 5, auto: true, noShowSec: 60 },
  services: [
    { id: 'A', name: 'บริการทั่วไป', color: '#0f9d8a' },
    { id: 'B', name: 'ชำระเงิน', color: '#3b6fd4' },
    { id: 'C', name: 'สอบถามข้อมูล', color: '#d98a00' }
  ],
  counters: [1, 2, 3].map(i => ({ id: i, name: `ช่อง ${i}`, services: ['A', 'B', 'C'], open: true, current: null }))
});

let S;
try { S = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { S = defaults(); }
S.settings = { ...defaults().settings, ...S.settings };

let timer;
const save = () => {
  clearTimeout(timer);
  timer = setTimeout(() => fs.writeFile(FILE + '.tmp', JSON.stringify(S), e => { if (!e) fs.rename(FILE + '.tmp', FILE, () => {}); }), 300);
};

const app = express();
const server = http.createServer(app);
const io = new Server(server);
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- helpers ---------- */
function rollover() {
  if (S.date === today()) return;
  S.history = (S.history || []).concat({ date: S.date, total: S.tickets.length, served: S.tickets.filter(t => t.status === 'done').length }).slice(-60);
  S.date = today(); S.counts = {}; S.tickets = [];
  S.counters.forEach(c => (c.current = null));
}
const svc = id => S.services.find(s => s.id === id);
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

function avgServiceMin() {
  const d = S.tickets.filter(t => t.status === 'done' && t.calledAt && t.doneAt).map(t => (t.doneAt - t.calledAt) / 60000);
  return d.length >= 3 ? Math.max(1, mean(d)) : S.settings.avgMin;
}

function info(t) {
  const s = svc(t.service) || {};
  const c = S.counters.find(c => c.id === t.counter);
  const ahead = t.status === 'waiting' ? S.tickets.filter(x => x.status === 'waiting' && x.service === t.service && x.id < t.id).length : 0;
  const open = S.counters.filter(c => c.open && c.services.includes(t.service)).length || 1;
  return { ...t, serviceName: s.name, color: s.color, counterName: c && c.name, ahead, eta: Math.ceil(((ahead + 1) * avgServiceMin()) / open) };
}

const pub = () => ({
  date: S.date, settings: S.settings,
  services: S.services.map(s => ({ ...s, waiting: S.tickets.filter(t => t.service === s.id && t.status === 'waiting').length })),
  counters: S.counters.map(c => ({ ...c, ticket: c.current ? info(S.tickets.find(t => t.id === c.current)) : null })),
  waiting: S.tickets.filter(t => t.status === 'waiting').map(({ id, number, service }) => ({ id, number, service })),
  recent: S.tickets.filter(t => t.calledAt && t.status === 'calling').sort((a, b) => b.calledAt - a.calledAt).slice(0, 6).map(info)
});
const broadcast = () => { io.emit('state', pub()); save(); };

function callNext(c) {
  if (!c.open || c.current) return null;
  const t = S.tickets.find(t => t.status === 'waiting' && c.services.includes(t.service));
  if (!t) return null;
  Object.assign(t, { status: 'calling', counter: c.id, calledAt: Date.now(), calls: 1 });
  c.current = t.id;
  io.emit('call', { id: t.id, number: t.number, counter: c.name });
  return t;
}
function finish(c, status) {
  const t = S.tickets.find(t => t.id === c.current);
  if (t) { t.status = status; t.doneAt = Date.now(); }
  c.current = null;
  if (S.settings.auto) callNext(c);
}
const dispatch = () => { if (S.settings.auto) S.counters.forEach(callNext); };

/* ---------- public API ---------- */
app.get('/health', (_, res) => res.send('ok'));
app.get('/api/state', (_, res) => { rollover(); res.json(pub()); });

app.post('/api/tickets', (req, res) => {
  rollover();
  const s = svc(req.body.service);
  if (!s) return res.status(400).json({ error: 'ไม่พบประเภทบริการ' });
  const n = (S.counts[s.id] = (S.counts[s.id] || 0) + 1);
  const t = { id: S.nextId++, service: s.id, number: s.id + String(n).padStart(3, '0'), status: 'waiting', createdAt: Date.now() };
  S.tickets.push(t);
  dispatch();
  broadcast();
  res.json(info(t));
});

app.get('/api/tickets/:id', (req, res) => {
  const t = S.tickets.find(x => x.id === +req.params.id);
  t ? res.json(info(t)) : res.status(404).json({ error: 'ไม่พบบัตรคิว หรือหมดอายุแล้ว' });
});

/* ---------- staff API ---------- */
const auth = (req, res, next) => (req.get('x-pin') === PIN ? next() : res.status(401).json({ error: 'PIN ไม่ถูกต้อง' }));
app.post('/api/auth', auth, (_, res) => res.json({ ok: true }));

app.post('/api/counters/:id/:action', auth, (req, res) => {
  rollover();
  const c = S.counters.find(c => c.id === +req.params.id);
  if (!c) return res.status(404).json({ error: 'ไม่พบช่องบริการ' });
  const need = () => (c.current ? null : res.status(400).json({ error: 'ยังไม่มีคิวที่กำลังเรียก' }));
  switch (req.params.action) {
    case 'next':
      if (c.current) return res.status(400).json({ error: 'กรุณาปิดคิวปัจจุบันก่อน' });
      callNext(c); break;
    case 'recall': {
      if (need()) return;
      const t = S.tickets.find(t => t.id === c.current);
      t.calls++; t.calledAt = Date.now();
      io.emit('call', { id: t.id, number: t.number, counter: c.name }); break;
    }
    case 'done': case 'skip': case 'donenext':
      if (need()) return;
      finish(c, req.params.action === 'skip' ? 'skipped' : 'done');
      if (req.params.action === 'donenext') callNext(c);
      break;
    case 'toggle':
      c.open = !c.open; if (c.open && S.settings.auto) callNext(c); break;
    default: return res.status(400).json({ error: 'คำสั่งไม่ถูกต้อง' });
  }
  broadcast();
  res.json({ ok: true });
});

app.put('/api/config', auth, (req, res) => {
  const b = req.body;
  if (b.settings) {
    const s = b.settings;
    S.settings = { org: String(s.org || '').slice(0, 60) || S.settings.org, avgMin: Math.max(1, +s.avgMin || 5), noShowSec: Math.max(0, +s.noShowSec || 0), auto: !!s.auto };
  }
  if (Array.isArray(b.services) && b.services.length) {
    const m = new Map();
    b.services.forEach(s => { const id = String(s.id || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 2); if (id && !m.has(id)) m.set(id, { id, name: String(s.name || id).slice(0, 40), color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#0f9d8a' }); });
    if (m.size) S.services = [...m.values()];
  }
  if (Array.isArray(b.counters) && b.counters.length) {
    let max = Math.max(0, ...b.counters.map(c => +c.id || 0));
    S.counters = b.counters.map(c => {
      const id = +c.id || ++max, old = S.counters.find(o => o.id === id);
      return { id, name: String(c.name || `ช่อง ${id}`).slice(0, 30), open: c.open !== false, services: (c.services || []).filter(x => svc(x)), current: old ? old.current : null };
    });
  }
  S.tickets.forEach(t => { if (t.status === 'calling' && !S.counters.some(c => c.current === t.id)) t.status = 'waiting'; });
  dispatch(); broadcast(); res.json({ ok: true });
});

app.get('/api/stats', auth, (_, res) => {
  rollover();
  const T = S.tickets, called = T.filter(t => t.calledAt), done = T.filter(t => t.status === 'done');
  res.json({
    total: T.length, waiting: T.filter(t => t.status === 'waiting').length, served: done.length, skipped: T.filter(t => t.status === 'skipped').length,
    avgWaitMin: +(mean(called.map(t => (t.calledAt - t.createdAt) / 60000))).toFixed(1),
    avgServiceMin: +(mean(done.map(t => (t.doneAt - t.calledAt) / 60000))).toFixed(1),
    perService: S.services.map(s => ({ ...s, total: T.filter(t => t.service === s.id).length, served: done.filter(t => t.service === s.id).length })),
    history: S.history.slice(-7)
  });
});

app.post('/api/reset', auth, (_, res) => {
  S.counts = {}; S.tickets = []; S.counters.forEach(c => (c.current = null));
  broadcast(); res.json({ ok: true });
});

/* ---------- background jobs: ข้ามคิวที่ไม่มา + เปลี่ยนวัน ---------- */
setInterval(() => {
  const before = S.date;
  rollover();
  let changed = before !== S.date;
  if (S.settings.auto && S.settings.noShowSec > 0) {
    S.counters.forEach(c => {
      const t = c.current && S.tickets.find(t => t.id === c.current);
      if (t && Date.now() - t.calledAt > S.settings.noShowSec * 1000) { finish(c, 'skipped'); changed = true; }
    });
  }
  if (changed) broadcast();
}, 5000);

io.on('connection', s => s.emit('state', pub()));
server.listen(PORT, '0.0.0.0', () => console.log(`Queue system running on :${PORT} (PIN=${PIN === '1234' ? '1234 — เปลี่ยนด้วย STAFF_PIN!' : 'custom'})`));
