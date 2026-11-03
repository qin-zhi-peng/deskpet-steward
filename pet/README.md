# 小鲸 · 桌面宠物（Electron）

一个常驻桌面的 Q 版鲸鱼女仆。透明无边框窗口，点击穿透，拖得动，会眨眼，会伸手打劫 token。

## 运行

```bash
npm install     # 首次会下载 Electron 运行时（约 150MB）
npm start       # 小鲸出现在屏幕右下角
```

退出：系统托盘图标（右下角托盘区）→ 右键 → 退出。

打包成免安装 exe（可选）：

```bash
npm i -D electron-builder
npm run dist
```

> 若在 CI / 特殊终端里启动报 `Cannot read properties of undefined (reading 'on')`，
> 说明环境里带着 `ELECTRON_RUN_AS_NODE=1`，先 `unset` 再启动。

## 交互

| 操作 | 反应 |
| --- | --- |
| 单击身体 | 惊讶 → 连点 3 次生气、5 次委屈 |
| 双击 | 生气 + 伸爪「打劫，给我 token」 |
| 按住拖动 | 整窗跟随光标移动，松手吸附屏幕边缘 |
| 右键 | 菜单：打劫 / 喂 token / 置顶 / 藏起来 / 退出 |
| 闲置 45 秒 | 犯困打瞌睡（Zzz） |
| 托盘图标 | 左键显示 / 隐藏；右键菜单 |

## 结构

```
main.js      主进程：窗口、托盘、拖拽轮询、点击穿透
preload.js   contextBridge 暴露 5 个 IPC
pet.html     渲染层：气泡、眨眼、姿势切换、情绪
assets/      pet-idle / pet-blink / pet-beg（同画布 816×916）
              head/*.png 九张 300px 头部贴片
              tray.png 托盘图标
```

## 实现要点

- **透明**：`transparent: true` + `frame: false` + `backgroundColor: '#00000000'`
- **点击穿透**：默认 `setIgnoreMouseEvents(true, { forward: true })`；渲染层用 `closest('.pet')` 判断落点，命中才发 IPC 接管
- **拖动**：主进程 8ms 轮询 `screen.getCursorScreenPoint()` 后 `setBounds`，比 CSS 拖动跟手。窗口宽高固定为 320×400 / 320×640（4 的倍数），否则 Windows 在高 DPI（如 175%）下每次位移都会因 DIP↔物理像素取整把窗口 +1px，导致宠物越拖越大、下沉、点不到；光标未移动时跳过调用，避免无谓换算
- **三帧同画布**：待机 / 闭眼 / 伸爪都在 816×916 画布内底边居中对齐，切换时不会跳位

## 已知限制

- 立绘是整图切换，没有分层。真尾巴摆动、说话口型需要手工分层（尾巴与裙摆同色，自动抠图分不干净）
- 只有 2 套姿势（待机 / 伸爪）
- 未做开机自启与代码签名
