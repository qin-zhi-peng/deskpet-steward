// 桌宠总管 · 智能体核心：对话、工具、工单（拆活/并行/汇报）、记忆
import fs from 'node:fs'
import path from 'node:path'
import { AGENT, BACKUP_DIR, DATA, MODEL, OUT, READ_ROOTS, ROOT, ROOTS, SKIP_EXT, WRITE_EXTS, WRITE_ROOTS } from './config.mjs'
import { chatStream, complete, hasApiKey } from './deepseek.mjs'
import { getIndex, indexSummary } from './scanner.mjs'
import { store } from './store.mjs'
import { clamp, fmtBytes, nowISO, pool, stripMarkdown, uid } from './util.mjs'

const MAX_TOOL_ROUNDS = 6
const MAX_SUBTASKS = 5
const runningTasks = new Set()
const cancelled = new Set()

/** 把模型的原始报错翻译成人能看懂的一句话（完整原因仍写日志）。 */
function friendlyModelError(err) {
  const msg = String(err?.message || err || '')
  if (/401|403|Authentication Fails|invalid.*key/i.test(msg)) {
    return '模型认证失败（401）：key 没通过。检查仓库根目录 .env 里的 DEEPSEEK_API_KEY（或环境变量），确认没有多余空格/引号、也没被吊销。（原始报错已写入 logs/agent.log）'
  }
  if (/ECONNREFUSED|fetch failed|ENOTFOUND/i.test(msg)) {
    return '连不上模型服务：检查网络、代理设置，以及 config.json / .env 里的 STEWARD_API_BASE 是否指向一个真的地址。'
  }
  if (/model.*not.*(found|exist)|400/.test(msg) && /model/i.test(msg)) {
    return `模型名不被接受：检查 config.json 里的 model.name（当前 "${MODEL}"）。`
  }
  return msg || '模型调用失败'
}

/* ------------------------------------------------------------------ */
/* 工具定义                                                            */
/* ------------------------------------------------------------------ */

const TOOL_SCHEMAS = {
  list_projects: {
    type: 'function',
    function: {
      name: 'list_projects',
      description: '列出白名单工作区里的项目（名称、路径、类型、最近改动）。不确定某件事归哪个项目时先调用它。',
      parameters: {
        type: 'object',
        properties: {
          filter: { type: 'string', description: '按名称/路径关键字过滤，可空' },
          root: { type: 'string', description: '限定扫描根的 key（见 config.json 的 roots[].key），可空' },
        },
      },
    },
  },
  read_file: {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取白名单目录内的文本文件（最多 24KB）。路径必须是绝对路径或白名单根内的相对路径。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          maxBytes: { type: 'number', description: '最多读取字节数，默认 12288' },
        },
        required: ['path'],
      },
    },
  },
  search_files: {
    type: 'function',
    function: {
      name: 'search_files',
      description: '在项目/笔记/技能目录里按关键词搜索文件名或文本内容（大小写不敏感），返回最多 20 条命中。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '关键词' },
          root: { type: 'string', description: '可选：限定搜索根（绝对路径）' },
          limit: { type: 'number' },
        },
        required: ['query'],
      },
    },
  },
  list_skills: {
    type: 'function',
    function: {
      name: 'list_skills',
      description: '列出技能库（config.json 里 kind=skills 的根目录）下的技能与简介。',
      parameters: { type: 'object', properties: {} },
    },
  },
  create_task: {
    type: 'function',
    function: {
      name: 'create_task',
      description: '当用户要你真正动手做多步工作（而不是回答问题）时，派一张工单：你负责拆活、并行执行、最后汇报。',
      parameters: {
        type: 'object',
        properties: {
          goal: { type: 'string', description: '清晰的目标与边界（做什么、不做什么、交付什么）' },
          title: { type: 'string', description: '工单标题，≤20 字' },
        },
        required: ['goal'],
      },
    },
  },
  list_tasks: {
    type: 'function',
    function: {
      name: 'list_tasks',
      description: '查看最近的工单及状态。',
      parameters: {
        type: 'object',
        properties: { limit: { type: 'number' } },
      },
    },
  },
  remember: {
    type: 'function',
    function: {
      name: 'remember',
      description: '把用户明确要求记住的偏好/事实写入长期记忆。',
      parameters: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          value: { type: 'string' },
          pinned: { type: 'boolean' },
        },
        required: ['key', 'value'],
      },
    },
  },
}

const WORKER_TOOL_SCHEMAS = {
  read_file: TOOL_SCHEMAS.read_file,
  search_files: TOOL_SCHEMAS.search_files,
  list_projects: TOOL_SCHEMAS.list_projects,
  list_skills: TOOL_SCHEMAS.list_skills,
  write_artifact: {
    type: 'function',
    function: {
      name: 'write_artifact',
      description: '把这次子任务的成果写成一份 markdown 产物，落在总管自己的 out 目录（只给总管留档/给用户看，不是项目里的文件）。≤2000 字，结论先行，不要空话。只调用一次。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '文件名，例如 选题池.md' },
          content: { type: 'string', description: 'markdown 正文' },
        },
        required: ['name', 'content'],
      },
    },
  },
  write_file: {
    type: 'function',
    function: {
      name: 'write_file',
      description: `把成果真正写进用户的项目目录（新建/覆盖文本文件）。只允许写 ${WRITE_ROOTS.join(' 或 ')} 下的文本文件（md/txt/json/js/py/ps1/css/html/svg 等）；目标已存在时必须显式传 overwrite:true，会先自动备份到 out/_backup。写 README、清理清单、笔记这类要交付到项目里的文件，用这个。`,
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目标文件的绝对路径（必须落在可写白名单根内）' },
          content: { type: 'string', description: '完整文件内容（≤200KB）' },
          overwrite: { type: 'boolean', description: '目标已存在时是否覆盖（会先备份）；默认 false' },
        },
        required: ['path', 'content'],
      },
    },
  },
}

/* ------------------------------------------------------------------ */
/* 系统提示词                                                          */
/* ------------------------------------------------------------------ */

function readLocalNote(name, max = 6000) {
  try {
    return fs.readFileSync(path.join(DATA, name), 'utf8').replace(/^\uFEFF/, '').slice(0, max).trim()
  } catch {
    return ''
  }
}

function persona() {
  const profile = readLocalNote('profile.md')
  const profileBlock = profile
    ? `\n【用户自述的背景（data/profile.md，只有本机有，不会进版本库）】\n${profile}\n`
    : ''
  return `你是「${AGENT.name}」（${AGENT.no}），常驻在用户电脑上的本地总管。桌面上那只小鲸是你的化身：它替你看状态、替你冒泡提醒。
${profileBlock}
【说话方式】
- 说人话、结论先行；给判断和建议，不替用户做不可逆的决定。
- 不端着、不训人、不复读用户的话；不写「作为一个 AI」这类废话。
- 中文回答，适当用小标题/列表/短段落；能一句话说清就一句话。

【工作原则】
1. 先判断：这件事归哪个项目？需不需要动手？问一句能答的就直接答。
2. 用户给目标和边界，你补背景和边界；需要事实先用工具查（list_projects / read_file / search_files / list_skills），不要凭记忆编。
3. 要真正做多步工作才用 create_task 派工单，一次最多 5 个子任务；派完告诉用户「我去做了」，不要空等。
   - 工单执行器能真正写文件：只允许写可写白名单根（默认是项目/笔记目录）下的文本文件，目标已存在会先备份，其它路径只读。所以「补 README / 写清单 / 整理笔记」这类活可以派，派的时候把目标绝对路径写清楚。
   - 汇报工单必须逐条核对真实产物（list_tasks 会带 artifacts 路径），文件没写出来就直说「没写出来」，不许把「跑了流程」说成「做完了」。
4. 对不可逆/对外动作（发布、群发、花钱、注册登录、删用户文件）先问；技术性、设计性的事自己拍板。
5. 不确定就说不确定；工具没查到就说没查到，不要编文件名和数字。
6. 不要把 API key、口令、cookie 写进回复、记忆或产物里；看到这类内容只提示「建议放进 .env」。

【工作方式】
- 用户问你状态时，先看「当前工单」再回答。
- 用户说「记住…」就调用 remember。
- 用户交代一件具体的事（做报告、查资料、整理文件、写提纲），如果 3 步以内能答完就直接答；否则派工单。`
}

function buildSystemPrompt(projectId) {
  const idx = getIndex()
  const memories = store.memories(12)
  const pinned = memories.filter((m) => m.pinned)
  const rest = memories.filter((m) => !m.pinned).slice(0, 8)
  const tasks = store.tasks(5)
  let projectBlock = ''
  if (projectId && idx) {
    const p = idx.projects.find((x) => x.id === projectId)
    if (p) {
      projectBlock = `\n【当前项目（项目助理模式）】\n名称：${p.name}\n路径：${p.path}\n类型：${p.kind}｜最近改动：${p.updatedAt || '未知'}｜文件 ${p.files} 个 / ${p.sizeMB} MB\n简介：${p.readme || '（无 README）'}\n回答时优先围绕这个项目。`
    }
  }
  const memBlock = memories.length
    ? `\n【长期记忆】\n${[...pinned, ...rest].map((m) => `- ${m.key}：${m.value}${m.pinned ? '（置顶）' : ''}`).join('\n')}`
    : ''
  const taskBlock = tasks.length
    ? `\n【当前工单】\n${tasks.map((t) => `- ${t.id}｜${t.title}｜${t.status}｜进度 ${Math.round(t.progress * 100)}%`).join('\n')}`
    : '\n【当前工单】无'
  return `${persona()}${projectBlock}${memBlock}${taskBlock}\n\n【项目地图（自动扫描，可能略有延迟）】\n${indexSummary()}`
}

/* ------------------------------------------------------------------ */
/* 工具执行                                                            */
/* ------------------------------------------------------------------ */

function isUnder(p, root) {
  const a = path.resolve(p)
  const b = path.resolve(root)
  return a === b || a.startsWith(b + path.sep)
}

function resolveReadPath(input) {
  const raw = String(input || '').trim()
  if (!raw) throw new Error('缺路径')
  const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(READ_ROOTS[0], raw)
  if (!READ_ROOTS.some((r) => isUnder(abs, r))) throw new Error(`路径不在白名单内：${raw}`)
  return abs
}

async function toolListProjects(args = {}) {
  const idx = getIndex()
  if (!idx) return { projects: [], note: '索引尚未建立' }
  const filter = String(args.filter || '').toLowerCase()
  const root = args.root || null
  const list = idx.projects
    .filter((p) => (!root || p.root === root) && (!filter || (p.name + p.path + p.readme).toLowerCase().includes(filter)))
    .slice(0, 40)
    .map((p) => ({
      name: p.name, path: p.path, root: p.rootName, kind: p.kind, tech: p.tech,
      updatedAt: p.updatedAt, status: p.status, files: p.files, sizeMB: p.sizeMB,
      readme: p.readme ? p.readme.slice(0, 80) : '',
    }))
  return { total: idx.projects.length, count: list.length, shown: list.length, truncated: list.length < idx.projects.length, projects: list }
}

async function toolReadFile(args = {}) {
  const p = resolveReadPath(args.path)
  const ext = path.extname(p).toLowerCase()
  if (SKIP_EXT.has(ext)) throw new Error(`不支持读取该类型文件：${ext}`)
  const st = await fs.promises.stat(p)
  if (!st.isFile()) throw new Error('不是文件')
  const max = clamp(Number(args.maxBytes) || 12288, 512, 24576)
  const fh = await fs.promises.open(p, 'r')
  const buf = Buffer.alloc(Math.min(st.size, max))
  const { bytesRead } = await fh.read(buf, 0, buf.length, 0)
  await fh.close()
  return {
    path: p, sizeBytes: st.size, truncated: st.size > bytesRead,
    content: buf.subarray(0, bytesRead).toString('utf8'),
  }
}

const SEARCH_EXTS = new Set(['.md', '.txt', '.json', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.py', '.ps1', '.css', '.html', '.yml', '.yaml', '.csv'])
const SEARCH_SKIP = new Set(['node_modules', '.git', '__pycache__', '.venv', 'dist', 'build', 'out', 'tmp', 'data', 'logs', 'assets'])

async function toolSearchFiles(args = {}) {
  const query = String(args.query || '').trim()
  if (!query) throw new Error('缺关键词')
  const limit = clamp(Number(args.limit) || 20, 1, 40)
  const root = args.root ? resolveReadPath(args.root) : null
  const skillPaths = new Set(ROOTS.filter((r) => r.kind === 'skills').map((r) => r.path))
  const roots = root ? [root] : READ_ROOTS.filter((r) => !skillPaths.has(r))
  const needle = query.toLowerCase()
  const hits = []
  const started = Date.now()
  let scanned = 0

  async function walk(dir, depth) {
    if (hits.length >= limit || scanned > 6000 || Date.now() - started > 4000) return
    let entries
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (hits.length >= limit) return
      const p = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (depth >= 4 || SEARCH_SKIP.has(e.name) || e.name.startsWith('.')) continue
        await walk(p, depth + 1)
      } else if (e.isFile()) {
        if (!SEARCH_EXTS.has(path.extname(e.name).toLowerCase())) continue
        scanned++
        if (e.name.toLowerCase().includes(needle)) {
          hits.push({ file: p, line: 0, text: `文件名命中：${e.name}` })
          continue
        }
        try {
          const st = await fs.promises.stat(p)
          if (st.size > 512 * 1024) continue
          const text = await fs.promises.readFile(p, 'utf8')
          const idx = text.toLowerCase().indexOf(needle)
          if (idx >= 0) {
            const lineStart = text.lastIndexOf('\n', idx) + 1
            const lineEnd = text.indexOf('\n', idx)
            hits.push({ file: p, line: text.slice(0, idx).split('\n').length, text: text.slice(lineStart, lineEnd > 0 ? lineEnd : undefined).trim().slice(0, 200) })
          }
        } catch {}
      }
    }
  }

  for (const r of roots) {
    if (hits.length >= limit) break
    await walk(r, 0)
  }
  return { query, scanned, count: hits.length, hits }
}

async function toolListSkills() {
  const idx = getIndex()
  return { skills: (idx?.skills || []).map((s) => ({ name: s.name, description: s.description })) }
}

async function toolRemember(args = {}) {
  if (!args.key || !args.value) throw new Error('需要 key 和 value')
  const m = store.addMemory({ key: args.key, value: args.value, source: 'chat', pinned: !!args.pinned })
  return { ok: true, memory: m }
}

async function toolCreateTask(args = {}, ctx = {}) {
  const goal = String(args.goal || '').trim()
  if (!goal) throw new Error('缺目标')
  const title = String(args.title || goal).slice(0, 24)
  const task = await createTask({ goal, title, projectId: ctx.projectId || null })
  return { ok: true, taskId: task.id, title: task.title, subtasks: task.subtasks.length, status: task.status }
}

async function toolListTasks(args = {}) {
  const list = store.tasks(clamp(Number(args.limit) || 8, 1, 20))
  const arts = store.artifacts(120)
  return {
    tasks: list.map((t) => {
      const own = arts.filter((a) => a.taskId === t.id)
      return {
        id: t.id, title: t.title, status: t.status, progress: Math.round(t.progress * 100),
        error: t.error || null,
        subtasks: t.subtasks.map((s) => ({ title: s.title, status: s.status, artifact: s.artifact || null, error: s.error || null })),
        artifacts: own.map((a) => ({ name: a.name, path: a.path, sizeBytes: a.sizeBytes })),
        artifactCount: own.length,
        summary: t.summary ? stripMarkdown(t.summary, 200) : null,
      }
    }),
  }
}

function toolLabel(name, args = {}) {
  switch (name) {
    case 'list_projects': return args.filter ? `查项目：${args.filter}` : '看项目地图'
    case 'read_file': return `读 ${shortPath(args.path)}`
    case 'search_files': return `搜「${args.query}」`
    case 'list_skills': return '看技能库'
    case 'create_task': return `派工单：${String(args.title || args.goal || '').slice(0, 18)}`
    case 'list_tasks': return '看工单'
    case 'remember': return `记住：${String(args.key || '').slice(0, 12)}`
    case 'write_artifact': return `写产物 ${args.name || ''}`
    case 'write_file': return `写文件 ${shortPath(args.path)}`
    default: return name
  }
}

function shortPath(p) {
  const s = String(p || '')
  return s.length > 46 ? '…' + s.slice(-44) : s
}

function summarizeResult(name, result) {
  if (!result) return '空'
  if (result.error) return String(result.error).slice(0, 80)
  if (name === 'read_file') return `${fmtBytes(result.sizeBytes || 0)}${result.truncated ? '（截断）' : ''}`
  if (name === 'list_projects') return `${result.count ?? result.projects?.length ?? 0} 个项目`
  if (name === 'search_files') return `${result.count ?? 0} 条命中`
  if (name === 'list_skills') return `${result.skills?.length ?? 0} 个技能`
  if (name === 'create_task') return `工单 ${result.taskId}`
  if (name === 'write_artifact') return result.path || '已写入'
  if (name === 'write_file') return result.path || '已写入'
  if (name === 'list_tasks') return `${result.tasks?.length ?? 0} 张工单`
  return '完成'
}

async function executeTool(name, args, ctx) {
  switch (name) {
    case 'list_projects': return toolListProjects(args)
    case 'read_file': return toolReadFile(args)
    case 'search_files': return toolSearchFiles(args)
    case 'list_skills': return toolListSkills()
    case 'remember': return toolRemember(args)
    case 'create_task': return toolCreateTask(args, ctx)
    case 'list_tasks': return toolListTasks(args)
    case 'write_artifact': return ctx.writeArtifact(args)
    case 'write_file': return ctx.writeFile(args)
    default: throw new Error(`未知工具 ${name}`)
  }
}

/* ------------------------------------------------------------------ */
/* 对话主流程                                                          */
/* ------------------------------------------------------------------ */

/**
 * @param {object} p
 * @param {(type:string, payload:any)=>void} p.emit  SSE 事件出口
 */
export async function runChat({ sessionId = 'main', message, projectId = null, source = 'web', emit, shouldAbort }) {
  if (!hasApiKey()) {
    emit('error', { message: '缺少 DeepSeek API key：在仓库根目录 .env 里写 DEEPSEEK_API_KEY=sk-...（或设为环境变量）' })
    return
  }
  const text = String(message || '').trim()
  if (!text) {
    emit('error', { message: '消息为空' })
    return
  }
  store.addMessage(sessionId, 'user', text)
  emit('start', { messageId: uid('msg') })
  emit('agent.state', { status: 'thinking' })

  const aborted = () => typeof shouldAbort === 'function' && shouldAbort()

  const history = store.messages(sessionId, 20).slice(0, -1)
  const messages = [
    { role: 'system', content: buildSystemPrompt(projectId) },
    ...history.map((m) => ({ role: m.role, content: m.text })),
    { role: 'user', content: text },
  ]

  let finalText = ''
  let usage = null
  let rounds = 0
  try {
    while (rounds < MAX_TOOL_ROUNDS) {
      if (aborted()) return
      rounds++
      const res = await chatStream({ messages, tools: Object.values(TOOL_SCHEMAS), maxTokens: 1600, onDelta: (t) => {
        // 浏览器/手机断开后停止继续生成，别让 token 白烧。
        if (aborted()) throw new Error('客户端已断开')
        emit('delta', { text: t })
      } })
      usage = res.usage || usage
      if (res.toolCalls?.length) {
        messages.push({
          role: 'assistant',
          content: res.content || null,
          tool_calls: res.toolCalls.map((tc) => ({ id: tc.id || uid('call'), type: 'function', function: { name: tc.name, arguments: tc.arguments || '{}' } })),
        })
        for (const tc of res.toolCalls) {
          let args = {}
          try {
            args = JSON.parse(tc.arguments || '{}')
          } catch {}
          emit('tool', { name: tc.name, args, label: toolLabel(tc.name, args) })
          let result
          try {
            result = await executeTool(tc.name, args, { sessionId, projectId, emit })
          } catch (err) {
            result = { error: err.message }
          }
          emit('tool_result', { name: tc.name, ok: !result?.error, summary: summarizeResult(tc.name, result) })
          messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 14000) })
          if (tc.name === 'create_task' && result?.taskId) {
            const t = store.task(result.taskId)
            if (t) emit('task', { task: t })
          }
        }
        continue
      }
      finalText = res.content || ''
      break
    }
  } catch (err) {
    emit('error', { message: friendlyModelError(err) })
    emit('agent.state', { status: 'idle' })
    return
  }

  if (!finalText) finalText = '这轮被工具调用打断了，没来得及给结论。要不要我再接着说？'
  store.addMessage(sessionId, 'assistant', finalText)
  emit('done', { text: finalText, usage })
  emit('agent.state', { status: 'idle' })
}

/* ------------------------------------------------------------------ */
/* 工单：拆活 → 并行 → 汇报                                            */
/* ------------------------------------------------------------------ */

let broadcast = () => {}
export function setBroadcast(fn) {
  broadcast = typeof fn === 'function' ? fn : () => {}
}

function emitTask(task) {
  broadcast('task.update', { task })
}
function emitArtifact(a) {
  broadcast('artifact.new', { artifact: a })
}
function setAgentState(status) {
  broadcast('agent.state', { status })
}

export async function createTask({ goal, title, projectId = null }) {
  const task = store.createTask({ title: title || goal.slice(0, 24), goal, projectId })
  emitTask(task)
  if (!runningTasks.has(task.id)) {
    runningTasks.add(task.id)
    setAgentState('working')
    runTask(task.id).catch((err) => {
      store.updateTask(task.id, { status: 'failed', error: err.message, progress: 1 })
      emitTask(store.task(task.id))
      setAgentState('idle')
    }).finally(() => {
      runningTasks.delete(task.id)
      if (!runningTasks.size) setAgentState('idle')
    })
  }
  return task
}

async function planTask(goal) {
  const idx = getIndex()
  const prompt = `你是工单规划器。把用户目标拆成 1-${MAX_SUBTASKS} 个可并行的子任务（能独立完成、互不写同一个文件）。
- 简单任务（读一个文件写摘要、答一个问题、查一件事）只拆 1 个，不要为了显得忙硬拆。
- 只有真正互不依赖的并行工作才拆多个；有先后依赖的不要拆成并行。
每个子任务给出：
- title：≤14 字
- brief：给执行者的一段话（要做什么、读哪些路径、交付什么、边界）
输出严格 JSON：{"title":"工单标题","subtasks":[{"title":"…","brief":"…"}]}
只输出 JSON，不要解释。

【用户目标】${goal}
【项目地图摘要】${idx ? indexSummary(10) : '（无）'}`
  try {
    const { content } = await complete({ messages: [{ role: 'user', content: prompt }], jsonMode: true, temperature: 0.3, maxTokens: 900 })
    const parsed = JSON.parse(extractJson(content))
    const subs = (parsed.subtasks || [])
      .filter((s) => s && s.title)
      .slice(0, MAX_SUBTASKS)
      .map((s) => ({ title: String(s.title).slice(0, 20), brief: String(s.brief || s.title) }))
    if (subs.length) return { title: String(parsed.title || goal).slice(0, 24), subtasks: subs }
  } catch {}
  return { title: goal.slice(0, 24), subtasks: [{ title: '执行目标', brief: goal }] }
}

function extractJson(text) {
  const s = String(text || '')
  const start = s.indexOf('{')
  const end = s.lastIndexOf('}')
  if (start >= 0 && end > start) return s.slice(start, end + 1)
  return s
}

async function runTask(taskId) {
  const task = store.task(taskId)
  if (!task) return
  store.updateTask(taskId, { status: 'planning', progress: 0.04 })
  emitTask(store.task(taskId))

  const plan = await planTask(task.goal)
  const subs = plan.subtasks.map((s, i) => store.addSubtask(taskId, i + 1, s.title, s.brief))
  store.updateTask(taskId, { status: 'running', progress: 0.1 })
  emitTask(store.task(taskId))

  let done = 0
  const results = await pool(subs, 3, async (sub) => {
    if (cancelled.has(taskId)) {
      store.updateSubtask(sub.id, { status: 'cancelled' })
      return { sub, error: '已取消' }
    }
    store.updateSubtask(sub.id, { status: 'running' })
    emitTask(store.task(taskId))
    try {
      const out = await runSubtask(task, sub)
      store.updateSubtask(sub.id, { status: 'done', summary: out.summary, artifact: out.artifact })
      done++
      store.updateTask(taskId, { progress: 0.1 + 0.75 * (done / subs.length) })
      emitTask(store.task(taskId))
      return { sub, ...out }
    } catch (err) {
      store.updateSubtask(sub.id, { status: 'failed', error: err.message })
      done++
      store.updateTask(taskId, { progress: 0.1 + 0.75 * (done / subs.length) })
      emitTask(store.task(taskId))
      return { sub, error: err.message }
    }
  })

  if (cancelled.has(taskId)) {
    store.updateTask(taskId, { status: 'cancelled', progress: 1 })
    emitTask(store.task(taskId))
    cancelled.delete(taskId)
    return
  }

  const ok = results.filter((r) => !r.error && r.artifact && fileOk(r.artifact))
  const failed = results.filter((r) => !ok.includes(r))
  const artifacts = store.artifacts(50).filter((a) => a.taskId === taskId)
  const summary = await summarizeTask(task, ok, failed, artifacts)
  const status = failed.length === 0 ? 'done' : ok.length ? 'partial' : 'failed'
  const errorText = failed.length
    ? failed.map((f) => `${f.sub.title}：${f.error || '无产物落盘'}`).join('；').slice(0, 800)
    : null
  store.updateTask(taskId, { status, progress: 1, summary, error: errorText })
  emitTask(store.task(taskId))
  broadcast('notice', {
    title: status === 'done' ? '工单完成' : status === 'partial' ? '工单部分完成' : '工单未完成',
    text:
      status === 'partial'
        ? `${plan.title}：${ok.length}/${results.length} 个子任务有产物，其余失败`
        : status === 'failed'
          ? `${plan.title}：没产出任何文件（已标失败，不装完成）`
          : `${plan.title}：${ok.length}/${results.length} 个子任务完成，产物 ${artifacts.length} 份`,
    level: status === 'done' ? 'ok' : 'warn',
    taskId,
  })
}

function fileOk(p) {
  try {
    const st = fs.statSync(p)
    return st.isFile() && st.size >= 20
  } catch {
    return false
  }
}

async function runSubtask(task, sub) {
  const dir = path.join(OUT, task.id)
  fs.mkdirSync(dir, { recursive: true })
  let artifact = null
  const registerArtifact = (p) => {
    const st = fs.statSync(p)
    const rec = store.addArtifact({ taskId: task.id, subtaskId: sub.id, name: path.basename(p), path: p, sizeBytes: st.size })
    artifact = rec
    emitArtifact(rec)
    return rec
  }

  const writeArtifact = async (args = {}) => {
    const name = String(args.name || '产物.md').replace(/[\\/:*?"<>|]/g, '-').slice(0, 80)
    const content = String(args.content || '')
    if (content.trim().length < 40) throw new Error('产物内容太短（<40 字），请把完整结论写进 content')
    const p = path.join(dir, `${sub.id}-${name}`)
    fs.writeFileSync(p, content, 'utf8')
    const rec = registerArtifact(p)
    return { ok: true, path: p, bytes: rec.sizeBytes }
  }

  // 真正写进用户项目（白名单内、文本类、覆盖前备份）
  const writeFile = async (args = {}) => {
    const raw = String(args.path || '').trim()
    const content = String(args.content ?? '')
    if (!raw) throw new Error('缺 path')
    if (!content.trim()) throw new Error('内容为空')
    const abs = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(WRITE_ROOTS[0], raw)
    if (!WRITE_ROOTS.some((r) => isUnder(abs, r))) {
      throw new Error(`路径不在可写白名单：${raw}（只允许 ${WRITE_ROOTS.join(' 、 ')}）`)
    }
    const ext = path.extname(abs).toLowerCase()
    if (!WRITE_EXTS.has(ext)) throw new Error(`不允许写该类型文件：${ext || '(无扩展名)'}`)
    if (Buffer.byteLength(content, 'utf8') > 200 * 1024) throw new Error('内容超过 200KB，请精简后再写')
    const existed = fs.existsSync(abs)
    let backup = null
    if (existed) {
      if (args.overwrite !== true) throw new Error(`目标已存在：${abs}；确认覆盖请传 "overwrite": true（会先备份）`)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const rel = abs.replace(/^[A-Za-z]:\\/, '').replace(/[\\/]/g, '_')
      backup = path.join(BACKUP_DIR, stamp, `${task.id}-${rel}`)
      fs.mkdirSync(path.dirname(backup), { recursive: true })
      fs.copyFileSync(abs, backup)
    }
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content, 'utf8')
    const rec = registerArtifact(abs)
    return { ok: true, path: abs, bytes: rec.sizeBytes, overwritten: existed, backup }
  }

  const ctx = { writeArtifact, writeFile, projectId: task.projectId }
  const system = `你是「桌宠总管」派出的执行子任务，只做这一件事，不要扩展范围。
- 结论先行，中文，不写套话；≤1200 字。
- 需要事实就调用工具查（read_file / search_files / list_projects / list_skills），不要编数字和文件名。查资料最多两三轮，别把时间全花在读文件上。
- 交付必须真正落盘，二选一：
  A. 要交付到用户项目里的文件（README、清理清单、笔记、报告）→ 用 write_file，path 写绝对路径，只能写 ${WRITE_ROOTS.join(' 或 ')} 下的文本文件；目标已存在时带 "overwrite": true（会自动备份）。
  B. 只给总管留一份参考产物 → 用 write_artifact（落到 out 目录）。
- 你没有删除/移动文件的能力；没写成就在结论里直说，不许假装写了。
- 不发布、不花钱、不动用户数据。
【总目标】${task.goal}
【你的子任务】${sub.title}
【说明】${sub.brief || ''}`

  const messages = [
    { role: 'system', content: system },
    { role: 'user', content: '开始。最多两三轮查资料，然后必须用 write_file 或 write_artifact 把成果写出来，最后给一句结论。' },
  ]

  async function step(tools) {
    const res = await chatStream({ messages, tools, maxTokens: 2400 })
    if (res.toolCalls?.length) {
      messages.push({
        role: 'assistant',
        content: res.content || null,
        tool_calls: res.toolCalls.map((tc) => ({ id: tc.id || uid('call'), type: 'function', function: { name: tc.name, arguments: tc.arguments || '{}' } })),
      })
      for (const tc of res.toolCalls) {
        let args = {}
        try {
          args = JSON.parse(tc.arguments || '{}')
        } catch {}
        let result
        try {
          result = await executeTool(tc.name, args, ctx)
        } catch (err) {
          result = { error: err.message }
        }
        messages.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(result).slice(0, 12000) })
      }
      return { hadTools: true, content: res.content || '' }
    }
    return { hadTools: false, content: res.content || '' }
  }

  let finalText = ''
  let nudged = false
  for (let round = 0; round < 8; round++) {
    if (cancelled.has(task.id)) throw new Error('已取消')
    const r = await step(Object.values(WORKER_TOOL_SCHEMAS))
    if (r.hadTools) {
      if (artifact) break
      if (round >= 1 && !nudged) {
        nudged = true
        messages.push({ role: 'user', content: '资料够了。现在停止查证，直接调用 write_file（交付到项目）或 write_artifact（留产物）把成果写出来，只写一次，然后给一句结论。' })
      }
      continue
    }
    if (r.content) finalText = r.content
    if (artifact) break
    if (!nudged) {
      nudged = true
      messages.push({ role: 'user', content: '还没有落盘。现在必须调用 write_file 或 write_artifact 把成果写出来（只写一次），再给结论。' })
      continue
    }
    break
  }

  // 强制收尾：只给写工具，逼一次真实落盘；再不落盘这张子任务就算失败，不许装完成
  if (!artifact) {
    messages.push({ role: 'user', content: '只剩一次机会：立刻调用 write_file（交付到用户项目）或 write_artifact（留产物）写出成果，不要再读文件，不要再解释。' })
    try {
      const r = await step([WORKER_TOOL_SCHEMAS.write_file, WORKER_TOOL_SCHEMAS.write_artifact])
      if (r.content && !finalText) finalText = r.content
    } catch (err) {
      if (cancelled.has(task.id)) throw err
    }
  }

  // 兜底：有结论但没落盘，把结论存成 out 产物，至少不丢东西
  if (!artifact && finalText.trim()) {
    await writeArtifact({ name: `${sub.title}.md`, content: `# ${sub.title}\n\n${finalText}\n` })
  }

  if (!artifact || !fileOk(artifact.path)) throw new Error('没有产出任何文件（write_file / write_artifact 都未成功落盘）')
  const summary = stripMarkdown(finalText || `已落盘：${path.basename(artifact.path)}`, 180)
  return { summary, artifact: artifact.path }
}

async function summarizeTask(task, ok, failed, artifacts = []) {
  const lines = ok
    .map((r) => `### ${r.sub.title}\n${r.summary || ''}${r.artifact ? `\n产物：${path.basename(r.artifact)}` : ''}`)
    .join('\n\n')
  const prompt = `你是「桌宠总管」，向老板汇报一张刚跑完的工单。用 180~260 字中文，结构：
**结论**：一句
**做了什么**：每条子任务一行带结果
**要你拍板/注意**：0~3 条（没有就写「暂无」）
**产物**：只列下面给定的产物文件名
不要编数字；失败的要如实说。不要出现「作为 AI」。

【工单】${task.title}
【目标】${task.goal}
【结果】
${lines}
【真实产物】${artifacts.length ? artifacts.map((a) => a.name).join('、') : '无'}
${failed.length ? `【失败】${failed.map((f) => `${f.sub.title}：${f.error}`).join('；')}` : ''}`
  try {
    const { content } = await complete({ messages: [{ role: 'user', content: prompt }], temperature: 0.4, maxTokens: 600 })
    return content.trim()
  } catch {
    return `**结论**：${ok.length}/${ok.length + failed.length} 个子任务完成。\n\n**产物**：${artifacts.map((a) => a.name).join('、') || '无'}`
  }
}

export function cancelTask(taskId) {
  cancelled.add(taskId)
  return true
}

export { TOOL_SCHEMAS }
