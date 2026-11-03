# 桌宠总管 · HTTP API

Base URL：`http://127.0.0.1:8795`（`config.json` 的 `server.port` 可改）。

- 普通接口返回 `application/json; charset=utf-8`，带 `Cache-Control: no-store`；错误统一 `{ "error": "消息" }`，配 4xx / 5xx。
- 时间字段是 UTC 的 ISO 8601 字符串（如 `2026-11-03T12:34:56.789Z`），客户端自己换算成本地时间显示。
- **鉴权**：本机回环地址直接放行。非回环（手机、局域网）访问 `/api/*` 和 `/m` 必须带令牌，最简形式是 query 参数 `?token=…`；手机页校验通过后会下发 30 天有效的 HttpOnly cookie（`steward_token`）。令牌要在**本机**打开工作台，从 `GET /api/phone` 或「手机入口」二维码里取——远程请求本身也要令牌，不能靠这个接口拿。
- 流式接口是 `text/event-stream`，每条消息一行 `data: {json}`，以空行分隔。`POST /api/chat` 用 `fetch` 读 body 流，不能用 `EventSource`。

## 0. 通用对象

### Agent

```json
{
  "name": "桌宠总管",
  "no": "No.001",
  "tagline": "我的工作区 · 本地总管",
  "model": "deepseek-chat",
  "version": "1.0.0",
  "status": "idle",
  "uptimeSec": 1830,
  "hasKey": true
}
```

`status` 取值：`idle`（待命）、`thinking`（思考中）、`working`（干活中）、`happy`（开心）、`sleep`（休息）。`hasKey` 只表示有没有配 key，不含任何 key 内容。

### Career（事业线）

```json
{
  "id": "career:10_产品",
  "name": "产品",
  "dir": "10_产品",
  "path": "D:\\work\\10_产品",
  "files": 124,
  "sizeMB": 46.2,
  "updatedAt": "2026-11-03T09:12:00.000Z",
  "summary": "需求池、路线图、产品文档、竞品调研"
}
```

### Project（项目）

```json
{
  "id": "proj:demo-blog",
  "name": "demo-blog",
  "parent": null,
  "path": "D:\\work\\demo-blog",
  "root": "projects",
  "rootName": "项目",
  "kind": "node",
  "tech": ["node", "markdown"],
  "files": 42,
  "sizeMB": 1.4,
  "updatedAt": "2026-11-03T09:12:00.000Z",
  "readme": "个人博客：Markdown 写稿，构建成静态站。",
  "git": true,
  "status": "active"
}
```

`kind`：`node` / `python` / `web` / `git` / `docs` / `other`。`status`：`active`（≤ 14 天）/ `stale`（≤ 60 天）/ `archive`（更久）。`parent` 只在事业线下的项目上有值，是所属事业线目录名。

### Task（工单）

```json
{
  "id": "t_20261103_2036_ab12",
  "title": "今晚三件事",
  "goal": "把周报提纲、项目健康检查、本周产物汇总一起做了",
  "status": "running",
  "progress": 0.34,
  "projectId": null,
  "summary": null,
  "error": null,
  "createdAt": "2026-11-03T11:36:00.000Z",
  "updatedAt": "2026-11-03T12:33:00.000Z",
  "subtasks": []
}
```

`status`：`queued` / `planning` / `running` / `done` / `partial` / `failed` / `cancelled`。

### Subtask（子任务）

```json
{
  "id": "s1_ab12",
  "taskId": "t_20261103_2036_ab12",
  "seq": 1,
  "title": "列出周报提纲",
  "brief": "读 notes/weekly.md，按三段式列提纲，交付到 out/",
  "status": "done",
  "summary": "出了 3 个版本，推荐三段式",
  "artifact": "D:\\work\\deskpet-steward\\out\\t_20261103_2036_ab12\\s1_ab12-周报提纲.md",
  "error": null,
  "createdAt": "2026-11-03T11:36:00.000Z",
  "updatedAt": "2026-11-03T11:38:00.000Z"
}
```

### Artifact（产物）

```json
{
  "id": "a_m8x2k1",
  "taskId": "t_20261103_2036_ab12",
  "subtaskId": "s1_ab12",
  "name": "s1_ab12-周报提纲.md",
  "path": "D:\\work\\deskpet-steward\\out\\t_20261103_2036_ab12\\s1_ab12-周报提纲.md",
  "sizeBytes": 3120,
  "createdAt": "2026-11-03T11:38:00.000Z"
}
```

`taskId` 可能为 `null`（不是工单产生的产物，例如手动放进 `out/` 的文件）。

### Memory（记忆）

```json
{
  "id": "m_k91x0a",
  "key": "说话风格",
  "value": "结论先行，不端着，不训人",
  "source": "chat",
  "pinned": true,
  "createdAt": "2026-10-28T02:10:00.000Z"
}
```

`source`：`chat`（模型调 `remember` 写入）/ `web`（接口写入）。

## 1. 状态与健康

### GET /api/health

```json
{
  "ok": true,
  "time": "2026-11-03T12:36:00.000Z",
  "agent": { "name": "桌宠总管", "no": "No.001", "tagline": "我的工作区 · 本地总管",
             "model": "deepseek-chat", "version": "1.0.0",
             "status": "idle", "uptimeSec": 8130, "hasKey": true },
  "counts": { "projects": 20, "tasks": 3, "running": 1, "memories": 6 }
}
```

`tasks` 是全部工单数（最多 200），`running` 是 `queued` / `planning` / `running` 之和。

### GET /api/pet

桌宠轮询用的紧凑状态，5 秒一次足够。

```json
{
  "ok": true,
  "name": "桌宠总管",
  "no": "No.001",
  "tagline": "我的工作区 · 本地总管",
  "status": "working",
  "model": "deepseek-chat",
  "hasKey": true,
  "counts": { "projects": 20, "tasks": 3, "running": 1 },
  "lastNotice": { "title": "工单完成", "text": "今晚三件事：3/3 完成", "level": "ok",
                  "taskId": "t_20261103_2036_ab12", "at": "2026-11-03T12:30:00.000Z" },
  "tasks": [
    { "id": "t_20261103_2036_ab12", "title": "今晚三件事", "status": "running", "progress": 34 }
  ],
  "url": "http://127.0.0.1:8795",
  "ts": "2026-11-03T12:36:00.000Z"
}
```

`tasks` 最多 5 条，`progress` 是 0–100 的整数。`lastNotice` 没有通知时为 `null`。

### GET /api/state

首屏一次拉全量。

```json
{
  "agent": { "...": "同 Agent" },
  "careers": [ "...Career" ],
  "projects": [ "...Project" ],
  "tasks": [ "...Task" ],
  "artifacts": [ "...Artifact" ],
  "memories": [ "...Memory" ],
  "stats": { "projects": 20, "files": 1508, "sizeMB": 525.8, "todayTasks": 2, "todayArtifacts": 5 },
  "phone": { "url": "http://127.0.0.1:8795/m?token=…", "qr": "/api/phone/qr?ts=1762…" },
  "indexedAt": "2026-11-03T12:13:00.000Z",
  "indexTookMs": 1280
}
```

`tasks` 取最近 20 条，`artifacts` 最近 20 条，`memories` 最近 20 条；`todayTasks` / `todayArtifacts` 在这 20 条里按创建日期的前 10 个字符比当天 UTC 日期。`indexedAt` 和 `indexTookMs` 在索引还没建好时为 `null`。

默认只监听 `127.0.0.1` 时，`phone.url` 就是上面的回环地址；把 `server.host` 改成 `0.0.0.0` 后，这里换成电脑的局域网地址（`GET /api/phone` 的 `lan` 字段同源）。

## 2. 项目地图

### GET /api/projects

```json
{
  "indexedAt": "2026-11-03T12:13:00.000Z",
  "tookMs": 1280,
  "roots": [],
  "careers": [ "...Career" ],
  "projects": [ "...Project" ]
}
```

`roots` 是预留字段，目前恒为空数组，配置的扫描根以 `config.json` 为准。索引不存在时只返回 `indexedAt: null` 和两个空列表。

### POST /api/projects/refresh

强制重扫，同步返回（最长约几十秒，取决于目录规模）。

```json
{ "ok": true, "indexedAt": "2026-11-03T12:40:00.000Z", "projects": 20, "tookMs": 1410 }
```

扫完会向事件总线广播 `projects.indexed`。

### GET /api/skills

```json
[
  { "name": "demo-skill-report", "description": "周报技能：从产物里抽进展、卡点、下一步。",
    "path": "D:\\work\\skills\\demo-skill-report" }
]
```

## 3. 聊天

### POST /api/chat

请求体：

```json
{ "sessionId": "main", "message": "现在手上有哪些项目？", "projectId": null, "source": "web" }
```

- `sessionId` 默认 `main`；同一个会话同时只允许一个请求在跑，第二个返回 **409**。
- `message` 不能为空，否则 **400**。
- `projectId` 非空时进入项目层，系统提示词会带上这个项目的摘要。
- `source` 只用于标记来源（默认 `web`，桌宠传 `pet`），不影响逻辑。

响应是 `text/event-stream`：

| type | 载荷 | 说明 |
| --- | --- | --- |
| `start` | `{ "messageId": "msg_…" }` | 开始 |
| `delta` | `{ "text": "…" }` | 文本增量，逐段追加 |
| `tool` | `{ "name": "read_file", "args": {…}, "label": "读 …" }` | 开始调工具 |
| `tool_result` | `{ "name": "read_file", "ok": true, "summary": "3.2 KB" }` | 工具结束 |
| `task` | `{ "task": {…Task} }` | 模型刚派出一张工单 |
| `done` | `{ "text": "完整回复", "usage": {…} }` | 正常结束；`usage` 是模型返回的用量，可能为 `null` |
| `error` | `{ "message": "…" }` | 出错（缺 key、401、网络断等），出错后流结束 |

一次回复最多 6 轮工具调用，单轮 `max_tokens` 1600。客户端断开后服务端停止生成。

### GET /api/chat/history

`GET /api/chat/history?sessionId=main&limit=50`

```json
{
  "sessionId": "main",
  "messages": [
    { "id": "msg_…", "sessionId": "main", "role": "user", "text": "…", "createdAt": "…" }
  ]
}
```

`role` 是 `user` / `assistant`。`limit` 默认 60，范围 1–200；返回按时间正序。

### DELETE /api/chat/history

`DELETE /api/chat/history?sessionId=main` → `{ "ok": true }`

只清这个会话的消息，不动工单和产物。

## 4. 工单

### POST /api/tasks

```json
{ "goal": "把 demo-api 的接口清单整理成文档，归档到 out/", "title": "整理接口笔记", "projectId": "proj:demo-api" }
```

只 `goal` 必填。返回 **201** 和 Task（`status` 为 `queued`），执行在后台异步进行。后续进度从 `GET /api/tasks/:id` 或事件总线拿。

### GET /api/tasks

`GET /api/tasks?limit=20` → `{ "tasks": [ …Task ] }`

`limit` 默认 20，范围 1–50。按创建时间倒序，每条带完整子任务。

### GET /api/tasks/:id

返回单个 Task；不存在时 **404**。

### POST /api/tasks/:id/cancel

`{ "ok": true }`。取消是协作式的：正在执行的子任务在当前轮结束后停下，未开始的标 `cancelled`，工单最终状态为 `cancelled`。

## 5. 产物

### GET /api/artifacts

`{ "artifacts": [ …Artifact ] }`，最近 50 条。

### GET /api/artifact?path=…

按路径读取产物原文，返回 `text/markdown; charset=utf-8`。

- `path` 可以是相对仓库根目录的路径，也可以是绝对路径。
- 只允许 `out/` 和 `docs/` 目录内的文件，越界返回 **400**。
- 文件不存在时按系统错误返回 500（错误信息来自 `fs.statSync`），调用方自己判空更稳。

## 6. 记忆

### GET /api/memory

`{ "memories": [ …Memory ] }`，按置顶优先、时间倒序，最近 50 条。

### POST /api/memory

```json
{ "key": "周报格式", "value": "进展 / 卡点 / 下一步三段，正文不超过 300 字", "pinned": true }
```

返回 **201** 和 Memory（`source` 固定为 `web`），同时广播 `memory.new`。缺 `key` 或 `value` 返回 400。

### POST /api/memory/:id/pin

`{ "pinned": true }` → `{ "ok": true }`。传 `false` 取消置顶。

### DELETE /api/memory/:id

`{ "ok": true }`。

## 7. 事件总线

### GET /api/events

长连接 `text/event-stream`。连上立刻发一条 `hello`，之后每 15 秒发一次心跳。

| type | 载荷 | 触发时机 |
| --- | --- | --- |
| `hello` | `{ "status": "idle", "time": "…" }` | 连接建立 |
| `ping` | `{}` | 每 15 秒，事件名是 `event: ping` |
| `agent.state` | `{ "status": "working" }` | 对话开始 / 结束、工单开始 / 结束 |
| `task.update` | `{ "task": {…Task} }` | 工单状态或进度变化 |
| `artifact.new` | `{ "artifact": {…Artifact} }` | 有新产物落盘 |
| `notice` | `{ "title": "工单完成", "text": "…", "level": "ok", "taskId": "t_…" }` | 工单结束的汇总通知；`level` 为 `ok` / `warn` |
| `memory.new` | `{ "memory": {…Memory} }` | 通过接口写记忆 |
| `projects.indexed` | `{ "indexedAt": "…", "projects": 20 }` | 索引重扫完成（启动后、手动刷新后） |

服务端写事件时的格式是 `data: {"type":"task.update", …}\n\n`，类型在 JSON 里，不是 SSE 的 `event:` 字段；只有心跳用了 `event: ping`。客户端解析时两种都要认。

## 8. 手机入口

### GET /api/phone

```json
{
  "url": "http://127.0.0.1:8795/m?token=AbC123…",
  "qr": "/api/phone/qr?ts=1762173360000",
  "lan": "127.0.0.1",
  "token": "AbC123…"
}
```

只监听回环时 `lan` 固定是 `127.0.0.1`，不会给出连不上的假地址；`server.host` 改成 `0.0.0.0` 后才枚举网卡，取第一个私网 IPv4（优先家用网段），没有可用网卡时回落到 `127.0.0.1`。

### GET /api/phone/qr

返回 `image/png`，`Cache-Control: no-store`。二维码由本机 `python` + `qrcode` 生成，地址没变时复用 `data/phone-qr.png`；没装 `python` 或 `qrcode` 时接口会报错，工作台退回占位图案。

### GET /m

移动版页面，非回环访问需要令牌。校验通过后写 cookie，之后页面里的 `/api` 请求自动带凭证。

## 9. 静态资源

| 路径 | 返回 |
| --- | --- |
| `/`、`/index.html` | `web/index.html` |
| `/m`、`/mobile.html` | `web/mobile.html` |
| `/assets/*` | 项目 `assets/` 下的文件 |
| `/web/*` | 项目 `web/` 下的文件 |
| `/<相对路径>` | 兜底：`web/` 下同名文件（`app.css`、`lib/api.js` 这种相对引用） |
| `/favicon.ico` | `assets/icons/favicon.png` |

静态文件只读，带 `Cache-Control: no-cache`。`data/`、`out/`、`server/` 不对外。

## 10. 错误码

| 码 | 含义 |
| --- | --- |
| 400 | 参数错（消息为空、缺 goal、路径越界、JSON 解析失败） |
| 403 | 非本机访问但令牌不对（`需要手机访问令牌`） |
| 404 | 接口或资源不存在（含工单不存在） |
| 409 | 同一个会话正在回复 |
| 413 | 请求体超过 1 MB |
| 500 | 内部错误；服务端日志在 `logs/server.log`，不返回堆栈 |

模型侧的错误会被翻译成人话再返回，例如缺 key、401、连不上模型服务、模型名不被接受；原始报错写 `logs/agent.log`。

## 11. 客户端约定

- 首屏用 `GET /api/state`，之后用 `GET /api/events` 增量更新，不要定时轮询全量。
- 聊天按 `delta` 追加，`done` 时用 `done.text` 校正全文（工具调用轮次里模型可能补完最后一段）。
- 断流时把最后一条消息标成「回复中断」并给重试按钮，不要静默丢弃。
- 所有时间转成本地时间显示：刚刚 / N 分钟前 / 昨天 HH:mm / M 月 D 日。
