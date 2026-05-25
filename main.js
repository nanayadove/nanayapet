// ===== main.js — Electron 主进程 =====
//
// Electron 应用有两个"进程"（独立的 JS 运行环境）：
//   1. 主进程 (Main Process) — 只有这一个，负责创建窗口、处理系统事件、调用 Node.js API
//   2. 渲染进程 (Renderer Process) — 每个窗口一个，负责展示 HTML/CSS/JS 页面
//   两者通过 IPC (进程间通信) 互相发消息，就像对讲机一样。
//
// 这个文件就是主进程。它做的事情：
//   1. 创建宠物窗口（透明、无边框、置顶）
//   2. 创建设置窗口（模态弹窗）
//   3. 监听渲染进程的请求（IPC handlers），处理 LLM 调用、配置读写
//   4. 定时检查提醒是否到期
//   5. 概率递增主动搭话（每 N 分钟检测，概率逐渐升高）
//
// 学习 Electron 的关键点：
//   app: 控制整个应用的生命周期（启动、退出）
//   BrowserWindow: 创建窗口的类
//   ipcMain: 主进程端的 IPC 接收器（接收渲染进程发来的消息）
//   safeStorage: 操作系统级加密 API（Windows DPAPI / macOS Keychain）

// require('electron') — 引入 Electron 框架
// 解构赋值 { app, BrowserWindow, ... } 同时取出多个导出项
// 等价于：
//   const electron = require('electron')
//   const app = electron.app
//   const BrowserWindow = electron.BrowserWindow
//   ...以此类推
const { app, BrowserWindow, ipcMain, safeStorage, Tray, Menu, nativeImage, Notification } = require('electron')

// require('path') — Node.js 内置模块，处理文件路径
// path.join() 把多个片段拼成合法路径，自动适配 Windows(`\`) / Linux(`/`)
// __dirname — Node.js 全局变量，当前文件所在目录的绝对路径
const path = require('path')

// require('fs') — Node.js 内置文件系统模块
// 用于读写文件、检查文件是否存在
const fs = require('fs')

// require('./src/config') — 引入项目自己的模块（相对路径 ./）
// 模块里用 module.exports 导出的函数/对象在这里获取
const config = require('./src/config')
const llm = require('./src/llm')
const db = require('./src/db')
const tools = require('./src/tools/index')

// config.init(safeStorage) — 把 Electron 的 safeStorage 实例传给 config 模块
// config 模块用它加密/解密 API Key，保证配置文件里不存明文
config.init(safeStorage)

// app.commandLine.appendSwitch() — 在 Electron 启动时注入 Chromium 命令行参数
// --disable-gpu-shader-disk-cache 禁用 GPU 着色器磁盘缓存
// 避免因文件权限问题导致的 "Unable to move the cache" 错误
app.commandLine.appendSwitch('disable-gpu-shader-disk-cache')

// ================================================================
// 工具函数
// ================================================================

// 获取错误日志文件路径
function getLogPath() {
  const dir = app.isPackaged ? process.resourcesPath : __dirname
  return path.join(dir, 'netpet-error.log')
}

// pushToUser(channel, data) — 窗口可见时发气泡，最小化时发系统通知
function pushToUser(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()) {
    mainWindow.webContents.send(channel, data)
  } else if (Notification.isSupported()) {
    const notif = new Notification({
      title: data.label || 'NetPet',
      body: data.reply || data.message || '',
      icon: path.join(__dirname, 'assets', 'idle.png'),
    })
    notif.show()
  }
}

// logError(err) — 记录错误到日志文件和控制台
// err.message: 错误简短描述
// err.stack: 错误堆栈（哪个文件第几行出错的调用链）
function logError(err) {
  // `${...}` — 模板字符串，可以嵌入变量和表达式
  // new Date().toISOString() 生成 ISO 8601 格式时间如 "2026-05-23T12:00:00.000Z"
  const msg = `[${new Date().toISOString()}] ${err.message}\n${err.stack || ''}\n`
  // fs.appendFileSync() — 追加内容到文件末尾，不覆盖已有内容
  fs.appendFileSync(getLogPath(), msg, 'utf-8')
  console.error(msg)
}

// 全局变量，保存窗口引用
let mainWindow = null       // 宠物主窗口
let settingsWindow = null   // 设置窗口
let tray = null             // 系统托盘图标
let scheduleInterval = null // 定时提醒的定时器 ID
let idleInterval = null     // 主动搭话检测定时器
let idleProbability = 0     // 当前触发概率（动态递增）
let lastInteractionTime = 0 // 最近一次用户交互时间戳（内存变量，搭话检测用）

// ================================================================
// 创建宠物主窗口
// ================================================================
function createWindow() {
  // config.load() — 读取 config.json 配置文件，返回 JS 对象
  const cfg = config.load()
  // 可选链操作符 ?. — 安全访问深层属性
  // cfg.ui_settings?.window_width 等价于：
  //   cfg.ui_settings && cfg.ui_settings.window_width
  // 如果 ui_settings 不存在就返回 undefined 而不报错
  const ui = cfg.ui_settings || {}
  const winW = ui.window_width || 200
  const winH = ui.window_height || 400

  // new BrowserWindow({...}) — 创建一个 Electron 窗口
  // 参数对象配置窗口的各种属性
  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    frame: false,           // 无边框（没有标题栏、关闭按钮等系统装饰）
    transparent: true,      // 透明背景（让窗口可以是非矩形的）
    alwaysOnTop: true,      // 窗口始终置顶，不被其他窗口遮挡
    resizable: true,        // 可拉伸缩放（用户拖拽窗口边缘）
    minWidth: 200,          // 最小宽度
    minHeight: 400,         // 最小高度
    skipTaskbar: true,      // 不在任务栏显示
    webPreferences: {       // 网页视图（渲染进程）的安全配置
      // preload: 预加载脚本，在页面 JS 之前执行
      // 用于把 Node.js 能力安全地暴露给页面
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,  // 隔离上下文（安全最佳实践：页面 JS 和 preload JS 各自有独立的全局对象）
      nodeIntegration: false,  // 禁止页面直接使用 Node.js API（安全考虑，必须为 false）
    }
  })

  // mainWindow.loadFile(路径) — 在窗口中加载 HTML 文件
  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'))

  // setAspectRatio(宽高比) — 限制窗口只能等比例缩放，拖拽任一边缘自动保持比例
  // 宽高比 = window_width / window_height，默认 320/650 ≈ 0.492
  mainWindow.setAspectRatio(winW / winH)

  // process.argv — Node.js 的命令行参数数组
  // 如果用 npm run dev 启动，会传入 --dev 参数，此时打开 DevTools
  if (process.argv.includes('--dev')) {
    // mainWindow.webContents — 窗口内的网页内容对象
    // .openDevTools() 打开 Chrome 开发者工具（调试用）
    mainWindow.webContents.openDevTools()
  }

  // mainWindow.on('closed', callback) — 监听窗口关闭事件
  mainWindow.on('closed', () => {
    // 保存当前窗口尺寸到 config，下次启动恢复
    try {
      if (!mainWindow.isDestroyed()) {
        const [w, h] = mainWindow.getSize()
        const cfg = config.load()
        cfg.ui_settings = cfg.ui_settings || {}
        cfg.ui_settings.window_width = w
        cfg.ui_settings.window_height = h
        config.save(cfg)
      }
    } catch (err) {
      console.error('[main] 保存窗口尺寸失败:', err.message)
    }
    mainWindow = null
    // app.quit() — 退出整个 Electron 应用
    app.quit()
  })

  createTray()

  // mainWindow.webContents.on('did-finish-load', callback) — 页面加载完成时触发
  mainWindow.webContents.on('did-finish-load', () => {
    startScheduleChecker()
    checkActivityGap()
    startIdleChecker()
  })
}

// ================================================================
// 创建设置窗口
// ================================================================
function openSettings() {
  // 如果设置窗口已存在，直接聚焦（不重复创建）
  if (settingsWindow) {
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 560,
    height: 700,
    resizable: false,
    alwaysOnTop: true,
    parent: mainWindow,   // 父窗口：设置窗口是宠物窗口的子窗口
    modal: true,          // 模态：打开时阻塞父窗口操作
    title: 'NetPet 设置',
    webPreferences: {
      // 设置窗口有自己的 preload 脚本
      preload: path.join(__dirname, 'src', 'settings-preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  settingsWindow.loadFile(path.join(__dirname, 'src', 'settings.html'))

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

// ================================================================
// 定时提醒检查
// ================================================================
function startScheduleChecker() {
  // clearInterval(id) — 清除已有的定时器，防止重复创建
  if (scheduleInterval) clearInterval(scheduleInterval)

  // Promise.resolve() — 把值包装成 Promise（一个未来的值）
  // db.getDb 可能是同步函数，Promise.resolve 确保不管它是什么都当异步处理
  // .then(callback) — 等 Promise 完成（resolve）后执行回调
  Promise.resolve(db.getDb ? db.getDb() : null).then(() => {
    // setInterval(callback, 毫秒) — 每隔指定毫秒重复执行回调
    // 这里每 15 秒检查一次是否有到期的提醒
    scheduleInterval = setInterval(() => {
      checkSchedules()
    }, 15000)
    // 启动时立即检查一次
    checkSchedules()
  }).catch(err => {
    console.error('[Schedule] 数据库初始化失败，定时检查未启动:', err.message)
  })
}

function checkSchedules() {
  try {
    // new Date() — 创建当前时间的 Date 对象
    const now = new Date()
    const upcoming = db.getUpcomingSchedules()

    // for...of 循环遍历数组
    for (const sch of upcoming) {
      if (!sch.trigger_at) continue  // 跳过没有触发时间的记录
      const triggerTime = new Date(sch.trigger_at)

      // 如果触发时间 ≤ 当前时间，说明过期了，触发提醒
      if (triggerTime <= now) {
        // 标记为已触发（完成状态）
        db.markScheduleFired(sch.id)

        const reminderContent = `[系统提醒: 时间已到 — 提醒用户：${sch.content || sch.label || '有一条提醒'}]`
        triggerScheduleReminder(sch, reminderContent)
      }
    }
  } catch (err) {
    console.error('[Schedule] 检查提醒失败:', err.message)
  }
}

// triggerScheduleReminder(提醒对象, 系统消息) — 触发 LLM 提醒并推送给前端
function triggerScheduleReminder(sch, systemContent) {
  const cfg = config.load()

  // llm.sendSystemMessage() 返回 Promise
  // .then() 处理成功情况
  // .catch() 处理失败情况
  llm.sendSystemMessage(cfg, systemContent)
    .then(result => {
      // mainWindow 可能已被关闭（isDestroyed() 检查）
      if (mainWindow && !mainWindow.isDestroyed()) {
        pushToUser('schedule:triggered', {
          id: sch.id,
          label: sch.label || '提醒',
          reply: result.reply,
          emotion: result.emotion || 'idle',
        })
      }
      console.log(`[Schedule] 提醒已通过 LLM 发送: ${sch.label}`)
    })
    .catch(err => {
      logError(err)
      pushToUser('schedule:triggered', {
        id: sch.id,
        label: sch.label || '提醒',
        reply: `提醒: ${sch.content || sch.label}`,
        emotion: 'idle',
      })
    })
}

// ================================================================
// 系统托盘
// ================================================================

function createTray() {
  if (tray) return

  const iconPath = path.join(__dirname, 'assets', 'idle.png')
  const iconData = fs.readFileSync(iconPath)
  const trayIcon = nativeImage.createFromBuffer(iconData).resize({ width: 16, height: 16 })
  tray = new Tray(trayIcon)
  tray.setToolTip('NetPet')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示/隐藏桌宠',
      click: () => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          if (mainWindow.isVisible()) {
            mainWindow.hide()
          } else {
            mainWindow.show()
            mainWindow.focus()
          }
        }
      }
    },
    {
      label: '设置',
      click: () => openSettings()
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        tray = null
        app.quit()
      }
    }
  ])

  tray.setContextMenu(contextMenu)
  tray.on('click', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isVisible()) {
        mainWindow.hide()
      } else {
        mainWindow.show()
        mainWindow.focus()
      }
    }
  })
}

// ================================================================
// IPC 处理器（主进程端）
// ================================================================
// ipcMain.handle(频道名, callback) — 注册一个 IPC 请求-响应处理器
// 渲染进程用 ipcRenderer.invoke(频道名, 参数) 发起请求
// 主进程的 callback 处理请求并返回结果
// 这是异步的，渲染进程 await invoke() 拿到返回值

// ================================================================
// 主动搭话：启动时离线间隔检测
// ================================================================

// checkActivityGap() — 检查距上次下线的间隔
// 如果超过配置的阈值，生成问候
function checkActivityGap() {
  const cfg = config.load()
  const proactive = cfg.proactive_settings || {}
  if (!proactive.enabled) return

  const lastOffline = db.getLastOfflineRecord()
  if (!lastOffline) return

  const match = lastOffline.content.match(/\[系统记录: 下线\] (.+)/)
  if (!match) return

  const offlineTime = new Date(match[1])
  if (isNaN(offlineTime.getTime())) return

  const now = new Date()
  const gapMs = now.getTime() - offlineTime.getTime()
  const gapHours = gapMs / (1000 * 60 * 60)
  const threshold = proactive.gap_hours || 6

  if (gapHours < threshold) return

  let gapDesc = ''
  if (gapHours < 1) {
    gapDesc = `${Math.round(gapMs / (1000 * 60))}分钟`
  } else if (gapHours < 24) {
    gapDesc = `${Math.round(gapHours)}小时`
  } else {
    gapDesc = `${Math.round(gapHours / 24)}天`
  }

  const systemContent = `[系统通知] 用户重新上线了。距上次下线已经过去了约${gapDesc}。
请根据你的角色设定，主动问候用户。可以表达关心，猜测用户这段时间可能在忙什么。
保持1-2句话的长度，不要太长。`

  llm.sendSystemMessage(cfg, systemContent)
    .then(result => {
      pushToUser('proactive:greeting', {
        reply: result.reply,
        emotion: result.emotion || 'idle',
        gap: gapDesc,
      })
    })
    .catch(err => {
      console.error('[Activity] 问候生成失败:', err.message)
    })
}

// ================================================================
// 主动搭话：运行时闲置检测（概率递增）
// ================================================================

function startIdleChecker() {
  if (idleInterval) clearInterval(idleInterval)

  const cfg = config.load()
  const proactive = cfg.proactive_settings || {}
  if (!proactive.enabled) return

  const intervalMin = proactive.idle_interval_minutes || 10
  const intervalMs = intervalMin * 60 * 1000

  // 初始概率 = 基础值（0~1 之间的小数）
  idleProbability = proactive.idle_base_probability ?? 0.15
  // 初始交互时间 = 当前时间（窗口刚加载，视为刚交互过）
  lastInteractionTime = Date.now()

  idleInterval = setInterval(() => {
    checkIdleGreeting()
  }, intervalMs)
}

function checkIdleGreeting() {
  const cfg = config.load()
  const proactive = cfg.proactive_settings || {}
  if (!proactive.enabled) return

  // 判断用户最近是否活跃：上次发言距现在 < 检测间隔 ?
  const elapsedMs = Date.now() - lastInteractionTime
  const intervalMs = (proactive.idle_interval_minutes || 10) * 60 * 1000
  if (elapsedMs < intervalMs) return

  // 掷骰子：Math.random() 返回 0~1 的随机数
  const roll = Math.random()
  if (roll >= idleProbability) {
    // 未触发 → 概率递增
    if (proactive.idle_escalation_enabled) {
      const increment = proactive.idle_escalation_increment ?? 0.10
      idleProbability = Math.min(idleProbability + increment, 0.95)
    }
    return
  }

  // 触发 → 重置概率，更新交互时间防止连续搭话
  const baseProb = proactive.idle_base_probability ?? 0.15
  idleProbability = baseProb
  lastInteractionTime = Date.now()

  const systemContent = `[系统通知] 用户已经一段时间没有理你了。
请根据你的角色设定，对其发起询问吧。可以问ta在做什么、关心一下、或者吐槽ta冷落了你。
保持1-2句话，不要太长。`

  llm.sendSystemMessage(cfg, systemContent)
    .then(result => {
      pushToUser('proactive:greeting', {
        reply: result.reply,
        emotion: result.emotion || 'idle',
      })
    })
    .catch(err => {
      console.error('[Idle] 搭话生成失败:', err.message)
    })
}

function resetIdleProbability() {
  const cfg = config.load()
  const proactive = cfg.proactive_settings || {}
  idleProbability = proactive.idle_base_probability ?? 0.15
}

// ================================================================
// IPC 处理器
// ================================================================

// config:get — 读取配置
ipcMain.handle('config:get', () => config.load())

// config:save — 保存配置
// _e 是事件对象（下划线前缀表示未使用的参数）
ipcMain.handle('config:save', (_e, newConfig) => config.save(newConfig))

// config:has-encryption — 检查操作系统加密是否可用
ipcMain.handle('config:has-encryption', () => config.isEncryptionAvailable())

// llm:send — 用户发送消息给 LLM
// async 函数 + await 等待异步结果
ipcMain.handle('llm:send', async (_event, userText) => {
  lastInteractionTime = Date.now()
  resetIdleProbability()

  const pendingSearch = llm.getPendingSearch()
  if (pendingSearch) {
    const text = userText.trim()
    const confirmKeywords = ['好', '查', '搜', '可以', 'yes', 'ok', 'sure', '行', '嗯', '对', '要', '搜一下', '查一下']
    const confirmed = confirmKeywords.some(k => text.includes(k))
    if (confirmed) {
      llm.clearPendingSearch()
      const cfg = config.load()
      try {
        const searchResult = await tools.executeTool('web_search', { query: pendingSearch.topic }, cfg)
        db.saveKnowledge(pendingSearch.topic, searchResult.result, 'web', '')
        db.saveMessage('user', userText)
        db.saveMessage('assistant', searchResult.result)
        return { reply: `已搜索关于「${pendingSearch.topic}」的信息：\n\n${searchResult.result}`, emotion: 'happy' }
      } catch (err) {
        logError(err)
        return { reply: `搜索失败: ${err.message}`, emotion: 'confused' }
      }
    }
    llm.clearPendingSearch()
  }

  const cfg = config.load()
  try {
    const result = await llm.sendMessage(cfg, userText)

    if (result.need_search && result.search_topic) {
      llm.setPendingSearch(result.search_topic)
    }

    return { reply: result.reply, emotion: result.emotion }
  } catch (err) {
    logError(err)
    throw err
  }
})

// llm:models — 获取服务商的模型列表
ipcMain.handle('llm:models', async (_e, baseUrl, apiKey) => {
  return await llm.fetchModels(baseUrl, apiKey)
})

// settings:open — 打开设置窗口
ipcMain.handle('settings:open', () => openSettings())

// window:minimize — 隐藏宠物窗口（到托盘）
ipcMain.handle('window:minimize', () => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.hide()
})

// 工具管理 IPC
// 这些 = async () => 是箭头函数简写，等价于 async function() { return ... }
ipcMain.handle('tools:list', async (_e, type) => {
  return db.getToolsByType(type, 'active')
})
ipcMain.handle('tools:all-active', async () => {
  return db.getAllActiveTools()
})
ipcMain.handle('tools:delete', async (_e, id) => {
  db.deleteTool(id)
  return { success: true }  // 返回对象告知删除成功
})

// ================================================================
// 应用启动
// ================================================================

// requestSingleInstanceLock() — 保证只运行一个实例
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    // 用户尝试启动第二个实例 → 激活已有窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  })

  // app.whenReady() — 返回 Promise，当 Electron 完成初始化时 resolve
  app.whenReady().then(() => {
    // 检查是否需要把明文 API Key 迁移到加密存储
    if (config.needsMigration()) {
      try {
        config.migrate()
        console.log('[Config] 已迁移明文 API Key 到加密存储')
      } catch (err) {
        console.error('[Config] 迁移 API Key 失败:', err.message)
      }
    }
    createWindow()
  })

  app.on('window-all-closed', () => {
    try { db.saveOfflineRecord() } catch {}
    if (scheduleInterval) clearInterval(scheduleInterval)
    if (idleInterval) clearInterval(idleInterval)
    if (settingsWindow) settingsWindow.close()
    app.quit()
  })

  app.on('before-quit', () => {
    if (tray) { tray.destroy(); tray = null }
  })
}
