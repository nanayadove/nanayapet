// ===== preload.js — Electron IPC 桥接层 =====
//
// Electron 的安全架构：
//   渲染进程（页面里的 JS）不能直接访问 Node.js 功能。
//   这是安全策略——如果网页能用 Node.js，恶意脚本就能读写你的文件系统。
//
// preload.js 的职责：
//   在渲染进程加载页面之前执行，通过 contextBridge 安全地
//   把主进程的功能"暴露"给页面 JS 使用。
//
// 关键概念：
//
// 1. contextBridge
//    Electron 提供的安全桥梁 API。
//    contextBridge.exposeInMainWorld('api', methods)
//    把 methods 对象挂到页面的 window.api 上。
//    contextIsolation: true 时，preload 和页面各自有独立的全局作用域，
//    contextBridge 是唯一合法的(安全的)数据通道。
//
// 2. ipcRenderer
//    渲染进程端的 IPC（进程间通信）模块。
//    它只存在于 preload 脚本中，页面 JS 接触不到。
//
// 3. IPC 两种模式：
//
//   a) invoke/handle（请求-响应模式）
//      页面调 ipcRenderer.invoke('频道名', 数据)
//      主进程 ipcMain.handle('频道名', handler) 接收
//      主进程返回结果，页面在 Promise 的 .then() 里拿到
//      相当于 HTTP 请求：发请求 → 等响应
//
//   b) send/on（推送模式）
//      主进程调 mainWindow.webContents.send('频道名', 数据)
//      页面通过 ipcRenderer.on('频道名', callback) 监听
//      相当于 WebSocket：服务器主动推消息
//      适用于主进程主动通知（如：定时提醒到期了）

// 引入 Electron 的 preload 专用 API
const { contextBridge, ipcRenderer } = require('electron')

// contextBridge.exposeInMainWorld('api', {...})
//   第一个参数 'api' — 在页面里通过 window.api 访问
//   第二个参数 {...} — 要暴露的方法集合
contextBridge.exposeInMainWorld('api', {
  // ============ 对话相关 ============

  // sendMessage(用户文本) — 发送消息给 LLM
  // invoke: 向主进程发请求，返回 Promise
  // 'llm:send' 是频道名，main.js 里有对应的 ipcMain.handle('llm:send', ...)
  // 页面调用: const result = await window.api.sendMessage('你好')
  sendMessage: (userText) => ipcRenderer.invoke('llm:send', userText),

  // ============ 配置相关 ============

  // getConfig() — 读取配置（返回解密后的配置对象）
  getConfig: () => ipcRenderer.invoke('config:get'),
  // saveConfig(config) — 保存配置
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  // hasEncryption() — 检查系统是否支持加密存储 API Key
  hasEncryption: () => ipcRenderer.invoke('config:has-encryption'),

  // ============ 设置窗口相关 ============

  // getModels(baseUrl, apiKey) — 获取模型列表（设置页面"获取列表"按钮用）
  getModels: (baseUrl, apiKey) => ipcRenderer.invoke('llm:models', baseUrl, apiKey),
  // openSettings() — 打开设置窗口
  openSettings: () => ipcRenderer.invoke('settings:open'),
  // minimizeWindow() — 最小化宠物窗口
  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),

  // ============ 工具管理 ============

  // getTools(type) — 按类型查询工具记录
  getTools: (type) => ipcRenderer.invoke('tools:list', type),
  // getAllActiveTools() — 获取所有活跃工具记录
  getAllActiveTools: () => ipcRenderer.invoke('tools:all-active'),
  // deleteTool(id) — 删除指定 ID 的工具记录
  deleteTool: (id) => ipcRenderer.invoke('tools:delete', id),

  // ============ 主进程推送监听 ============

  // onScheduleTriggered(callback) — 监听定时提醒触发事件
  // 这是推送模式(不是请求-响应)，callback 在提醒触发时被调用
  // ipcRenderer.on(频道, (事件对象, 数据) => callback(数据)) — 注册监听
  // _event 是事件对象（下划线前缀表示不使用它）
  onScheduleTriggered: (callback) => {
    ipcRenderer.on('schedule:triggered', (_event, data) => callback(data))
  },

  // onProactiveGreeting(callback) — 监听主动问候事件
  // 当用户长时间离线后重新上线时触发（L3 智能关心）
  onProactiveGreeting: (callback) => {
    ipcRenderer.on('proactive:greeting', (_event, data) => callback(data))
  },
})
