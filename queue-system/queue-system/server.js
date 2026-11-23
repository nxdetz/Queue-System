const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PIN = process.env.ADMIN_PIN || '1234';
const DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE = path.join(DIR, 'queue.json');
fs.mkdirSync(DIR, { recursive: true });

let db = { last: 0, tickets: [] };
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
const save = () => fs.writeFile(FILE, JSON.stringify(db), () => {});

const current = () => db.tickets.find(t => t.status === 'serving');
const waiting = () => db.tickets.filter(t => t.status === 'waiting');
const pub = () => ({ serving: current()?.n || null, last: db.last, waiting: waiting().length });

// ---------- ลูกค้า ----------
app.get('/api/state', (req, res) => res.json(pub()));

app.post('/api/ticket', (req, res) => {
  const name = String(req.body.name || '').trim().slice(0, 30);
  const t = { n: ++db.last, name, status: 'waiting', at: Date.now() };
  db.tickets.push(t);
  save();
  res.json(t);
});

app.get('/api/ticket/:n', (req, res) => {
  const t = db.tickets.find(x => x.n == req.params.n);
  if (!t) return res.status(404).json({ error: 'not found' });
  const ahead = t.status === 'waiting' ? waiting().filter(x => x.n < t.n).length : 0;
  res.json({ ...t, ahead, ...pub() });
});

app.post('/api/ticket/:n/cancel', (req, res) => {
  const t = db.tickets.find(x => x.n == req.params.n);
  if (t && t.status === 'waiting') { t.status = 'cancelled'; save(); }
  res.json({ ok: true });
});

// ---------- พนักงาน ----------
const auth = (req, res, next) =>
  req.get('x-pin') === PIN ? next() : res.status(401).json({ error: 'wrong pin' });

const callNext = () => {
  const done = current();
  if (done) done.status = done.status === 'serving' ? 'done' : done.status;
  const next = waiting()[0];
  if (next) { next.status = 'serving'; next.calledAt = Date.now(); }
};

app.get('/api/admin/list', auth, (req, res) => {
  res.json({ ...pub(), current: current() || null, queue: waiting() });
});
app.post('/api/admin/next', auth, (req, res) => { callNext(); save(); res.json(pub()); });
app.post('/api/admin/skip', auth, (req, res) => {
  const c = current();
  if (c) c.status = 'skipped';
  const next = waiting()[0];
  if (next) { next.status = 'serving'; next.calledAt = Date.now(); }
  save(); res.json(pub());
});
app.post('/api/admin/reset', auth, (req, res) => {
  db = { last: 0, tickets: [] }; save(); res.json(pub());
});

app.listen(process.env.PORT || 3000, () => console.log('Queue system running'));
