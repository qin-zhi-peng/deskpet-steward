/* 桌宠总管 · Web 工作台前端
 * 原生 JS，无构建、无第三方依赖。file:// 可直接打开（自动演示数据）。
 * 契约：docs/SPEC.md、docs/API.md
 */
(function () {
  'use strict';

  var WHALE = '../assets/pet/xiaojing-portrait-512.png';

  var STATE_META = {
    idle: { label: '待命', cls: 'ok' },
    thinking: { label: '思考中', cls: 'whale' },
    working: { label: '干活中', cls: 'warn' },
    happy: { label: '开心', cls: 'gold' },
    sleep: { label: '休息', cls: 'dim' }
  };

  var TASK_STATUS = {
    queued: '排队中',
    planning: '拆活中',
    running: '进行中',
    done: '已完成',
    partial: '部分完成',
    failed: '失败',
    cancelled: '已取消'
  };

  var S = {
    mock: false,
    booted: false,
    agent: { name: '桌宠总管', no: 'No.001', tagline: '我的工作区 · 本地总管', status: 'idle', model: 'deepseek-chat' },
    careers: [],
    projects: [],
    tasks: [],
    artifacts: [],
    memories: [],
    stats: {},
    phone: {},
    indexedAt: null,
    sessionId: 'main',
    currentProjectId: null,
    search: '',
    messages: [],
    events: [],
    streaming: false,
    mobileView: 'chat',
    taskOpen: {},
    summaryOpen: {},
    mockTimer: null,
    es: null,
    renderTimer: null,
    renderedIds: '',
    autoScroll: true,
    bootReason: ''
  };

  var el = {};

  /* ---------------- 基础工具 ---------------- */

  function $(id) {
    return document.getElementById(id);
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function pad2(n) {
    return (n < 10 ? '0' : '') + n;
  }

  function nowIso() {
    var d = new Date();
    var off = -d.getTimezoneOffset();
    var sign = off >= 0 ? '+' : '-';
    var abs = Math.abs(off);
    return (
      d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
      sign + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60)
    );
  }

  function toDate(iso) {
    if (!iso) return null;
    var d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function clock(iso) {
    var d = toDate(iso);
    if (!d) return '';
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  function timeAgo(iso) {
    var d = toDate(iso);
    if (!d) return '';
    var diff = Date.now() - d.getTime();
    if (diff < 45000) return '刚刚';
    if (diff < 3600000) return Math.max(1, Math.floor(diff / 60000)) + ' 分钟前';
    var now = new Date();
    var sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return clock(iso);
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + clock(iso);
    if (d.getFullYear() === now.getFullYear()) return d.getMonth() + 1 + '月' + d.getDate() + '日';
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function shortAgo(iso) {
    var d = toDate(iso);
    if (!d) return '';
    var diff = Date.now() - d.getTime();
    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return Math.floor(diff / 60000) + '分';
    if (diff < 86400000) return Math.floor(diff / 3600000) + '时';
    if (diff < 172800000) return '昨天';
    if (diff < 2592000000) return Math.floor(diff / 86400000) + '天';
    return d.getMonth() + 1 + '月';
  }

  function fmtNum(n) {
    var v = Number(n) || 0;
    return v.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function fmtSizeMB(mb) {
    var v = Number(mb) || 0;
    if (v >= 1024) return (v / 1024).toFixed(1) + ' GB';
    if (v >= 10) return v.toFixed(0) + ' MB';
    if (v >= 1) return v.toFixed(1) + ' MB';
    if (v > 0) return Math.round(v * 1024) + ' KB';
    return '0 MB';
  }

  function fmtBytes(b) {
    var v = Number(b) || 0;
    if (v >= 1048576) return (v / 1048576).toFixed(1) + ' MB';
    if (v >= 1024) return (v / 1024).toFixed(1) + ' KB';
    return v + ' B';
  }

  function fmtDur(sec) {
    var v = Number(sec) || 0;
    if (!v) return '—';
    var h = Math.floor(v / 3600);
    var m = Math.floor((v % 3600) / 60);
    if (h > 0) return h + 'h ' + m + 'm';
    return Math.max(1, m) + 'm';
  }

  function basename(p) {
    if (!p) return '';
    var s = String(p).replace(/[\\/]+$/, '');
    var i = Math.max(s.lastIndexOf('\\'), s.lastIndexOf('/'));
    return i >= 0 ? s.slice(i + 1) : s;
  }

  function isMobile() {
    return window.matchMedia && window.matchMedia('(max-width: 899px)').matches;
  }

  function dayLabel() {
    var d = new Date();
    var week = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getDay()];
    return '今天 · ' + (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + week;
  }

  function repeat(n, html) {
    var out = '';
    for (var i = 0; i < n; i++) out += html;
    return out;
  }

  function toast(msg, level) {
    if (!el.toasts) return;
    var node = document.createElement('div');
    node.className = 'toast toast-' + (level || 'info');
    node.textContent = msg;
    el.toasts.appendChild(node);
    while (el.toasts.children.length > 4) el.toasts.removeChild(el.toasts.firstChild);
    setTimeout(function () {
      node.classList.add('is-out');
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 220);
    }, level === 'err' ? 4200 : 2600);
  }

  function copyText(text) {
    function fallback() {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', 'readonly');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return ok;
      } catch (e) {
        return false;
      }
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          return true;
        },
        function () {
          return fallback();
        }
      );
    }
    return Promise.resolve(fallback());
  }

  function copyPath(path) {
    if (!path) return;
    copyText(path).then(function (ok) {
      toast(ok ? '已复制路径：' + basename(path) : '复制失败，路径：' + path, ok ? 'ok' : 'warn');
    });
  }

  /* ---------------- 骨架屏 ---------------- */

  function skelRows(n, kind) {
    var rows = '';
    for (var i = 0; i < n; i++) {
      if (kind === 'tile') {
        rows +=
          '<div class="skel-tile"><span class="skel skel-line w50"></span><span class="skel skel-line w80 sm"></span></div>';
      } else if (kind === 'row') {
        rows +=
          '<div class="skel-row"><span class="skel skel-dot"></span><span class="skel skel-line w40"></span><span class="skel skel-line w20 sm"></span></div>';
      } else if (kind === 'task') {
        rows +=
          '<div class="skel-card"><div class="skel-row"><span class="skel skel-line w60"></span><span class="skel skel-line w20 sm"></span></div><span class="skel skel-line w90 sm"></span><span class="skel skel-bar"></span></div>';
      } else {
        rows +=
          '<div class="skel-row"><span class="skel skel-line w70"></span><span class="skel skel-line w15 sm"></span></div>';
      }
    }
    return rows;
  }

  function renderSkeletons() {
    el.idcard.innerHTML =
      '<div class="idcard is-skel">' +
      '<div class="skel-avatar-row"><span class="skel skel-ava"></span><span class="skel skel-line w50"></span></div>' +
      '<span class="skel skel-line w80"></span><span class="skel skel-line w60"></span>' +
      '</div>';
    el.careerList.innerHTML = skelRows(6, 'tile');
    el.projectList.innerHTML = skelRows(7, 'row');
    el.chatInner.innerHTML =
      '<div class="chat-skel">' +
      '<div class="skel skel-bubble left"></div>' +
      '<div class="skel skel-bubble right"></div>' +
      '<div class="skel skel-bubble left tall"></div>' +
      '</div>';
    el.taskList.innerHTML = skelRows(2, 'task');
    el.artifactList.innerHTML = skelRows(3, 'line');
    el.memoryList.innerHTML = skelRows(3, 'line');
    el.eventList.innerHTML = skelRows(3, 'line');
  }

  /* ---------------- 顶栏 / 工牌 ---------------- */

  function renderTopbar() {
    var meta = STATE_META[S.agent.status] || STATE_META.idle;
    el.indexTime.textContent = S.indexedAt ? '索引 ' + clock(S.indexedAt) : '索引 —';
    el.indexTime.title = S.indexedAt ? '上次索引：' + timeAgo(S.indexedAt) : '尚未建立索引';
    el.demoBadge.hidden = !S.mock;
    el.mockHint.hidden = !S.mock;
    el.stateChip.className = 'state-chip st-' + (S.agent.status || 'idle');
    el.stateText.textContent = meta.label;
    el.stateChip.title = '总管状态：' + meta.label + ' · 模型 ' + (S.agent.model || 'deepseek-chat');
  }

  function renderBadge() {
    var a = S.agent || {};
    var st = a.status || 'idle';
    var meta = STATE_META[st] || STATE_META.idle;
    var stats = S.stats || {};
    el.idcard.innerHTML =
      '<div class="idcard st-' + esc(st) + '">' +
      '<div class="idcard-top">' +
      '<div class="avatar"><img src="' + WHALE + '" alt="小鲸"></div>' +
      '<div class="id-main">' +
      '<div class="id-name">' + esc(a.name || '桌宠总管') + '</div>' +
      '<div class="id-tag">' + esc(a.tagline || '我的工作区 · 本地总管') + '</div>' +
      '</div>' +
      '<span class="id-status"><i class="dot"></i>' + meta.label + '</span>' +
      '</div>' +
      '<div class="id-foot" title="本次在线 ' + esc(fmtDur(a.uptimeSec)) + '">' +
      '<span>' + fmtNum(stats.projects || S.projects.length) + ' 项目 · ' + fmtNum(stats.files || 0) + ' 文件</span>' +
      '<span>' + fmtSizeMB(stats.sizeMB || 0) + '</span>' +
      '</div>' +
      '</div>';
  }

  function setAgentState(status) {
    if (!status || !STATE_META[status]) return;
    if (S.agent.status === status) return;
    S.agent.status = status;
    renderTopbar();
    renderBadge();
  }

  /* ---------------- 左栏：事业线 / 项目 ---------------- */

  function renderCareers() {
    el.careerCount.textContent = S.careers.length || '—';
    if (!S.careers.length) {
      el.careerList.innerHTML = '<div class="empty small">没有扫到事业线</div>';
      return;
    }
    el.careerList.innerHTML = S.careers
      .map(function (c) {
        var name = String(c.name || c.dir || '').replace(/^\d+_/, '').split('_')[0];
        return (
          '<div class="career" title="' + esc((c.dir || '') + ' · ' + (c.summary || '')) + '">' +
          '<div class="c-top"><span class="c-name">' + esc(name) + '</span><span class="c-time">' + esc(shortAgo(c.updatedAt)) + '</span></div>' +
          '<div class="c-meta">' + fmtNum(c.files) + ' 文件 · ' + fmtSizeMB(c.sizeMB) + '</div>' +
          '</div>'
        );
      })
      .join('');
  }

  function filteredProjects() {
    var q = S.search.trim().toLowerCase();
    if (!q) return S.projects;
    return S.projects.filter(function (p) {
      var hay = [p.name, p.path, p.kind, p.root, (p.tech || []).join(' '), p.readme].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function renderProjects() {
    var list = filteredProjects();
    el.projCount.textContent = S.search ? list.length + ' / ' + S.projects.length : S.projects.length || '—';
    if (!list.length) {
      el.projectList.innerHTML =
        '<div class="empty small">没有匹配的项目<span>换个词：skills / demo / node</span></div>';
      return;
    }
    el.projectList.innerHTML = list
      .map(function (p) {
        var active = p.id === S.currentProjectId;
        return (
          '<button type="button" class="proj' + (active ? ' is-active' : '') + '" data-project="' + esc(p.id) + '" title="' + esc(p.path + '\n' + (p.readme || '')) + '">' +
          '<span class="p-dot ' + esc(p.status || 'active') + '"></span>' +
          '<span class="p-name">' + esc(p.name) + '</span>' +
          '<span class="p-kind">' + esc(p.kind || 'other') + '</span>' +
          '<span class="p-time">' + esc(shortAgo(p.updatedAt)) + '</span>' +
          '</button>'
        );
      })
      .join('');
  }

  function renderContext() {
    var p = null;
    for (var i = 0; i < S.projects.length; i++) {
      if (S.projects[i].id === S.currentProjectId) {
        p = S.projects[i];
        break;
      }
    }
    if (p) {
      el.ctxKicker.textContent = '项目层';
      el.ctxTitle.textContent = p.name;
      el.ctxSub.textContent = p.path + ' · ' + p.kind + ' · ' + fmtNum(p.files) + ' 文件 · ' + fmtSizeMB(p.sizeMB);
      el.ctxSub.title = p.readme || p.path;
      el.btnClearCtx.hidden = false;
      el.chatInput.placeholder = '问这个项目：它是什么、最近动过什么、下一步能干什么';
    } else {
      el.ctxKicker.textContent = '当前';
      el.ctxTitle.textContent = '全局 · ' + fmtNum((S.stats && S.stats.projects) || S.projects.length) + ' 个项目';
      el.ctxSub.textContent = (S.agent && S.agent.tagline) || '我的工作区 · 本地总管';
      el.ctxSub.title = '';
      el.btnClearCtx.hidden = true;
      el.chatInput.placeholder = '说目标和边界，背景我来交代';
    }
  }

  function selectProject(id) {
    var found = null;
    for (var i = 0; i < S.projects.length; i++) {
      if (S.projects[i].id === id) {
        found = S.projects[i];
        break;
      }
    }
    if (!found) return;
    S.currentProjectId = S.currentProjectId === id ? null : id;
    renderProjects();
    renderContext();
    if (S.currentProjectId) {
      addEvent('notice', 'muted', '进入项目层：' + found.name);
      if (isMobile()) switchView('chat');
      el.chatInput.focus();
    }
  }

  /* ---------------- 中栏：聊天 ---------------- */

  function chatEmpty() {
    return (
      '<div class="chat-empty">' +
      '<img class="ce-whale" src="' + WHALE + '" alt="小鲸">' +
      '<div class="ce-title">你只管说目标和边界</div>' +
      '<div class="ce-sub">背景我来交代。项目地图、工单、产物、记忆都在左右两侧。</div>' +
      '<div class="ce-cards">' +
      '<button class="ce-card" data-cmd="现在手上有哪些项目"><b>看看手上有哪些项目</b><span>' +
      fmtNum((S.stats && S.stats.projects) || S.projects.length) + ' 个项目 · ' +
      (S.careers.length || '—') + ' 条事业线</span></button>' +
      '<button class="ce-card" data-cmd="今晚帮我做三件事：整理本周文件、项目健康检查、写周报"><b>今晚帮我做三件事</b><span>我拆 3 个子任务并行跑</span></button>' +
      '<button class="ce-card" data-cmd="记住：结论先行，不端着"><b>记住我的说话风格</b><span>结论先行，不端着</span></button>' +
      '</div>' +
      '</div>'
    );
  }

  function toolHtml(t) {
    var cls = t.status === 'running' ? 'is-run' : t.status === 'err' ? 'is-err' : 'is-ok';
    var ico =
      t.status === 'running'
        ? '<i class="spin"></i>'
        : t.status === 'err'
        ? '<span class="tool-x">✕</span>'
        : '<span class="tool-ok">✓</span>';
    return (
      '<div class="tool-bar ' + cls + '">' +
      '<span class="tool-ico">' + ico + '</span>' +
      '<span class="tool-label">' + esc(t.label || t.name || '工具调用') + '</span>' +
      (t.res ? '<span class="tool-res">' + esc(t.res) + '</span>' : '') +
      '</div>'
    );
  }

  function aiContentHtml(m) {
    var body = '';
    if (m.tools && m.tools.length) {
      body += '<div class="tool-stack">' + m.tools.map(toolHtml).join('') + '</div>';
    }
    if (m.text) {
      body += '<div class="msg-text md">' + YH_MD.render(m.text) + (m.pending ? '<span class="caret"></span>' : '') + '</div>';
    } else if (m.pending) {
      body += '<div class="thinking"><i></i><i></i><i></i></div>';
    }
    if (m.error) {
      body +=
        '<div class="chat-error"><span>回复中断：' + esc(m.error) + '</span>' +
        '<button type="button" data-act="retry" data-mid="' + esc(m.id) + '">重试</button></div>';
    }
    return body;
  }

  function aiBodyHtml(m) {
    return (
      '<div class="msg-meta"><span class="who">桌宠总管</span><span class="msg-time">' +
      clock(m.createdAt) + (m.pending ? ' · 输入中' : '') +
      '</span></div>' + aiContentHtml(m)
    );
  }

  function msgHtml(m) {
    if (m.role === 'user') {
      return (
        '<div class="msg msg-user" data-mid="' + esc(m.id) + '">' +
        '<div class="msg-body">' +
        '<div class="bubble">' + esc(m.text).replace(/\n/g, '<br>') + '</div>' +
        '<div class="msg-time">' + clock(m.createdAt) + '</div>' +
        '</div></div>'
      );
    }
    return (
      '<div class="msg msg-ai' + (m.pending ? ' is-streaming' : '') + '" data-mid="' + esc(m.id) + '">' +
      '<div class="msg-ava"><img src="' + WHALE + '" alt=""></div>' +
      '<div class="msg-body">' + aiBodyHtml(m) + '</div>' +
      '</div>'
    );
  }

  function idsSignature() {
    var out = [];
    for (var i = 0; i < S.messages.length; i++) out.push(S.messages[i].id);
    return out.join('|');
  }

  function scrollChatBottom() {
    requestAnimationFrame(function () {
      if (S.autoScroll) el.chatScroll.scrollTop = el.chatScroll.scrollHeight;
    });
  }

  function renderMessages() {
    if (!S.messages.length) {
      el.chatInner.innerHTML = chatEmpty();
      S.renderedIds = '';
      return;
    }
    // 整表重建只在消息集合变化时发生（发送 / 重试 / 载入历史），
    // 流式增量走 patchLastMessage，避免每次字都重建全部消息造成闪烁。
    var sig = idsSignature();
    if (sig === S.renderedIds) {
      patchLastMessage();
      return;
    }
    el.chatInner.innerHTML =
      '<div class="day-div"><span>' + esc(dayLabel()) + '</span></div>' + S.messages.map(msgHtml).join('');
    S.renderedIds = sig;
    scrollChatBottom();
  }

  /** 只更新最后一条 AI 消息的正文，历史消息与头像不重建。 */
  function patchLastMessage() {
    var m = S.messages[S.messages.length - 1];
    if (!m || m.role !== 'assistant') return;
    var nodes = el.chatInner.querySelectorAll('.msg-ai');
    var node = nodes.length ? nodes[nodes.length - 1] : null;
    if (!node) {
      S.renderedIds = '';
      renderMessages();
      return;
    }
    if (node.getAttribute('data-mid') !== m.id) node.setAttribute('data-mid', m.id);
    node.classList.toggle('is-streaming', !!m.pending);
    var body = node.querySelector('.msg-body');
    if (body) body.innerHTML = aiBodyHtml(m);
    scrollChatBottom();
  }

  function scheduleChatRender() {
    if (S.renderTimer) return;
    S.renderTimer = setTimeout(function () {
      S.renderTimer = null;
      renderMessages();
    }, 55);
  }

  function toolLabelFromEvent(p) {
    var args = p.args || {};
    switch (p.name) {
      case 'read_file':
        return '读 ' + (args.path || args.file || '文件');
      case 'list_projects':
        return '扫项目地图';
      case 'search_files':
        return '搜 ' + (args.query || args.q || '文件');
      case 'list_skills':
        return '查技能库';
      case 'create_task':
        return '派工单 ' + (args.title || '');
      case 'list_tasks':
        return '查工单';
      case 'remember':
        return '写入记忆';
      default:
        return p.name || '工具调用';
    }
  }

  function lastRunningTool(m) {
    for (var i = m.tools.length - 1; i >= 0; i--) {
      if (m.tools[i].status === 'running') return m.tools[i];
    }
    return null;
  }

  function runAssistant(text) {
    var am = {
      id: 'a_' + Date.now().toString(36),
      role: 'assistant',
      text: '',
      tools: [],
      pending: true,
      error: null,
      createdAt: nowIso(),
      retryText: text
    };
    S.messages.push(am);
    S.streaming = true;
    setAgentState('thinking');
    renderMessages();
    if (S.mock) mockStream(am, text);
    else liveStream(am, text);
  }

  function sendMessage(raw) {
    var text = String(raw || '').trim();
    if (!text || S.streaming) return;
    S.messages.push({ id: 'u_' + Date.now().toString(36), role: 'user', text: text, createdAt: nowIso() });
    S.autoScroll = true;
    el.chatInput.value = '';
    autoGrow();
    // 和下面 runAssistant 的占位消息合并成一次渲染，避免连续两次整表重建。
    runAssistant(text);
  }

  function retryAssistant(mid) {
    var idx = -1;
    for (var i = 0; i < S.messages.length; i++) {
      if (S.messages[i].id === mid) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    var m = S.messages[idx];
    if (!m.retryText) m.retryText = (S.messages[idx - 1] && S.messages[idx - 1].text) || '';
    S.messages.splice(idx, 1);
    renderMessages();
    runAssistant(m.retryText);
  }

  function liveStream(am, text) {
    YH_API.chatStream(
      { sessionId: S.sessionId, message: text, projectId: S.currentProjectId, source: 'web' },
      {
        onStart: function (p) {
          // 服务端 id 与本会话消息表不对应，保持前端 id，避免流式中途整表重建。
          if (p && p.messageId) am.serverId = p.messageId;
        },
        onDelta: function (p) {
          am.text += p.text || '';
          scheduleChatRender();
        },
        onTool: function (p) {
          am.tools.push({ name: p.name, label: p.label || toolLabelFromEvent(p), status: 'running' });
          setAgentState('working');
          scheduleChatRender();
        },
        onToolResult: function (p) {
          var t = lastRunningTool(am);
          if (t) {
            t.status = p.ok === false ? 'err' : 'ok';
            t.res = p.summary || '';
          }
          scheduleChatRender();
        },
        onTask: function (p) {
          if (p && p.task) {
            upsertTask(p.task, true);
            addEvent('task.update', 'ok', '排出一张工单：' + p.task.title);
            toast('工单已派出：' + p.task.title, 'ok');
          }
        },
        onDone: function (p) {
          am.pending = false;
          if (p && p.text) am.text = p.text;
          if (p && p.interrupted && !am.text) am.error = '连接中断，没有收到完整回复';
          S.streaming = false;
          setAgentState('idle');
          renderMessages();
        },
        onError: function (err) {
          failAssistant(am, err);
        }
      }
    );
  }

  function failAssistant(am, err) {
    am.pending = false;
    am.error = (err && err.message) || '网络异常';
    S.streaming = false;
    setAgentState('idle');
    renderMessages();
  }

  /* ---------------- 演示模式聊天（本地模拟流式） ---------------- */

  function mockStream(am, text) {
    var plan = YH_MOCK.plan(text);
    var ti = 0;

    function nextTool() {
      if (ti < plan.tools.length) {
        var spec = plan.tools[ti++];
        am.tools.push({ name: spec.name, label: spec.label, status: 'running' });
        setAgentState('working');
        scheduleChatRender();
        setTimeout(function () {
          var cur = am.tools[am.tools.length - 1];
          if (cur) {
            cur.status = 'ok';
            cur.res = spec.res || '';
          }
          scheduleChatRender();
          setTimeout(nextTool, 150);
        }, 380);
      } else {
        streamText();
      }
    }

    function streamText() {
      var full = plan.text || '';
      var i = 0;
      setAgentState('thinking');
      var timer = setInterval(function () {
        i += 3;
        am.text = full.slice(0, i);
        scheduleChatRender();
        if (i >= full.length) {
          clearInterval(timer);
          finish();
        }
      }, 18);
    }

    function finish() {
      am.pending = false;
      S.streaming = false;
      if (plan.task) {
        var t = plan.task;
        t.createdAt = nowIso();
        t.updatedAt = nowIso();
        if (!t.progress) t.progress = 0;
        S.tasks.unshift(t);
        S.taskOpen[t.id] = true;
        renderTasks();
        addEvent('task.update', 'ok', '新工单「' + t.title + '」已派出 · ' + t.subtasks.length + ' 个子任务');
        toast('工单已派出：' + t.title, 'ok');
      }
      if (plan.memory) {
        var mem = {
          id: 'm_' + Date.now().toString(36),
          key: plan.memory.key,
          value: plan.memory.value,
          pinned: true,
          source: 'chat',
          createdAt: nowIso()
        };
        S.memories.unshift(mem);
        renderMemories();
        addEvent('notice', 'ok', '记住：' + mem.key + ' · ' + mem.value);
        toast('已记住：' + mem.key, 'ok');
      }
      setAgentState(plan.state || 'idle');
      renderMessages();
    }

    setTimeout(nextTool, 430);
  }

  function mockTick() {
    var t = null;
    for (var i = 0; i < S.tasks.length; i++) {
      if (S.tasks[i].status === 'running') {
        t = S.tasks[i];
        break;
      }
    }
    if (!t) return;
    var subs = t.subtasks || [];
    if (!subs.length) return;
    var cur = null;
    for (var j = 0; j < subs.length; j++) {
      if (subs[j].status === 'running') {
        cur = subs[j];
        break;
      }
    }
    if (cur) {
      cur.status = 'done';
      cur.summary = '完成 · ' + clock(nowIso());
      if (!cur.artifact) cur.artifact = 'out/' + t.id + '/' + cur.id + '-产物.md';
      addArtifact({
        id: 'a_' + cur.id + '_' + Date.now().toString(36),
        taskId: t.id,
        name: basename(cur.artifact),
        path: cur.artifact,
        sizeBytes: 1800 + j * 640,
        createdAt: nowIso()
      });
    } else {
      for (var k = 0; k < subs.length; k++) {
        if (subs[k].status === 'queued') {
          subs[k].status = 'running';
          break;
        }
      }
    }
    var done = subs.filter(function (s) {
      return s.status === 'done';
    }).length;
    t.progress = done / subs.length;
    t.updatedAt = nowIso();
    if (done === subs.length) {
      t.status = 'done';
      t.progress = 1;
      t.summary = '**全部完成。** ' + subs.length + ' 个子任务都落了地，产物在右侧「产物」里。\n\n有要你拍板的，我会带着建议回来。';
      addEvent('notice', 'ok', '工单「' + t.title + '」完成 ' + done + '/' + subs.length);
      toast('工单完成：' + t.title, 'ok');
      setAgentState('happy');
      setTimeout(function () {
        if (S.agent.status === 'happy') setAgentState('idle');
      }, 4000);
    } else {
      addEvent('task.update', 'ok', '工单「' + t.title + '」进度 ' + Math.round(t.progress * 100) + '%');
    }
    initTaskOpen();
    renderTasks();
  }

  /* ---------------- 右栏：工单 / 产物 / 记忆 / 事件 ---------------- */

  function initTaskOpen() {
    S.tasks.forEach(function (t, i) {
      if (S.taskOpen[t.id] === undefined) S.taskOpen[t.id] = i === 0;
    });
  }

  function progressPct(t) {
    return Math.max(0, Math.min(100, Math.round((Number(t.progress) || 0) * 100)));
  }

  function subtaskHtml(s) {
    var map = { done: '✓', running: '<i class="spin"></i>', queued: '○', failed: '✕', cancelled: '–' };
    var ico = map[s.status] || '○';
    return (
      '<div class="subtask st-' + esc(s.status) + '">' +
      '<span class="st-ico">' + ico + '</span>' +
      '<span class="st-title">' + esc(s.title) + '</span>' +
      (s.artifact
        ? '<button type="button" class="st-art" data-act="copy-path" data-path="' + esc(s.artifact) + '" title="' + esc(s.artifact) + '">产物</button>'
        : '') +
      (s.summary && s.status === 'failed' ? '<span class="st-note">' + esc(s.summary) + '</span>' : '') +
      '</div>'
    );
  }

  function taskCardHtml(t) {
    var status = t.status || 'queued';
    var pct = progressPct(t);
    var subs = t.subtasks || [];
    var doneCount = subs.filter(function (s) {
      return s.status === 'done';
    }).length;
    var open = S.taskOpen[t.id] !== false;
    var head =
      '<div class="task-head" data-act="toggle-task" data-task="' + esc(t.id) + '" role="button" tabindex="0">' +
      '<span class="pill pill-' + esc(status) + '">' + (TASK_STATUS[status] || status) + '</span>' +
      '<span class="task-title">' + esc(t.title) + '</span>' +
      '<span class="task-caret">' + (open ? '▾' : '▸') + '</span>' +
      '</div>';

    var body = '';
    if (open) {
      body +=
        '<div class="task-goal">' + esc(t.goal || '') + '</div>' +
        '<div class="progress"><i class="progress-fill ' + (status === 'running' ? 'is-breathing' : '') + '" style="width:' + pct + '%"></i></div>' +
        '<div class="progress-meta"><span class="pm-pct">' + pct + '%</span><span>' + doneCount + '/' + subs.length + ' 子任务</span><span class="pm-time">' + timeAgo(t.updatedAt) + '</span></div>';
      if (subs.length) body += '<div class="subtasks">' + subs.map(subtaskHtml).join('') + '</div>';
      if (t.summary) {
        var plainSummary = YH_MD.plain(t.summary);
        var longSummary = plainSummary.length > 200;
        var opened = S.summaryOpen[t.id] === true;
        body += '<div class="task-summary md' + (longSummary && !opened ? ' is-clamped' : '') + '">' + YH_MD.render(t.summary) + '</div>';
        if (longSummary) {
          body += '<button type="button" class="summary-toggle" data-act="toggle-summary" data-task="' + esc(t.id) + '">' + (opened ? '收起' : '展开全文') + '</button>';
        }
      }
      var actions = '';
      if (status === 'running' || status === 'planning' || status === 'queued') {
        actions += '<button type="button" class="mini-btn" data-act="cancel-task" data-task="' + esc(t.id) + '">取消工单</button>';
      }
      if (status === 'failed' || status === 'partial') {
        actions += '<button type="button" class="mini-btn" data-act="retry-task" data-task="' + esc(t.id) + '">重试</button>';
      }
      if (actions) body += '<div class="task-actions">' + actions + '</div>';
    } else {
      body =
        '<div class="task-collapsed">' + pct + '% · ' + doneCount + '/' + subs.length + ' 子任务 · ' + timeAgo(t.updatedAt) + '</div>' +
        (t.summary ? '<div class="task-preview">' + esc(YH_MD.plain(t.summary, 90)) + '</div>' : '');
    }

    return '<div class="task-card status-' + esc(status) + '">' + head + body + '</div>';
  }

  function renderTasks() {
    initTaskOpen();
    el.taskCount.textContent = S.tasks.length || '—';
    if (!S.tasks.length) {
      el.taskList.innerHTML = '<div class="empty small">还没有工单<span>在聊天里说目标，我拆成 1–5 个子任务并行跑</span></div>';
      return;
    }
    el.taskList.innerHTML = S.tasks.map(taskCardHtml).join('');
  }

  function renderArtifacts() {
    el.artifactCount.textContent = S.artifacts.length || '—';
    if (!S.artifacts.length) {
      el.artifactList.innerHTML = '<div class="empty small">还没有产物<span>工单跑完会落到 out/ 并登记在这里</span></div>';
      return;
    }
    el.artifactList.innerHTML = S.artifacts
      .slice(0, 20)
      .map(function (a) {
        var ext = (String(a.name || '').split('.').pop() || 'file').toUpperCase();
        if (ext.length > 3) ext = ext.slice(0, 3);
        return (
          '<button type="button" class="art-row" data-act="copy-path" data-path="' + esc(a.path || a.name) + '" title="点击复制路径：' + esc(a.path || '') + '">' +
          '<span class="art-ico">' + esc(ext) + '</span>' +
          '<span class="art-main"><span class="art-name">' + esc(a.name) + '</span>' +
          '<span class="art-meta">' + fmtBytes(a.sizeBytes) + ' · ' + timeAgo(a.createdAt) + '</span></span>' +
          '</button>'
        );
      })
      .join('');
  }

  function sortedMemories() {
    return S.memories.slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return new Date(b.createdAt || 0) - new Date(a.createdAt || 0);
    });
  }

  function renderMemories() {
    el.memoryCount.textContent = S.memories.length || '—';
    var list = sortedMemories();
    if (!list.length) {
      el.memoryList.innerHTML = '<div class="empty small">还没有记忆<span>聊天里说「记住…」就会存下来</span></div>';
      return;
    }
    el.memoryList.innerHTML = list
      .map(function (m) {
        return (
          '<div class="mem-row' + (m.pinned ? ' is-pinned' : '') + '">' +
          '<div class="mem-main"><span class="mem-key">' + esc(m.key) + '</span>' +
          '<span class="mem-val">' + esc(m.value) + '</span></div>' +
          '<div class="mem-acts">' +
          '<button type="button" class="icon-btn' + (m.pinned ? ' is-on' : '') + '" data-act="pin-memory" data-id="' + esc(m.id) + '" title="' + (m.pinned ? '已置顶（点击取消）' : '置顶') + '" aria-label="置顶记忆">' +
          '<svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true"><path d="M5 1.6h4l-.5 3.2 2 2.2H3.5l2-2.2z" fill="currentColor"/><path d="M7 7v5.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>' +
          '</button>' +
          '<button type="button" class="icon-btn danger" data-act="del-memory" data-id="' + esc(m.id) + '" title="删除" aria-label="删除记忆">×</button>' +
          '</div></div>'
        );
      })
      .join('');
  }

  var EVENT_TYPE = {
    'task.update': '工单',
    'artifact.new': '产物',
    notice: '通知',
    'agent.state': '状态',
    chat: '对话'
  };

  function renderEvents() {
    el.eventCount.textContent = S.events.length || '—';
    if (!S.events.length) {
      el.eventList.innerHTML = '<div class="empty small">还没有事件<span>任务、产物、状态变化会实时滚到这里</span></div>';
      return;
    }
    el.eventList.innerHTML = S.events
      .slice(0, 14)
      .map(function (ev) {
        return (
          '<div class="ev-row">' +
          '<span class="ev-time">' + clock(ev.time) + '</span>' +
          '<span class="ev-dot lv-' + esc(ev.level || 'muted') + '"></span>' +
          '<span class="ev-text">' + esc(ev.text) + '</span>' +
          '<span class="ev-type">' + esc(EVENT_TYPE[ev.type] || ev.type || '') + '</span>' +
          '</div>'
        );
      })
      .join('');
  }

  function addEvent(type, level, text) {
    S.events.unshift({ time: nowIso(), type: type, level: level || 'muted', text: text });
    if (S.events.length > 40) S.events.length = 40;
    renderEvents();
  }

  function addArtifact(a) {
    var exists = false;
    for (var i = 0; i < S.artifacts.length; i++) {
      if (S.artifacts[i].id === a.id) {
        exists = true;
        break;
      }
    }
    if (!exists) S.artifacts.unshift(a);
    renderArtifacts();
    addEvent('artifact.new', 'ok', '新产物 ' + a.name + ' · ' + fmtBytes(a.sizeBytes));
  }

  function upsertTask(task, openIt) {
    if (!task || !task.id) return;
    var found = null;
    for (var i = 0; i < S.tasks.length; i++) {
      if (S.tasks[i].id === task.id) {
        found = S.tasks[i];
        break;
      }
    }
    if (found) Object.assign(found, task);
    else {
      S.tasks.unshift(task);
      if (openIt) S.taskOpen[task.id] = true;
    }
    initTaskOpen();
    renderTasks();
  }

  function updateEventLive(mode) {
    var map = {
      live: { text: '实时', cls: 'is-live' },
      mock: { text: '模拟', cls: 'is-mock' },
      retry: { text: '重连中', cls: 'is-retry' },
      off: { text: '未连接', cls: 'is-off' }
    };
    var m = map[mode] || map.off;
    el.eventLive.textContent = m.text;
    el.eventLive.className = 'sec-live ' + m.cls;
  }

  /* ---------------- 状态注入 / 渲染 ---------------- */

  function hydrate(st) {
    if (!st || typeof st !== 'object') throw new Error('state 为空');
    S.agent = st.agent || S.agent;
    S.careers = st.careers || [];
    S.projects = st.projects || [];
    S.tasks = st.tasks || [];
    S.artifacts = st.artifacts || [];
    S.memories = st.memories || [];
    S.stats = st.stats || {};
    S.phone = st.phone || {};
    S.indexedAt = st.indexedAt || null;
    S.events = st.events || [];
    S.taskOpen = {};
    initTaskOpen();
  }

  function renderAll() {
    renderTopbar();
    renderBadge();
    renderCareers();
    renderProjects();
    renderContext();
    renderMessages();
    renderTasks();
    renderArtifacts();
    renderMemories();
    renderEvents();
    autoGrow();
  }

  function enterMock(reason) {
    S.mock = true;
    S.bootReason = reason || '';
    var st = YH_MOCK.state();
    hydrate(st);
    if (!S.events.length) S.events = YH_MOCK.seedEvents();
    S.messages = YH_MOCK.initialMessages().map(function (m) {
      m.tools = m.tools || [];
      return m;
    });
    S.booted = true;
    renderAll();
    updateEventLive('mock');
    addEvent('agent.state', 'warn', reason || '服务未就绪，已切换演示数据');
    if (S.mockTimer) clearInterval(S.mockTimer);
    S.mockTimer = setInterval(mockTick, 11000);
    setAgentState('idle');
  }

  /* ---------------- 实时事件 ---------------- */

  function handleServerEvent(type, data) {
    if (type === 'task.update' && data.task) {
      upsertTask(data.task, false);
      var t = data.task;
      if (t.status === 'done') addEvent('notice', 'ok', '工单「' + t.title + '」完成');
      else addEvent('task.update', 'muted', '工单「' + t.title + '」进度 ' + progressPct(t) + '%');
    } else if (type === 'artifact.new' && data.artifact) {
      addArtifact(data.artifact);
    } else if (type === 'memory.new' && data.memory) {
      S.memories.unshift(data.memory);
      renderMemories();
      addEvent('notice', 'muted', '新记忆：' + data.memory.key);
    } else if (type === 'notice') {
      addEvent('notice', data.level || 'ok', (data.title ? data.title + ' · ' : '') + (data.text || ''));
      toast((data.title ? data.title + '：' : '') + (data.text || ''), data.level === 'err' ? 'err' : 'ok');
    } else if (type === 'agent.state' && data.status) {
      setAgentState(data.status);
      addEvent('agent.state', 'muted', '总管状态：' + ((STATE_META[data.status] || {}).label || data.status));
    }
  }

  function connectEvents() {
    if (typeof EventSource === 'undefined') {
      updateEventLive('off');
      return;
    }
    try {
      S.es = new EventSource(YH_API.abs('/api/events'));
    } catch (e) {
      updateEventLive('off');
      return;
    }
    S.es.onopen = function () {
      updateEventLive('live');
      if (!S.eventAnnounced) {
        S.eventAnnounced = true;
        addEvent('agent.state', 'ok', '事件总线已连接，工单与产物会实时滚进来');
      }
    };
    S.es.onerror = function () {
      updateEventLive('retry');
    };
    // 服务端事件是 `data: {"type": ...}`（类型在 JSON 里），不是命名事件
    S.es.onmessage = function (ev) {
      var data = {};
      try {
        data = JSON.parse(ev.data || '{}');
      } catch (e) {
        return;
      }
      var type = data.type || '';
      if (!type || type === 'ping') {
        updateEventLive('live');
        return;
      }
      if (type === 'hello') {
        updateEventLive('live');
        if (data.status) setAgentState(data.status);
        return;
      }
      handleServerEvent(type, data);
    };
    S.es.addEventListener('ping', function () {
      updateEventLive('live');
    });
  }

  function loadHistory() {
    YH_API.getHistory(S.sessionId, 50)
      .then(function (res) {
        var list = (res && res.messages) || [];
        if (!list.length) return;
        // 历史是异步回来的：如果用户已经开了新对话，别把正在进行的会话覆盖掉。
        if (S.messages.length) return;
        S.messages = list.map(function (m, i) {
          return {
            id: m.id || 'h_' + i,
            role: m.role === 'user' ? 'user' : 'assistant',
            text: m.text || '',
            tools: [],
            createdAt: m.createdAt || nowIso()
          };
        });
        renderMessages();
      })
      .catch(function () {
        /* 历史拿不到就保持空态，不打扰 */
      });
  }

  /* ---------------- key / 模型异常提示 ---------------- */

  function showWarn(text) {
    if (!el.warnBar) return;
    el.warnText.textContent = text;
    el.warnBar.hidden = false;
  }

  function hideWarn() {
    if (el.warnBar) el.warnBar.hidden = true;
  }

  function checkHealth() {
    YH_API.getHealth()
      .then(function (h) {
        var a = (h && h.agent) || {};
        if (a.hasKey === false) {
          showWarn('模型 key 未配置：聊天会直接失败。把 DEEPSEEK_API_KEY 写进仓库根目录的 .env（见 README）。');
        } else if (a.hasKey === true) {
          hideWarn();
        }
        if (a.status) S.agent.status = a.status;
        if (typeof a.uptimeSec === 'number') S.agent.uptimeSec = a.uptimeSec;
        if (a.model) S.agent.model = a.model;
        renderBadge();
        renderTopbar();
      })
      .catch(function () {
        /* 健康检查失败不打扰，首页状态已能说明问题 */
      });
  }

  /* ---------------- 操作 ---------------- */

  function refreshIndex() {
    if (el.btnRefresh.disabled) return;
    el.btnRefresh.disabled = true;
    el.btnRefresh.classList.add('is-loading');
    var label = el.btnRefresh.querySelector('.btn-label');
    if (label) label.textContent = '扫描中';
    function done() {
      el.btnRefresh.disabled = false;
      el.btnRefresh.classList.remove('is-loading');
      if (label) label.textContent = '刷新索引';
    }
    if (S.mock) {
      setTimeout(function () {
        S.indexedAt = nowIso();
        renderTopbar();
        addEvent('agent.state', 'muted', `索引已刷新 · 演示模式（${S.projects.length} 个项目 / ${S.careers.length} 条事业线）`);
        toast('索引已刷新（演示数据）', 'ok');
        done();
      }, 850);
      return;
    }
    YH_API.refreshIndex()
      .then(function (res) {
        S.indexedAt = (res && res.indexedAt) || nowIso();
        renderTopbar();
        addEvent('agent.state', 'ok', '索引已刷新：' + ((res && res.projects) || '?') + ' 个项目');
        toast('索引已刷新：' + ((res && res.projects) || '?') + ' 个项目', 'ok');
        done();
        checkHealth();
        // 重扫后把项目/事业线拉到最新，不动聊天与事件流
        YH_API.getState()
          .then(function (st) {
            if (!st) return;
            S.agent = st.agent || S.agent;
            S.careers = st.careers || S.careers;
            S.projects = st.projects || S.projects;
            S.stats = st.stats || S.stats;
            S.indexedAt = st.indexedAt || S.indexedAt;
            renderTopbar();
            renderBadge();
            renderCareers();
            renderProjects();
            renderContext();
          })
          .catch(function () {});
      })
      .catch(function (err) {
        addEvent('agent.state', 'err', '刷新索引失败：' + err.message);
        toast('刷新失败：' + err.message, 'err');
        done();
      });
  }

  function togglePin(id) {
    var m = null;
    for (var i = 0; i < S.memories.length; i++) {
      if (S.memories[i].id === id) {
        m = S.memories[i];
        break;
      }
    }
    if (!m) return;
    if (S.mock) {
      m.pinned = !m.pinned;
      renderMemories();
      addEvent('notice', 'muted', (m.pinned ? '置顶' : '取消置顶') + '记忆：' + m.key);
      toast(m.pinned ? '已置顶（演示）' : '已取消置顶（演示）', 'ok');
      return;
    }
    if (m.pinned) {
      YH_API.pinMemory(id, false)
        .then(function () {
          m.pinned = false;
          renderMemories();
          toast('已取消置顶', 'ok');
        })
        .catch(function (err) {
          toast('取消置顶失败：' + err.message, 'err');
        });
      return;
    }
    YH_API.pinMemory(id, true)
      .then(function () {
        m.pinned = true;
        renderMemories();
        toast('已置顶', 'ok');
      })
      .catch(function (err) {
        toast('置顶失败：' + err.message, 'err');
      });
  }

  function removeMemory(id, btn) {
    if (btn && btn.getAttribute('data-confirm') !== '1') {
      btn.setAttribute('data-confirm', '1');
      btn.textContent = '确认';
      btn.classList.add('is-confirm');
      setTimeout(function () {
        if (!btn.parentNode) return;
        btn.removeAttribute('data-confirm');
        btn.textContent = '×';
        btn.classList.remove('is-confirm');
      }, 2600);
      return;
    }
    var idx = -1;
    for (var i = 0; i < S.memories.length; i++) {
      if (S.memories[i].id === id) {
        idx = i;
        break;
      }
    }
    if (idx < 0) return;
    if (S.mock) {
      var key = S.memories[idx].key;
      S.memories.splice(idx, 1);
      renderMemories();
      addEvent('notice', 'muted', '删除记忆：' + key);
      toast('已删除（演示）', 'ok');
      return;
    }
    YH_API.deleteMemory(id)
      .then(function () {
        S.memories.splice(idx, 1);
        renderMemories();
        toast('已删除', 'ok');
      })
      .catch(function (err) {
        toast('删除失败：' + err.message, 'err');
      });
  }

  function cancelTask(id) {
    var t = null;
    for (var i = 0; i < S.tasks.length; i++) {
      if (S.tasks[i].id === id) {
        t = S.tasks[i];
        break;
      }
    }
    if (!t) return;
    if (S.mock) {
      t.status = 'cancelled';
      t.updatedAt = nowIso();
      renderTasks();
      addEvent('task.update', 'warn', '工单「' + t.title + '」已取消');
      toast('工单已取消（演示）', 'ok');
      return;
    }
    YH_API.cancelTask(id)
      .then(function () {
        t.status = 'cancelled';
        t.updatedAt = nowIso();
        renderTasks();
        toast('工单已取消', 'ok');
      })
      .catch(function (err) {
        toast('取消失败：' + err.message, 'err');
      });
  }

  function retryTask(id) {
    var t = null;
    for (var i = 0; i < S.tasks.length; i++) {
      if (S.tasks[i].id === id) {
        t = S.tasks[i];
        break;
      }
    }
    if (!t) return;
    sendMessage('重试工单「' + t.title + '」：' + (t.goal || ''));
  }

  /* ---------------- 手机二维码 ---------------- */

  function fakeQrSvg() {
    var n = 25;
    var cell = 7;
    var size = n * cell;
    var seed = 20261102;
    function rand() {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    }
    function inFinder(x, y) {
      var zones = [
        [0, 0],
        [n - 7, 0],
        [0, n - 7]
      ];
      for (var i = 0; i < zones.length; i++) {
        var zx = zones[i][0];
        var zy = zones[i][1];
        if (x >= zx && x < zx + 7 && y >= zy && y < zy + 7) return true;
      }
      return false;
    }
    var out = '<rect width="' + size + '" height="' + size + '" fill="#F4EDDF"/>';
    for (var y = 0; y < n; y++) {
      for (var x = 0; x < n; x++) {
        if (inFinder(x, y)) continue;
        if (rand() > 0.52) {
          out += '<rect x="' + x * cell + '" y="' + y * cell + '" width="' + cell + '" height="' + cell + '" fill="#0B0C10"/>';
        }
      }
    }
    [
      [0, 0],
      [n - 7, 0],
      [0, n - 7]
    ].forEach(function (z) {
      var x = z[0] * cell;
      var y = z[1] * cell;
      out += '<rect x="' + x + '" y="' + y + '" width="' + 7 * cell + '" height="' + 7 * cell + '" fill="none" stroke="#0B0C10" stroke-width="' + cell + '"/>';
      out += '<rect x="' + (x + 2 * cell) + '" y="' + (y + 2 * cell) + '" width="' + 3 * cell + '" height="' + 3 * cell + '" fill="#0B0C10"/>';
    });
    return (
      '<svg class="fake-qr" viewBox="0 0 ' + size + ' ' + size + '" width="188" height="188" role="img" aria-label="演示二维码图案">' +
      out +
      '</svg>'
    );
  }

  function openPhone() {
    var ph = S.phone || {};
    el.phoneModal.hidden = false;
    document.body.classList.add('modal-open');
    el.phoneUrl.textContent = ph.url || '启动服务后这里显示局域网地址';
    el.phoneQr.hidden = true;
    el.phoneQr.removeAttribute('src');
    el.phonePh.hidden = false;
    el.phonePh.innerHTML = fakeQrSvg();
    el.phoneNote.textContent = '演示图案 · 启动服务后这里显示真实二维码（/api/phone/qr）';
    if (!S.mock && ph.qr) {
      el.phoneNote.textContent = '正在加载二维码…';
      el.phoneQr.onload = function () {
        el.phoneQr.hidden = false;
        el.phonePh.hidden = true;
        el.phoneNote.textContent = '手机与电脑在同一局域网时，扫码打开移动版聊天';
      };
      el.phoneQr.onerror = function () {
        el.phoneQr.hidden = true;
        el.phonePh.hidden = false;
        el.phoneNote.textContent = '二维码加载失败，请确认服务已启动（GET /api/phone/qr）';
      };
      el.phoneQr.src = YH_API.phoneQrSrc();
    }
    setTimeout(function () {
      try {
        el.phoneClose.focus();
      } catch (e) {}
    }, 30);
  }

  function closePhone() {
    el.phoneModal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  /* ---------------- 视图 / 输入 ---------------- */

  function switchView(view) {
    S.mobileView = view;
    document.body.setAttribute('data-view', view);
    var tabs = el.tabbar.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      var active = tabs[i].getAttribute('data-view') === view;
      tabs[i].classList.toggle('is-active', active);
      tabs[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
  }

  function autoGrow() {
    if (!el.chatInput) return;
    el.chatInput.style.height = 'auto';
    el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 132) + 'px';
  }

  /* ---------------- 绑定 ---------------- */

  function bindUI() {
    document.body.setAttribute('data-view', 'chat');

    // 用户往上翻时不要把他拽回底部；只有停在底部附近才跟随流式输出。
    el.chatScroll.addEventListener('scroll', function () {
      var sc = el.chatScroll;
      S.autoScroll = sc.scrollHeight - sc.scrollTop - sc.clientHeight < 80;
    });

    el.btnSend.addEventListener('click', function () {
      sendMessage(el.chatInput.value);
    });

    el.chatInput.addEventListener('input', autoGrow);
    el.chatInput.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        sendMessage(el.chatInput.value);
      }
    });

    el.quickCmds.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-cmd]');
      if (!btn) return;
      sendMessage(btn.getAttribute('data-cmd'));
    });

    el.chatInner.addEventListener('click', function (ev) {
      var retry = ev.target.closest('[data-act="retry"]');
      if (retry) {
        retryAssistant(retry.getAttribute('data-mid'));
        return;
      }
      var cmd = ev.target.closest('[data-cmd]');
      if (cmd) sendMessage(cmd.getAttribute('data-cmd'));
    });

    el.projectList.addEventListener('click', function (ev) {
      var row = ev.target.closest('[data-project]');
      if (row) selectProject(row.getAttribute('data-project'));
    });

    el.projectSearch.addEventListener('input', function () {
      S.search = el.projectSearch.value;
      el.searchClear.hidden = !S.search;
      renderProjects();
    });
    el.searchClear.addEventListener('click', function () {
      S.search = '';
      el.projectSearch.value = '';
      el.searchClear.hidden = true;
      renderProjects();
      el.projectSearch.focus();
    });

    el.btnClearCtx.addEventListener('click', function () {
      S.currentProjectId = null;
      renderProjects();
      renderContext();
    });

    el.btnRefresh.addEventListener('click', refreshIndex);
    el.btnPhone.addEventListener('click', openPhone);
    el.btnNewTask.addEventListener('click', function () {
      if (isMobile()) switchView('chat');
      el.chatInput.value = '帮我做：';
      el.chatInput.focus();
      autoGrow();
      toast('把目标和边界写清楚，我来拆活', 'info');
    });

    el.taskList.addEventListener('click', function (ev) {
      var action = ev.target.closest('[data-act]');
      if (!action) return;
      var act = action.getAttribute('data-act');
      var taskId = action.getAttribute('data-task') || (action.closest('.task-card') || {}).getAttribute
        ? action.getAttribute('data-task') || (action.closest('.task-card') && action.closest('.task-card').getAttribute('data-task-id'))
        : null;
      if (act === 'toggle-task') {
        var id = action.getAttribute('data-task');
        S.taskOpen[id] = S.taskOpen[id] === false;
        renderTasks();
      } else if (act === 'toggle-summary') {
        var sid = action.getAttribute('data-task');
        S.summaryOpen[sid] = S.summaryOpen[sid] !== true;
        renderTasks();
      } else if (act === 'copy-path') {
        copyPath(action.getAttribute('data-path'));
      } else if (act === 'cancel-task') {
        cancelTask(action.getAttribute('data-task'));
      } else if (act === 'retry-task') {
        retryTask(action.getAttribute('data-task'));
      }
    });

    el.artifactList.addEventListener('click', function (ev) {
      var row = ev.target.closest('[data-act="copy-path"]');
      if (row) copyPath(row.getAttribute('data-path'));
    });

    el.memoryList.addEventListener('click', function (ev) {
      var btn = ev.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.getAttribute('data-act');
      var id = btn.getAttribute('data-id');
      if (act === 'pin-memory') togglePin(id);
      else if (act === 'del-memory') removeMemory(id, btn);
    });

    el.tabbar.addEventListener('click', function (ev) {
      var tab = ev.target.closest('[data-view]');
      if (tab) switchView(tab.getAttribute('data-view'));
    });

    el.phoneClose.addEventListener('click', closePhone);
    el.warnClose.addEventListener('click', hideWarn);
    el.phoneCopy.addEventListener('click', function () {
      var url = (S.phone && S.phone.url) || '';
      if (!url) {
        toast('还没有拿到手机入口地址', 'warn');
        return;
      }
      copyText(url).then(function (ok) {
        toast(ok ? '已复制手机入口链接' : '复制失败', ok ? 'ok' : 'warn');
      });
    });
    el.phoneModal.addEventListener('click', function (ev) {
      if (ev.target === el.phoneModal) closePhone();
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && !el.phoneModal.hidden) {
        closePhone();
        return;
      }
      var tag = (ev.target && ev.target.tagName) || '';
      if (ev.key === '/' && tag !== 'INPUT' && tag !== 'TEXTAREA') {
        ev.preventDefault();
        el.projectSearch.focus();
      }
    });

    window.addEventListener('resize', function () {
      if (!isMobile()) switchView('chat');
    });
  }

  function cacheEls() {
    el.idcard = $('idcard');
    el.careerList = $('careerList');
    el.careerCount = $('careerCount');
    el.projectList = $('projectList');
    el.projCount = $('projCount');
    el.projectSearch = $('projectSearch');
    el.searchClear = $('searchClear');
    el.ctxKicker = $('ctxKicker');
    el.ctxTitle = $('ctxTitle');
    el.ctxSub = $('ctxSub');
    el.btnClearCtx = $('btnClearCtx');
    el.chatScroll = $('chatScroll');
    el.chatInner = $('chatInner');
    el.chatInput = $('chatInput');
    el.btnSend = $('btnSend');
    el.quickCmds = $('quickCmds');
    el.mockHint = $('mockHint');
    el.demoBadge = $('demoBadge');
    el.indexTime = $('indexTime');
    el.stateChip = $('stateChip');
    el.stateText = $('stateText');
    el.btnRefresh = $('btnRefresh');
    el.btnPhone = $('btnPhone');
    el.btnNewTask = $('btnNewTask');
    el.taskList = $('taskList');
    el.taskCount = $('taskCount');
    el.artifactList = $('artifactList');
    el.artifactCount = $('artifactCount');
    el.memoryList = $('memoryList');
    el.memoryCount = $('memoryCount');
    el.eventList = $('eventList');
    el.eventCount = $('eventCount');
    el.eventLive = $('eventLive');
    el.tabbar = $('tabbar');
    el.phoneModal = $('phoneModal');
    el.phoneQr = $('phoneQr');
    el.phonePh = $('phonePh');
    el.phoneUrl = $('phoneUrl');
    el.phoneCopy = $('phoneCopy');
    el.phoneClose = $('phoneClose');
    el.phoneNote = $('phoneNote');
    el.warnBar = $('warnBar');
    el.warnText = $('warnText');
    el.warnClose = $('warnClose');
    el.toasts = $('toasts');
  }

  /* ---------------- 启动 ---------------- */

  function boot() {
    cacheEls();
    bindUI();
    S.mock = /(^|[?&])mock=1(&|$)/.test(location.search);
    renderSkeletons();
    renderTopbar();

    if (S.mock) {
      enterMock('已按 ?mock=1 使用演示数据');
      return;
    }

    YH_API.getState()
      .then(function (st) {
        hydrate(st);
        S.booted = true;
        el.demoBadge.hidden = true;
        el.mockHint.hidden = true;
        renderAll();
        updateEventLive('live');
        connectEvents();
        loadHistory();
        if (st.agent && st.agent.hasKey === false) showWarn('模型 key 未配置：聊天会直接失败。把 DEEPSEEK_API_KEY 写进仓库根目录的 .env。');
        checkHealth();
      })
      .catch(function (err) {
        enterMock('未连接到服务（' + (err && err.message ? err.message : '网络错误') + '），已切换演示数据');
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
