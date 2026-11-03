// 桌宠总管 · HTTP 服务（API + SSE + 静态页 + 手机入口）
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import {
  AGENT, ASSETS, DATA, DOCS, HOST, LOGS, OUT, PORT, ROOT, VERSION, WEB, ensureDirs,
} from './config.mjs'
import {
  cancelTask, createTask, runChat, setBroadcast,
} from './agent.mjs'
import { hasApiKey } from './deepseek.mjs'
import { getIndex, indexSummary, scanAll } from './scanner.mjs'
import { store } from './store.mjs'
import { HttpError, ensureDir, json, nowISO, readBody, clamp } from './util.mjs'

const execFileP = promisify(execFile)
const START_AT = Date.now()
const LOG = path.join(LOGS, 'server.log')
const clients = new Set()
const busySessions = new Set()
let currentStatus = 'idle'
let lastNotice = null

function log(...args) {
  try {
    ensureDir(LOGS)
    fs.appendFileSync(LOG, `[${nowISO()}] ${args.join(' ')}\n`, 'utf8')
  } catch {}
}

/* ---------------- 事件总线 ---------------- */

function writeSse(res, type, payload) {
  try {
    res.write(`data: ${JSON.stringify({ type, ...payload })}\n\n`)
  } catch {}
}

function broadcast(type, payload) {
  if (type === 'notice') lastNotice = { ...payload, at: payload?.at || nowISO() }
  for (const res of clients) {
    try {
      writeSse(res, type, payload)
    } catch {}
  }
}

setBroadcast((type, payload) => {
  if (type === 'agent.state') currentStatus = payload.status || 'idle'
  broadcast(type, payload)
})

setInterval(() => {
  for (const res of clients) {
    try {
      res.write('event: ping\ndata: {}\n\n')
    } catch {}
  }
}, 15000)

/* ---------------- 手机入口 ---------------- */

function lanIP() {
  // 只监听回环时，手机端本来就连不上，二维码也给回环地址，避免给出一个假的可达地址
  if (/^(127\.|localhost$|::1$)/i.test(String(HOST))) return '127.0.0.1'
  const ifaces = os.networkInterfaces()
  const candidates = []
  for (const list of Object.values(ifaces)) {
    for (const ni of list || []) {
      if (ni.family !== 'IPv4' || ni.internal) continue
      if (!/^(192\.168|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ni.address)) continue
      candidates.push(ni.address)
    }
  }
  candidates.sort((a, b) => (a.startsWith('192.168.') ? -1 : 0) - (b.startsWith('192.168.') ? -1 : 0))
  return candidates[0] || '127.0.0.1'
}

function phoneToken() {
  let t = store.getMeta('phone_token')
  if (!t) {
    t = crypto.randomBytes(12).toString('base64url')
    store.setMeta('phone_token', t)
  }
  return t
}

function phoneUrl() {
  return `http://${lanIP()}:${PORT}/m?token=${phoneToken()}`
}

async function ensureQr() {
  const url = phoneUrl()
  const file = path.join(DATA, 'phone-qr.png')
  const stamp = path.join(DATA, 'phone-qr.url')
  let cachedUrl = ''
  try {
    cachedUrl = fs.readFileSync(stamp, 'utf8').trim()
  } catch {}
  if (cachedUrl === url && fs.existsSync(file)) return file
  const code = 'import sys, qrcode\nimg = qrcode.make(sys.argv[1])\nimg.save(sys.argv[2])\nprint("ok")'
  await execFileP('python', ['-c', code, url, file], { timeout: 15000 })
  fs.writeFileSync(stamp, url, 'utf8')
  return file
}

/* ---------------- 业务数据 ---------------- */

function buildState() {
  const idx = getIndex() || {}
  const tasks = store.tasks(20)
  const artifacts = store.artifacts(20)
  const memories = store.memories(20)
  const today = new Date().toISOString().slice(0, 10)
  return {
    agent: {
      ...AGENT,
      status: currentStatus,
      uptimeSec: Math.floor((Date.now() - START_AT) / 1000),
      hasKey: hasApiKey(),
    },
    careers: idx.careers || [],
    projects: idx.projects || [],
    tasks,
    artifacts,
    memories,
    stats: {
      ...(idx.stats || { projects: 0, files: 0, sizeMB: 0 }),
      todayTasks: tasks.filter((t) => (t.createdAt || '').slice(0, 10) === today).length,
      todayArtifacts: artifacts.filter((a) => (a.createdAt || '').slice(0, 10) === today).length,
    },
    phone: { url: phoneUrl(), qr: `/api/phone/qr?ts=${Date.now()}` },
    indexedAt: idx.indexedAt || null,
    indexTookMs: idx.tookMs || null,
  }
}

/* ---------------- 静态文件 ---------------- */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
}

function serveFile(res, file) {
  let st
  try {
    st = fs.statSync(file)
  } catch {
    return false
  }
  if (!st.isFile()) return false
  const ext = path.extname(file).toLowerCase()
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': st.size,
    // 本机工具，升级后别让浏览器拿着 60 秒内的旧 JS/CSS 跑。
    'Cache-Control': 'no-cache',
    'Last-Modified': st.mtime.toUTCString(),
  })
  fs.createReadStream(file).pipe(res)
  return true
}

function isLoopback(req) {
  const a = req.socket.remoteAddress || ''
  return a === '127.0.0.1' || a === '::1' || a === '::ffff:127.0.0.1'
}

function cookieToken(req) {
  const raw = req.headers.cookie || ''
  const m = raw.match(/(?:^|;\s*)steward_token=([^;]+)/)
  return m ? decodeURIComponent(m[1]) : null
}

function requestToken(req, url) {
  return url.searchParams.get('token') || req.headers['x-steward-token'] || cookieToken(req)
}

/* ---------------- 路由 ---------------- */

async function handleApi(req, res, url) {
  const p = url.pathname
  const method = req.method || 'GET'

  if (method === 'GET' && p === '/api/health') {
    const idx = getIndex() || {}
    const tasks = store.tasks(200)
    return json(res, 200, {
      ok: true,
      time: nowISO(),
      agent: { ...AGENT, status: currentStatus, uptimeSec: Math.floor((Date.now() - START_AT) / 1000), hasKey: hasApiKey() },
      counts: {
        projects: (idx.projects || []).length,
        tasks: tasks.length,
        running: tasks.filter((t) => ['queued', 'planning', 'running'].includes(t.status)).length,
        memories: store.memories(200).length,
      },
    })
  }

  if (method === 'GET' && p === '/api/pet') {
    const idx = getIndex() || {}
    const all = store.tasks(200)
    const running = all.filter((t) => ['queued', 'planning', 'running'].includes(t.status))
    return json(res, 200, {
      ok: true,
      name: AGENT.name,
      no: AGENT.no,
      tagline: AGENT.tagline,
      status: currentStatus,
      model: AGENT.model,
      hasKey: hasApiKey(),
      counts: { projects: (idx.projects || []).length, tasks: all.length, running: running.length },
      lastNotice,
      tasks: all.slice(0, 5).map((t) => ({ id: t.id, title: t.title, status: t.status, progress: Math.round(t.progress * 100) })),
      url: `http://127.0.0.1:${PORT}`,
      ts: nowISO(),
    })
  }

  if (method === 'GET' && p === '/api/state') return json(res, 200, buildState())

  if (method === 'GET' && p === '/api/projects') {
    const idx = getIndex()
    return json(res, 200, idx ? { indexedAt: idx.indexedAt, tookMs: idx.tookMs, roots: idx.projects?.length ? [] : [], careers: idx.careers, projects: idx.projects } : { indexedAt: null, careers: [], projects: [] })
  }

  if (method === 'POST' && p === '/api/projects/refresh') {
    const idx = await scanAll({ force: true })
    broadcast('projects.indexed', { indexedAt: idx.indexedAt, projects: idx.projects.length })
    return json(res, 200, { ok: true, indexedAt: idx.indexedAt, projects: idx.projects.length, tookMs: idx.tookMs })
  }

  if (method === 'GET' && p === '/api/skills') {
    const idx = getIndex()
    return json(res, 200, (idx?.skills || []).map((s) => ({ name: s.name, description: s.description, path: s.path })))
  }

  if (method === 'GET' && p === '/api/chat/history') {
    const sessionId = url.searchParams.get('sessionId') || 'main'
    const limit = clamp(Number(url.searchParams.get('limit')) || 60, 1, 200)
    return json(res, 200, { sessionId, messages: store.messages(sessionId, limit) })
  }

  if (method === 'DELETE' && p === '/api/chat/history') {
    const sessionId = url.searchParams.get('sessionId') || 'main'
    store.clearMessages(sessionId)
    return json(res, 200, { ok: true })
  }

  if (method === 'POST' && p === '/api/chat') {
    const body = await readBody(req)
    const sessionId = String(body.sessionId || 'main')
    const message = String(body.message || '')
    const projectId = body.projectId || null
    if (!message.trim()) throw new HttpError(400, '消息为空')
    if (busySessions.has(sessionId)) throw new HttpError(409, '这个会话正在回复，等它说完再发')
    busySessions.add(sessionId)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    if (res.flushHeaders) res.flushHeaders()
    let closed = false
    // 监听 res 而不是 req：req 的 close 会在请求体读完时就触发，
    // 会把整条 SSE 流误判成已断开。res close 才代表客户端真的走了。
    res.on('close', () => {
      closed = true
    })
    const emit = (type, payload) => {
      if (closed) return
      writeSse(res, type, payload || {})
    }
    try {
      await runChat({ sessionId, message, projectId, source: body.source || 'web', emit, shouldAbort: () => closed })
    } catch (err) {
      emit('error', { message: err.message })
    } finally {
      busySessions.delete(sessionId)
      res.end()
    }
    return
  }

  if (method === 'GET' && p === '/api/tasks') {
    const limit = clamp(Number(url.searchParams.get('limit')) || 20, 1, 50)
    return json(res, 200, { tasks: store.tasks(limit) })
  }

  if (method === 'GET' && p.startsWith('/api/tasks/')) {
    const id = decodeURIComponent(p.slice('/api/tasks/'.length))
    const t = store.task(id)
    if (!t) throw new HttpError(404, '工单不存在')
    return json(res, 200, t)
  }

  if (method === 'POST' && p === '/api/tasks') {
    const body = await readBody(req)
    const goal = String(body.goal || '').trim()
    if (!goal) throw new HttpError(400, '缺 goal')
    const task = await createTask({ goal, title: body.title, projectId: body.projectId || null })
    return json(res, 201, task)
  }

  if (method === 'POST' && p.endsWith('/cancel') && p.startsWith('/api/tasks/')) {
    const id = decodeURIComponent(p.slice('/api/tasks/'.length, -'/cancel'.length))
    if (!store.task(id)) throw new HttpError(404, '工单不存在')
    cancelTask(id)
    return json(res, 200, { ok: true })
  }

  if (method === 'GET' && p === '/api/memory') {
    return json(res, 200, { memories: store.memories(50) })
  }

  if (method === 'POST' && p === '/api/memory') {
    const body = await readBody(req)
    if (!body.key || !body.value) throw new HttpError(400, '缺 key/value')
    const m = store.addMemory({ key: body.key, value: body.value, source: 'web', pinned: !!body.pinned })
    broadcast('memory.new', { memory: m })
    return json(res, 201, m)
  }

  if (method === 'POST' && p.match(/^\/api\/memory\/[^/]+\/pin$/)) {
    const id = p.split('/')[3]
    const body = await readBody(req)
    store.pinMemory(id, !!body.pinned)
    return json(res, 200, { ok: true })
  }

  if (method === 'DELETE' && p.startsWith('/api/memory/')) {
    const id = p.slice('/api/memory/'.length)
    store.deleteMemory(id)
    return json(res, 200, { ok: true })
  }

  if (method === 'GET' && p === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    if (res.flushHeaders) res.flushHeaders()
    clients.add(res)
    writeSse(res, 'hello', { status: currentStatus, time: nowISO() })
    req.on('close', () => clients.delete(res))
    return
  }

  if (method === 'GET' && p === '/api/phone') {
    return json(res, 200, { url: phoneUrl(), qr: `/api/phone/qr?ts=${Date.now()}`, lan: lanIP(), token: phoneToken() })
  }

  if (method === 'GET' && p === '/api/phone/qr') {
    const file = await ensureQr()
    const buf = fs.readFileSync(file)
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': buf.length, 'Cache-Control': 'no-store' })
    return res.end(buf)
  }

  if (method === 'GET' && p === '/api/artifacts') {
    return json(res, 200, { artifacts: store.artifacts(50) })
  }

  if (method === 'GET' && p === '/api/artifact') {
    const rel = url.searchParams.get('path') || ''
    const abs = path.resolve(ROOT, rel)
    if (!abs.startsWith(path.resolve(OUT) + path.sep) && !abs.startsWith(path.resolve(DOCS) + path.sep)) throw new HttpError(400, '路径越界')
    const st = fs.statSync(abs)
    res.writeHead(200, { 'Content-Type': 'text/markdown; charset=utf-8', 'Content-Length': st.size })
    return fs.createReadStream(abs).pipe(res)
  }

  throw new HttpError(404, `未知接口 ${method} ${p}`)
}

/* ---------------- 主服务 ---------------- */

async function main() {
  ensureDirs()
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    try {
      if (url.pathname.startsWith('/api/')) {
        const remote = !isLoopback(req)
        if (remote && requestToken(req, url) !== phoneToken()) throw new HttpError(403, '需要手机访问令牌')
        await handleApi(req, res, url)
        return
      }

      // 静态页
      if (url.pathname === '/' || url.pathname === '/index.html') {
        if (serveFile(res, path.join(WEB, 'index.html'))) return
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        return res.end('工作台还没建好（web/index.html 缺失）')
      }
      if (url.pathname === '/m' || url.pathname === '/mobile.html') {
        const remote = !isLoopback(req)
        if (remote) {
          const token = requestToken(req, url)
          if (token !== phoneToken()) {
            res.writeHead(403, { 'Content-Type': 'text/html; charset=utf-8' })
            return res.end('<meta charset="utf-8"><h3>需要配对令牌</h3><p>请在电脑上打开工作台，用「手机入口」的二维码扫码。</p>')
          }
          res.setHeader('Set-Cookie', `steward_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000`)
        }
        if (serveFile(res, path.join(WEB, 'mobile.html'))) return
        if (serveFile(res, path.join(WEB, 'index.html'))) return
        res.writeHead(404)
        return res.end('mobile page missing')
      }
      if (url.pathname.startsWith('/assets/')) {
        const f = path.join(ASSETS, url.pathname.slice('/assets/'.length))
        if (serveFile(res, f)) return
      }
      if (url.pathname.startsWith('/web/')) {
        const f = path.join(WEB, url.pathname.slice('/web/'.length))
        if (serveFile(res, f)) return
      }
      // 根路径下的 web 资产（index.html 里写的是相对路径 app.css / lib/*.js）
      {
        const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '')
        if (rel && !rel.includes('\0')) {
          const f = path.resolve(WEB, rel)
          if (f.startsWith(path.resolve(WEB) + path.sep) && serveFile(res, f)) return
        }
      }
      if (url.pathname === '/favicon.ico') {
        const f = path.join(ASSETS, 'icons', 'favicon.png')
        if (serveFile(res, f)) return
      }
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
    } catch (err) {
      if (res.headersSent) {
        try {
          res.end()
        } catch {}
        return
      }
      const code = err instanceof HttpError ? err.code : 500
      if (code === 500) log('ERR', err.stack || err.message)
      json(res, code, { error: err.message || '服务器错误' })
    }
  })

  server.listen(PORT, HOST, () => {
    log(`listen ${HOST}:${PORT}`)
    console.log(`[deskpet-steward] listening on http://127.0.0.1:${PORT}`)
  })

  // 启动时后台建索引（不阻塞服务）
  scanAll().then((idx) => {
    log(`index ready: ${idx.projects.length} projects, ${idx.careers.length} careers, ${idx.tookMs}ms`)
    broadcast('projects.indexed', { indexedAt: idx.indexedAt, projects: idx.projects.length })
  }).catch((err) => log('index failed', err.message))

  const bye = () => {
    try {
      server.close()
    } catch {}
    process.exit(0)
  }
  process.on('SIGINT', bye)
  process.on('SIGTERM', bye)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
