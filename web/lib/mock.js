/* 桌宠总管 · 演示数据（mock 降级）
 * 形状严格对齐 docs/API.md：GET /api/state 的返回体 + SSE 事件载荷。
 * 所有时间以「当前时刻为基准」生成带本地时区偏移的 ISO 串，截图永远新鲜。
 */
(function (root) {
  'use strict';

  var MIN = 60000;
  var HOUR = 3600000;
  var DAY = 86400000;

  function pad(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function iso(msAgo) {
    var d = new Date(Date.now() - (msAgo || 0));
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    var abs = Math.abs(off);
    return (
      d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) +
      'T' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()) +
      sign + pad(Math.floor(abs / 60)) + ':' + pad(abs % 60)
    );
  }

  var AGENT = {
    name: '桌宠总管',
    no: 'No.001',
    tagline: '我的工作区 · 本地总管',
    status: 'idle',
    model: 'deepseek-chat',
    uptimeSec: 8130,
    version: '1.0.0'
  };

  function careers() {
    return [
      { id: 'career:00_总览', name: '总览', dir: '00_总览', files: 16, sizeMB: 0.9, updatedAt: iso(2 * HOUR), summary: '导航、目录规范、资产地图、变更记录' },
      { id: 'career:10_产品', name: '产品', dir: '10_产品', files: 124, sizeMB: 46.2, updatedAt: iso(3 * HOUR), summary: '需求池、路线图、产品文档、竞品调研' },
      { id: 'career:20_设计', name: '设计', dir: '20_设计', files: 88, sizeMB: 214.6, updatedAt: iso(1 * DAY), summary: '界面稿、设计规范、组件库、插画素材' },
      { id: 'career:30_内容', name: '内容', dir: '30_内容', files: 96, sizeMB: 58.4, updatedAt: iso(4 * HOUR), summary: '选题库、长文草稿、图文素材、发布记录' },
      { id: 'career:40_运营', name: '运营', dir: '40_运营', files: 57, sizeMB: 12.8, updatedAt: iso(2 * DAY), summary: '数据周报、活动复盘、用户反馈' },
      { id: 'career:50_研究', name: '研究', dir: '50_研究', files: 63, sizeMB: 24.3, updatedAt: iso(1 * DAY), summary: '技术调研、读书笔记、原型实验' },
      { id: 'career:60_工程', name: '工程', dir: '60_工程', files: 172, sizeMB: 68.5, updatedAt: iso(5 * HOUR), summary: '脚手架、脚本、构建与自检工具' },
      { id: 'career:70_归档', name: '归档', dir: '70_归档', files: 92, sizeMB: 40.1, updatedAt: iso(12 * DAY), summary: '往年项目归档与回滚材料' }
    ];
  }

  function projects() {
    return [
      { id: 'proj:demo-blog', name: 'demo-blog', path: '~/projects/demo-blog', root: 'projects', kind: 'node', tech: ['node', 'markdown'], files: 42, sizeMB: 1.4, updatedAt: iso(12 * MIN), readme: '个人博客：Markdown 写稿，构建成静态站。', git: true, status: 'active' },
      { id: 'proj:demo-api', name: 'demo-api', path: '~/projects/demo-api', root: 'projects', kind: 'node', tech: ['node', 'sqlite', 'rest'], files: 68, sizeMB: 3.8, updatedAt: iso(3 * HOUR), readme: '示例服务：REST 接口加 SQLite，带接口自检脚本。', git: true, status: 'active' },
      { id: 'proj:demo-site', name: 'demo-site', path: '~/projects/demo-site', root: 'projects', kind: 'web', tech: ['html', 'css'], files: 24, sizeMB: 0.9, updatedAt: iso(5 * HOUR), readme: '产品官网落地页，纯静态，改文案不用碰构建。', git: true, status: 'active' },
      { id: 'proj:demo-cli', name: 'demo-cli', path: '~/projects/demo-cli', root: 'projects', kind: 'node', tech: ['node', 'cli'], files: 33, sizeMB: 0.6, updatedAt: iso(1 * DAY), readme: '命令行小工具：批量重命名、按日期归档文件。', git: false, status: 'active' },
      { id: 'proj:demo-notes', name: 'demo-notes', path: '~/notes/demo-notes.md', root: 'notes', kind: 'docs', tech: ['markdown'], files: 18, sizeMB: 0.9, updatedAt: iso(8 * HOUR), readme: '维护笔记：目录约定、常用命令、踩坑记录。', git: false, status: 'active' },
      { id: 'proj:design-system', name: 'design-system', path: '~/projects/design-system', root: 'projects', kind: 'docs', tech: ['markdown', 'css'], files: 56, sizeMB: 12.4, updatedAt: iso(1 * DAY), readme: '设计规范与组件清单，附色板与间距表。', git: true, status: 'active' },
      { id: 'proj:landing-page', name: 'landing-page', path: '~/projects/landing-page', root: 'projects', kind: 'web', tech: ['html', 'netlify'], files: 12, sizeMB: 4.2, updatedAt: iso(31 * DAY), readme: '早期落地页，31 天没动，待归档。', git: true, status: 'stale' },
      { id: 'proj:task-board', name: 'task-board', path: '~/projects/task-board', root: 'projects', kind: 'node', tech: ['node', 'canvas'], files: 96, sizeMB: 8.6, updatedAt: iso(2 * DAY), readme: '看板小工具：拖拽改状态，数据存在本地 JSON。', git: false, status: 'active' },
      { id: 'proj:data-lab', name: 'data-lab', path: '~/projects/data-lab', root: 'projects', kind: 'python', tech: ['python', 'pandas'], files: 74, sizeMB: 22.2, updatedAt: iso(1 * DAY), readme: '数据清洗与报表脚本，输入 CSV，输出图表。', git: true, status: 'active' },
      { id: 'proj:docs-site', name: 'docs-site', path: '~/projects/docs-site', root: 'projects', kind: 'docs', tech: ['markdown', 'search'], files: 41, sizeMB: 2.7, updatedAt: iso(6 * DAY), readme: '文档站：Markdown 转静态页，带全文搜索。', git: true, status: 'active' },
      { id: 'proj:demo-skill-report', name: 'demo-skill-report', path: '~/.config/deskpet-steward/skills/demo-skill-report', root: 'skills', kind: 'docs', tech: ['python', 'markdown'], files: 42, sizeMB: 9.6, updatedAt: iso(1 * DAY), readme: '周报技能：从产物里抽进展、卡点、下一步。', git: false, status: 'active' },
      { id: 'proj:demo-skill-review', name: 'demo-skill-review', path: '~/.config/deskpet-steward/skills/demo-skill-review', root: 'skills', kind: 'docs', tech: ['markdown'], files: 28, sizeMB: 5.1, updatedAt: iso(1 * DAY), readme: '审校技能：查错别字、口径和数字一致性。', git: false, status: 'active' },
      { id: 'proj:demo-skill-notes', name: 'demo-skill-notes', path: '~/.config/deskpet-steward/skills/demo-skill-notes', root: 'skills', kind: 'docs', tech: ['python', 'markdown'], files: 33, sizeMB: 6.8, updatedAt: iso(2 * DAY), readme: '笔记整理技能：把散落笔记归并成主题页。', git: false, status: 'active' },
      { id: 'proj:weekly-report', name: 'weekly-report', path: '~/work/30_内容/weekly-report', root: 'work', kind: 'docs', tech: ['markdown'], files: 24, sizeMB: 2.1, updatedAt: iso(4 * HOUR), readme: '周报底稿与历史归档，按周分目录。', git: false, status: 'active' },
      { id: 'proj:brand-kit', name: 'brand-kit', path: '~/work/20_设计/brand-kit', root: 'work', kind: 'docs', tech: ['svg', 'markdown'], files: 86, sizeMB: 18.4, updatedAt: iso(1 * DAY), readme: '标志、配色、字体与使用说明。', git: false, status: 'active' },
      { id: 'proj:api-mock', name: 'api-mock', path: '~/projects/api-mock', root: 'projects', kind: 'node', tech: ['node', 'json'], files: 27, sizeMB: 1.1, updatedAt: iso(40 * DAY), readme: '接口假数据服务，联调时用，已经 40 天没动。', git: true, status: 'stale' },
      { id: 'proj:prototype-01', name: 'prototype-01', path: '~/work/50_研究/prototype-01', root: 'work', kind: 'web', tech: ['html', 'canvas'], files: 9, sizeMB: 0.3, updatedAt: iso(96 * DAY), readme: '交互原型试验田：拖拽与动画。', git: false, status: 'archive' },
      { id: 'proj:archive-2025', name: 'archive-2025', path: '~/work/70_归档/2025', root: 'work', kind: 'docs', tech: ['markdown'], files: 340, sizeMB: 620.3, updatedAt: iso(120 * DAY), readme: '去年项目全量归档。', git: false, status: 'archive' },
      { id: 'proj:ci-scripts', name: 'ci-scripts', path: '~/projects/ci-scripts', root: 'projects', kind: 'python', tech: ['python', 'shell'], files: 31, sizeMB: 1.9, updatedAt: iso(45 * DAY), readme: '构建与发布脚本，迁到 CI 之后闲置。', git: true, status: 'stale' },
      { id: 'proj:demo-mobile', name: 'demo-mobile', path: '~/projects/demo-mobile', root: 'projects', kind: 'node', tech: ['node', 'electron'], files: 58, sizeMB: 24.6, updatedAt: iso(3 * DAY), readme: '桌面端壳子：加载本地页面，打包成免安装 exe。', git: false, status: 'active' }
    ];
  }

  function tasks() {
    return [
      {
        id: 't_20261103_2036_ab12',
        title: '今晚三件事',
        goal: '把周报提纲、项目健康检查、本周产物汇总一起做了',
        status: 'running',
        progress: 0.34,
        createdAt: iso(1 * HOUR),
        updatedAt: iso(4 * MIN),
        subtasks: [
          { id: 's1', title: '列出周报提纲', status: 'done', summary: '出了 3 个版本，推荐「进展 / 卡点 / 下一步」三段式', artifact: 'out/t_20261103_2036_ab12/s1-周报提纲.md' },
          { id: 's2', title: '检查重点项目健康度', status: 'running', summary: null, artifact: null },
          { id: 's3', title: '汇总本周产物', status: 'queued', summary: null, artifact: null }
        ],
        summary: null,
        projectId: null
      },
      {
        id: 't_20261103_1041_c3d4',
        title: '整理 demo-api 接口笔记',
        goal: '把 demo-api 的接口清单和错误码整理成一份文档，归档到 out/',
        status: 'done',
        progress: 1,
        createdAt: iso(9 * HOUR),
        updatedAt: iso(7 * HOUR),
        subtasks: [
          { id: 's1', title: '扫一遍路由定义', status: 'done', summary: '28 个接口、9 个错误码', artifact: 'out/t_20261103_1041_c3d4/s1-接口清单.md' },
          { id: 's2', title: '补错误码说明', status: 'done', summary: '补了 9 条触发条件与返回示例', artifact: 'out/t_20261103_1041_c3d4/s2-错误码.md' }
        ],
        summary: '**做完了。** 两件事都落了地：\n\n- 接口清单：28 个接口按资源分了 6 组，标了鉴权与限流\n- 错误码：9 条都补齐了触发条件和返回示例\n- 文档：`out/t_20261103_1041_c3d4/s1-接口清单.md`\n\n有 1 件要你拍板：`landing-page` 归档还是重开。',
        projectId: 'proj:demo-api'
      },
      {
        id: 't_20261102_2210_e5f6',
        title: '重跑十月的三张报表',
        goal: '把 10 月的三张报表按新口径重跑并导出图片',
        status: 'failed',
        progress: 0.5,
        createdAt: iso(22 * HOUR),
        updatedAt: iso(21 * HOUR),
        subtasks: [
          { id: 's1', title: '重跑 10 月报表', status: 'failed', summary: '数据源连接超时（第 2 次），已保留 1 份中间结果', artifact: null },
          { id: 's2', title: '导出 PNG', status: 'queued', summary: null, artifact: null }
        ],
        summary: null,
        projectId: 'proj:data-lab'
      }
    ];
  }

  function artifacts() {
    return [
      { id: 'a_01', taskId: 't_20261103_2036_ab12', name: 's1-周报提纲.md', path: 'out/t_20261103_2036_ab12/s1-周报提纲.md', sizeBytes: 3120, createdAt: iso(36 * MIN) },
      { id: 'a_02', taskId: 't_20261103_1041_c3d4', name: 's1-接口清单.md', path: 'out/t_20261103_1041_c3d4/s1-接口清单.md', sizeBytes: 4820, createdAt: iso(7 * HOUR) },
      { id: 'a_03', taskId: 't_20261103_1041_c3d4', name: 's2-错误码.md', path: 'out/t_20261103_1041_c3d4/s2-错误码.md', sizeBytes: 2240, createdAt: iso(7 * HOUR) },
      { id: 'a_04', taskId: 't_20261102_2210_e5f6', name: 's1-中间结果.csv', path: 'out/t_20261102_2210_e5f6/s1-中间结果.csv', sizeBytes: 1780, createdAt: iso(21 * HOUR) },
      { id: 'a_05', taskId: null, name: 'report-oct.png', path: 'out/20261103/report-oct.png', sizeBytes: 486400, createdAt: iso(9 * HOUR) }
    ];
  }

  function memories() {
    return [
      { id: 'm_01', key: '说话风格', value: '结论先行，不端着，不训人', pinned: true, source: 'chat', createdAt: iso(6 * DAY) },
      { id: 'm_02', key: '周报格式', value: '进展 / 卡点 / 下一步三段，正文不超过 300 字', pinned: true, source: 'chat', createdAt: iso(5 * DAY) },
      { id: 'm_03', key: '写文档的习惯', value: '先给结论再给依据，代码块标语言', pinned: false, source: 'chat', createdAt: iso(5 * DAY) },
      { id: 'm_04', key: '项目路径写法', value: '引用项目一律写 ~/projects/...', pinned: false, source: 'chat', createdAt: iso(2 * DAY) },
      { id: 'm_05', key: '目录命名', value: '两位数字前缀，文件名用短横线', pinned: false, source: 'chat', createdAt: iso(1 * DAY) },
      { id: 'm_06', key: '回复长度', value: '能一句话说清就一句话', pinned: false, source: 'chat', createdAt: iso(4 * HOUR) }
    ];
  }

  function state() {
    return {
      agent: Object.assign({}, AGENT, { uptimeSec: 8130 + Math.floor((Date.now() / 1000) % 60) }),
      careers: careers(),
      projects: projects(),
      tasks: tasks(),
      artifacts: artifacts(),
      memories: memories(),
      stats: { projects: 20, files: 1508, sizeMB: 525.8, todayTasks: 2, todayArtifacts: 5 },
      phone: { url: 'http://127.0.0.1:8795/m?token=demo', qr: '/api/phone/qr' },
      indexedAt: iso(23 * MIN)
    };
  }

  function initialMessages() {
    return [
      {
        id: 'm_demo_1',
        role: 'assistant',
        text: '在。手上有 **20 个项目**、8 条事业线，今天动过 2 张工单。\n\n- 「今晚三件事」还差 2 个子任务\n- `landing-page` 已经 31 天没动，可以考虑归档\n\n要我接着往下推，还是先看哪条线？',
        createdAt: iso(32 * MIN),
        tools: []
      },
      {
        id: 'm_demo_2',
        role: 'user',
        text: '产品这条线最近在动什么？',
        createdAt: iso(30 * MIN),
        tools: []
      },
      {
        id: 'm_demo_3',
        role: 'assistant',
        text: '**结论：产品线最近七天只动了两样。**\n\n1. 需求池加了 6 条，其中 2 条标了「本周必须」\n2. `demo-api` 补了 4 个接口，自测还没跟上\n\n下一步建议：先补自测，再排下周的范围。要我派个工单？',
        createdAt: iso(29 * MIN),
        tools: [
          { name: 'read_file', label: '读 notes/demo-notes.md', status: 'ok', res: '5.2 KB' },
          { name: 'list_projects', label: '扫产品线项目', status: 'ok', res: '20 项' }
        ]
      }
    ];
  }

  function seedEvents() {
    return [
      { time: iso(4 * MIN), type: 'task.update', level: 'ok', text: '工单「今晚三件事」进度 34%（1/3 子任务）' },
      { time: iso(9 * MIN), type: 'artifact.new', level: 'ok', text: '新产物 s1-周报提纲.md · 3.1 KB' },
      { time: iso(26 * MIN), type: 'notice', level: 'ok', text: '工单「整理 demo-api 接口笔记」完成 2/2' },
      { time: iso(58 * MIN), type: 'agent.state', level: 'muted', text: '总管状态：干活中 → 待命' }
    ];
  }

  /* 演示聊天剧本：关键词 → 工具动作 + 回复 + 可选副作用 */
  function plan(raw) {
    var text = String(raw || '');

    if (/三件|工单|派活|安排一下|做三/.test(text)) {
      return {
        tools: [
          { name: 'list_projects', label: '扫一遍在册项目', res: '20 项' },
          { name: 'create_task', label: '派工单 · 今晚三件事', res: '3 子任务' }
        ],
        text:
          '**好，拆成 3 个子任务，并行跑：**\n\n' +
          '1. 列出周报提纲 → 进展 / 卡点 / 下一步三段，300 字以内\n' +
          '2. 检查重点项目健康度 → 只报异常项\n' +
          '3. 汇总本周产物 → 按项目分组，标出没落盘的\n\n' +
          '工单已经派出去了，跑完把产物丢到右侧。有要你拍板的，我会回来找你。',
        task: {
          id: 't_mock_' + Date.now().toString(36),
          title: '今晚三件事',
          goal: '把周报提纲、项目健康检查、本周产物汇总一起做了',
          status: 'running',
          progress: 0.2,
          subtasks: [
            { id: 's1', title: '列出周报提纲', status: 'running', summary: null, artifact: null },
            { id: 's2', title: '检查重点项目健康度', status: 'queued', summary: null, artifact: null },
            { id: 's3', title: '汇总本周产物', status: 'queued', summary: null, artifact: null }
          ],
          summary: null,
          projectId: null
        },
        state: 'working'
      };
    }

    if (/记住|记一下|记忆/.test(text)) {
      return {
        tools: [{ name: 'remember', label: '写入长期记忆', res: '已存' }],
        text:
          '记住了：**结论先行，不端着**。\n\n以后我回话先给结论，再给依据；拿不准的事会直接说卡在哪，不硬编。\n\n这条已经进置顶，下次对话开头就带着。',
        memory: { key: '说话风格', value: '结论先行，不端着，不训人' },
        state: 'happy'
      };
    }

    if (/健康|体检|状态|检查/.test(text)) {
      return {
        tools: [
          { name: 'read_file', label: '读 data/index.json', res: '412 KB' },
          { name: 'list_tasks', label: '查最近工单', res: '3 张' }
        ],
        text:
          '**体检结果：都正常。**\n\n- 服务在 8795，索引 23 分钟前更新过\n- 3 张 stale 项目：`landing-page`、`api-mock`、`ci-scripts`\n- 有 1 张工单卡在 failed：重跑十月报表，卡在数据源连接\n\n建议先清 `landing-page`：31 天没动，留着只是占索引。',
        state: 'idle'
      };
    }

    if (/内容|选题|文章|更新/.test(text)) {
      return {
        tools: [
          { name: 'read_file', label: '读 notes/demo-notes.md', res: '5.2 KB' },
          { name: 'search_files', label: '搜本周选题池', res: '3 个候选' }
        ],
        text:
          '**结论：这周还能再出两篇，别硬凑第三篇。**\n\n1. 「把工具用顺手」——现成素材，400 字就能立住\n2. 「重复劳动怎么砍」——需要补一个具体场景\n\n排版沿用上次的模板。要我直接开个工单排到周四？',
        state: 'idle'
      };
    }

    if (/项目|手上|哪些|地图|索引/.test(text)) {
      return {
        tools: [
          { name: 'list_projects', label: '扫项目地图', res: '20 项' },
          { name: 'read_file', label: '读 notes/demo-notes.md', res: '5.2 KB' }
        ],
        text:
          '**结论：20 个项目在册，8 条事业线，今天动过 2 张工单。**\n\n- 活跃：`demo-blog`、`demo-api`、`demo-site`、`demo-cli`\n- 该收尾：`landing-page` 31 天没动，建议归档\n- 3 个 `demo-skill-*` 技能都在技能库里，简介能直接读\n\n要我把 stale 的项目列一份归档清单吗？',
        state: 'idle'
      };
    }

    return {
      tools: [{ name: 'list_projects', label: '看看相关项目', res: '20 项' }],
      text:
        '**收到。** 我先把边界说清楚再动手：这件事建议拆成两步——\n\n' +
        '1. 先摸清现状（读相关项目 + 最近产物）\n' +
        '2. 再动一处最小的，跑通再加\n\n' +
        '要我现在就派工单，还是先把相关项目拉出来给你看一眼？',
      state: 'idle'
    };
  }

  root.YH_MOCK = {
    state: state,
    initialMessages: initialMessages,
    seedEvents: seedEvents,
    plan: plan
  };
})(window);
