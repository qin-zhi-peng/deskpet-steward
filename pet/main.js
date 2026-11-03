// 小鲸桌面宠物 · Electron 主进程（桌宠总管接入版）
// 窗口、托盘、拖拽、点击穿透、状态同步 / SSE 事件 / 悬浮聊天。
const { app, BrowserWindow, ipcMain, screen, Tray, Menu, nativeImage, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const WIN_W = 320;
const CLOSED_H = 400;
const OPEN_H = 640; // 聊天面板展开后的窗口高度（向上长）
const API = (process.env.STEWARD_API || process.env.STEWARD_AGENT_URL || 'http://127.0.0.1:8795').replace(/\/+$/, '');

let win = null;
let tray = null;
let dragTimer = null;
let dragStartedAt = 0;
let dragging = false;
let dragOffset = { x: 0, y: 0 };
let dragSize = { width: WIN_W, height: CLOSED_H };
let lastDragPos = { x: 0, y: 0 };
let panelOpen = false;
let statusTimer = null;
let evAbort = null;
let evRetry = 500;
let lastStatus = null;
let lastNoticeAt = 0;
let ignoreState = null;
let cursorTimer = null;
const PET_HIT_W = 250; // 与 pet.html 里 .pet 的宽高一致（下面留 2px 宽容）
const PET_HIT_H = 292;

const SHOT = process.env.PET_SHOT || '';
const SHOT_DELAY = Math.min(20000, Math.max(500, Number(process.env.PET_SHOT_DELAY || 2600)));
const SHOT_PANEL = process.env.PET_SHOT_PANEL === '1';
const SHOT_MOOD = process.env.PET_MOOD || '';

function sendToWin(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

/* ---------------- 鼠标热区（主进程轮询，比渲染层 mousemove 可靠） ---------------- */

function applyIgnore(ignore) {
  if (!win || win.isDestroyed()) return;
  if (ignore === ignoreState) return;
  ignoreState = ignore;
  win.setIgnoreMouseEvents(!!ignore, { forward: true });
  if (process.env.PET_DEBUG) {
    console.log('[ignore]', ignore ? 'click-through' : 'interactive');
    try {
      fs.appendFileSync(path.join(app.getPath('userData'), 'hit.log'), `${new Date().toISOString()} ${ignore ? 'click-through' : 'interactive'}\n`);
    } catch {}
  }
}

function startCursorWatch() {
  clearInterval(cursorTimer);
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    // 拖拽卡死看门狗：8s 没收到 drag-end 就强制恢复
    if (dragTimer && Date.now() - dragStartedAt > 8000) {
      if (process.env.PET_DEBUG) console.log('[drag] watchdog fired, forcing end');
      clearInterval(dragTimer);
      dragTimer = null;
      dragging = false;
    }
    if (dragging) return; // 拖拽中保持可交互，避免热区轮询把 ignore 切回去
    if (panelOpen) {
      applyIgnore(false); // 面板展开：整窗可交互
      return;
    }
    const pt = screen.getCursorScreenPoint();
    const b = win.getBounds();
    const hx = b.x + Math.round((WIN_W - PET_HIT_W) / 2);
    const hy = b.y + b.height - PET_HIT_H;
    const inside = pt.x >= hx && pt.x <= hx + PET_HIT_W && pt.y >= hy && pt.y <= hy + PET_HIT_H;
    applyIgnore(!inside);
  }, 70);
}

/* ---------------- 窗口 ---------------- */

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();

  win = new BrowserWindow({
    width: WIN_W,
    height: CLOSED_H,
    x: workArea.x + workArea.width - WIN_W - 24,
    y: workArea.y + workArea.height - CLOSED_H - 12,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });

  win.loadFile(path.join(__dirname, 'pet.html'));
  win.webContents.on('console-message', (_e, level, message) => {
    if (process.env.PET_DEBUG) console.log('[renderer]', level, message);
  });

  win.once('ready-to-show', () => {
    win.show();
    // 统一成标准尺寸（高 DPI 下初始窗口可能被系统加上不可见边框而多几个像素），
    // 以底边为锚点，宠物本身不会移动。
    const b = win.getBounds();
    win.setBounds({ x: b.x, y: b.y + b.height - CLOSED_H, width: WIN_W, height: CLOSED_H }, false);
    // 不要用“先移开再移回”来触发重绘：Windows 高 DPI 下每次位移都会
    // 让窗口尺寸向上取整 +1px，宠物会被慢慢撑大、下沉。
    try { win.webContents.invalidate(); } catch {}
    if (SHOT) setTimeout(runShot, SHOT_DELAY);
    startIntegration();
    startCursorWatch();
    if (process.env.PET_AUTOCHAT) {
      setTimeout(() => {
        setPanel(true);
        sendToWin('pet:open-panel', true);
        setTimeout(() => sendToWin('pet:test-chat', process.env.PET_AUTOCHAT), 350);
      }, 1500);
    }
  });

  win.on('closed', () => {
    win = null;
  });
}

/* ---------------- 桌宠总管 API ---------------- */

async function fetchJson(pathname, opts = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), opts.timeout || 5000);
  try {
    const res = await fetch(API + pathname, { ...opts, signal: ctl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

let apiLogged = false;
async function pollStatus() {
  try {
    const s = await fetchJson('/api/pet');
    lastStatus = s;
    if (!apiLogged) {
      apiLogged = true;
      console.log('[api] online:', JSON.stringify({ status: s.status, counts: s.counts, hasKey: s.hasKey }));
    }
    sendToWin('pet:status', s);
  } catch (err) {
    if (!apiLogged) {
      apiLogged = true;
      console.log('[api] offline:', err.message);
    }
    lastStatus = null;
    sendToWin('pet:status', { online: false });
  }
}

function parseSseChunk(chunk, onEvent) {
  for (const line of chunk.split(/\r?\n/)) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const raw = s.slice(5).trim();
    if (!raw) continue;
    try {
      onEvent(JSON.parse(raw));
    } catch {}
  }
}

async function connectEvents() {
  if (evAbort) {
    try {
      evAbort.abort();
    } catch {}
  }
  evAbort = new AbortController();
  const signal = evAbort.signal;
  let opened = false;
  try {
    const res = await fetch(API + '/api/events', { headers: { Accept: 'text/event-stream' }, signal });
    if (!res.ok || !res.body) throw new Error('SSE HTTP ' + res.status);
    opened = true;
    evRetry = 500;
    console.log('[api] SSE connected');
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        parseSseChunk(chunk, (evt) => {
          if (evt.type === 'notice') {
            lastNoticeAt = Date.now();
            sendToWin('pet:notice', evt);
          } else if (evt.type === 'task.update') {
            sendToWin('pet:task', evt.task);
          } else if (evt.type === 'agent.state') {
            sendToWin('pet:agent-state', evt.status);
          }
        });
      }
    }
  } catch (err) {
    if (signal.aborted) return;
  }
  if (signal.aborted) return;
  if (opened) sendToWin('pet:offline', true);
  evRetry = Math.min(15000, Math.round(evRetry * 1.8));
  setTimeout(connectEvents, evRetry);
}

function startIntegration() {
  pollStatus();
  clearInterval(statusTimer);
  statusTimer = setInterval(pollStatus, 5000);
  connectEvents();
}

/* ---------------- 聊天（主进程代理，避免 file:// 跨域） ---------------- */

ipcMain.handle('pet:chat', async (_e, message) => {
  const text = String(message || '').trim();
  if (!text) return '';
  try {
    const res = await fetch(API + '/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: 'main', message: text, source: 'pet' }),
    });
    if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let finalText = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        parseSseChunk(chunk, (evt) => {
          if (evt.type === 'delta') sendToWin('pet:chat-delta', evt.text || '');
          else if (evt.type === 'tool') sendToWin('pet:chat-tool', evt.label || evt.name || '');
          else if (evt.type === 'done') {
            finalText = evt.text || '';
            sendToWin('pet:chat-done', finalText);
          } else if (evt.type === 'error') sendToWin('pet:chat-error', evt.message || '出错了');
        });
      }
    }
    return finalText;
  } catch (err) {
    sendToWin('pet:chat-error', err.message);
    return '';
  }
});

ipcMain.handle('pet:history', async () => {
  try {
    const j = await fetchJson('/api/chat/history?sessionId=main&limit=20');
    return (j.messages || []).map((m) => ({ role: m.role, text: m.text }));
  } catch {
    return [];
  }
});

/* ---------------- 面板 / 托盘 / 菜单 ---------------- */

function setPanel(open) {
  if (!win) return;
  open = !!open;
  if (open === panelOpen) return;
  panelOpen = open;
  const b = win.getBounds();
  const h = open ? OPEN_H : CLOSED_H;
  const y = b.y + b.height - h; // 以底边为锚点向上长
  win.setBounds({ x: b.x, y, width: WIN_W, height: h });
  if (process.env.PET_DEBUG) console.log('[panel]', open, JSON.stringify(win.getBounds()));
  if (open) applyIgnore(false);
  else applyIgnore(true);
  sendToWin('pet:panel-sized', { open });
}

ipcMain.on('pet:panel', (_e, open) => setPanel(open));
ipcMain.on('pet:workbench', () => shell.openExternal(API + '/'));

/* 从托盘/右键菜单打开聊天：窗口长高 + 通知渲染层展开面板 */
function openChatFromMain() {
  if (!win) {
    createWindow();
    return;
  }
  win.show();
  setPanel(true);
  sendToWin('pet:open-panel', true);
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);
  tray.setToolTip('小鲸 · 桌宠总管桌宠');
  const menu = Menu.buildFromTemplate([
    { label: '找总管说话…', click: () => openChatFromMain() },
    { label: '打开工作台', click: () => shell.openExternal(API + '/') },
    { label: '修复点不到（恢复交互）', click: () => {
        clearInterval(dragTimer);
        dragTimer = null;
        dragStartedAt = 0;
        dragging = false;
        ignoreState = null;
        if (win) {
          // 顺便把可能被累加撑大的窗口恢复成标准尺寸
          const b = win.getBounds();
          const h = panelOpen ? OPEN_H : CLOSED_H;
          win.setBounds({ x: b.x, y: b.y + b.height - h, width: WIN_W, height: h }, false);
        }
        applyIgnore(false);
      } },
    { label: '重新载入界面', click: () => win && win.reload() },
    { label: '叫她出来 / 藏起来', click: () => (win ? (win.isVisible() ? win.hide() : win.show()) : createWindow()) },
    { label: '置顶', type: 'checkbox', checked: true, click: (m) => win && win.setAlwaysOnTop(m.checked, 'screen-saver') },
    { type: 'separator' },
    { label: '藏到托盘（随时点托盘召唤）', click: () => win && win.hide() },
    { label: '彻底退出桌宠', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => {
    if (win) win.isVisible() ? win.hide() : win.show();
  });
}

/* ---------------- 拖拽 ---------------- */

ipcMain.on('pet:drag-start', () => {
  if (!win) return;
  dragging = true;
  dragStartedAt = Date.now();
  const pt = screen.getCursorScreenPoint();
  const b = win.getBounds();
  // 关键：拖动期间尺寸必须固定为与缩放比整倍数对齐的值（175% 下 320/400/640
  // 都是 4 的倍数，DIP↔物理像素换算无取整误差）。否则 setPosition/setBounds
  // 每调一次窗口就 +1px，宠物锚在窗口底部会一路沉出屏幕。
  dragSize = { width: WIN_W, height: panelOpen ? OPEN_H : CLOSED_H };
  // 以窗口底边为锚点，尺寸归一时宠物不会跳
  const newX = b.x + Math.round((b.width - dragSize.width) / 2);
  const newY = b.y + b.height - dragSize.height;
  dragOffset = { x: pt.x - newX, y: pt.y - newY };
  lastDragPos = { x: newX, y: newY };
  win.setBounds({ x: newX, y: newY, width: dragSize.width, height: dragSize.height }, false);
  if (process.env.PET_DEBUG) console.log('[drag] start cursor=', pt, 'bounds=', JSON.stringify(b), 'offset=', dragOffset);
  win.setIgnoreMouseEvents(false);
  clearInterval(dragTimer);
  let lastLog = 0;
  dragTimer = setInterval(() => {
    if (!win) return;
    const c = screen.getCursorScreenPoint();
    const nx = c.x - dragOffset.x;
    const ny = c.y - dragOffset.y;
    // 光标没动就别碰窗口：多余的 setBounds 也会触发 DIP 换算
    if (nx === lastDragPos.x && ny === lastDragPos.y) return;
    lastDragPos = { x: nx, y: ny };
    win.setBounds({ x: nx, y: ny, width: dragSize.width, height: dragSize.height }, false);
    if (process.env.PET_DEBUG && Date.now() - lastLog > 500) {
      lastLog = Date.now();
      const nb = win.getBounds();
      console.log('[drag] follow cursor=', c, 'bounds=', JSON.stringify(nb), 'offsetNow=', c.x - nb.x, c.y - nb.y);
    }
  }, 8);
});

ipcMain.on('pet:drag-end', () => {
  if (process.env.PET_DEBUG) console.log('[drag] end', win && !win.isDestroyed() ? win.getBounds() : null);
  dragging = false;
  dragStartedAt = 0;
  clearInterval(dragTimer);
  dragTimer = null;
  if (!win) return;
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const b = win.getBounds();
  const w = WIN_W;
  const h = panelOpen ? OPEN_H : CLOSED_H;
  const nx = Math.min(Math.max(b.x, workArea.x - 40), workArea.x + workArea.width - w + 40);
  const ny = Math.min(Math.max(b.y, workArea.y - 40), workArea.y + workArea.height - h + 40);
  // 用固定尺寸，避免往返取整把窗口越撑越大
  win.setBounds({ x: Math.round(nx), y: Math.round(ny), width: w, height: h }, false);
});

ipcMain.on('pet:set-ignore', (_e, ignore) => {
  // 忽略渲染层的请求：热区统一由主进程 startCursorWatch 轮询决定，避免两套逻辑打架
  void ignore;
});

ipcMain.on('pet:quit', () => {
  app.isQuitting = true;
  app.quit();
});

ipcMain.on('pet:menu', () => {
  if (!win) return;
  Menu.buildFromTemplate([
    { label: '找总管说话…', click: () => openChatFromMain() },
    { label: '打开工作台', click: () => shell.openExternal(API + '/') },
    { type: 'separator' },
    { label: '打劫，给我 token', click: () => win.webContents.send('pet:action', 'rob') },
    { label: '喂一个 token', click: () => win.webContents.send('pet:action', 'feed') },
    { type: 'separator' },
    { label: '置顶', type: 'checkbox', checked: win.isAlwaysOnTop(), click: (m) => win.setAlwaysOnTop(m.checked, 'screen-saver') },
    { label: '藏到托盘', click: () => win.hide() },
    { label: '彻底退出桌宠', click: () => { app.isQuitting = true; app.quit(); } },
  ]).popup({ window: win });
});

/* ---------------- 截图自检（PET_SHOT=路径） ---------------- */

async function runShot() {
  try {
    if (SHOT_PANEL) {
      setPanel(true);
      sendToWin('pet:open-panel', true);
    }
    if (SHOT_MOOD) sendToWin('pet:force-mood', SHOT_MOOD);
    await new Promise((r) => setTimeout(r, 800));
    const image = await win.webContents.capturePage();
    fs.mkdirSync(path.dirname(SHOT), { recursive: true });
    fs.writeFileSync(SHOT, image.toPNG());
    console.log('[shot]', SHOT, JSON.stringify(image.getSize()));
  } catch (err) {
    console.error('[shot] failed:', err);
    process.exitCode = 1;
  }
  app.isQuitting = true;
  app.quit();
}

/* ---------------- 生命周期 ---------------- */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    // 再次双击快捷方式：把已有桌宠叫出来，不重复开第二个
    if (win) {
      win.show();
      setPanel(panelOpen);
    }
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();
  if (process.env.PET_SMOKE) {
    setTimeout(() => {
      console.log('[smoke] window ok:', !!win && win.isVisible(), 'api:', API);
      app.isQuitting = true;
      app.quit();
    }, 3000);
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  clearInterval(dragTimer);
  clearInterval(statusTimer);
  clearInterval(cursorTimer);
  if (evAbort) {
    try {
      evAbort.abort();
    } catch {}
  }
});
