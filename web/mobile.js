/* 桌宠总管 · 手机版（单列）
 * 复用 lib/api.js（token 从 URL 透传）、lib/md.js、lib/mock.js。
 */
(function () {
  'use strict';

  var WHALE = '../assets/pet/xiaojing-portrait-512.png';
  var STATE_META = {
    idle: { label: '待命', cls: 'st-idle' },
    thinking: { label: '思考中', cls: 'st-thinking' },
    working: { label: '干活中', cls: 'st-working' },
    happy: { label: '开心', cls: 'st-happy' },
    sleep: { label: '休息', cls: 'st-sleep' }
  };
  var TASK_STATUS = {
    queued: '排队中',
    planning: '拆活中',
    running: '进行中',
    done: '已完成',
    failed: '失败',
    cancelled: '已取消'
  };

  var S = {
    mock: false,
    agent: { status: 'idle', name: '桌宠总管' },
    tasks: [],
    artifacts: [],
    memories: [],
    stats: {},
    phone: {},
    indexedAt: null,
    messages: [],
    streaming: false,
    taskOpen: {},
    es: null,
    renderTimer: null,
    renderedIds: '',
    autoScroll: true,
    sessionId: 'main'
  };

  var el = {};

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
    var abs = Math.abs(off);
    return (
      d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      'T' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds()) +
      (off >= 0 ? '+' : '-') + pad2(Math.floor(abs / 60)) + ':' + pad2(abs % 60)
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
    if (d.toDateString() === now.toDateString()) return clock(iso);
    var y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + clock(iso);
    return d.getMonth() + 1 + '月' + d.getDate() + '日';
  }

  function fmtNum(n) {
    return String(Number(n) || 0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function toast(msg, level) {
    var node = document.createElement('div');
    node.className = 'm-toast ' + (level || '');
    node.textContent = msg;
    el.toasts.appendChild(node);
    while (el.toasts.children.length > 3) el.toasts.removeChild(el.toasts.firstChild);
    setTimeout(function () {
      node.classList.add('out');
      setTimeout(function () {
        if (node.parentNode) node.parentNode.removeChild(node);
      }, 220);
    }, 2600);
  }

  function setAgentState(status) {
    if (!status || !STATE_META[status] || S.agent.status === status) return;
    S.agent.status = status;
    renderHeader();
  }

  function renderHeader() {
    var st = (S.agent && S.agent.status) || 'idle';
    var meta = STATE_META[st] || STATE_META.idle;
    el.stateChip.className = 'm-state ' + meta.cls;
    el.state.textContent = meta.label;
    el.tag.textContent = YH_API.token() ? '手机入口 · 已配对' : '我的工作区 · 手机入口';
  }

  function renderHero() {
    el.statProjects.textContent = fmtNum((S.stats && S.stats.projects) || 0);
    el.statTasks.textContent = S.tasks.length || 0;
    el.statIndex.textContent = S.indexedAt ? timeAgo(S.indexedAt) : '—';
    el.heroSub.textContent =
      '项目 ' + fmtNum((S.stats && S.stats.projects) || 0) + ' · 工单 ' + S.tasks.length + ' · 索引 ' + (S.indexedAt ? timeAgo(S.indexedAt) : '未建立');
    el.demo.hidden = !S.mock;
    el.mockHint.hidden = !S.mock;
  }

  /* ---------------- 聊天 ---------------- */

  function toolHtml(t) {
    var ok = t.status !== 'running';
    var label = t.label || t.name || '工具';
    return (
      '<div class="m-tool' + (ok ? ' ok' : '') + '">' +
      '<i></i><span class="label">' + esc(label) + '</span>' +
      (t.res ? '<span class="res">' + esc(t.res) + '</span>' : '') +
      '</div>'
    );
  }

  function aiContentHtml(m) {
    var body = '';
    if (m.tools && m.tools.length) body += '<div class="m-tools">' + m.tools.map(toolHtml).join('') + '</div>';
    if (m.text) body += '<div class="md">' + YH_MD.render(m.text) + (m.pending ? '<span class="m-caret"></span>' : '') + '</div>';
    else if (m.pending) body += '<div class="m-thinking"><i></i><i></i><i></i></div>';
    if (m.error) {
      body +=
        '<div class="m-error"><span>回复中断：' + esc(m.error) + '</span>' +
        '<button type="button" data-act="retry" data-mid="' + esc(m.id) + '">重试</button></div>';
    }
    return body;
  }

  function aiBodyHtml(m) {
    return (
      '<div class="m-meta"><b>桌宠总管</b><span>' + clock(m.createdAt) +
      (m.pending ? ' · 输入中' : '') + '</span></div>' + aiContentHtml(m)
    );
  }

  function msgHtml(m) {
    if (m.role === 'user') {
      return (
        '<div class="m-msg user" data-mid="' + esc(m.id) + '">' +
        '<div class="m-body"><div class="m-bubble">' + esc(m.text).replace(/\n/g, '<br>') + '</div>' +
        '<div class="m-time">' + clock(m.createdAt) + '</div></div></div>'
      );
    }
    return (
      '<div class="m-msg" data-mid="' + esc(m.id) + '">' +
      '<div class="m-ava2"><img src="' + WHALE + '" alt=""></div>' +
      '<div class="m-body">' + aiBodyHtml(m) + '</div></div>'
    );
  }

  function idsSignature() {
    var out = [];
    for (var i = 0; i < S.messages.length; i++) out.push(S.messages[i].id);
    return out.join('|');
  }

  function scrollBottom() {
    if (!S.autoScroll) return;
    requestAnimationFrame(function () {
      el.main.scrollTop = el.main.scrollHeight;
    });
  }

  function renderMessages(scroll) {
    if (!S.messages.length) {
      el.chat.innerHTML =
        '<div class="m-empty">' +
        '<div style="font-family:var(--font-title);font-size:22px;color:var(--paper);margin-bottom:4px">出门也能拍板</div>' +
        '从电脑端「手机入口」扫码进来，就能看工单、发指令。<br>直接说目标，我在这边接着干。' +
        '</div>';
      S.renderedIds = '';
      return;
    }
    var sig = idsSignature();
    if (sig === S.renderedIds) {
      patchLastMessage();
      return;
    }
    el.chat.innerHTML =
      '<div class="m-day"><span>今天 · ' + (new Date().getMonth() + 1) + '月' + new Date().getDate() + '日</span></div>' +
      S.messages.map(msgHtml).join('');
    S.renderedIds = sig;
    if (scroll) scrollBottom();
  }

  function patchLastMessage() {
    var m = S.messages[S.messages.length - 1];
    if (!m || m.role !== 'assistant') return;
    var nodes = el.chat.querySelectorAll('.m-msg');
    var node = nodes.length ? nodes[nodes.length - 1] : null;
    if (!node) {
      S.renderedIds = '';
      renderMessages(false);
      return;
    }
    if (node.getAttribute('data-mid') !== m.id) node.setAttribute('data-mid', m.id);
    var body = node.querySelector('.m-body');
    if (body) body.innerHTML = aiBodyHtml(m);
    scrollBottom();
  }

  function scheduleRender() {
    if (S.renderTimer) return;
    S.renderTimer = setTimeout(function () {
      S.renderTimer = null;
      renderMessages(true);
    }, 60);
  }

  function pushUser(text) {
    S.messages.push({ id: 'u_' + Date.now().toString(36), role: 'user', text: text, createdAt: nowIso() });
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
    renderMessages(true);
    if (S.mock) mockStream(am, text);
    else liveStream(am, text);
  }

  function sendMessage(raw) {
    var text = String(raw || '').trim();
    if (!text || S.streaming) return;
    pushUser(text);
    S.autoScroll = true;
    el.input.value = '';
    autoGrow();
    runAssistant(text);
  }

  function retry(mid) {
    for (var i = 0; i < S.messages.length; i++) {
      if (S.messages[i].id === mid) {
        var text = S.messages[i].retryText || (S.messages[i - 1] && S.messages[i - 1].text) || '';
        S.messages.splice(i, 1);
        renderMessages(false);
        runAssistant(text);
        return;
      }
    }
  }

  function lastRunningTool(m) {
    for (var i = m.tools.length - 1; i >= 0; i--) {
      if (m.tools[i].status === 'running') return m.tools[i];
    }
    return null;
  }

  function toolLabel(p) {
    var a = p.args || {};
    if (p.name === 'read_file') return '读 ' + (a.path || a.file || '文件');
    if (p.name === 'list_projects') return '扫项目地图';
    if (p.name === 'create_task') return '派工单 ' + (a.title || '');
    if (p.name === 'remember') return '写入记忆';
    if (p.name === 'list_tasks') return '查工单';
    if (p.name === 'search_files') return '搜 ' + (a.query || '文件');
    return p.name || '工具调用';
  }

  function liveStream(am, text) {
    YH_API.chatStream(
      { sessionId: S.sessionId, message: text, projectId: null, source: 'mobile' },
      {
        onDelta: function (p) {
          am.text += p.text || '';
          scheduleRender();
        },
        onTool: function (p) {
          am.tools.push({ name: p.name, label: p.label || toolLabel(p), status: 'running' });
          setAgentState('working');
          scheduleRender();
        },
        onToolResult: function (p) {
          var t = lastRunningTool(am);
          if (t) {
            t.status = p.ok === false ? 'err' : 'ok';
            t.res = p.summary || '';
          }
          scheduleRender();
        },
        onTask: function (p) {
          if (p && p.task) {
            upsertTask(p.task, true);
            toast('工单已派出：' + p.task.title, 'ok');
          }
        },
        onDone: function (p) {
          am.pending = false;
          if (p && p.text) am.text = p.text;
          S.streaming = false;
          setAgentState('idle');
          renderMessages(true);
        },
        onError: function (err) {
          am.pending = false;
          am.error = (err && err.message) || '网络异常';
          S.streaming = false;
          setAgentState('idle');
          renderMessages(true);
        }
      }
    );
  }

  function mockStream(am, text) {
    var plan = YH_MOCK.plan(text);
    var ti = 0;
    function nextTool() {
      if (ti < plan.tools.length) {
        var spec = plan.tools[ti++];
        am.tools.push({ name: spec.name, label: spec.label, status: 'running' });
        setAgentState('working');
        scheduleRender();
        setTimeout(function () {
          var cur = am.tools[am.tools.length - 1];
          if (cur) {
            cur.status = 'ok';
            cur.res = spec.res || '';
          }
          scheduleRender();
          setTimeout(nextTool, 140);
        }, 340);
      } else stream();
    }
    function stream() {
      var full = plan.text || '';
      var i = 0;
      setAgentState('thinking');
      var timer = setInterval(function () {
        i += 3;
        am.text = full.slice(0, i);
        scheduleRender();
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
        plan.task.createdAt = nowIso();
        plan.task.updatedAt = nowIso();
        S.tasks.unshift(plan.task);
        S.taskOpen[plan.task.id] = true;
        renderTasks();
        toast('工单已派出：' + plan.task.title, 'ok');
      }
      if (plan.memory) {
        S.memories.unshift({
          id: 'm_' + Date.now().toString(36),
          key: plan.memory.key,
          value: plan.memory.value,
          pinned: true,
          source: 'chat',
          createdAt: nowIso()
        });
      }
      setAgentState(plan.state || 'idle');
      renderMessages(true);
    }
    setTimeout(nextTool, 380);
  }

  /* ---------------- 工单 ---------------- */

  function initTaskOpen() {
    S.tasks.forEach(function (t, i) {
      if (S.taskOpen[t.id] === undefined) S.taskOpen[t.id] = i === 0 && t.status === 'running';
    });
  }

  function taskHtml(t) {
    var status = t.status || 'queued';
    var subs = t.subtasks || [];
    var done = subs.filter(function (s) {
      return s.status === 'done';
    }).length;
    var pct = Math.round((Number(t.progress) || 0) * 100);
    var open = S.taskOpen[t.id] === true;
    var ico = { done: '✓', running: '◌', queued: '○', failed: '✕', cancelled: '–' };
    var html =
      '<div class="m-task ' + esc(status) + '">' +
      '<div class="m-task-head" data-act="toggle" data-task="' + esc(t.id) + '">' +
      '<span class="m-pill ' + esc(status) + '">' + (TASK_STATUS[status] || status) + '</span>' +
      '<span class="m-task-title">' + esc(t.title) + '</span>' +
      '<span class="m-task-caret">' + (open ? '▾' : '▸') + '</span>' +
      '</div>' +
      '<div class="m-progress"><i class="' + (status === 'running' ? 'breathing' : '') + '" style="width:' + pct + '%"></i></div>' +
      '<div class="m-task-meta"><b>' + pct + '%</b><span>' + done + '/' + subs.length + ' 子任务</span><span class="right">' + timeAgo(t.updatedAt) + '</span></div>';
    if (open) {
      if (subs.length) {
        html +=
          '<div class="m-subs">' +
          subs
            .map(function (s) {
              return (
                '<div class="m-sub ' + esc(s.status) + '"><span class="ico">' + (ico[s.status] || '○') + '</span><span class="t">' + esc(s.title) + '</span></div>'
              );
            })
            .join('') +
          '</div>';
      }
      if (t.summary) html += '<div class="m-summary md">' + YH_MD.render(t.summary) + '</div>';
    }
    return html + '</div>';
  }

  function renderTasks() {
    initTaskOpen();
    el.taskCount.textContent = S.tasks.length || '—';
    if (!S.tasks.length) {
      el.taskList.innerHTML = '<div class="m-empty">还没有工单。在下面说目标，我拆活并行跑。</div>';
      return;
    }
    el.taskList.innerHTML = S.tasks.slice(0, 6).map(taskHtml).join('');
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
    renderHero();
  }

  /* ---------------- 事件 ---------------- */

  function connectEvents() {
    if (typeof EventSource === 'undefined') return;
    try {
      S.es = new EventSource(YH_API.abs('/api/events'));
    } catch (e) {
      return;
    }
    S.es.onmessage = function (ev) {
      var data = {};
      try {
        data = JSON.parse(ev.data || '{}');
      } catch (e) {
        return;
      }
      var type = data.type || '';
      if (type === 'task.update' && data.task) upsertTask(data.task, false);
      else if (type === 'notice') toast((data.title ? data.title + '：' : '') + (data.text || ''), data.level === 'err' ? 'err' : 'ok');
      else if (type === 'agent.state' && data.status) setAgentState(data.status);
      else if (type === 'artifact.new' && data.artifact) {
        S.artifacts.unshift(data.artifact);
        renderHero();
      }
    };
  }

  /* ---------------- 载入 ---------------- */

  function hydrate(st) {
    S.agent = st.agent || S.agent;
    S.tasks = st.tasks || [];
    S.artifacts = st.artifacts || [];
    S.memories = st.memories || [];
    S.stats = st.stats || {};
    S.phone = st.phone || {};
    S.indexedAt = st.indexedAt || null;
    S.taskOpen = {};
    initTaskOpen();
  }

  function renderAll(scroll) {
    renderHeader();
    renderHero();
    renderTasks();
    renderMessages(scroll);
  }

  function loadHistory() {
    YH_API.getHistory(S.sessionId, 50)
      .then(function (res) {
        var list = (res && res.messages) || [];
        if (!list.length) return;
        if (S.messages.length) return; // 用户已经开了新对话，别覆盖
        S.messages = list.map(function (m, i) {
          return {
            id: m.id || 'h_' + i,
            role: m.role === 'user' ? 'user' : 'assistant',
            text: m.text || '',
            tools: [],
            createdAt: m.createdAt || nowIso()
          };
        });
        renderMessages(false);
      })
      .catch(function () {});
  }

  function enterMock(reason) {
    S.mock = true;
    hydrate(YH_MOCK.state());
    S.messages = YH_MOCK.initialMessages();
    renderAll(false);
    toast(reason || '已切换演示数据', 'warn');
  }

  function autoGrow() {
    el.input.style.height = 'auto';
    el.input.style.height = Math.min(el.input.scrollHeight, 110) + 'px';
  }

  function bind() {
    el.main.addEventListener('scroll', function () {
      S.autoScroll = el.main.scrollHeight - el.main.scrollTop - el.main.clientHeight < 70;
    });
    el.send.addEventListener('click', function () {
      sendMessage(el.input.value);
    });
    el.input.addEventListener('input', autoGrow);
    el.input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && !ev.shiftKey) {
        ev.preventDefault();
        sendMessage(el.input.value);
      }
    });
    el.quick.addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-cmd]');
      if (b) sendMessage(b.getAttribute('data-cmd'));
    });
    el.chat.addEventListener('click', function (ev) {
      var r = ev.target.closest('[data-act="retry"]');
      if (r) retry(r.getAttribute('data-mid'));
    });
    el.taskList.addEventListener('click', function (ev) {
      var h = ev.target.closest('[data-act="toggle"]');
      if (!h) return;
      var id = h.getAttribute('data-task');
      S.taskOpen[id] = S.taskOpen[id] !== true;
      renderTasks();
    });
  }

  function cache() {
    el.tag = $('mTag');
    el.stateChip = $('mStateChip');
    el.state = $('mState');
    el.demo = $('mDemo');
    el.main = $('mMain');
    el.heroSub = $('mHeroSub');
    el.statProjects = $('mStatProjects');
    el.statTasks = $('mStatTasks');
    el.statIndex = $('mStatIndex');
    el.chat = $('mChat');
    el.tasks = $('mTaskList');
    el.taskCount = $('mTaskCount');
    el.taskList = $('mTaskList');
    el.input = $('mInput');
    el.send = $('mSend');
    el.quick = $('mQuick');
    el.mockHint = $('mMockHint');
    el.toasts = $('mToasts');
  }

  function boot() {
    cache();
    bind();
    var forceMock = /(^|[?&])mock=1(&|$)/.test(location.search);
    el.chat.innerHTML =
      '<div class="m-msg"><div class="m-ava2"><img src="' + WHALE + '" alt=""></div>' +
      '<div class="m-body"><div class="m-skel" style="height:64px;width:230px"></div></div></div>' +
      '<div class="m-msg user"><div class="m-body"><div class="m-skel" style="height:40px;width:170px"></div></div></div>';
    if (forceMock) {
      enterMock('已按 ?mock=1 使用演示数据');
      return;
    }
    YH_API.getState()
      .then(function (st) {
        hydrate(st);
        el.demo.hidden = true;
        el.mockHint.hidden = true;
        renderAll(false);
        connectEvents();
        loadHistory();
      })
      .catch(function (err) {
        enterMock('未连接到服务，已切换演示数据');
      });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
