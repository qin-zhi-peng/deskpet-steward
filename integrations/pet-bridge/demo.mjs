// 桌宠总管 · 桌宠桥接自检 + 演示
// 用法：
//   node integrations/pet-bridge/demo.mjs --self-test        # 跑一遍接口自检（exit 0 = 通过）
//   node integrations/pet-bridge/demo.mjs --watch            # 实时看状态与事件
//   node integrations/pet-bridge/demo.mjs --chat "你好"      # 流式聊天演示
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { createPetClient } = require('./pet-client.cjs')

const BASE = process.env.STEWARD_API || 'http://127.0.0.1:8795'
const pet = createPetClient({ base: BASE })
const args = process.argv.slice(2)

function fmtStatus(s) {
  const map = { idle: '待命', thinking: '思考中', working: '干活中', happy: '开心', sleep: '休息' }
  return map[s] || s || '?'
}

async function selfTest() {
  const results = []
  const check = (name, ok, detail = '') => {
    results.push({ name, ok })
    console.log(`${ok ? '✅' : '❌'} ${name}${detail ? '  ' + detail : ''}`)
  }
  try {
    const p = await pet.pet()
    check('/api/pet', p.ok === true, `status=${fmtStatus(p.status)} 项目=${p.counts.projects} 工单=${p.counts.tasks}`)
  } catch (e) {
    check('/api/pet', false, e.message)
  }
  try {
    const h = await pet.health()
    check('/api/health', h.ok === true && h.agent?.name === '桌宠总管', `key=${h.agent?.hasKey}`)
  } catch (e) {
    check('/api/health', false, e.message)
  }
  try {
    const hist = await pet.chatHistory('main', 5)
    check('/api/chat/history', Array.isArray(hist.messages), `${hist.messages.length} 条`)
  } catch (e) {
    check('/api/chat/history', false, e.message)
  }
  // SSE
  try {
    const ctrl = new AbortController()
    let hello = false
    const timer = setTimeout(() => ctrl.abort(), 4000)
    await Promise.race([
      pet.onEvents({ signal: ctrl.signal, onEvent: (evt) => { if (evt.type === 'hello') hello = true } }),
      new Promise((r) => setTimeout(r, 3500)),
    ])
    clearTimeout(timer)
    ctrl.abort()
    check('/api/events', hello, hello ? '收到 hello' : '没收到 hello')
  } catch (e) {
    check('/api/events', false, e.message)
  }
  // 聊天（一句话、不花太多 token）
  try {
    let text = ''
    await pet.chat({ message: '只回复两个字：在。', onDone: (t) => { text = t } })
    check('/api/chat', text.length > 0, JSON.stringify(text.slice(0, 20)))
  } catch (e) {
    check('/api/chat', false, e.message)
  }
  const failed = results.filter((r) => !r.ok)
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过`)
  process.exit(failed.length ? 1 : 0)
}

async function watch() {
  let last = ''
  async function tick() {
    try {
      const p = await pet.pet()
      const line = `${fmtStatus(p.status)}｜项目 ${p.counts.projects}｜工单 ${p.counts.tasks}（运行 ${p.counts.running}）`
      if (line !== last) {
        console.log(`[status] ${line}`)
        last = line
      }
    } catch {}
  }
  await tick()
  setInterval(tick, 4000)
  console.log('[events] 已连接，Ctrl+C 退出')
  await pet.onEvents({
    onEvent: (evt) => {
      if (evt.type === 'ping' || evt.type === 'hello') return
      if (evt.type === 'agent.state') console.log(`[state] ${fmtStatus(evt.status)}`)
      else if (evt.type === 'task.update') console.log(`[task] ${evt.task?.title} -> ${evt.task?.status} ${evt.task?.progress ?? ''}`)
      else if (evt.type === 'notice') console.log(`[notice] ${evt.title}：${evt.text}`)
      else if (evt.type === 'artifact.new') console.log(`[artifact] ${evt.artifact?.name}`)
    },
  })
}

async function chatOne(message) {
  console.log(`[you] ${message}`)
  await pet.chat({
    message,
    onDelta: (t) => process.stdout.write(t),
    onTool: (t) => console.log(`\n[tool] ${t.label || t.name}`),
    onError: (e) => console.error('\n[error]', e.message),
  })
  console.log('')
}

if (args.includes('--self-test')) selfTest()
else if (args.includes('--watch')) watch()
else if (args.includes('--chat')) chatOne(args[args.indexOf('--chat') + 1] || '你好')
else {
  console.log('用法：node integrations/pet-bridge/demo.mjs --self-test | --watch | --chat "消息"')
  process.exit(2)
}
