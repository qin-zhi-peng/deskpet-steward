# 桌宠接入指南

`pet/` 里的小鲸是参考实现。你完全可以换成自己的桌宠——Electron、Tauri、Python + Qt，甚至一个常驻的网页窗口都行。只要接对三个接口，它就能跟总管同步状态、冒泡提醒、悬浮聊天。

现成的客户端在 `integrations/pet-bridge/pet-client.cjs`，零依赖，含 SSE 解析，Electron 主进程和普通 Node 都能直接用。

## 一、三个接口就够

Base URL 默认 `http://127.0.0.1:8795`。桌宠连本机时不需要令牌；如果桌宠跑在另一台机器上，要带 `?token=`（先在主机上从 `GET /api/phone` 拿）。

| 接口 | 用途 | 频率 |
| --- | --- | --- |
| `GET /api/pet` | 紧凑状态：名字、状态、项目数、工单数、最近通知、最近 5 张工单 | 5 秒轮询一次 |
| `GET /api/events` | SSE 推送：状态变化、工单进度、通知、新产物 | 长连接，断了自动重连 |
| `POST /api/chat` | 悬浮聊天，流式返回 | 用户说话时 |

为什么轮询和 SSE 都要：SSE 负责「立刻知道」，轮询负责「对齐真相」。SSE 断线重连期间漏掉的事件，靠下一次轮询补齐。

### GET /api/pet

```json
{
  "ok": true,
  "name": "桌宠总管",
  "no": "No.001",
  "tagline": "我的工作区 · 本地总管",
  "status": "idle",
  "model": "deepseek-chat",
  "hasKey": true,
  "counts": { "projects": 20, "tasks": 3, "running": 1 },
  "lastNotice": null,
  "tasks": [
    { "id": "t_20261103_2036_ab12", "title": "今晚三件事", "status": "running", "progress": 34 }
  ],
  "url": "http://127.0.0.1:8795",
  "ts": "2026-11-03T12:36:00.000Z"
}
```

判断顺序建议：

1. 请求失败 → 显示「总管未上线」，切哭脸，不弹系统错误框。
2. `hasKey === false` → 显示「缺 key」，切哭脸，提示去 `.env` 配。
3. `counts.running > 0` → 干活中。
4. 否则按 `status` 映射：`idle` 待命、`thinking` 思考、`working` 干活、`happy` 开心、`sleep` 休息。

### GET /api/events

```text
data: {"type":"hello","status":"idle","time":"2026-11-03T12:36:00.000Z"}

data: {"type":"agent.state","status":"working"}

data: {"type":"notice","title":"工单完成","text":"今晚三件事：3/3 完成","level":"ok","taskId":"t_…"}

event: ping
data: {}
```

| type | 该做什么 |
| --- | --- |
| `hello` | 连接建立，用它对齐一次状态，并标记「已连上」 |
| `ping` | 忽略，只用来判断连接还活着 |
| `agent.state` | 切表情 |
| `task.update` | 更新进度气泡；`status` 变 `done` 时开心两秒 |
| `artifact.new` | 可选：冒一句「产物 +1」 |
| `notice` | 冒泡提醒；`level` 是 `warn` 时用警告色 |
| `memory.new` | 可选：记一句「新记忆」 |
| `projects.indexed` | 可选：项目数变了就刷新状态 |

### POST /api/chat

请求：

```json
{ "sessionId": "main", "message": "现在手上有哪些项目？", "source": "pet" }
```

响应是 SSE，逐条读：

```text
data: {"type":"start","messageId":"msg_…"}
data: {"type":"delta","text":"结论"}
data: {"type":"delta","text":"：20 个项目"}
data: {"type":"tool","name":"list_projects","label":"看项目地图"}
data: {"type":"tool_result","name":"list_projects","ok":true,"summary":"20 个项目"}
data: {"type":"done","text":"完整回复"}
```

`delta` 追加到气泡里，`done` 时用 `done.text` 校正全文。`error` 会带一句人话（缺 key、401、连不上），直接显示给用户。

历史：`GET /api/chat/history?sessionId=main&limit=20`，桌宠打开聊天面板时先拉一次，别从空白开始。

## 二、用现成客户端

```js
// Electron 主进程 main.cjs
const { createPetClient } = require('./integrations/pet-bridge/pet-client.cjs')

const pet = createPetClient({ base: 'http://127.0.0.1:8795' })

// 1) 5 秒轮询
setInterval(async () => {
  try {
    win.webContents.send('pet:status', await pet.pet())
  } catch {
    win.webContents.send('pet:status', { online: false })
  }
}, 5000)

// 2) SSE：内部自带重连（默认 2 秒，指数退避由你自己加也行）
pet.onEvents({
  onEvent: (evt) => win.webContents.send('pet:event', evt),
  onError: () => {},
})

// 3) 聊天
ipcMain.handle('pet:chat', (_e, message) =>
  pet.chat({
    message,
    onDelta: (t) => win.webContents.send('pet:delta', t),
    onTool: (t) => win.webContents.send('pet:tool', t.label || t.name),
    onDone: (t) => win.webContents.send('pet:done', t),
    onError: (e) => win.webContents.send('pet:error', e.message),
  })
)
```

`createPetClient` 暴露的方法：

| 方法 | 说明 |
| --- | --- |
| `pet()` | `GET /api/pet` |
| `health()` | `GET /api/health` |
| `state()` | `GET /api/state`（全量，桌宠一般不用） |
| `projects()` | `GET /api/projects` |
| `tasks(limit)` | `GET /api/tasks` |
| `chatHistory(sessionId, limit)` | `GET /api/chat/history` |
| `onEvents({ onEvent, onOpen, onError, signal, retryMs })` | 订阅事件，断线自动重连 |
| `chat({ message, sessionId, projectId, onDelta, onTool, onDone, onError, signal })` | 流式聊天 |

构造参数：`base`（默认取 `STEWARD_API` 或 `STEWARD_AGENT_URL`，再退到 `http://127.0.0.1:8795`）、`token`、`timeout`（默认 12 秒）。

## 三、Electron 的四个坑

**1. 不要在 `file://` 的渲染进程里直接 `fetch`。** 页面来源是 `file://`，请求 `http://127.0.0.1` 会被 CORS 拦。统一让主进程发请求，再用 `webContents.send` 转给渲染层。

**2. 渲染层别开 Node。** `contextIsolation: true` + `nodeIntegration: false`，用 `preload.js` 通过 `contextBridge` 只暴露白名单方法。参考 `pet/preload.js`，它把主进程的 IPC 包成了 `window.petAPI`。

**3. `ELECTRON_RUN_AS_NODE=1` 会让 Electron 退化成纯 Node。** 症状是启动就退，报 `Cannot read properties of undefined (reading 'on')`。启动前清掉这个环境变量：

```powershell
Remove-Item Env:\ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

**4. 高 DPI 下别反复改窗口尺寸。** 从主进程轮询光标做拖动时，`setBounds` 的宽高要固定成 4 的倍数（参考实现用 320×400，展开聊天 320×640），否则 175% 缩放下每次 DIP↔物理像素换算都会向上取整 1px，窗口越拖越大、宠物沉出屏幕。拖动结束再用固定尺寸吸附一次。

另外两条经验：透明窗用 `transparent: true` + `frame: false` + `backgroundColor: '#00000000'`；点击穿透用 `setIgnoreMouseEvents(true, { forward: true })`，命中角色区域时再关掉。参考实现是在主进程按光标位置判断热区，比渲染层 `mousemove` 可靠。

## 四、自检

`integrations/pet-bridge/demo.mjs` 有三种用法：

```bash
node integrations/pet-bridge/demo.mjs --self-test   # 跑一遍接口自检，exit 0 = 通过
node integrations/pet-bridge/demo.mjs --watch       # 实时打印状态和事件
node integrations/pet-bridge/demo.mjs --chat "现在手上有哪些项目？"
```

`--self-test` 会依次验 `/api/pet`、`/api/health`、`/api/chat/history`、`/api/events`、`/api/chat`，五项全过才算接好。它要求服务名是 `桌宠总管`——你改过 `agent.name` 的话，把那一行断言一起改掉。

桌宠侧的最低验收：

- [ ] 透明无边框、置顶、跳过任务栏、不抢焦点
- [ ] 状态跟随 `/api/events` 的 `agent.state`，断线后能自己重连
- [ ] `/api/pet` 轮询能纠正 SSE 漏掉的状态
- [ ] 工单完成时冒泡（`notice` 或 `task.update` 里 `status=done`）
- [ ] 点开能聊天，`delta` 逐字显示，`done` 后不重复
- [ ] 总管没起时显示「未上线」，不崩溃、不弹系统对话框

## 五、边界

- 桌宠只调只读接口和聊天，**不要**给它文件读写能力；要动文件就让总管派工单，走白名单和备份。
- 对外动作（发布、群发、花钱、登录）由总管在对话里问，桌宠不替用户确认。
- 手机二维码是给手机看板用的，桌宠不需要；参考实现只连 `127.0.0.1`，跨机部署要带令牌并自己评估暴露面。
- 一个进程只开一只桌宠就够了，参考实现用 `app.requestSingleInstanceLock()` 做了单实例。
