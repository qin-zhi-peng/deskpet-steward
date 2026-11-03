// 桌宠总管 · 交付自检
// 用法：node scripts/verify.mjs [--full]
// 退出码 0 = 全绿；1 = 有失败
const PORT = Number(process.env.STEWARD_PORT || 8795)
const BASE = process.env.STEWARD_URL || `http://127.0.0.1:${PORT}`
const FULL = process.argv.includes('--full')
const results = []

function ok(name, detail = '') {
  results.push({ name, pass: true, detail })
  console.log(`✅ ${name}${detail ? '  ' + detail : ''}`)
}
function bad(name, detail = '') {
  results.push({ name, pass: false, detail })
  console.log(`❌ ${name}${detail ? '  ' + detail : ''}`)
}

async function getJson(path) {
  const res = await fetch(BASE + path)
  const text = await res.text()
  let data
  try {
    data = JSON.parse(text)
  } catch {
    data = text
  }
  return { status: res.status, data, headers: res.headers }
}

async function readSse(res, onEvent, timeoutMs = 90000) {
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n')
    buf = lines.pop() || ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const raw = line.slice(5).trim()
      if (!raw) continue
      let evt
      try {
        evt = JSON.parse(raw)
      } catch {
        continue
      }
      await onEvent(evt)
    }
  }
  try {
    await reader.cancel()
  } catch {}
}

async function main() {
  console.log(`\n桌宠总管 · 自检  ${BASE}\n`)

  // 1. 健康
  try {
    const { status, data } = await getJson('/api/health')
    if (status === 200 && data.ok && data.agent?.name) {
      ok('健康检查', `status=${data.agent.status} model=${data.agent.model} 项目=${data.counts.projects} key=${data.agent.hasKey}`)
    } else {
      bad('健康检查', `HTTP ${status}`)
    }
  } catch (err) {
    bad('健康检查（服务没起？）', err.message)
    return finish()
  }

  // 2. 首屏状态
  try {
    const { status, data } = await getJson('/api/state')
    const careers = data.careers?.length || 0
    const projects = data.projects?.length || 0
    if (status === 200 && projects >= 1) ok('项目地图', `事业线 ${careers} / 项目 ${projects} / 索引 ${data.indexedAt}`)
    else bad('项目地图', `careers=${careers} projects=${projects}`)
    if (data.phone?.url?.includes(`:${PORT}`)) ok('手机入口', data.phone.url)
    else bad('手机入口', JSON.stringify(data.phone || null))
  } catch (err) {
    bad('首屏状态', err.message)
  }

  // 3. 静态页
  for (const [label, p] of [['工作台页面', '/'], ['移动页面', '/m']]) {
    try {
      const res = await fetch(BASE + p)
      const html = await res.text()
      if (res.status === 200 && /<html|<!doctype/i.test(html) && html.length > 800) ok(label, `${html.length} 字节`)
      else bad(label, `HTTP ${res.status} len=${html.length}`)
    } catch (err) {
      bad(label, err.message)
    }
  }

  // 4. 聊天（流式 + 工具）
  try {
    const res = await fetch(BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'verify', message: '只回复两个字：收到' }),
    })
    if (res.status !== 200) throw new Error(`HTTP ${res.status}`)
    let deltas = 0
    let doneText = ''
    let errored = ''
    await readSse(res, (evt) => {
      if (evt.type === 'delta') deltas++
      if (evt.type === 'done') doneText = evt.text || ''
      if (evt.type === 'error') errored = evt.message || 'error'
    }, 90000)
    if (doneText && deltas > 0 && !errored) ok('聊天（流式）', `${deltas} 个增量 / ${doneText.length} 字`)
    else bad('聊天（流式）', errored || `deltas=${deltas} text=${doneText.slice(0, 40)}`)
  } catch (err) {
    bad('聊天（流式）', err.message)
  }

  // 5. 聊天（工具调用）
  try {
    const res = await fetch(BASE + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'verify', message: '本机现在一共有多少个项目？只回答数字和依据（用工具查）' }),
    })
    let tools = []
    let doneText = ''
    await readSse(res, (evt) => {
      if (evt.type === 'tool') tools.push(evt.name)
      if (evt.type === 'done') doneText = evt.text || ''
    }, 120000)
    if (doneText && tools.includes('list_projects')) ok('聊天（工具调用）', `工具=${tools.join(',')} / ${doneText.slice(0, 50).replace(/\n/g, ' ')}`)
    else bad('聊天（工具调用）', `tools=${tools.join(',')} text=${doneText.slice(0, 60)}`)
  } catch (err) {
    bad('聊天（工具调用）', err.message)
  }

  // 6. 记忆
  try {
    const key = 'verify-memory-' + Date.now()
    const res = await fetch(BASE + '/api/memory', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: '自检写入的记忆', pinned: true }),
    })
    const mem = await res.json()
    const list = await getJson('/api/memory')
    const found = (list.data.memories || []).find((m) => m.id === mem.id)
    if (found?.pinned) ok('记忆写入/置顶', mem.id)
    else bad('记忆写入/置顶', JSON.stringify(found || mem))
    await fetch(BASE + '/api/memory/' + mem.id, { method: 'DELETE' })
    const after = await getJson('/api/memory')
    if (!(after.data.memories || []).some((m) => m.id === mem.id)) ok('记忆删除')
    else bad('记忆删除')
  } catch (err) {
    bad('记忆', err.message)
  }

  // 7. 手机二维码
  try {
    const res = await fetch(BASE + '/api/phone/qr')
    const buf = Buffer.from(await res.arrayBuffer())
    if (res.status === 200 && buf[0] === 0x89 && buf.toString('latin1', 1, 4) === 'PNG') ok('手机二维码', `${buf.length} 字节 PNG`)
    else bad('手机二维码', `HTTP ${res.status} ${buf.length}b`)
  } catch (err) {
    bad('手机二维码', err.message)
  }

  // 8. 事件总线
  try {
    const ctrl = new AbortController()
    const res = await fetch(BASE + '/api/events', { signal: ctrl.signal })
    let gotHello = false
    await Promise.race([
      readSse(res, (evt) => {
        if (evt.type === 'hello') gotHello = true
      }, 5000),
      new Promise((r) => setTimeout(r, 3000)),
    ])
    ctrl.abort()
    if (gotHello) ok('事件总线')
    else bad('事件总线', '没收到 hello')
  } catch (err) {
    if (/abort/i.test(err.message)) ok('事件总线', '超时 abort 预期')
    else bad('事件总线', err.message)
  }

  // 9. 工单全链路（--full）
  if (FULL) {
    try {
      const res = await fetch(BASE + '/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal: '列出项目地图里的前 3 个项目，每个写一句简介，合并成一份清单写进产物', title: '自检：项目清单' }),
      })
      const task = await res.json()
      if (!task.id) throw new Error('没返回 taskId')
      ok('工单创建', `${task.id} ${task.status}`)
      let final = null
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const t = await getJson('/api/tasks/' + task.id)
        if (['done', 'failed', 'cancelled'].includes(t.data.status)) {
          final = t.data
          break
        }
      }
      if (!final) throw new Error('工单超时未结束')
      if (final.status === 'done' && final.subtasks.length >= 1 && final.subtasks.every((s) => s.status === 'done')) {
        ok('工单执行', `${final.subtasks.length} 子任务 / 进度 100%`)
      } else {
        bad('工单执行', `status=${final.status} subs=${final.subtasks.map((s) => s.status).join(',')}`)
      }
      const arts = await getJson('/api/artifacts')
      const mine = (arts.data.artifacts || []).filter((a) => a.taskId === task.id)
      if (mine.length && mine.every((a) => a.sizeBytes > 0)) ok('工单产物', mine.map((a) => a.name).join('、'))
      else bad('工单产物', `count=${mine.length} sizes=${mine.map((a) => a.sizeBytes).join(',')}`)
      if (final.summary && final.summary.length > 60) ok('工单汇报', `${final.summary.length} 字`)
      else bad('工单汇报', '汇总太短')
    } catch (err) {
      bad('工单全链路', err.message)
    }
  }

  finish()
}

function finish() {
  const failed = results.filter((r) => !r.pass)
  console.log(`\n结果：${results.length - failed.length}/${results.length} 通过${failed.length ? `，失败 ${failed.length}` : ''}`)
  if (failed.length) {
    console.log(failed.map((f) => ` - ${f.name}: ${f.detail}`).join('\n'))
    process.exit(1)
  }
  process.exit(0)
}

main()
