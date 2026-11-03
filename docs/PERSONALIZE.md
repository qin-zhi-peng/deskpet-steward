# 把它改成你自己的总管

克隆下来直接跑，它只知道两个演示目录。这份文档是「从能跑到顺手」的最短路径：先改三行配置，再补背景，最后按需收紧权限。

## 一、五分钟版

复制配置，改三个地方：

```bash
cp config.example.json config.json
```

```json
{
  "roots": [
    { "key": "work", "kind": "career", "name": "工作区", "path": "~/work", "depth": 2 },
    { "key": "projects", "kind": "projects", "name": "项目", "path": "~/projects", "depth": 2 },
    { "key": "notes", "kind": "notes", "name": "笔记", "path": "~/notes", "depth": 1 }
  ],
  "server": { "port": 8795, "host": "127.0.0.1" },
  "agent": { "name": "我的总管", "no": "No.001", "tagline": "我的工作区 · 本地总管" },
  "model": { "name": "deepseek-chat" }
}
```

1. `roots` 换成你真实的目录（支持 `~`，Windows 也可以写 `D:\\work`）。
2. `agent.name` 改成你叫得顺口的名字。
3. 仓库根目录建 `.env`，写 `DEEPSEEK_API_KEY=sk-xxxxxxxx`。

仓库没带 `config.example.json` 就直接新建 `config.json`，按上面填。改完重启服务，工作台左栏就是你的项目了。

## 二、roots 怎么配

`kind` 决定怎么读目录，四种各管一段：

**`career`：按事业线组织。** 一级目录是线，二级目录是项目。适合「按业务分文件夹、每个业务下面一堆项目」的结构：

```text
~/work/
├── 10_产品/
│   ├── demo-blog/        ← 文件数 ≥ 2，成为一个项目
│   └── demo-api/
├── 20_设计/
│   └── brand-kit/
└── 30_内容/
    └── weekly-report/
```

文件数少于 2 的二级目录会被忽略（通常是空目录或只有一个占位文件）。一级目录本身也会作为「事业线」出现在左栏顶部。

**`projects`：平铺的工程目录。** 一级目录直接当项目，适合 `~/projects/xxx` 这种：

```json
{ "key": "projects", "kind": "projects", "name": "项目", "path": "~/projects", "depth": 2 }
```

**`notes`：零散笔记。** 只收一级目录下的 `.md`，不进项目列表，但会进索引，`read_file` 和 `search_files` 能读到：

```json
{ "key": "notes", "kind": "notes", "name": "笔记", "path": "~/notes", "depth": 1 }
```

**`skills`：技能库。** 每个子目录是一个技能，读 `SKILL.md` 的 `description`。默认指向 `~/.config/deskpet-steward/skills`，你可以改成自己的：

```json
{ "key": "skills", "kind": "skills", "name": "技能库", "path": "~/.config/deskpet-steward/skills", "depth": 1 }
```

不想被扫的目录直接不写进 `roots`。`readOnly` 可以额外加只读目录（比如资料库），它们不参与项目地图，只给 `read_file` / `search_files` 用。

## 三、给它一点背景

新建 `data/profile.md`（确认已加入 `.gitignore`，只在本机）。它会被原样拼进系统提示词，最多取前 6000 字：

```markdown
# 关于我

- 做产品，同时维护几个自己的小项目。
- 习惯：先看结论，再看依据；不喜欢客套。
- 常驻项目：demo-api（下周要发 1.1）、demo-blog（每月两篇）。
- 别替我做的事：发邮件、发公开内容、花钱、删文件。
```

三条经验：

- **写稳定的东西**，别写「今天要干什么」——那是聊天里说的事。
- **写边界**比写喜好有用。「别替我发东西」比「我喜欢简洁」更能改变它的行为。
- 每次对话都会带上，太长费 token。6000 字是上限，建议控制在 1000 字以内。

## 四、记忆：让它越用越顺

两种写法：

- 聊天里说「记住：周报用进展 / 卡点 / 下一步三段」，它会调 `remember`。
- 右栏「记忆」卡片里手动置顶、删除；也可以打接口：

```bash
curl -X POST http://127.0.0.1:8795/api/memory \
  -H "Content-Type: application/json" \
  -d '{"key":"周报格式","value":"进展 / 卡点 / 下一步三段，300 字以内","pinned":true}'
```

置顶的最多全带进提示词，其余取最近 8 条。所以**置顶留给长期有效的偏好**，一次性的交代别置顶。

## 五、技能库：写说明书，不是装插件

技能不是可执行插件，是给模型看的操作手册。扫描器只读 `SKILL.md` 的 frontmatter `description`，`list_skills` 把名字和简介给它；真要用的时候，它会 `read_file` 读整份 `SKILL.md`，然后照着做。

目录结构：

```text
~/.config/deskpet-steward/skills/
└── weekly-report/
    ├── SKILL.md
    ├── template.md
    └── scripts/build.py
```

`SKILL.md` 开头：

```markdown
---
name: weekly-report
description: 从本周产物里抽进展、卡点、下一步，按模板生成周报。
---

# 周报技能

## 什么时候用
用户说「写周报」「汇总本周」时。

## 步骤
1. 读 `out/` 下最近 7 天的产物。
2. 按 `template.md` 的三段式组织。
3. 用 `write_file` 写到可写根，例如 `~/projects/weekly-report/YYYY-Www.md`。

## 边界
不编造没发生的进展；产物里没有的数字不要补。
```

写技能的三条要求：**说清触发时机**、**给具体路径**、**写明不许做什么**。模型不怕步骤多，怕的是边界模糊。

## 六、模型与网关

默认直连 `https://api.deepseek.com`，模型 `deepseek-chat`。三种改法：

```json
{ "model": { "name": "deepseek-chat", "base": "https://your-gateway.example.com" } }
```

- 换模型：改 `model.name`，要跟网关支持的模型名一致。
- 换网关：`model.base` 填 OpenAI 兼容的地址（会拼 `/chat/completions`）。
- 走本地代理：key 形如 `cx-` / `wb-` / `dc-` 时自动走 `model.proxyBase`（默认 `http://127.0.0.1:8787`）；不是这类 key 就走直连。

也可以用环境变量临时覆盖：`STEWARD_MODEL`、`STEWARD_API_BASE`、`STEWARD_PROXY_BASE`。

## 七、端口、手机、局域网

- 换端口：`server.port` 或 `STEWARD_PORT`。
- 手机看板：`server.host` 改成 `0.0.0.0`，重启后工作台右上角「手机」出二维码。二维码要本机有 `python` 和 `qrcode`：

```bash
python -m pip install qrcode pillow
```

- 只在自己电脑用，就别开 `0.0.0.0`。开了等于把接口暴露到局域网，虽然有令牌，但没必要就别开。

## 八、收紧写权限

默认允许工单写 `kind` 为 `projects` / `notes` 的根。想更保守：

```json
{
  "roots": [ ... ],
  "writeRoots": ["D:\\work\\scratch"]
}
```

只留一个「草稿区」给它写，其它目录纯只读。它写不了就会在汇报里直说，不会硬来。注意 `writeRoots` 配上之后**默认推导失效**，要写的地方必须显式列全。

## 九、换皮

- **名字和工牌**：`agent.name` / `agent.no` / `agent.tagline`，改完重启，工作台、桌宠、提示词一起变。
- **头像**：工作台的 `WHALE` 常量（`web/app.js`）指向 `assets/pet/xiaojing-portrait-512.png`；桌宠用 `pet/assets/` 下的立绘和九张头部贴片，同名替换即可，画布尺寸保持一致（参考实现是 816×916，头部贴片 300px）。
- **气泡台词**：`pet/pet.html` 里的台词和表情映射，改数组就行，不用动逻辑。
- **字体**：替换 `assets/fonts/` 下的字体文件，改 `app.css` 的 `@font-face`。换商用字体前先看许可证。
- **演示数据**：`web/lib/mock.js` 是没连上服务时用的假数据，截图、演示、给别人看都会用到它。改成你自己的项目名，看起来才像你的工作台。

## 十、改造清单

- [ ] `config.json` 的 `roots` 指向真实目录，`kind` 选对
- [ ] `.env` 里有 key，且 `.env` 没被提交
- [ ] `data/profile.md` 写了背景和边界，1000 字以内
- [ ] 置顶了 2–3 条长期偏好
- [ ] 技能库至少有一个能用的 `SKILL.md`
- [ ] `writeRoots` 按需要收紧
- [ ] 手机入口：要用就开 `host`，不用就保持 `127.0.0.1`
- [ ] `node scripts/verify.mjs` 跑绿
- [ ] 名字、头像、演示数据换成自己的
