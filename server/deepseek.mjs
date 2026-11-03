// DeepSeek 客户端（OpenAI 兼容 /chat/completions，支持流式与工具调用）
import fs from 'node:fs'
import path from 'node:path'
import { LOGS, MODEL, getRoutes } from './config.mjs'
import { ensureDir, nowISO } from './util.mjs'

const LOG = path.join(LOGS, 'agent.log')

function logLine(obj) {
  try {
    ensureDir(LOGS)
    fs.appendFileSync(LOG, JSON.stringify({ at: nowISO(), ...obj }) + '\n', 'utf8')
  } catch {}
}

/* ---------------- 路由：自定义网关 / 本地代理 / 直连官网 ---------------- */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
let routeIndex = 0
let routeLogged = ''

function routes() {
  return getRoutes()
}

function currentRoute() {
  const list = routes()
  if (!list.length) {
    throw new Error('缺少 DeepSeek API key：在仓库根目录 .env 里写 DEEPSEEK_API_KEY=sk-... 或设为环境变量（见 README「密钥怎么放」）')
  }
  return list[Math.min(routeIndex, list.length - 1)]
}

/** 换下一条路由（代理没起 / 令牌失效 / 401 时降级）。全部试过返回 false。 */
function nextRoute(fromLabel) {
  const list = routes()
  if (routeIndex >= list.length - 1) return false
  routeIndex += 1
  const r = list[routeIndex]
  routeLogged = ''
  logLine({ kind: 'route-fallback', from: fromLabel, to: r.label, base: r.base })
  return true
}

function headers(route) {
  if (!route.key) throw new Error('缺少 DeepSeek API key（.env 或环境变量 DEEPSEEK_API_KEY）')
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${route.key}`,
  }
}

async function request(pathname, body, { signal, retries = 2 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const route = currentRoute()
    if (routeLogged !== route.label) {
      routeLogged = route.label
      logLine({ kind: 'route', label: route.label, base: route.base, model: MODEL })
    }
    let res
    try {
      res = await fetch(route.base + pathname, { method: 'POST', headers: headers(route), body: JSON.stringify(body), signal })
    } catch (err) {
      lastErr = err
      if (signal?.aborted) throw err
      if (nextRoute(route.label)) continue // 代理没起/连不上：立刻换下一条
      await sleep(800 * (attempt + 1))
      continue
    }
    if (res.status === 401 || res.status === 403) {
      // key 与端点不匹配（本地令牌打到官网 / 真 key 打到代理），换下一条
      const text = await res.text().catch(() => '')
      lastErr = new Error(`DeepSeek 请求失败 ${res.status}: ${text.slice(0, 300)}`)
      if (nextRoute(route.label)) continue
      throw lastErr
    }
    if (res.status === 429 || res.status >= 500) {
      lastErr = new Error(`DeepSeek ${res.status}: ${(await res.text()).slice(0, 300)}`)
      await sleep(800 * (attempt + 1))
      continue
    }
    return res
  }
  throw lastErr
}

/**
 * 流式对话。delta 回调按 token 吐出。
 * @returns {Promise<{content:string, toolCalls:Array, usage:object|null, finish:string|null}>}
 */
export async function chatStream({ messages, tools, temperature = 0.7, maxTokens = 1600, signal, onDelta }) {
  const body = {
    model: MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  }
  if (tools?.length) {
    body.tools = tools
    body.tool_choice = 'auto'
  }
  const startedAt = Date.now()
  const res = await request('/chat/completions', body, { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`DeepSeek 请求失败 ${res.status}: ${text.slice(0, 300)}`)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  let content = ''
  let usage = null
  let finish = null
  const toolMap = new Map()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue
      let chunk
      try {
        chunk = JSON.parse(payload)
      } catch {
        continue
      }
      if (chunk.usage) usage = chunk.usage
      const choice = chunk.choices?.[0]
      if (!choice) continue
      const delta = choice.delta || {}
      if (delta.content) {
        content += delta.content
        if (onDelta) onDelta(delta.content)
      }
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index ?? 0
          let acc = toolMap.get(idx)
          if (!acc) {
            acc = { index: idx, id: '', name: '', arguments: '' }
            toolMap.set(idx, acc)
          }
          if (tc.id) acc.id += tc.id
          if (tc.function?.name) acc.name += tc.function.name
          if (tc.function?.arguments) acc.arguments += tc.function.arguments
        }
      }
      if (choice.finish_reason) finish = choice.finish_reason
    }
  }

  const toolCalls = [...toolMap.values()].sort((a, b) => a.index - b.index)
  logLine({
    kind: 'chat',
    ms: Date.now() - startedAt,
    tokens: usage?.total_tokens ?? null,
    prompt: usage?.prompt_tokens ?? null,
    completion: usage?.completion_tokens ?? null,
    tools: toolCalls.map((t) => t.name),
    chars: content.length,
  })
  return { content, toolCalls, usage, finish }
}

/** 非流式（用于拆计划、写汇总），可要求 JSON。 */
export async function complete({ messages, temperature = 0.4, maxTokens = 1200, jsonMode = false, signal }) {
  const body = {
    model: MODEL,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: false,
  }
  if (jsonMode) body.response_format = { type: 'json_object' }
  const res = await request('/chat/completions', body, { signal })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`DeepSeek 请求失败 ${res.status}: ${text.slice(0, 300)}`)
  }
  const data = await res.json()
  return {
    content: data.choices?.[0]?.message?.content || '',
    usage: data.usage || null,
  }
}

export function hasApiKey() {
  return routes().length > 0
}

/** 当前实际会用的接入方式（给 /api/health 和排查用，不含 key）。 */
export function routeInfo() {
  const list = routes()
  const cur = list[Math.min(routeIndex, Math.max(0, list.length - 1))]
  return {
    routes: list.map((r) => ({ label: r.label, base: r.base })),
    active: cur ? cur.label : null,
  }
}
