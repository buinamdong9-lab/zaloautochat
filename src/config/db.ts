import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DB_DIR = path.resolve(__dirname, '../../data');
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

const dbPath = path.join(DB_DIR, 'database.db');
const db = new Database(dbPath);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    imei TEXT,
    encrypted_cookies TEXT,
    timezone TEXT DEFAULT 'Asia/Ho_Chi_Minh',
    is_admin INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Dynamic Migration for existing DBs
try {
  db.exec('ALTER TABLE users ADD COLUMN is_admin INTEGER DEFAULT 0');
} catch (e) {
  // Column already exists, ignore
}
try {
  db.exec('ALTER TABLE users ADD COLUMN proxy TEXT');
} catch (e) {
  // Column already exists, ignore
}

db.exec(`
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    message_content TEXT NOT NULL,
    send_hour INTEGER NOT NULL,
    send_minute INTEGER NOT NULL,
    send_days TEXT NOT NULL, -- e.g., 'mon,tue,wed,thu,fri'
    start_date TEXT, -- YYYY-MM-DD
    end_date TEXT,   -- YYYY-MM-DD
    recipient_type TEXT DEFAULT 'GROUP', -- 'GROUP' or 'USER'
    recipient_id TEXT NOT NULL,
    is_active INTEGER DEFAULT 1, -- 0 or 1
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    schedule_id INTEGER,
    time TEXT NOT NULL, -- YYYY-MM-DD HH:mm:ss
    status TEXT NOT NULL, -- 'success' or 'error'
    message_content TEXT NOT NULL,
    recipient_id TEXT NOT NULL,
    error_message TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    time TEXT NOT NULL,
    level TEXT NOT NULL,
    message TEXT NOT NULL,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

console.log('📂 Database initialized successfully at:', dbPath);

export default db;
export { dbPath };
