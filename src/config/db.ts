/**
 * -----------------------------------------------------------------------------
 * ZALO AUTO MESSENGER - DATABASE CONNECTION CONFIGURATION
 * -----------------------------------------------------------------------------
 * @version 2.5.0
 * @author Dong Bui
 * @copyright (c) 2026 Dong Bui. All rights reserved.
 * @contact Hotline/Zalo: 0779356619 | Email: buinamdong9@gmail.com
 * @license Proprietary - Closed Source
 * -----------------------------------------------------------------------------
 */

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
try {
  db.exec("ALTER TABLE schedules ADD COLUMN action_type TEXT DEFAULT 'send_message'");
} catch (e) {
  // Column already exists, ignore
}
try {
  db.exec('ALTER TABLE schedules ADD COLUMN poll_id TEXT');
} catch (e) {
  // Column already exists, ignore
}
try {
  db.exec('ALTER TABLE schedules ADD COLUMN poll_question_filter TEXT');
} catch (e) {
  // Column already exists, ignore
}
try {
  db.exec('ALTER TABLE schedules ADD COLUMN poll_option TEXT');
} catch (e) {
  // Column already exists, ignore
}
try {
  db.exec('ALTER TABLE schedules ADD COLUMN watch_end_hour INTEGER DEFAULT 8');
} catch (e) {
  // Column already exists, ignore
}
try {
  db.exec('ALTER TABLE schedules ADD COLUMN watch_end_minute INTEGER DEFAULT 0');
} catch (e) {
  // Column already exists, ignore
}
try {
  db.exec('ALTER TABLE schedules ADD COLUMN poll_watch_interval_seconds INTEGER DEFAULT 60');
} catch (e) {
  // Column already exists, ignore
}

db.exec(`
  CREATE TABLE IF NOT EXISTS schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    message_content TEXT NOT NULL,
    action_type TEXT DEFAULT 'send_message', -- 'send_message', 'vote_poll', or 'watch_poll'
    poll_id TEXT,
    poll_question_filter TEXT,
    poll_option TEXT,
    watch_end_hour INTEGER DEFAULT 8,
    watch_end_minute INTEGER DEFAULT 0,
    poll_watch_interval_seconds INTEGER DEFAULT 60,
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

  CREATE TABLE IF NOT EXISTS proxies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT UNIQUE NOT NULL,
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS poll_watch_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    schedule_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    poll_id TEXT NOT NULL,
    processed_at TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    UNIQUE(schedule_id, poll_id),
    FOREIGN KEY(schedule_id) REFERENCES schedules(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

// Seed initial proxies if table is empty
try {
  const countResult = db.prepare('SELECT COUNT(*) as count FROM proxies').get() as any;
  if (countResult && countResult.count === 0) {
    const insert = db.prepare('INSERT OR IGNORE INTO proxies (url, is_active) VALUES (?, 1)');
    const initialProxies = [
      "http://113.176.100.249:8881",
      "socks4://118.71.44.153:1083",
      "socks5://118.71.44.153:1083",
      "socks5://103.249.117.187:1080",
      "http://113.160.132.26:8080",
      "http://163.181.207.171:9999",
      "socks4://117.7.81.125:1111",
      "socks4://116.97.117.27:4153",
      "socks5://118.70.67.11:1080",
      "socks5://160.250.54.6:9000",
      "http://137.59.47.73:3128",
      "socks4://1.53.106.137:5000",
      "socks5://160.250.54.9:9000",
      "socks5://160.250.54.7:9000",
      "socks5://45.118.146.219:1080",
      "http://14.225.240.23:8562"
    ];
    for (const p of initialProxies) {
      insert.run(p);
    }
    console.log('Seeded initial working proxies to database.');
  }
} catch (err) {
  console.error('Error seeding proxies table:', err);
}

console.log('📂 Database initialized successfully at:', dbPath);

export default db;
export { dbPath };
