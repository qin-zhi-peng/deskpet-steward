// DeskPet Steward · 全局配置
//
// 配置优先级：环境变量 > 仓库根目录的 config.json（已进 .gitignore）> 内置默认值
// 想改成自己的目录/名字，复制 config.example.json 为 config.json 再改，不要改这个文件。
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const here = import.meta.dirname
export const ROOT = path.resolve(here, '..')
export const DATA = path.join(ROOT, 'data')
export const OUT = path.join(ROOT, 'out')
export const WEB = path.join(ROOT, 'web')
export const ASSETS = path.join(ROOT, 'assets')
export const DOCS = path.join(ROOT, 'docs')
export const LOGS = path.join(ROOT, 'logs')

const pick = (...vals) => {
  for (const v of vals) {
    if (v === undefined || v === null) continue
    if (typeof v === 'string' && !v.trim()) continue
    return v
  }
  return undefined
}

export function expandHome(p) {
  if (!p) return p
  if (p === '~') return os.homedir()
  if (p.startsWith('~/') || p.startsWith('~\\')) return path.join(os.homedir(), p.slice(2))
  return p
}

/* ---------------- .env（只在本机，不进版本库） ----------------
 * 用来放 DEEPSEEK_API_KEY，避免把 key 写进任何会被提交的文件。
 * 真实环境变量优先于 .env，方便 CI / 临时覆盖。
 */
export const ENV_FILE = process.env.STEWARD_ENV_FILE || path.join(ROOT, '.env')

function loadEnvFile(file) {
  let raw = ''
  try {
    raw = fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')
  } catch {
    return
  }
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 1) continue
    const key = t.slice(0, eq).trim()
    let val = t.slice(eq + 1).trim()
    if (/^".*"$/.test(val) || /^'.*'$/.test(val)) val = val.slice(1, -1)
    if (!(key in process.env)) process.env[key] = val
  }
}

loadEnvFile(ENV_FILE)

/* ---------------- config.json ---------------- */

export const CONFIG_FILE = process.env.STEWARD_CONFIG || path.join(ROOT, 'config.json')

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^\uFEFF/, '')) || {}
  } catch {
    return {}
  }
}

export const CONFIG = readConfig()

export const PORT = Number(pick(process.env.STEWARD_PORT, CONFIG?.server?.port, 8795))
// 默认只监听本机回环；手机看板要开 config.json 的 server.host = "0.0.0.0"
export const HOST = pick(process.env.STEWARD_HOST, CONFIG?.server?.host, '127.0.0.1')
export const MODEL = pick(process.env.STEWARD_MODEL, CONFIG?.model?.name, 'deepseek-chat')
export const VERSION = '1.0.0'

export const AGENT = Object.freeze({
  name: pick(process.env.STEWARD_NAME, CONFIG?.agent?.name, '桌宠总管'),
  no: pick(CONFIG?.agent?.no, 'No.001'),
  tagline: pick(process.env.STEWARD_TAGLINE, CONFIG?.agent?.tagline, '我的工作区 · 本地总管'),
  model: MODEL,
  version: VERSION,
})

/* ---------------- 工作区扫描根 ----------------
 * kind 决定怎么读：
 *   career   一级目录当「事业线」，其下文件数 >= 2 的二级目录当项目
 *   projects 一级目录直接当项目
 *   notes    只收 .md
 *   skills   每个一级目录读 SKILL.md 的 description
 */
const DEFAULT_ROOTS = [
  { key: 'work', kind: 'career', name: '工作区', path: '~/work', depth: 2 },
  { key: 'projects', kind: 'projects', name: '项目', path: '~/projects', depth: 2 },
  { key: 'notes', kind: 'notes', name: '笔记', path: '~/notes', depth: 1 },
  { key: 'skills', kind: 'skills', name: '技能库', path: '~/.config/deskpet-steward/skills', depth: 1 },
]

const configuredRoots =
  Array.isArray(CONFIG?.roots) && CONFIG.roots.length ? CONFIG.roots : DEFAULT_ROOTS

export const ROOTS = configuredRoots.map((r, i) => {
  const kind = r.kind || r.key || 'projects'
  return {
    key: r.key || `root${i}`,
    kind,
    name: r.name || r.key || `根目录 ${i + 1}`,
    path: path.resolve(expandHome(r.path)),
    depth: Number(r.depth || (kind === 'notes' || kind === 'skills' ? 1 : 2)),
    career: kind === 'career' || r.career === true,
  }
})

// 允许 agent 读取的根（全部只读）
export const READ_ROOTS = [
  ...ROOTS.map((r) => r.path),
  ...(Array.isArray(CONFIG?.readOnly) ? CONFIG.readOnly.map((p) => path.resolve(expandHome(p))) : []),
]

// 工单执行器可写的根（白名单；只允许文本类文件，覆盖前自动备份到 out/_backup）
const defaultWriteRoots = ROOTS.filter((r) => r.kind === 'projects' || r.kind === 'notes').map((r) => r.path)

export const WRITE_ROOTS = (
  process.env.STEWARD_WRITE_ROOTS
    ? process.env.STEWARD_WRITE_ROOTS.split(';').map((s) => s.trim()).filter(Boolean)
    : Array.isArray(CONFIG?.writeRoots) && CONFIG.writeRoots.length
      ? CONFIG.writeRoots.map((p) => path.resolve(expandHome(p)))
      : defaultWriteRoots
)

export const WRITE_EXTS = new Set([
  '.md', '.txt', '.json', '.yml', '.yaml', '.csv',
  '.js', '.mjs', '.cjs', '.ts', '.py', '.ps1', '.css', '.html', '.svg',
])

export const BACKUP_DIR = path.join(OUT, '_backup')

// 扫描时跳过的目录名
export const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', '__pycache__', '.venv', 'venv', 'env',
  'dist', 'build', '.next', '.nuxt', '.cache', '.turbo', 'out', 'tmp', 'temp',
  '.idea', '.vscode', 'logs', '.run', 'coverage', '.pytest_cache', 'site-packages',
  '$RECYCLE.BIN', 'System Volume Information',
])

export const SKIP_EXT = new Set([
  '.mp4', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.mp3', '.wav', '.flac', '.aac',
  '.zip', '.7z', '.rar', '.tar', '.gz', '.iso', '.exe', '.dll', '.asar', '.psd',
  '.ttf', '.otf', '.woff', '.woff2', '.pdf', '.docx', '.pptx', '.xlsx', '.sqlite',
  '.db', '.bin', '.safetensors', '.pt', '.pth', '.onnx',
])

/* ---------------- 模型接入 ----------------
 * key 只从这两处来，只存在进程内存里，不落盘、不回显：
 *   1. 环境变量 STEWARD_API_KEY / DEEPSEEK_API_KEY（推荐写进仓库根目录 .env）
 *   2. 都没有就明确报「缺 key」——不会去读别的软件的配置文件
 *
 * 路由（按顺序降级）：
 *   explicit  STEWARD_API_BASE / config.model.base 指定的网关
 *   local     key 形如 cx-/wb-/dc- 的本地代理令牌 → 走 STEWARD_PROXY_BASE（默认 127.0.0.1:8787）
 *   direct    sk- 开头（或其它）→ 直连 api.deepseek.com
 */
const PROXY_TOKEN_RE = /^(cx|wb|dc)-/i
const EXPLICIT_BASE = (process.env.STEWARD_API_BASE || CONFIG?.model?.base || '').replace(/\/+$/, '')
const DIRECT_BASE = 'https://api.deepseek.com'
const PROXY_BASE = (
  process.env.STEWARD_PROXY_BASE ||
  CONFIG?.model?.proxyBase ||
  'http://127.0.0.1:8787'
).replace(/\/+$/, '')

export function getApiKey() {
  return String(process.env.STEWARD_API_KEY || process.env.DEEPSEEK_API_KEY || '').trim()
}

export function getRoutes() {
  const key = getApiKey()
  const routes = []
  const push = (base, routeKey, label) => {
    if (!routeKey) return
    base = String(base).replace(/\/+$/, '')
    if (!base || routes.some((r) => r.base === base && r.key === routeKey)) return
    routes.push({ base, key: routeKey, label })
  }
  if (EXPLICIT_BASE) push(EXPLICIT_BASE, key, 'explicit')
  if (key && PROXY_TOKEN_RE.test(key)) push(PROXY_BASE, key, 'local-proxy')
  if (key && !PROXY_TOKEN_RE.test(key)) push(DIRECT_BASE, key, 'direct')
  return routes
}

export const API_BASE = getRoutes()[0]?.base || DIRECT_BASE

export function ensureDirs() {
  for (const d of [DATA, OUT, LOGS]) fs.mkdirSync(d, { recursive: true })
}
