// 桌宠总管 · 桌宠桥接客户端（Electron 主进程 / Node 通用，无依赖）
// 新桌宠包只需要 import 这个文件，或者照抄里面的请求逻辑。
//
// 用法（Electron main.cjs）：
//   const { createPetClient } = require('./pet-client.cjs')
//   const pet = createPetClient({ base: 'http://127.0.0.1:8795' })
//   pet.onEvents({ onEvent: (evt) => win.webContents.send('pet:event', evt) })
//   const s = await pet.pet()           // 紧凑状态，5s 轮询一次足够
//   await pet.chat({ message: '你好', onDelta: (t) => win.webContents.send('pet:delta', t) })
//   await pet.chatHistory()
//
// 注意：不要从 file:// 的渲染进程直接 fetch，会被 CORS 拦；统一走主进程再用 IPC 转发。

const DEFAULT_BASE = process.env.STEWARD_API || process.env.STEWARD_AGENT_URL || 'http://127.0.0.1:8795'

function trimBase(base) {
  return String(base || DEFAULT_BASE).replace(/\/+$/, '')
}

function withToken(path, token) {
  if (!token) return path
  return path + (path.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token)
}

/** 极简 SSE 解析：把 text/event-stream 拆成 {type, ...data} 事件 */
async function readSse(res, onEvent, signal) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    if (signal && signal.aborted) break
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const s = line.trim()
      if (!s.startsWith('data:')) continue
      const raw = s.slice(5).trim()
      if (!raw) continue
      let obj
      try {
        obj = JSON.parse(raw)
      } catch {
        continue
      }
      onEvent(obj)
    }
  }
  try {
    await reader.cancel()
  } catch {}
}

function createPetClient(opts = {}) {
  const base = trimBase(opts.base)
  const token = opts.token || ''
  const timeout = opts.timeout || 12000

  async function getJson(path, extra = {}) {
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), timeout)
    try {
      const res = await fetch(base + withToken(path, token), { signal: ctl.signal, ...extra })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return await res.json()
    } finally {
      clearTimeout(timer)
    }
  }

  return {
    base,
    token,

    /** 紧凑状态：名称/状态/工单数/最近通知 —— 桌宠轮询这个就够 */
    pet: () => getJson('/api/pet'),
    health: () => getJson('/api/health'),
    state: () => getJson('/api/state'),
    projects: () => getJson('/api/projects'),
    tasks: (limit = 10) => getJson('/api/tasks?limit=' + limit),
    chatHistory: (sessionId = 'main', limit = 20) => getJson(`/api/chat/history?sessionId=${encodeURIComponent(sessionId)}&limit=${limit}`),

    /** 订阅事件总线：task.update / notice / agent.state / artifact.new / ping */
    async onEvents({ onEvent, onOpen, onError, signal, retryMs = 2000 } = {}) {
      while (!(signal && signal.aborted)) {
        try {
          const res = await fetch(base + withToken('/api/events', token), {
            headers: { Accept: 'text/event-stream' },
            signal,
          })
          if (!res.ok || !res.body) throw new Error('SSE HTTP ' + res.status)
          if (onOpen) onOpen()
          await readSse(res, (evt) => {
            if (onEvent) onEvent(evt)
          }, signal)
        } catch (err) {
          if (signal && signal.aborted) return
          if (onError) onError(err)
        }
        if (signal && signal.aborted) return
        await new Promise((r) => setTimeout(r, retryMs))
      }
    },

    /**
     * 发消息并流式接收。
     * onDelta(text), onTool({name,label}), onDone(text), onError(err)
     */
    async chat({ message, sessionId = 'main', projectId = null, onDelta, onTool, onDone, onError, signal } = {}) {
      try {
        const res = await fetch(base + withToken('/api/chat', token), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId, message, projectId, source: 'pet' }),
          signal,
        })
        if (!res.ok || !res.body) throw new Error('HTTP ' + res.status)
        let finalText = ''
        await readSse(res, (evt) => {
          if (evt.type === 'delta' && onDelta) onDelta(evt.text || '')
          else if (evt.type === 'tool' && onTool) onTool(evt)
          else if (evt.type === 'done') {
            finalText = evt.text || ''
            if (onDone) onDone(finalText)
          } else if (evt.type === 'error' && onError) onError(new Error(evt.message || 'chat error'))
        }, signal)
        return finalText
      } catch (err) {
        if (onError) onError(err)
        else throw err
      }
    },
  }
}

module.exports = { createPetClient }
