# ManageHw — Homework Time Manager

A full-stack local web app for students to manage homework, track time, and stay on top of deadlines.

## Tech Stack
- **Backend**: Node.js + Express
- **Database**: SQLite (via `better-sqlite3`) — stored as `managehw.db` locally
- **Auth**: Session-based with bcrypt password hashing
- **Frontend**: Vanilla HTML/CSS/JS (no framework needed)

## Setup & Run

### 1. Install Node.js
Download from https://nodejs.org (v18 or later recommended)

### 2. Install dependencies
```bash
cd managehw
npm install
```

### 3. Start the server
```bash
npm start
```

### 4. Open in browser
Visit: **http://localhost:3000**

---

## Features

### 👤 Authentication
- Register with username, email, and password
- Secure login with hashed passwords (bcryptjs)
- Sessions persist for 7 days

### ✅ Task Management
- Add, edit, delete homework tasks
- Set **type**: Homework / Exam / Project
- Set **priority**: High 🔴 / Medium 🟡 / Low 🟢
- Set **subject** / course
- Set **deadline** with countdown
- Add **notes** per task
- Mark tasks complete / undo

### 🗂 Views & Filters
- All Tasks / Pending / Completed
- Due Today / This Week / Overdue
- Filter by Subject
- Search by task name
- Sort by: Priority / Deadline / Name / Time Spent

### ⏱ Timer
- Per-task study timer (start, pause, reset)
- Saves time to task and daily study log
- Total time shown per task

### 🍅 Pomodoro
- Built-in 25/5 Pomodoro timer in the sidebar
- Tracks pomodoros completed today

### 📊 Study Graph
- Line chart of study time (last 7 days)
- **Only appears once you've actually logged study time**

### 🏷 Subjects
- Add custom subjects with colors
- Filter tasks by subject
- Task count per subject

### 📈 Stats Dashboard
- Total tasks, pending, completed, total study time
- Study streak counter (days in a row)

---

## Project Structure
```
managehw/
├── server.js          # Express backend + all API routes
├── package.json
├── managehw.db        # SQLite database (auto-created on first run)
└── public/
    ├── login.html     # Login & Register page
    └── app.html       # Main dashboard
```

## API Endpoints
| Method | Route | Description |
|--------|-------|-------------|
| POST | /api/auth/register | Register new user |
| POST | /api/auth/login | Login |
| POST | /api/auth/logout | Logout |
| GET  | /api/auth/me | Get current user |
| PUT  | /api/auth/me | Update profile |
| GET  | /api/tasks | List tasks (with filters) |
| POST | /api/tasks | Create task |
| PUT  | /api/tasks/:id | Update task |
| DELETE | /api/tasks/:id | Delete task |
| GET  | /api/subjects | List subjects |
| POST | /api/subjects | Create subject |
| POST | /api/timer/log | Log a study session |
| GET  | /api/stats | Get stats & study log |
