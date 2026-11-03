// SQLite 存储（node:sqlite）
import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { DATA } from './config.mjs'
import { nowISO, uid } from './util.mjs'

const DB_FILE = path.join(DATA, 'steward.db')
fs.mkdirSync(DATA, { recursive: true })
export const db = new DatabaseSync(DB_FILE)

db.exec(`
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, session_id TEXT NOT NULL, role TEXT NOT NULL,
  text TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, goal TEXT NOT NULL,
  status TEXT NOT NULL, progress REAL NOT NULL DEFAULT 0,
  project_id TEXT, summary TEXT, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS subtasks (
  id TEXT PRIMARY KEY, task_id TEXT NOT NULL, seq INTEGER NOT NULL,
  title TEXT NOT NULL, brief TEXT, status TEXT NOT NULL DEFAULT 'queued',
  summary TEXT, artifact TEXT, error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY, task_id TEXT, subtask_id TEXT, name TEXT NOT NULL,
  path TEXT NOT NULL, size_bytes INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, key TEXT NOT NULL, value TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'chat', pinned INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`)

const q = {
  insertMessage: db.prepare('INSERT INTO messages (id, session_id, role, text, created_at) VALUES (?,?,?,?,?)'),
  messages: db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'),
  clearMessages: db.prepare('DELETE FROM messages WHERE session_id = ?'),

  insertTask: db.prepare(`INSERT INTO tasks (id,title,goal,status,progress,project_id,summary,error,created_at,updated_at)
    VALUES (?,?,?,?,?,?,NULL,NULL,?,?)`),
  updateTask: db.prepare('UPDATE tasks SET status=?, progress=?, summary=?, error=?, updated_at=? WHERE id=?'),
  task: db.prepare('SELECT * FROM tasks WHERE id = ?'),
  tasks: db.prepare('SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?'),

  insertSubtask: db.prepare(`INSERT INTO subtasks (id,task_id,seq,title,brief,status,summary,artifact,error,created_at,updated_at)
    VALUES (?,?,?,?,?,?,NULL,NULL,NULL,?,?)`),
  updateSubtask: db.prepare('UPDATE subtasks SET status=?, summary=?, artifact=?, error=?, updated_at=? WHERE id=?'),
  subtasks: db.prepare('SELECT * FROM subtasks WHERE task_id = ? ORDER BY seq ASC'),

  insertArtifact: db.prepare('INSERT INTO artifacts (id,task_id,subtask_id,name,path,size_bytes,created_at) VALUES (?,?,?,?,?,?,?)'),
  artifacts: db.prepare('SELECT * FROM artifacts ORDER BY created_at DESC LIMIT ?'),

  insertMemory: db.prepare('INSERT INTO memories (id,key,value,source,pinned,created_at) VALUES (?,?,?,?,?,?)'),
  memories: db.prepare('SELECT * FROM memories ORDER BY pinned DESC, created_at DESC LIMIT ?'),
  memory: db.prepare('SELECT * FROM memories WHERE id = ?'),
  deleteMemory: db.prepare('DELETE FROM memories WHERE id = ?'),
  pinMemory: db.prepare('UPDATE memories SET pinned = ? WHERE id = ?'),

  meta: db.prepare('SELECT value FROM meta WHERE key = ?'),
  setMeta: db.prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'),
}

export const store = {
  addMessage(sessionId, role, text) {
    const id = uid('msg')
    const at = nowISO()
    q.insertMessage.run(id, sessionId, role, String(text), at)
    return { id, sessionId, role, text: String(text), createdAt: at }
  },
  messages(sessionId, limit = 80) {
    return q.messages.all(sessionId, limit).reverse().map(row2Message)
  },
  clearMessages(sessionId) {
    q.clearMessages.run(sessionId)
  },

  createTask({ title, goal, projectId = null }) {
    const id = `t_${new Date().toISOString().slice(0, 10).replace(/-/g, '')}_${uid('').slice(2, 6)}`
    const at = nowISO()
    q.insertTask.run(id, title, goal, 'queued', 0, projectId, at, at)
    return this.task(id)
  },
  task(id) {
    const t = q.task.get(id)
    if (!t) return null
    return row2Task(t, q.subtasks.all(id))
  },
  tasks(limit = 20) {
    return q.tasks.all(limit).map((t) => row2Task(t, q.subtasks.all(t.id)))
  },
  updateTask(id, patch) {
    const cur = q.task.get(id)
    if (!cur) return null
    q.updateTask.run(
      patch.status ?? cur.status,
      patch.progress ?? cur.progress,
      patch.summary ?? cur.summary,
      patch.error ?? cur.error,
      nowISO(),
      id,
    )
    return this.task(id)
  },
  addSubtask(taskId, seq, title, brief) {
    const id = `s${seq}_${uid('').slice(2, 6)}`
    const at = nowISO()
    q.insertSubtask.run(id, taskId, seq, title, brief, 'queued', at, at)
    return { id, taskId, seq, title, brief, status: 'queued', summary: null, artifact: null }
  },
  updateSubtask(id, patch) {
    const cur = db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id)
    if (!cur) return null
    q.updateSubtask.run(
      patch.status ?? cur.status,
      patch.summary ?? cur.summary,
      patch.artifact ?? cur.artifact,
      patch.error ?? cur.error,
      nowISO(),
      id,
    )
    return db.prepare('SELECT * FROM subtasks WHERE id = ?').get(id)
  },

  addArtifact({ taskId, subtaskId, name, path: p, sizeBytes }) {
    const id = uid('a')
    q.insertArtifact.run(id, taskId, subtaskId, name, p, sizeBytes, nowISO())
    return { id, taskId, subtaskId, name, path: p, sizeBytes, createdAt: nowISO() }
  },
  artifacts(limit = 20) {
    return q.artifacts.all(limit).map(row2Artifact)
  },

  addMemory({ key, value, source = 'chat', pinned = false }) {
    const id = uid('m')
    q.insertMemory.run(id, String(key), String(value), source, pinned ? 1 : 0, nowISO())
    return this.memory(id)
  },
  memory(id) {
    const m = q.memory.get(id)
    return m ? row2Memory(m) : null
  },
  memories(limit = 30) {
    return q.memories.all(limit).map(row2Memory)
  },
  deleteMemory(id) {
    q.deleteMemory.run(id)
  },
  pinMemory(id, pinned) {
    q.pinMemory.run(pinned ? 1 : 0, id)
  },

  getMeta(key, fallback = null) {
    const row = q.meta.get(key)
    return row ? row.value : fallback
  },
  setMeta(key, value) {
    q.setMeta.run(key, String(value))
  },
}

function row2Message(r) {
  return { id: r.id, sessionId: r.session_id, role: r.role, text: r.text, createdAt: r.created_at }
}
function row2Task(t, subs) {
  return {
    id: t.id, title: t.title, goal: t.goal, status: t.status,
    progress: t.progress, projectId: t.project_id, summary: t.summary, error: t.error,
    createdAt: t.created_at, updatedAt: t.updated_at,
    subtasks: subs.map(row2Subtask),
  }
}
function row2Subtask(s) {
  return {
    id: s.id, taskId: s.task_id, seq: s.seq, title: s.title, brief: s.brief,
    status: s.status, summary: s.summary, artifact: s.artifact, error: s.error,
    createdAt: s.created_at, updatedAt: s.updated_at,
  }
}
function row2Artifact(a) {
  return {
    id: a.id, taskId: a.task_id, subtaskId: a.subtask_id, name: a.name,
    path: a.path, sizeBytes: a.size_bytes, createdAt: a.created_at,
  }
}
function row2Memory(m) {
  return { id: m.id, key: m.key, value: m.value, source: m.source, pinned: !!m.pinned, createdAt: m.created_at }
}
