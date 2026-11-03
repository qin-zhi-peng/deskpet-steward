const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('petAPI', {
  dragStart: () => ipcRenderer.send('pet:drag-start'),
  dragEnd: () => ipcRenderer.send('pet:drag-end'),
  setIgnore: (ignore) => ipcRenderer.send('pet:set-ignore', ignore),
  showMenu: () => ipcRenderer.send('pet:menu'),
  quit: () => ipcRenderer.send('pet:quit'),
  onAction: (cb) => ipcRenderer.on('pet:action', (_e, name) => cb(name)),

  // 桌宠总管接入
  setPanel: (open) => ipcRenderer.send('pet:panel', open),
  openWorkbench: () => ipcRenderer.send('pet:workbench'),
  chat: (message) => ipcRenderer.invoke('pet:chat', message),
  history: () => ipcRenderer.invoke('pet:history'),
  onStatus: (cb) => ipcRenderer.on('pet:status', (_e, s) => cb(s)),
  onNotice: (cb) => ipcRenderer.on('pet:notice', (_e, n) => cb(n)),
  onTask: (cb) => ipcRenderer.on('pet:task', (_e, t) => cb(t)),
  onAgentState: (cb) => ipcRenderer.on('pet:agent-state', (_e, s) => cb(s)),
  onOffline: (cb) => ipcRenderer.on('pet:offline', (_e, v) => cb(v)),
  onChatDelta: (cb) => ipcRenderer.on('pet:chat-delta', (_e, t) => cb(t)),
  onChatTool: (cb) => ipcRenderer.on('pet:chat-tool', (_e, t) => cb(t)),
  onChatDone: (cb) => ipcRenderer.on('pet:chat-done', (_e, t) => cb(t)),
  onChatError: (cb) => ipcRenderer.on('pet:chat-error', (_e, t) => cb(t)),
  onOpenPanel: (cb) => ipcRenderer.on('pet:open-panel', (_e, v) => cb(v)),
  onPanelSized: (cb) => ipcRenderer.on('pet:panel-sized', (_e, v) => cb(v)),
  onForceMood: (cb) => ipcRenderer.on('pet:force-mood', (_e, m) => cb(m)),
  onTestChat: (cb) => ipcRenderer.on('pet:test-chat', (_e, t) => cb(t)),
});
