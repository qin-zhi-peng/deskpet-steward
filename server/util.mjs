// 通用小工具
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

export const nowISO = () => new Date().toISOString()

export function uid(prefix = 'x') {
  return `${prefix}_${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`
}

export function shortId() {
  return crypto.randomBytes(6).toString('hex')
}

export function json(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8')
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

export class HttpError extends Error {
  constructor(code, message) {
    super(message)
    this.code = code
  }
}

export async function readBody(req, limit = 1_000_000) {
  const chunks = []
  let total = 0
  for await (const c of req) {
    total += c.length
    if (total > limit) throw new HttpError(413, '请求体过大')
    chunks.push(c)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'JSON 解析失败')
  }
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true })
  return p
}

export function readJsonFile(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function writeJsonAtomic(file, obj) {
  ensureDir(path.dirname(file))
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), 'utf8')
  fs.renameSync(tmp, file)
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n))
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function safeJoin(base, rel) {
  const p = path.resolve(base, rel || '.')
  const b = path.resolve(base)
  if (p !== b && !p.startsWith(b + path.sep)) throw new HttpError(400, '路径越界')
  return p
}

export function stripMarkdown(text, max = 160) {
  const cleaned = String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[*_`>#]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned.length > max ? cleaned.slice(0, max) + '…' : cleaned
}

export async function pool(items, limit, worker) {
  const results = new Array(items.length)
  let i = 0
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      results[idx] = await worker(items[idx], idx)
    }
  })
  await Promise.all(runners)
  return results
}
