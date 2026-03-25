const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;

// ═══════════════════════════════════════════════════════════════════
// CLASS 1 — Database
// Handles all reading and writing to the JSON file.
// Think of this as the "storage layer" of the app.
// ═══════════════════════════════════════════════════════════════════
class Database {
  constructor(filePath) {
    this.filePath = filePath;
    this._ensureFile();
  }

  // Make sure the database file exists, create it empty if not
  _ensureFile() {
    if (!fs.existsSync(this.filePath)) {
      const empty = {
        users: [],
        tasks: [],
        timer_sessions: [],
        subjects: [],
        _counters: { users: 0, tasks: 0, sessions: 0, subjects: 0 }
      };
      fs.writeFileSync(this.filePath, JSON.stringify(empty, null, 2));
    }
  }

  // Load and return the full database object
  load() {
    return JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
  }

  // Save the full database object back to file
  save(data) {
    fs.writeFileSync(this.filePath, JSON.stringify(data, null, 2));
  }

  // Generate the next auto-increment ID for a given table
  nextId(data, table) {
    data._counters[table] = (data._counters[table] || 0) + 1;
    return data._counters[table];
  }
}


// ═══════════════════════════════════════════════════════════════════
// CLASS 2 — AuthService
// Handles everything related to users: register, login, profile.
// Uses the Database class to read/write user data.
// ═══════════════════════════════════════════════════════════════════
class AuthService {
  constructor(db) {
    this.db = db; // receives a Database instance
  }

  // Strip password hash before sending user to client
  _safeUser(user) {
    const { password_hash, ...safe } = user;
    return safe;
  }

  // Validate registration fields
  _validateRegister(username, email, password) {
    if (!username || !email || !password) return 'All fields are required';
    if (username.length < 2)             return 'Username must be at least 2 characters';
    if (password.length < 6)             return 'Password must be at least 6 characters';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Invalid email address';
    return null; // null = no error
  }

  register(username, email, password) {
    const error = this._validateRegister(username, email, password);
    if (error) throw new Error(error);

    const data = this.db.load();
    const emailLower = email.toLowerCase().trim();

    if (data.users.find(u => u.username.toLowerCase() === username.toLowerCase().trim()))
      throw new Error('Username already taken');
    if (data.users.find(u => u.email === emailLower))
      throw new Error('Email already registered');

    const colors = ['#e8501e', '#2563eb', '#16a34a', '#9333ea', '#0891b2', '#d97706'];
    const user = {
      id: this.db.nextId(data, 'users'),
      username: username.trim(),
      email: emailLower,
      password_hash: bcrypt.hashSync(password, 10),
      avatar_color: colors[data.users.length % colors.length],
      created_at: new Date().toISOString()
    };
    data.users.push(user);

    // Seed default subjects for the new user
    const defaults = [
      { name: 'Math',    color: '#2563eb' },
      { name: 'English', color: '#16a34a' },
      { name: 'Science', color: '#9333ea' },
      { name: 'History', color: '#d97706' }
    ];
    defaults.forEach(s => {
      data.subjects.push({
        id: this.db.nextId(data, 'subjects'),
        user_id: user.id,
        name: s.name,
        color: s.color
      });
    });

    this.db.save(data);
    return this._safeUser(user);
  }

  login(email, password) {
    if (!email || !password) throw new Error('Email and password required');
    const data = this.db.load();
    const user = data.users.find(u => u.email === email.toLowerCase().trim());
    if (!user || !bcrypt.compareSync(password, user.password_hash))
      throw new Error('Invalid email or password');
    return this._safeUser(user);
  }

  getUser(userId) {
    const data = this.db.load();
    const user = data.users.find(u => u.id === userId);
    if (!user) throw new Error('User not found');
    return this._safeUser(user);
  }

  updateUser(userId, { username, avatar_color }) {
    if (username && username.length < 2) throw new Error('Username too short');
    const data = this.db.load();
    const user = data.users.find(u => u.id === userId);
    if (!user) throw new Error('User not found');
    if (username) {
      const taken = data.users.find(u => u.username.toLowerCase() === username.toLowerCase() && u.id !== userId);
      if (taken) throw new Error('Username already taken');
      user.username = username.trim();
    }
    if (avatar_color) user.avatar_color = avatar_color;
    this.db.save(data);
    return this._safeUser(user);
  }
}


// ═══════════════════════════════════════════════════════════════════
// CLASS 3 — TaskService
// Handles tasks, subjects, timer sessions, and stats.
// Contains all the business logic for the homework manager features.
// ═══════════════════════════════════════════════════════════════════
class TaskService {
  constructor(db) {
    this.db = db; // receives a Database instance
  }

  // ── Subjects ──────────────────────────────────────────────────────

  getSubjects(userId) {
    const data = this.db.load();
    return data.subjects.filter(s => s.user_id === userId);
  }

  addSubject(userId, name, color) {
    if (!name) throw new Error('Name required');
    const data = this.db.load();
    const subject = {
      id: this.db.nextId(data, 'subjects'),
      user_id: userId,
      name: name.trim(),
      color: color || '#2563eb'
    };
    data.subjects.push(subject);
    this.db.save(data);
    return subject;
  }

  deleteSubject(userId, subjectId) {
    const data = this.db.load();
    data.subjects = data.subjects.filter(s => !(s.id == subjectId && s.user_id === userId));
    this.db.save(data);
  }

  // ── Tasks ─────────────────────────────────────────────────────────

  getTasks(userId, { filter, subject, search } = {}) {
    const data = this.db.load();
    const today = new Date().toLocaleDateString('en-CA');
    const weekEnd = (() => {
      const d = new Date(); d.setDate(d.getDate() + 7);
      return d.toLocaleDateString('en-CA');
    })();

    let tasks = data.tasks.filter(t => t.user_id === userId);

    // Apply filter
    if      (filter === 'pending')  tasks = tasks.filter(t => !t.done);
    else if (filter === 'done')     tasks = tasks.filter(t => t.done);
    else if (filter === 'overdue')  tasks = tasks.filter(t => !t.done && t.deadline && t.deadline < today);
    else if (filter === 'today')    tasks = tasks.filter(t => !t.done && t.deadline === today);
    else if (filter === 'week')     tasks = tasks.filter(t => !t.done && t.deadline && t.deadline >= today && t.deadline <= weekEnd);

    if (subject) tasks = tasks.filter(t => t.subject === subject);
    if (search)  tasks = tasks.filter(t => t.name.toLowerCase().includes(search.toLowerCase()));

    // Sort: done last → priority → deadline
    const pOrder = { High: 0, Medium: 1, Low: 2 };
    tasks.sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const pa = pOrder[a.priority] ?? 1, pb = pOrder[b.priority] ?? 1;
      if (pa !== pb) return pa - pb;
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });

    return tasks;
  }

  createTask(userId, { name, subject, type, priority, deadline, notes }) {
    if (!name || !name.trim()) throw new Error('Task name required');
    const data = this.db.load();
    const task = {
      id: this.db.nextId(data, 'tasks'),
      user_id: userId,
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
    data.tasks.push(task);
    this.db.save(data);
    return task;
  }

  updateTask(userId, taskId, fields) {
    const data = this.db.load();
    const task = data.tasks.find(t => t.id == taskId && t.user_id === userId);
    if (!task) throw new Error('Task not found');

    const { name, subject, type, priority, deadline, notes, done } = fields;
    if (name     !== undefined) task.name     = name.trim();
    if (subject  !== undefined) task.subject  = subject;
    if (type     !== undefined) task.type     = type;
    if (priority !== undefined) task.priority = priority;
    if (deadline !== undefined) task.deadline = deadline || null;
    if (notes    !== undefined) task.notes    = notes;
    if (done     !== undefined) {
      const wasDone = task.done;
      task.done    = !!done;
      task.done_at = (done && !wasDone) ? new Date().toISOString() : (!done ? null : task.done_at);
    }

    this.db.save(data);
    return task;
  }

  deleteTask(userId, taskId) {
    const data = this.db.load();
    const before = data.tasks.length;
    data.tasks = data.tasks.filter(t => !(t.id == taskId && t.user_id === userId));
    if (data.tasks.length === before) throw new Error('Task not found');
    this.db.save(data);
  }

  // ── Timer ─────────────────────────────────────────────────────────

  logTimer(userId, taskId, durationSeconds) {
    if (!durationSeconds || durationSeconds < 5) throw new Error('Duration too short');
    const data = this.db.load();
    data.timer_sessions.push({
      id: this.db.nextId(data, 'sessions'),
      user_id: userId,
      task_id: taskId || null,
      duration_seconds: durationSeconds,
      session_date: new Date().toLocaleDateString('en-CA'),
      created_at: new Date().toISOString()
    });
    if (taskId) {
      const task = data.tasks.find(t => t.id == taskId && t.user_id === userId);
      if (task) task.time_spent = (task.time_spent || 0) + durationSeconds;
    }
    this.db.save(data);
  }

  // ── Stats ─────────────────────────────────────────────────────────

  getStats(userId) {
    const data = this.db.load();
    const today = new Date().toLocaleDateString('en-CA');

    // Build daily log map
    const logMap = {};
    data.timer_sessions
      .filter(s => s.user_id === userId)
      .forEach(s => { logMap[s.session_date] = (logMap[s.session_date] || 0) + s.duration_seconds; });

    const log = Object.entries(logMap)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-30)
      .map(([date, seconds]) => ({ date, seconds }));

    // Calculate study streak
    let streak = 0;
    for (let i = 0; i < 365; i++) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const key = d.toLocaleDateString('en-CA');
      if (logMap[key]) streak++;
      else if (i > 0) break;
    }

    const userTasks = data.tasks.filter(t => t.user_id === userId);
    const bySubjectMap = {};
    userTasks.filter(t => !t.done).forEach(t => {
      bySubjectMap[t.subject] = (bySubjectMap[t.subject] || 0) + 1;
    });

    return {
      log,
      streak,
      totalSeconds: data.timer_sessions.filter(s => s.user_id === userId).reduce((sum, s) => sum + s.duration_seconds, 0),
      pending:   userTasks.filter(t => !t.done).length,
      done:      userTasks.filter(t => t.done).length,
      overdue:   userTasks.filter(t => !t.done && t.deadline && t.deadline < today).length,
      dueToday:  userTasks.filter(t => !t.done && t.deadline === today).length,
      bySubject: Object.entries(bySubjectMap).map(([subject, c]) => ({ subject, c }))
    };
  }
}


// ═══════════════════════════════════════════════════════════════════
// APP SETUP — Wire everything together
// ═══════════════════════════════════════════════════════════════════
const db          = new Database(path.join(__dirname, 'managehw_data.json'));
const authService = new AuthService(db);
const taskService = new TaskService(db);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: process.env.SESSION_SECRET || 'managehw_s3cr3t_k3y_local',
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
  try {
    const user = authService.register(req.body.username, req.body.email, req.body.password);
    req.session.userId = user.id;
    res.json({ success: true, user });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const user = authService.login(req.body.email, req.body.password);
    req.session.userId = user.id;
    res.json({ success: true, user });
  } catch (e) { res.status(401).json({ error: e.message }); }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  try {
    res.json(authService.getUser(req.session.userId));
  } catch (e) { res.status(401).json({ error: e.message }); }
});

app.put('/api/auth/me', requireAuth, (req, res) => {
  try {
    res.json(authService.updateUser(req.session.userId, req.body));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── SUBJECT ROUTES ───────────────────────────────────────────────

app.get('/api/subjects', requireAuth, (req, res) => {
  res.json(taskService.getSubjects(req.session.userId));
});

app.post('/api/subjects', requireAuth, (req, res) => {
  try {
    res.json(taskService.addSubject(req.session.userId, req.body.name, req.body.color));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.delete('/api/subjects/:id', requireAuth, (req, res) => {
  taskService.deleteSubject(req.session.userId, req.params.id);
  res.json({ success: true });
});

// ─── TASK ROUTES ──────────────────────────────────────────────────

app.get('/api/tasks', requireAuth, (req, res) => {
  res.json(taskService.getTasks(req.session.userId, req.query));
});

app.post('/api/tasks', requireAuth, (req, res) => {
  try {
    res.json(taskService.createTask(req.session.userId, req.body));
  } catch (e) { res.status(400).json({ error: e.message }); }
});

app.put('/api/tasks/:id', requireAuth, (req, res) => {
  try {
    res.json(taskService.updateTask(req.session.userId, req.params.id, req.body));
  } catch (e) { res.status(404).json({ error: e.message }); }
});

app.delete('/api/tasks/:id', requireAuth, (req, res) => {
  try {
    taskService.deleteTask(req.session.userId, req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(404).json({ error: e.message }); }
});

// ─── TIMER ROUTES ─────────────────────────────────────────────────

app.post('/api/timer/log', requireAuth, (req, res) => {
  try {
    taskService.logTimer(req.session.userId, req.body.task_id, req.body.duration_seconds);
    res.json({ success: true });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// ─── STATS ROUTE ──────────────────────────────────────────────────

app.get('/api/stats', requireAuth, (req, res) => {
  res.json(taskService.getStats(req.session.userId));
});

// ─── PAGES ────────────────────────────────────────────────────────

app.get('/',          (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/dashboard', (req, res) => res.sendFile(path.join(__dirname, 'public', 'app.html')));
app.get('/handbook',  (req, res) => res.sendFile(path.join(__dirname, 'public', 'handbook.html')));

app.listen(PORT, () => {
  console.log(`\n  ✦ ManageHw is running!`);
  console.log(`  → App:      http://localhost:${PORT}`);
  console.log(`  → Handbook: http://localhost:${PORT}/handbook\n`);
});
