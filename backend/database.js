const Database = require('better-sqlite3');
const bcrypt   = require('bcrypt');
const path     = require('path');
const fs       = require('fs');
require('dotenv').config();

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../data/nexcp.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  -- NexCP users (panel login)
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT UNIQUE NOT NULL,
    name          TEXT NOT NULL,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'Viewer',
    status        TEXT NOT NULL DEFAULT 'active',
    avatar        TEXT DEFAULT '',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_seen     DATETIME
  );

  -- One Microsoft token stored per linked account (by ms_email, unique)
  -- Multiple devices can link; each gets its own row identified by ms_email
  CREATE TABLE IF NOT EXISTS ms_tokens (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    ms_email      TEXT UNIQUE NOT NULL,
    ms_name       TEXT,
    access_token  TEXT,
    refresh_token TEXT,
    expires_at    DATETIME,
    status        TEXT DEFAULT 'active',
    linked_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Per-visit device flow sessions — each page load = new row = new code
  -- session_key is the browser's unique identifier (random, generated server-side)
  -- Multiple concurrent sessions are fully supported
  CREATE TABLE IF NOT EXISTS device_sessions (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    session_key      TEXT UNIQUE NOT NULL,   -- sent to browser, used to poll
    device_code      TEXT NOT NULL,          -- sent to Microsoft (secret)
    user_code        TEXT NOT NULL,          -- shown to user
    verification_uri TEXT NOT NULL,
    interval_secs    INTEGER DEFAULT 5,
    expires_at       DATETIME NOT NULL,
    status           TEXT DEFAULT 'pending', -- pending | success | expired | cancelled
    ms_email         TEXT,                   -- filled on success
    ms_name          TEXT,
    created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Domains with full SSL tracking
  CREATE TABLE IF NOT EXISTS domains (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    domain        TEXT UNIQUE NOT NULL,
    type          TEXT DEFAULT 'PRIMARY',
    ssl_status    TEXT DEFAULT 'NONE',       -- NONE | PENDING | VALID | FAILED | EXPIRED
    ssl_expiry    DATETIME,
    ssl_issued_at DATETIME,
    nginx_enabled INTEGER DEFAULT 0,
    status        TEXT DEFAULT 'active',
    created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Backups
  CREATE TABLE IF NOT EXISTS backups (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    type         TEXT NOT NULL,
    status       TEXT DEFAULT 'pending',
    size_bytes   INTEGER DEFAULT 0,
    filepath     TEXT,
    note         TEXT,
    created_by   INTEGER,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Visitor tracking (IP geolocation from link page)
  CREATE TABLE IF NOT EXISTS visitors (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    ip           TEXT NOT NULL,
    user_agent   TEXT,
    country      TEXT,
    city         TEXT,
    lat          REAL,
    lng          REAL,
    session_key  TEXT,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  -- Settings (key-value store)
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`);

// Seed default settings
const settingsCount = db.prepare('SELECT COUNT(*) as c FROM settings').get();
if (settingsCount.c === 0) {
  db.prepare("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)").run('link_template', 'voicemail');
}

// Seed admin user
const count = db.prepare('SELECT COUNT(*) as c FROM users').get();
if (count.c === 0) {
  const pw   = process.env.ADMIN_PASSWORD || 'changeme123!';
  const hash = bcrypt.hashSync(pw, 12);
  db.prepare("INSERT INTO users (username,name,email,password_hash,role,avatar) VALUES (?,?,?,?,?,?)")
    .run('admin', 'Administrator', 'admin@localhost', hash, 'Administrator', 'AD');
  console.log('[DB] Admin created — username: admin  password:', pw);
}

// Cleanup stale sessions on startup (expired > 2 hours ago)
db.prepare("DELETE FROM device_sessions WHERE expires_at < datetime('now', '-2 hours')").run();

module.exports = db;
