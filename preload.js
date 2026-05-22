// ===== preload.js — Electron IPC 桥接层 =====
//
// Electron 的安全策略：渲染进程（页面里的 JS）不能直接访问 Node.js 功能
// preload.js 在渲染进程加载页面之前执行，可以安全地调用 Node.js API
// contextBridge.exposeInMainWorld() 把指定功能"暴露"给页面 JS 使用
//
// 两种 IPC 模式：
//   1. invoke/handle（请求-响应）:
//      页面调 ipcRenderer.invoke('频道名', 数据)
//      主进程通过 ipcMain.handle('频道名', handler) 接收
//      主进程返回结果，页面在 Promise 的 .then() 里拿到
//
//   2. send/on（推送）:
//      主进程调 mainWindow.webContents.send('频道名', 数据)
//      页面通过 ipcRenderer.on('频道名', callback) 监听
//      适用于主进程主动通知（如：定时提醒到期了）

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  // ---- 对话相关 ----
  // 用户发送消息给 LLM
  // invoke: 向主进程发请求，等待返回结果
  // 'llm:send' 是频道名，main.js 里有对应的 ipcMain.handle('llm:send', ...)
  sendMessage: (userText) => ipcRenderer.invoke('llm:send', userText),

  // 读取/保存配置
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),

  // 获取模型列表（用于设置页面的"获取列表"功能）
  getModels: (baseUrl, apiKey) => ipcRenderer.invoke('llm:models', baseUrl, apiKey),

  // 打开设置窗口
  openSettings: () => ipcRenderer.invoke('settings:open'),

  // ---- 工具管理 ----
  // 按类型查询工具记录（笔记/待办等）
  getTools: (type) => ipcRenderer.invoke('tools:list', type),
  // 获取所有活跃的工具记录
  getAllActiveTools: () => ipcRenderer.invoke('tools:all-active'),
  // 删除指定 ID 的工具记录
  deleteTool: (id) => ipcRenderer.invoke('tools:delete', id),

  // ---- 监听主进程推送消息（和上面的 invoke 不同，这是推送模式）----
  // onScheduleTriggered 接收一个回调函数
  // 当主进程检测到定时提醒到期时，会通过 IPC 推送过来
  // 这里的 ipcRenderer.on('schedule:triggered', ...) 就是监听端
  onScheduleTriggered: (callback) => {
    ipcRenderer.on('schedule:triggered', (_event, data) => callback(data))
  },
})
