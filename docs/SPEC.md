# 桌宠总管 · 产品与技术规格

> 本文是实现契约：代码按它写，改动先改它。接口细节见 `docs/API.md`，桌宠接入见 `docs/PET-INTEGRATION.md`。

## 1. 一句话

**桌宠总管** = 一个常驻本机的个人 agent：扫一遍工作区，知道每个项目在哪、做到哪；只接「目标和边界」，自己拆活、并行干活、把要拍板的事带着建议回来；桌面上趴着一只小鲸，替它露脸。

设计取向有三条：**本地优先**（数据和索引都在本机）、**松耦合**（桌宠、工作台、手机页共用一个 HTTP 接口）、**可验证**（工单必须真落盘才算完成）。

## 2. 分层

| 层 | 名称 | 职责 |
| --- | --- | --- |
| 全局层 | 总管 | 跨项目索引、长期记忆、聊天、拆活、派单、汇报、产物归档 |
| 项目层 | 项目助理 | 选中某个项目后的窄上下文：它是什么、最近动过什么、下一步能干什么 |
| 桌面层 | 小鲸 | 常驻桌面右下角，状态同步，右键或托盘点开即聊，工单结束冒泡 |
| 远程层 | 手机入口 | 局域网二维码打开移动版，看状态、聊天、看工单 |

工牌：`桌宠总管 · No.001`，头像用小鲸立绘，副标题默认 `我的工作区 · 本地总管`。名字、编号、副标题都来自配置，不写死。

## 3. 项目地图

### 3.1 扫描根

`config.json` 的 `roots` 决定扫哪里、怎么读。`kind` 有四种：

| kind | 一级目录 | 二级目录 | 用途 |
| --- | --- | --- | --- |
| `career` | 事业线 | 文件数 ≥ 2 的当项目 | 按业务线组织的工作区 |
| `projects` | 直接当项目 | 只统计，不单独成项 | 代码 / 文档工程目录 |
| `notes` | 只收一级目录下的 `.md` | — | 零散笔记 |
| `skills` | 每个子目录是一个技能 | — | 读 `SKILL.md` 的 frontmatter `description` 当简介 |

### 3.2 扫描规则

- 跳过目录：`node_modules`、`.git`、`.svn`、`__pycache__`、`.venv`、`dist`、`build`、`.next`、`out`、`tmp`、`logs`、`.idea`、`.vscode`、`coverage` 等（完整列表在 `server/config.mjs` 的 `SKIP_DIRS`）。
- 跳过扩展名：视频、音频、压缩包、可执行文件、字体、Office 文档、数据库、模型权重（`SKIP_EXT`）。这些文件计入文件数和体积，但不读内容、不进技术栈统计。
- 单个目录上限：25000 个文件或 5000 毫秒，先到先截断，`truncated` 标记只用内部留痕。
- 并发：根目录下的一级目录最多 4 路并行；事业线的二级目录同样 4 路。
- 项目类型判定优先级：`package.json` → node；`.py` / `requirements.txt` / `pyproject.toml` → python；`.html` → web；有 `.git` → git；`.md` 超过 3 个 → docs；否则 other。
- 健康状态按最近修改时间：≤ 14 天 `active`，≤ 60 天 `stale`，更久 `archive`。
- README 摘要：取 README 文件（`README.md` / `README.txt` 等）前 3000 字节，去掉 Markdown 标记后截 150 字。

### 3.3 缓存

扫描结果写 `data/index.json`（原子写：先写临时文件再 rename）。启动时后台扫一次，不阻塞服务；10 分钟内重复调用直接返回缓存；`POST /api/projects/refresh` 强制重扫。索引里同时存 `stats`（项目数、文件数、总体积）和 `tookMs`。

## 4. 聊天

- 模型：DeepSeek，OpenAI 兼容 `/chat/completions`，默认 `deepseek-chat`；流式返回，支持 function calling。
- 一次对话最多 6 轮工具调用，单轮 `max_tokens` 1600。浏览器或手机断开连接后停止生成，不空烧 token。
- 同一个 `sessionId` 同时只允许一个请求在跑，第二个直接 409。
- 历史取最近 20 条拼进上下文；完整历史存在 SQLite，可按会话清空。

### 4.1 系统提示词

按顺序拼：

1. **人格**：说人话、结论先行、给判断不替用户做不可逆决定；先查再做，不编文件名和数字；不可逆或对外动作先问；不把 key、口令、cookie 写进回复或产物。
2. **用户背景**：`data/profile.md`（可选，≤ 6000 字，本机文件，不进版本库）。
3. **当前项目**（项目层模式才有）：名称、路径、类型、最近改动、文件数、体积、README 摘要。
4. **长期记忆**：置顶的全带，其余最多 8 条。
5. **当前工单**：最近 5 张，带状态和进度。
6. **项目地图摘要**：事业线全列，非归档项目按最近改动取前 24 个，附技能名单；要完整列表时让模型调 `list_projects`。

## 5. 工具

只读工具对白名单目录生效，写工具只对可写白名单生效。

| 工具 | 参数 | 作用 |
| --- | --- | --- |
| `list_projects` | `filter`、`root` | 列项目（名称、路径、类型、技术栈、最近改动、README 摘要），最多 40 条 |
| `read_file` | `path`、`maxBytes` | 读文本文件，单次 512 B – 24 KB，默认 12 KB，超长标记 `truncated` |
| `search_files` | `query`、`root`、`limit` | 按文件名和内容搜（大小写不敏感），最多 40 条；最多扫 6000 个文件或 4 秒 |
| `list_skills` | — | 列技能库和简介 |
| `create_task` | `goal`、`title` | 派工单，立刻返回，后台执行 |
| `list_tasks` | `limit` | 看工单、子任务、产物路径、错误 |
| `remember` | `key`、`value`、`pinned` | 写长期记忆 |
| `write_artifact` | `name`、`content` | 子任务专用：在 `out/<工单号>/<子任务号>-<文件名>` 留产物 |
| `write_file` | `path`、`content`、`overwrite` | 子任务专用：真正写进项目目录，覆盖前备份 |

`read_file`、`search_files` 的路径先解析成绝对路径，再判断是否落在 `READ_ROOTS`（所有扫描根 + `readOnly`）内，越界直接报错。

## 6. 工单

### 6.1 状态机

```text
queued → planning → running → done
                            ├→ partial（有产物、有失败）
                            ├→ failed（一个都没落盘）
                            └→ cancelled
```

子任务状态：`queued`、`running`、`done`、`failed`、`cancelled`。

### 6.2 执行流程

1. **拆活**：单独一次非流式调用，`temperature 0.3`，要求返回 JSON。规则写在提示词里：简单任务只拆 1 个；只有互不依赖的才拆多个，有先后依赖的不并行。上限 5 个。
2. **执行**：`pool` 限 3 路并发。每个子任务独立上下文，提示词只含总目标 + 本子任务标题和说明。
3. **落盘**：子任务要么 `write_file`（交付到项目），要么 `write_artifact`（留档到 `out/`）。工具描述里明确写了只能调用一次。
4. **催办**：连续两轮只有工具调用没有落盘，追加一条「资料够了，直接写」；还没写就再催一次；最后只给两个写工具，逼一次真实落盘。
5. **兜底**：有结论但确实没落盘，把结论写成 `out/` 产物，至少不丢东西。
6. **判定**：`fileOk()` 要求文件存在且 ≥ 20 字节。没有产物的子任务记失败；全部失败 → 工单 `failed`；部分失败 → `partial`。
7. **汇报**：汇总成功与失败，生成 180–260 字的中文汇报（结论 / 做了什么 / 要你拍板 / 产物），失败原因如实写。
8. **通知**：状态落库后广播 `notice`，桌宠冒泡，工作台右栏滚一条事件。

进度：起步 0.04（planning）、0.1（running），每个子任务结束时按 `0.1 + 0.75 × 完成数 / 总数` 推进，收尾置 1。

### 6.3 写入规则

- 允许的根：`writeRoots` 或自动推导（`kind` 为 `projects` / `notes` 的根）。
- 允许的扩展名：`.md` `.txt` `.json` `.yml` `.yaml` `.csv` `.js` `.mjs` `.cjs` `.ts` `.py` `.ps1` `.css` `.html` `.svg`。
- 单文件 ≤ 200 KB；目标已存在时必须 `overwrite: true`，否则报错不覆盖。
- 覆盖前把原文件复制到 `out/_backup/<时间戳>/<工单号>-<路径转下划线>`。
- 没有删除、移动、重命名工具。

## 7. 记忆

表 `memories`：`id / key / value / source / pinned / created_at`。来源分 `chat`（工具写入）和 `web`（接口写入）。读取按置顶优先、时间倒序；注入提示词时置顶全带、其余取 8 条。前端可置顶、取消置顶、删除。

## 8. 存储

`data/steward.db`，Node 内置 `node:sqlite`，WAL 模式。六张表：

| 表 | 关键字段 |
| --- | --- |
| `messages` | `id, session_id, role, text, created_at` |
| `tasks` | `id, title, goal, status, progress, project_id, summary, error, created_at, updated_at` |
| `subtasks` | `id, task_id, seq, title, brief, status, summary, artifact, error` |
| `artifacts` | `id, task_id, subtask_id, name, path, size_bytes, created_at` |
| `memories` | `id, key, value, source, pinned, created_at` |
| `meta` | `key, value`（手机令牌等） |

产物目录：`out/<工单号>/`；覆盖备份：`out/_backup/`。

## 9. 前端

- 原生 JS，无构建、无框架；`web/lib/api.js` 封装请求与 SSE 解析，`web/lib/md.js` 渲染 Markdown。
- 首屏：`GET /api/state` 一次拉全量（项目、事业线、工单、产物、记忆、统计、手机入口），之后靠 `GET /api/events` 增量更新。
- 降级：URL 带 `?mock=1`、或用 `file://` 打开、或服务没起，自动切 `web/lib/mock.js` 的演示数据，顶栏挂「演示数据」角标，事件区显示「模拟」。演示数据的字段名与前端预期一致，降级时不需要额外分支。
- 移动版：`web/mobile.html` 单列布局，聊天 + 工单；窄屏时工作台也会切成单栏，用底部标签切换。

## 10. 手机入口

- 只监听回环时直接用 `127.0.0.1`，不枚举网卡；`server.host` 改成 `0.0.0.0` 后才取第一个私网 IPv4（优先家用网段），拼成 `http://<ip>:<port>/m?token=<token>`。
- 令牌随机 12 字节 base64url，首次生成后存 `meta.phone_token`，之后复用。
- 非回环请求访问 `/api/*` 必须带令牌（query `token`、请求头或 cookie 三选一）；`/m` 页面校验通过后写 30 天有效的 HttpOnly cookie。
- 二维码由本机 `python` + `qrcode` 生成 PNG，缓存在 `data/phone-qr.png`，URL 变了才重出。

## 11. 视觉

深墨底 + 深色卡片 + 蓝色主色 + 金色点缀；标题用书法体 `LiuJianMaoCao`，正文用系统中文黑体，数字和代码用等宽字体。动效短促（约 0.2 秒），流式输出有光标，进度条呼吸，桌宠动画独立。桌宠窗口 320 × 400（展开聊天 320 × 640），固定尺寸并用底边锚定，避免高 DPI 下反复 `setBounds` 取整把窗口撑大。

## 12. 运行时约束

- Node 22.5+（`node:sqlite`、`import.meta.dirname`），推荐 24；早期 22.x / 23.x 启动时要加 `--experimental-sqlite`。服务端零第三方依赖。
- 二维码依赖本机 `python` 和 `qrcode`；没有就退回占位图案，不影响其它功能。
- 桌宠是独立 Electron 应用，`contextIsolation: true`、`nodeIntegration: false`；渲染层不直接发 HTTP，统一走主进程再 IPC 转发。
- 不抢用户焦点：桌宠默认点击穿透，只有光标落在角色上才接管鼠标；聊天面板展开时整窗可交互。

## 13. 验收标准

1. `node server/index.mjs` 起得来，`http://127.0.0.1:8795` 能打开工作台，工牌、事业线、项目能加载，聊天能打开；工单、产物、记忆在用过之后出现。
2. 问一句「现在手上有哪些项目」，能开始流式回复，引用真实项目名和路径。
3. 说「派一张工单：……」，出现工单卡，子任务按计划跑完，产物落进 `out/`，右栏出现产物和通知。
4. 故意让子任务写不进白名单，工单必须是 `failed` 或 `partial`，并写明原因。
5. 桌宠：透明无边框、可拖、点得到、右键出菜单、状态随 `agent.state` 变化。
6. 手机：改 `host` 后扫码打开，能聊天、能看工单。
7. `node scripts/verify.mjs` 全绿：健康检查、项目地图（至少 1 个项目）、静态页、流式聊天、工具调用、记忆增删、二维码、事件总线。
