const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = 3000;
const DB_FILE = path.join(__dirname, 'managehw_data.json');

// ─── JSON FILE DATABASE ───────────────────────────────────────────
// Pure JS — no compilation required. Data stored in managehw_data.json

function loadDB() {
  if (!fs.existsSync(DB_FILE)) {
    const empty = { users:[], tasks:[], timer_sessions:[], subjects:[], _counters:{ users:0, tasks:0, sessions:0, subjects:0 } };
    fs.writeFileSync(DB_FILE, JSON.stringify(empty, null, 2));
    return empty;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function nextId(db, table) {
  db._counters[table] = (db._counters[table] || 0) + 1;
  return db._counters[table];
}

// ─── MIDDLEWARE ───────────────────────────────────────────────────
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'managehw_s3cr3t_k3y_local',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });
  next();
}

// ─── AUTH ROUTES ──────────────────────────────────────────────────

app.post('/api/auth/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password)
    return res.status(400).json({ error: 'All fields are required' });
  if (username.length < 2)
    return res.status(400).json({ error: 'Username must be at least 2 characters' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: 'Invalid email address' });

  const db = loadDB();
  const emailLower = email.toLowerCase().trim();

  if (db.users.find(u => u.username.toLowerCase() === username.toLowerCase().trim()))
    return res.status(400).json({ error: 'Username already taken' });
  if (db.users.find(u => u.email === emailLower))
    return res.status(400).json({ error: 'Email already registered' });

  const colors = ['#e8501e','#2563eb','#16a34a','#9333ea','#0891b2','#d97706'];
  const color = colors[db.users.length % colors.length];
  const hash = bcrypt.hashSync(password, 10);

  const user = {
    id: nextId(db, 'users'),
    username: username.trim(),
    email: emailLower,
    password_hash: hash,
    avatar_color: color,
    created_at: new Date().toISOString()
  };
  db.users.push(user);

  // Seed default subjects for new user
  const defaults = [
    { name:'Math', color:'#2563eb' },
    { name:'English', color:'#16a34a' },
    { name:'Science', color:'#9333ea' },
    { name:'History', color:'#d97706' }
  ];
  defaults.forEach(s => {
    db.subjects.push({ id: nextId(db,'subjects'), user_id: user.id, name: s.name, color: s.color });
  });

  saveDB(db);
  req.session.userId = user.id;
  const { password_hash, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email and password required' });

  const db = loadDB();
  const user = db.users.find(u => u.email === email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash))
    return res.status(401).json({ error: 'Invalid email or password' });

  req.session.userId = user.id;
  const { password_hash, ...safeUser } = user;
  res.json({ success: true, user: safeUser });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(401).json({ error: 'Not found' });
  const { password_hash, ...safeUser } = user;
  res.json(safeUser);
});

app.put('/api/auth/me', requireAuth, (req, res) => {
  const { username, avatar_color } = req.body;
  if (username && username.length < 2)
    return res.status(400).json({ error: 'Username too short' });

  const db = loadDB();
  const user = db.users.find(u => u.id === req.session.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (username) {
    const taken = db.users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.id !== user.id);
    if (taken) return res.status(400).json({ error: 'Username already taken' });
    user.username = username.trim();
  }
  if (avatar_color) user.avatar_color = avatar_color;

  saveDB(db);
  const { password_hash, ...safeUser } = user;
  res.json(safeUser);
});

// ─── SUBJECT ROUTES ───────────────────────────────────────────────

app.get('/api/subjects', requireAuth, (req, res) => {
  const db = loadDB();
  res.json(db.subjects.filter(s => s.user_id === req.session.userId));
});

app.post('/api/subjects', requireAuth, (req, res) => {
  const { name, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const db = loadDB();
  const subject = { id: nextId(db,'subjects'), user_id: req.session.userId, name: name.trim(), color: color||'#2563eb' };
  db.subjects.push(subject);
  saveDB(db);
  res.json(subject);
});

app.delete('/api/subjects/:id', requireAuth, (req, res) => {
  const db = loadDB();
  db.subjects = db.subjects.filter(s => !(s.id == req.params.id && s.user_id === req.session.userId));
  saveDB(db);
  res.json({ success: true });
});

// ─── TASK ROUTES ──────────────────────────────────────────────────

app.get('/api/tasks', requireAuth, (req, res) => {
  const db = loadDB();
  const { filter, subject, search } = req.query;
  const today = new Date().toLocaleDateString('en-CA');
  const weekEnd = (() => { const d = new Date(); d.setDate(d.getDate()+7); return d.toLocaleDateString('en-CA'); })();

  let tasks = db.tasks.filter(t => t.user_id === req.session.userId);

  if (filter === 'pending')      tasks = tasks.filter(t => !t.done);
  else if (filter === 'done')    tasks = tasks.filter(t => t.done);
  else if (filter === 'overdue') tasks = tasks.filter(t => !t.done && t.deadline && t.deadline < today);
  else if (filter === 'today')   tasks = tasks.filter(t => !t.done && t.deadline === today);
  else if (filter === 'week')    tasks = tasks.filter(t => !t.done && t.deadline && t.deadline >= today && t.deadline <= weekEnd);

  if (subject) tasks = tasks.filter(t => t.subject === subject);
  if (search)  tasks = tasks.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

  const pOrder = { High:0, Medium:1, Low:2 };
  tasks.sort((a,b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const pa = pOrder[a.priority] ?? 1, pb = pOrder[b.priority] ?? 1;
    if (pa !== pb) return pa - pb;
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return a.deadline.localeCompare(b.deadline);
  });

  res.json(tasks);
});

app.post('/api/tasks', requireAuth, (req, res) => {
  const { name, subject, type, priority, deadline, notes } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Task name required' });
  const db = loadDB();
  const task = {
    id: nextId(db,'tasks'),
    user_id: req.session.userId,
    name: name.trim(),
    subject: subject || 'General',
    type: type || 'HW',
    priority: priority || 'Medium',
    deadline: deadline || null,
    notes: notes || '',
    done: false,
    done_at: null,
    time_spent: 0,
    created_at: new Date().toISOString()
  };
  db.tasks.push(task);
  saveDB(db);
  res.json(task);
});

app.put('/api/tasks/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const task = db.tasks.find(t => t.id == req.params.id && t.user_id === req.session.userId);
  if (!task) return res.status(404).json({ error: 'Task not found' });

  const { name, subject, type, priority, deadline, notes, done } = req.body;
  if (name     !== undefined) task.name     = name.trim();
  if (subject  !== undefined) task.subject  = subject;
  if (type     !== undefined) task.type     = type;
  if (priority !== undefined) task.priority = priority;
  if (deadline !== undefined) task.deadline = deadline || null;
  if (notes    !== undefined) task.notes    = notes;
  if (done     !== undefined) {
    const wasDone = task.done;
    task.done   = !!done;
    task.done_at = (done && !wasDone) ? new Date().toISOString() : (!done ? null : task.done_at);
  }
  saveDB(db);
  res.json(task);
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  const db = loadDB();
  const before = db.tasks.length;
  db.tasks = db.tasks.filter(t => !(t.id == req.params.id && t.user_id === req.session.userId));
  if (db.tasks.length === before) return res.status(404).json({ error: 'Not found' });
  saveDB(db);
  res.json({ success: true });
});

// ─── TIMER ROUTES ─────────────────────────────────────────────────

app.post('/api/timer/log', requireAuth, (req, res) => {
  const { task_id, duration_seconds } = req.body;
  if (!duration_seconds || duration_seconds < 5)
    return res.status(400).json({ error: 'Duration too short' });

  const db = loadDB();
  const today = new Date().toLocaleDateString('en-CA');

  db.timer_sessions.push({
    id: nextId(db,'sessions'),
    user_id: req.session.userId,
    task_id: task_id || null,
    duration_seconds,
    session_date: today,
    created_at: new Date().toISOString()
  });

  if (task_id) {
    const task = db.tasks.find(t => t.id == task_id && t.user_id === req.session.userId);
    if (task) task.time_spent = (task.time_spent || 0) + duration_seconds;
  }

  saveDB(db);
  res.json({ success: true });
});

// ─── STATS ROUTE ──────────────────────────────────────────────────

app.get('/api/stats', requireAuth, (req, res) => {
  const db = loadDB();
  const uid = req.session.userId;
  const today = new Date().toLocaleDateString('en-CA');

  const logMap = {};
  db.timer_sessions.filter(s => s.user_id === uid).forEach(s => {
    logMap[s.session_date] = (logMap[s.session_date] || 0) + s.duration_seconds;
  });
  const log = Object.entries(logMap)
    .sort((a,b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([date, seconds]) => ({ date, seconds }));

  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = d.toLocaleDateString('en-CA');
    if (logMap[key]) streak++;
    else if (i > 0) break;
  }

  const userTasks = db.tasks.filter(t => t.user_id === uid);
  const pending   = userTasks.filter(t => !t.done).length;
  const done      = userTasks.filter(t => t.done).length;
  const overdue   = userTasks.filter(t => !t.done && t.deadline && t.deadline < today).length;
  const dueToday  = userTasks.filter(t => !t.done && t.deadline === today).length;
  const totalSecs = db.timer_sessions.filter(s => s.user_id === uid).reduce((sum,s) => sum + s.duration_seconds, 0);

  const bySubjectMap = {};
  userTasks.filter(t => !t.done).forEach(t => { bySubjectMap[t.subject] = (bySubjectMap[t.subject]||0)+1; });
  const bySubject = Object.entries(bySubjectMap).map(([subject,c]) => ({ subject, c }));

  res.json({ log, streak, totalSeconds: totalSecs, pending, done, overdue, dueToday, bySubject });
});

// ─── PAGES ────────────────────────────────────────────────────────
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));

app.listen(PORT, () => {
  console.log(`\n  ✦ ManageHw is running!`);
  console.log(`  → Open: http://localhost:${PORT}\n`);
});
