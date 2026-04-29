import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'path';

// Store DB in the OS-specific user data directory
const dbPath = path.join(app.getPath('userData'), 'local_queue.db');
const db = new Database(dbPath);

export function initDB() {
  db.pragma('journal_mode = WAL'); // Better performance/concurrency
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      activity_score REAL NOT NULL,
      status TEXT NOT NULL,
      keyboard_entropy REAL NOT NULL,
      mouse_entropy REAL NOT NULL,
      active_app TEXT,
      timestamp TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS daily_activity_totals (
      date TEXT PRIMARY KEY,
      worked_minutes INTEGER NOT NULL DEFAULT 0,
      idle_minutes INTEGER NOT NULL DEFAULT 0
    )
  `);
  console.log(`Local SQLite database initialized at ${dbPath}`);
}

export default db;