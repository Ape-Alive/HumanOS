'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

/** @type {import('sql.js').SqlJsStatic | null} */
let SQL = null;
/** @type {import('sql.js').Database | null} */
let db = null;
/** @type {Promise<import('sql.js').Database> | null} */
let initPromise = null;

function getDbPath() {
  return path.join(app.getPath('userData'), 'humanos-agent.sqlite');
}

/** @param {string} file */
function locateFile(file) {
  // sql.js 可能被提升到仓库根 node_modules，不能写死 frontend/desktop/node_modules 路径
  const entry = require.resolve('sql.js');
  return path.join(path.dirname(entry), file);
}

async function ensureDb() {
  if (db) return db;
  if (!initPromise) {
    initPromise = (async () => {
      const initSqlJs = require('sql.js');
      SQL = await initSqlJs({ locateFile });
      const fp = getDbPath();
      let arr = new Uint8Array(0);
      try {
        if (fs.existsSync(fp)) arr = new Uint8Array(fs.readFileSync(fp));
      } catch {
        /* ignore */
      }
      db = new SQL.Database(arr);
      db.run('PRAGMA foreign_keys = ON');
      migrate(db);
      return db;
    })();
  }
  return initPromise;
}

function persist() {
  if (!db) return;
  try {
    const data = db.export();
    fs.writeFileSync(getDbPath(), Buffer.from(data));
  } catch (e) {
    console.error('[HumanOS] agent DB persist', e);
  }
}

/** @param {import('sql.js').Database} d */
function migrate(d) {
  d.run(`
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      goal TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      profile_id TEXT,
      profile_name TEXT,
      error_message TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS execution_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      round_index INTEGER NOT NULL DEFAULT 0,
      level TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS screenshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      task_id TEXT NOT NULL,
      round_index INTEGER NOT NULL DEFAULT 0,
      seq INTEGER NOT NULL DEFAULT 0,
      label TEXT,
      mime TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      video_w INTEGER,
      video_h INTEGER,
      image_blob BLOB NOT NULL,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS test_results (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL UNIQUE,
      outcome TEXT NOT NULL,
      markdown TEXT NOT NULL,
      summary_json TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_logs_task ON execution_logs(task_id);
    CREATE INDEX IF NOT EXISTS idx_shots_task ON screenshots(task_id);
  `);
}

/** @param {string} s @param {number} max */
function clip(s, max) {
  const t = String(s ?? '');
  return t.length > max ? t.slice(0, max) : t;
}

/**
 * @param {{ goal: string, profileId?: string, profileName?: string }} p
 * @returns {Promise<{ ok: boolean, id?: string, error?: string }>}
 */
async function taskCreate(p) {
  try {
    await ensureDb();
    const id = crypto.randomUUID();
    const goal = clip(p.goal, 8000);
    if (!goal.trim()) return { ok: false, error: 'empty-goal' };
    const t = Date.now();
    if (!db) throw new Error('db-null');
    db.run(
      `INSERT INTO tasks (id, goal, status, profile_id, profile_name, created_at, updated_at)
       VALUES (?, ?, 'running', ?, ?, ?, ?)`,
      [id, goal, clip(p.profileId || '', 128), clip(p.profileName || '', 256), t, t]
    );
    persist();
    return { ok: true, id };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * @param {{ taskId: string, status: string, errorMessage?: string }} p
 */
async function taskUpdateStatus(p) {
  try {
    await ensureDb();
    if (!db) throw new Error('db-null');
    db.run(`UPDATE tasks SET status = ?, error_message = ?, updated_at = ? WHERE id = ?`, [
      clip(p.status, 32),
      clip(p.errorMessage || '', 4000),
      Date.now(),
      clip(p.taskId, 64),
    ]);
    persist();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * @param {{ taskId: string, roundIndex?: number, level?: string, message: string, payload?: unknown }} p
 */
async function logAppend(p) {
  try {
    await ensureDb();
    if (!db) throw new Error('db-null');
    const payloadJson =
      p.payload !== undefined ? clip(JSON.stringify(p.payload), 16000) : null;
    db.run(
      `INSERT INTO execution_logs (task_id, round_index, level, message, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        clip(p.taskId, 64),
        Math.max(0, Math.floor(Number(p.roundIndex) || 0)),
        clip(p.level || 'info', 16),
        clip(p.message, 8000),
        payloadJson,
        Date.now(),
      ]
    );
    persist();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * @param {{
 *   taskId: string,
 *   roundIndex?: number,
 *   seq?: number,
 *   label?: string,
 *   mime: string,
 *   width?: number,
 *   height?: number,
 *   videoW?: number,
 *   videoH?: number,
 *   buffer: Buffer,
 * }} p
 */
async function screenshotSave(p) {
  try {
    const buf = p.buffer;
    if (!Buffer.isBuffer(buf) || buf.length === 0) return { ok: false, error: 'empty-buffer' };
    if (buf.length > 2_500_000) return { ok: false, error: 'image-too-large' };
    await ensureDb();
    if (!db) throw new Error('db-null');
    const blob = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    db.run(
      `INSERT INTO screenshots (task_id, round_index, seq, label, mime, width, height, video_w, video_h, image_blob, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        clip(p.taskId, 64),
        Math.max(0, Math.floor(Number(p.roundIndex) || 0)),
        Math.max(0, Math.floor(Number(p.seq) || 0)),
        clip(p.label || '', 128),
        clip(p.mime, 64),
        Math.floor(Number(p.width) || 0),
        Math.floor(Number(p.height) || 0),
        Math.floor(Number(p.videoW) || 0),
        Math.floor(Number(p.videoH) || 0),
        blob,
        Date.now(),
      ]
    );
    persist();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/**
 * @param {{ taskId: string, outcome: string, markdown: string, summary?: unknown }} p
 */
async function resultSave(p) {
  try {
    await ensureDb();
    if (!db) throw new Error('db-null');
    const id = crypto.randomUUID();
    const summaryJson =
      p.summary !== undefined ? clip(JSON.stringify(p.summary), 32000) : null;
    db.run(
      `INSERT INTO test_results (id, task_id, outcome, markdown, summary_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        clip(p.taskId, 64),
        clip(p.outcome, 32),
        clip(p.markdown, 512000),
        summaryJson,
        Date.now(),
      ]
    );
    persist();
    return { ok: true, resultId: id };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** @param {{ limit?: number }} p */
async function listRecentTasks(p) {
  try {
    await ensureDb();
    if (!db) throw new Error('db-null');
    const lim = Math.min(100, Math.max(1, Math.floor(Number(p?.limit) || 20)));
    const stmt = db.prepare(
      `SELECT id, goal, status, profile_name, created_at, updated_at FROM tasks ORDER BY created_at DESC LIMIT ?`
    );
    stmt.bind([lim]);
    const tasks = [];
    while (stmt.step()) tasks.push(stmt.getAsObject());
    stmt.free();
    return { ok: true, tasks };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), tasks: [] };
  }
}

/** @param {{ taskId: string }} p */
async function getLogsForTask(p) {
  try {
    await ensureDb();
    if (!db) throw new Error('db-null');
    const stmt = db.prepare(
      `SELECT id, round_index, level, message, payload_json, created_at FROM execution_logs WHERE task_id = ? ORDER BY id ASC`
    );
    stmt.bind([clip(p.taskId, 64)]);
    const logs = [];
    while (stmt.step()) logs.push(stmt.getAsObject());
    stmt.free();
    return { ok: true, logs };
  } catch (e) {
    return { ok: false, error: String(e?.message || e), logs: [] };
  }
}

/** 主进程启动时预热（可选） */
async function initAgentDatabase() {
  await ensureDb();
}

module.exports = {
  initAgentDatabase,
  ensureDb,
  taskCreate,
  taskUpdateStatus,
  logAppend,
  screenshotSave,
  resultSave,
  listRecentTasks,
  getLogsForTask,
};
