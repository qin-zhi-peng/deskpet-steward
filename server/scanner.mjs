// 项目地图扫描器：按 config.json 里的 roots 扫工作区 / 项目 / 笔记 / 技能库
import fs from 'node:fs'
import path from 'node:path'
import { DATA, ROOTS, SKIP_DIRS, SKIP_EXT } from './config.mjs'
import { pool, readJsonFile, stripMarkdown, writeJsonAtomic } from './util.mjs'

const CACHE_FILE = path.join(DATA, 'index.json')
const MAX_FILES = 25000
const MAX_MS = 5000

let cache = readJsonFile(CACHE_FILE, null)

export function getIndex() {
  return cache
}

export function indexedAt() {
  return cache?.indexedAt || null
}

export async function scanAll({ force = false } = {}) {
  if (!force && cache && Date.now() - new Date(cache.indexedAt).getTime() < 10 * 60 * 1000) {
    return cache
  }
  const started = Date.now()
  const careers = []
  const projects = []
  const notes = []
  const skills = []

  for (const root of ROOTS) {
    let entries = []
    try {
      entries = await fs.promises.readdir(root.path, { withFileTypes: true })
    } catch {
      continue
    }
    if (root.kind === 'skills') {
      for (const e of entries) {
        if (!(e.isDirectory() || e.isSymbolicLink())) continue
        const p = path.join(root.path, e.name)
        let isDir = e.isDirectory()
        if (!isDir) {
          try {
            isDir = (await fs.promises.stat(p)).isDirectory()
          } catch {
            isDir = false
          }
        }
        if (!isDir) continue
        const desc = await readSkillDescription(p)
        skills.push({ name: e.name, path: p, description: desc })
      }
      continue
    }
    if (root.kind === 'notes') {
      for (const e of entries) {
        if (!e.isFile() || !e.name.endsWith('.md')) continue
        const p = path.join(root.path, e.name)
        try {
          const st = await fs.promises.stat(p)
          notes.push({ name: e.name, path: p, sizeBytes: st.size, updatedAt: st.mtime.toISOString() })
        } catch {}
      }
      continue
    }
    const dirs = entries.filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !SKIP_DIRS.has(e.name)).map((e) => path.join(root.path, e.name))
    const scanned = await pool(dirs, 4, async (dir) => scanDir(dir, root, dir === root.path ? 1 : 2))
    for (const item of scanned) {
      if (!item) continue
      if (root.career) {
        careers.push(toCareer(item, root))
        // 事业线下的二级目录，挑有内容的作为项目
        const subs = await listSubDirs(item.path)
        const subScanned = await pool(subs, 4, async (sub) => {
          const s = await scanDir(sub, root, 1)
          return s && s.files >= 2 ? s : null
        })
        for (const s of subScanned) if (s) projects.push(toProject(s, root, item.name))
      } else {
        projects.push(toProject(item, root, null))
      }
    }
  }

  projects.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
  careers.sort((a, b) => a.dir.localeCompare(b.dir))

  const stats = {
    projects: projects.length,
    files: careers.reduce((n, c) => n + c.files, 0) + projects.reduce((n, p) => n + p.files, 0),
    sizeMB: +(careers.reduce((n, c) => n + c.sizeMB, 0) + projects.reduce((n, p) => n + p.sizeMB, 0)).toFixed(1),
  }

  cache = {
    indexedAt: new Date().toISOString(),
    tookMs: Date.now() - started,
    careers,
    projects,
    notes,
    skills,
    stats,
  }
  writeJsonAtomic(CACHE_FILE, cache)
  return cache
}

async function listSubDirs(dir) {
  try {
    const es = await fs.promises.readdir(dir, { withFileTypes: true })
    return es.filter((e) => (e.isDirectory() || e.isSymbolicLink()) && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.')).map((e) => path.join(dir, e.name))
  } catch {
    return []
  }
}

async function scanDir(dir, root, maxDepth = 2) {
  const state = {
    path: dir,
    name: path.basename(dir),
    files: 0,
    bytes: 0,
    latest: 0,
    hasGit: false,
    hasPkg: false,
    hasPy: false,
    hasHtml: false,
    exts: new Map(),
    readme: null,
    children: [],
    truncated: false,
    startedAt: Date.now(),
  }
  try {
    await walk(dir, 0, maxDepth, state)
  } catch {
    return null
  }
  if (state.files === 0) return null
  const readmePath = await findReadme(dir)
  if (readmePath) state.readme = stripMarkdown(await readText(readmePath, 3000), 150)
  return state
}

async function walk(dir, depth, maxDepth, state) {
  if (state.files >= MAX_FILES || Date.now() - state.startedAt > MAX_MS) {
    state.truncated = true
    return
  }
  let entries
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) {
        if (e.name === '.git') state.hasGit = true
        continue
      }
      if (depth + 1 <= maxDepth) await walk(p, depth + 1, maxDepth, state)
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase()
      const skipped = SKIP_EXT.has(ext)
      state.files++
      if (!skipped) state.exts.set(ext, (state.exts.get(ext) || 0) + 1)
      const lower = e.name.toLowerCase()
      if (lower === 'readme.md' || lower === 'readme.txt') state.readmeFile = p
      if (lower === 'package.json') state.hasPkg = true
      if (lower === 'requirements.txt' || lower === 'pyproject.toml') state.hasPy = true
      if (lower === 'index.html') state.hasHtml = true
      if (ext === '.py') state.hasPy = true
      if (ext === '.html' || ext === '.htm') state.hasHtml = true
      if (depth === 0) state.children.push(e.name)
      try {
        const st = await fs.promises.stat(p)
        state.bytes += st.size
        if (st.mtimeMs > state.latest) state.latest = st.mtimeMs
      } catch {}
    }
  }
}

async function findReadme(dir) {
  for (const name of ['README.md', 'readme.md', 'Readme.md', 'README.txt', 'README']) {
    const p = path.join(dir, name)
    try {
      const st = await fs.promises.stat(p)
      if (st.isFile()) return p
    } catch {}
  }
  return null
}

async function readText(file, max = 4000) {
  try {
    const fh = await fs.promises.open(file, 'r')
    const buf = Buffer.alloc(max)
    const { bytesRead } = await fh.read(buf, 0, max, 0)
    await fh.close()
    return buf.subarray(0, bytesRead).toString('utf8')
  } catch {
    return ''
  }
}

async function readSkillDescription(dir) {
  const p = path.join(dir, 'SKILL.md')
  try {
    const text = await readText(p, 4000)
    if (!text) return ''
    const fm = text.match(/^---\s*([\s\S]*?)\s*---/)
    if (fm) {
      const m = fm[1].match(/description:\s*(.+)/)
      if (m) return stripMarkdown(m[1].replace(/^["']|["']$/g, ''), 140)
    }
    const firstLine = text.split('\n').find((l) => l.trim() && !l.trim().startsWith('#'))
    return stripMarkdown(firstLine || '', 140)
  } catch {
    return ''
  }
}

function toTech(state) {
  const tech = []
  if (state.hasPkg) tech.push('node')
  if (state.hasPy) tech.push('python')
  if (state.hasHtml) tech.push('html')
  if (state.hasGit) tech.push('git')
  if (state.exts.get('.ts') || state.exts.get('.tsx')) tech.push('ts')
  if (state.exts.get('.md') > 5) tech.push('docs')
  return tech
}

function kindOf(state) {
  if (state.hasPkg) return 'node'
  if (state.hasPy) return 'python'
  if (state.hasHtml) return 'web'
  if (state.hasGit) return 'git'
  if ((state.exts.get('.md') || 0) > 3) return 'docs'
  return 'other'
}

function statusOf(ts) {
  if (!ts) return 'archive'
  const days = (Date.now() - ts) / 86400000
  if (days <= 14) return 'active'
  if (days <= 60) return 'stale'
  return 'archive'
}

function slug(p) {
  return p.replace(/[\\/:*?"<>|]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase()
}

function toProject(state, root, parent) {
  return {
    id: `proj:${slug(state.path)}`,
    name: state.name,
    parent: parent || null,
    path: state.path,
    root: root.key,
    rootName: root.name,
    kind: kindOf(state),
    tech: toTech(state),
    files: state.files,
    sizeMB: +(state.bytes / 1024 / 1024).toFixed(1),
    updatedAt: state.latest ? new Date(state.latest).toISOString() : null,
    readme: state.readme || '',
    git: state.hasGit,
    status: statusOf(state.latest),
  }
}

function toCareer(state, root) {
  return {
    id: `career:${slug(state.name)}`,
    name: state.name,
    dir: state.name,
    path: state.path,
    files: state.files,
    sizeMB: +(state.bytes / 1024 / 1024).toFixed(1),
    updatedAt: state.latest ? new Date(state.latest).toISOString() : null,
    summary: state.readme || '',
  }
}

export function indexSummary(maxProjects = 24) {
  if (!cache) return '（项目地图尚未建立）'
  const careers = cache.careers.map((c) => `- ${c.name}（${c.files} 文件 / ${c.sizeMB} MB）${c.summary ? '：' + c.summary : ''}`).join('\n')
  const projects = cache.projects
    .filter((p) => p.status !== 'archive')
    .slice(0, maxProjects)
    .map((p) => `- ${p.name}｜${p.rootName}｜${p.kind}｜最近 ${fmtDay(p.updatedAt)}${p.readme ? '｜' + p.readme.slice(0, 60) : ''}`)
    .join('\n')
  const skills = cache.skills.map((s) => s.name).join('、')
  return `【规模】项目共 ${cache.projects.length} 个；事业线 ${cache.careers.length} 条；技能 ${cache.skills.length} 个（下面只列事业线全部 + 项目按最近改动的前 ${maxProjects} 个；要完整项目列表请调用 list_projects 工具）

【事业线】
${careers}

【项目（前 ${maxProjects}）】
${projects}

【技能库】${skills}`
}

function fmtDay(iso) {
  if (!iso) return '未知'
  const d = (Date.now() - new Date(iso).getTime()) / 86400000
  if (d < 1) return '今天'
  return `${Math.floor(d)} 天前`
}
