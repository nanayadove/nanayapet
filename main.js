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

if (process.platform === 'win32') {
  require('child_process').execSync('chcp 65001', { stdio: 'ignore' })
  process.stdout.setDefaultEncoding('utf-8')
}

const { app, BrowserWindow, ipcMain, safeStorage, Tray, Menu, nativeImage, Notification, dialog, protocol } = require('electron')

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
const pngCard = require('./src/png-card')

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

// pushToUser(channel, data) — 始终发气泡到渲染进程；窗口隐藏时额外发系统通知
function pushToUser(channel, data) {
  // 始终发送 IPC，确保渲染进程收到消息（窗口恢复时能展示）
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data)
  }

  // 窗口不可见时，额外发系统通知弹窗
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible() && Notification.isSupported()) {
    const notif = new Notification({
      title: data.label || 'NetPet',
      body: data.reply || data.message || '',
      icon: path.join(__dirname, 'assets', 'idle.png'),
    })
    notif.on('click', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore()
        mainWindow.show()
        mainWindow.focus()
      }
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
  const winW = ui.window_width || 280
  const winH = ui.window_height || 480

  // new BrowserWindow({...}) — 创建一个 Electron 窗口
  // 参数对象配置窗口的各种属性
  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    frame: false,           // 无边框（没有标题栏、关闭按钮等系统装饰）
    transparent: true,      // 透明背景（让窗口可以是非矩形的）
    alwaysOnTop: true,      // 窗口始终置顶，不被其他窗口遮挡
    resizable: true,        // 可拉伸缩放（用户拖拽窗口边缘）
    minWidth: 240,          // 最小宽度
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
  // 宽高比 = window_width / window_height，默认 280/480 ≈ 0.583
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
ipcMain.handle('config:save', (_e, newConfig) => {
  config.save(newConfig)
  startScheduleChecker()
  startIdleChecker()
  return { success: true }
})

// config:has-encryption — 检查操作系统加密是否可用
ipcMain.handle('config:has-encryption', () => config.isEncryptionAvailable())

// llm:send — 用户发送消息给 LLM
// async 函数 + await 等待异步结果
ipcMain.handle('llm:send', async (_event, userText) => {
  lastInteractionTime = Date.now()
  resetIdleProbability()

  const cfg = config.load()
  try {
    const result = await llm.sendMessage(cfg, userText)
    return { reply: result.reply, emotion: result.emotion }
  } catch (err) {
    logError(err)
    return { reply: '呃...吾辈好像有点混乱喵', emotion: 'confused' }
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
// 角色管理 IPC
// ================================================================

function getCharacterDir() {
  return path.join(app.isPackaged ? process.resourcesPath : __dirname, 'characters')
}

ipcMain.handle('character:list', async () => {
  const cDir = getCharacterDir()
  if (!fs.existsSync(cDir)) return []
  return fs.readdirSync(cDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => {
      const charFile = path.join(cDir, d.name, 'character.json')
      if (fs.existsSync(charFile)) {
        try {
          const data = JSON.parse(fs.readFileSync(charFile, 'utf-8'))
          return { name: d.name, displayName: data.displayName || d.name }
        } catch { return null }
      }
      return null
    })
    .filter(Boolean)
})

ipcMain.handle('character:get-active', async () => {
  const cfg = config.load()
  const active = cfg.active_character || cfg.character_settings?.name || '七夜'
  const cDir = getCharacterDir()
  const charFile = path.join(cDir, active, 'character.json')
  if (fs.existsSync(charFile)) {
    return JSON.parse(fs.readFileSync(charFile, 'utf-8'))
  }
  return {
    name: active,
    displayName: active,
    system_prompt: cfg.character_settings?.system_prompt || '',
  }
})

ipcMain.handle('character:set-active', async (_e, charName) => {
  const cfg = config.load()
  cfg.active_character = charName
  config.save(cfg)
  return { success: true }
})

ipcMain.handle('character:save', async (_e, charName, charData) => {
  const cDir = getCharacterDir()
  const destDir = path.join(cDir, charName)
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
  const charFile = path.join(destDir, 'character.json')
  let existing = {}
  if (fs.existsSync(charFile)) {
    try { existing = JSON.parse(fs.readFileSync(charFile, 'utf-8')) } catch {}
  }
  const merged = { ...existing, ...charData }
  fs.writeFileSync(charFile, JSON.stringify(merged, null, 2), 'utf-8')
  return { success: true }
})

ipcMain.handle('character:import', async () => {
  const result = await dialog.showOpenDialog({
    title: '导入角色文件',
    filters: [
      { name: '角色文件', extensions: ['png', 'json'] },
    ],
    properties: ['openFile'],
  })
  if (result.canceled || result.filePaths.length === 0) return { success: false, reason: 'cancelled' }

  const srcPath = result.filePaths[0]
  const ext = path.extname(srcPath).toLowerCase()
  let charData
  let pngData = null

  if (ext === '.png') {
    try {
      const buf = fs.readFileSync(srcPath)
      charData = pngCard.extractCardJson(buf)
      if (!charData) return { success: false, reason: 'PNG 中未找到角色卡片数据（缺少 ccv3 字段）' }
      pngData = buf
    } catch (err) {
      return { success: false, reason: 'PNG 解析失败: ' + err.message }
    }
  } else {
    try {
      charData = JSON.parse(fs.readFileSync(srcPath, 'utf-8'))
    } catch {
      return { success: false, reason: '文件解析失败，请选择有效的角色文件' }
    }
  }

  if (!charData.name) return { success: false, reason: '角色文件缺少 name 字段' }

  const cDir = getCharacterDir()
  const destDir = path.join(cDir, charData.name)
  if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
  fs.writeFileSync(path.join(destDir, 'character.json'), JSON.stringify(charData, null, 2), 'utf-8')

  if (pngData) {
    fs.writeFileSync(path.join(destDir, 'idle.png'), pngData)
    for (const emotion of ['happy', 'angry', 'sad', 'shy', 'confused']) {
      const emotionSrc = path.join(path.dirname(srcPath), `${emotion}.png`)
      if (fs.existsSync(emotionSrc)) {
        fs.copyFileSync(emotionSrc, path.join(destDir, `${emotion}.png`))
      }
    }
  } else {
    const srcAssetsDir = path.join(path.dirname(srcPath))
    for (const emotion of ['idle', 'happy', 'angry', 'sad', 'shy', 'confused']) {
      const p = path.join(srcAssetsDir, `${emotion}.png`)
      if (fs.existsSync(p)) {
        fs.copyFileSync(p, path.join(destDir, `${emotion}.png`))
      }
    }
  }

  return { success: true, name: charData.name, displayName: charData.displayName || charData.name }
})

ipcMain.handle('character:export', async (_e, format) => {
  const cfg = config.load()
  const active = cfg.active_character || cfg.character_settings?.name || '七夜'
  const cDir = getCharacterDir()
  const charFile = path.join(cDir, active, 'character.json')
  let charData
  if (fs.existsSync(charFile)) {
    charData = JSON.parse(fs.readFileSync(charFile, 'utf-8'))
  } else {
    charData = {
      name: active,
      displayName: active,
      system_prompt: cfg.character_settings?.system_prompt || '',
    }
  }

  if (format === 'png') {
    const idlePath = path.join(cDir, active, 'idle.png')
    if (!fs.existsSync(idlePath)) return { success: false, reason: `角色 "${active}" 缺少 idle.png 立绘，无法导出 PNG 卡片` }

    const result = await dialog.showSaveDialog({
      title: '导出角色卡 PNG',
      defaultPath: `${active}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
    })
    if (result.canceled) return { success: false, reason: 'cancelled' }

    const pngBuf = fs.readFileSync(idlePath)
    const exportBuf = pngCard.embedCardJson(pngBuf, charData)
    fs.writeFileSync(result.filePath, exportBuf)
    return { success: true, path: result.filePath }
  }

  const result = await dialog.showSaveDialog({
    title: '导出角色 JSON',
    defaultPath: `${active}.json`,
    filters: [{ name: '角色文件', extensions: ['json'] }],
  })
  if (result.canceled) return { success: false, reason: 'cancelled' }

  fs.writeFileSync(result.filePath, JSON.stringify(charData, null, 2), 'utf-8')
  return { success: true, path: result.filePath }
})

// ================================================================
// Session 管理 IPC
// ================================================================

function notifyMainWindowSessionChanged(sessionId, action) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    const s = db.getSessionById(sessionId)
    mainWindow.webContents.send('session:changed', {
      action,
      sessionId,
      characterId: s?.character_id || '',
      title: s?.title || ''
    })
  }
}

ipcMain.handle('session:list', async () => {
  try {
    const sessions = db.getSessionList()
    return sessions.map(s => ({
      id: s.id,
      characterId: s.character_id,
      title: s.title,
      summary: s.summary,
      isActive: !!s.is_active,
      createdAt: s.created_at,
      lastActiveAt: s.last_active_at,
      messageCount: db.getSessionMessageCount(s.id)
    }))
  } catch (err) {
    console.error('[Session] 列表获取失败:', err.message)
    return []
  }
})

ipcMain.handle('session:create', async () => {
  try {
    const cfg = config.load()
    const charName = cfg.active_character || '七夜'
    const sessionId = db.createSession(charName, '新对话')
    notifyMainWindowSessionChanged(sessionId, 'created')
    console.log('[Session] 新建会话:', sessionId)
    return { success: true, sessionId }
  } catch (err) {
    console.error('[Session] 创建失败:', err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('session:create-for-character', async (_e, charName) => {
  try {
    const sessionId = db.createSession(charName, `${charName} 对话`)
    notifyMainWindowSessionChanged(sessionId, 'created')
    console.log('[Session] 为角色创建会话:', charName, sessionId)
    return { success: true, sessionId }
  } catch (err) {
    console.error('[Session] 为角色创建会话失败:', err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('session:switch', async (_e, sessionId) => {
  try {
    db.switchSession(sessionId)
    notifyMainWindowSessionChanged(sessionId, 'switched')
    console.log('[Session] 切换会话:', sessionId)
    return { success: true }
  } catch (err) {
    console.error('[Session] 切换失败:', err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('session:delete', async (_e, sessionId) => {
  try {
    db.deleteSession(sessionId)
    db.invalidateMessageCache(sessionId)
    console.log('[Session] 删除会话:', sessionId)
    return { success: true }
  } catch (err) {
    console.error('[Session] 删除失败:', err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('session:get-active', async () => {
  try {
    const s = db.getActiveSession()
    if (!s) return null
    return {
      id: s.id,
      characterId: s.character_id,
      title: s.title,
      summary: s.summary,
      messageCount: db.getSessionMessageCount(s.id)
    }
  } catch (err) {
    console.error('[Session] 获取活跃会话失败:', err.message)
    return null
  }
})

ipcMain.handle('session:get-messages', async (_e, sessionId) => {
  try {
    const sid = sessionId || (db.getActiveSession()?.id)
    if (!sid) return []
    return db.loadContextForLlm(sid, 200)
  } catch (err) {
    console.error('[Session] 获取消息失败:', err.message)
    return []
  }
})

// ================================================================
// 知识库管理 IPC
// ================================================================

ipcMain.handle('knowledge:list', async (_e, options) => {
  try {
    return db.queryKnowledgeBase(options || {})
  } catch (err) {
    console.error('[Knowledge] 查询失败:', err.message)
    return { items: [], total: 0, page: 1, pageSize: 20 }
  }
})

ipcMain.handle('knowledge:update', async (_e, id, fields) => {
  try {
    const ok = db.updateKnowledgeItem(id, fields)
    return { success: ok }
  } catch (err) {
    console.error('[Knowledge] 更新失败:', err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('knowledge:delete', async (_e, ids) => {
  try {
    const count = db.deleteKnowledgeItems(ids)
    return { success: true, deleted: count }
  } catch (err) {
    console.error('[Knowledge] 删除失败:', err.message)
    return { success: false, error: err.message }
  }
})

ipcMain.handle('knowledge:stats', async () => {
  try {
    return db.getKnowledgeStats()
  } catch (err) {
    console.error('[Knowledge] 统计失败:', err.message)
    return { user_profile: 0, taught: 0, web: 0, total: 0 }
  }
})

ipcMain.handle('knowledge:create', async (_e, item) => {
  try {
    const id = db.saveKnowledgeItem(item)
    return { success: true, id }
  } catch (err) {
    console.error('[Knowledge] 创建失败:', err.message)
    return { success: false, error: err.message }
  }
})

// ================================================================
// 导出 IPC
// ================================================================

ipcMain.handle('session:export', async (_e, sessionId, options) => {
  try {
    const { format, includeLore, includeProfile, includeWeb, includeChar } = options || {}
    const cfg = config.load()
    const charName = options?.charName || cfg.active_character || '七夜'

    let charData = null
    if (includeChar !== false) {
      const charFile = path.join(getCharacterDir(), charName, 'character.json')
      if (fs.existsSync(charFile)) {
        try { charData = JSON.parse(fs.readFileSync(charFile, 'utf-8')) } catch {}
      }
      if (!charData) {
        charData = { name: charName, displayName: charName, system_prompt: cfg.character_settings?.system_prompt || '' }
      }
    }

    let sessionData = null
    if (sessionId) {
      const s = db.getSessionById(sessionId)
      if (!s) return { success: false, reason: '会话不存在' }
      const msgs = db.loadContextForLlm(sessionId, 9999).filter(m => m.role === 'user' || m.role === 'assistant')
      sessionData = {
        id: s.id, title: s.title, character_id: s.character_id,
        summary: s.summary, created_at: s.created_at, last_active_at: s.last_active_at,
        message_count: msgs.length, messages: msgs
      }
    }

    const knowledge = {}
    if (includeLore) knowledge.lore = db.getAllKnowledgeByClassification('lore')
    if (includeProfile) knowledge.user_profile = db.getAllKnowledgeByClassification('user_profile')
    if (includeWeb) knowledge.web = db.getAllKnowledgeByClassification('web')

    const exportData = {
      format: 'netpet-session-v1',
      exported_at: new Date().toISOString(),
      character: charData,
      session: sessionData,
      knowledge: Object.keys(knowledge).length > 0 ? knowledge : undefined
    }

    const suffix = sessionId ? `_会话_${sessionId}` : '_角色卡'
    if (format === 'png') {
      const idlePath = path.join(getCharacterDir(), charName, 'idle.png')
      let pngBuf
      if (fs.existsSync(idlePath)) {
        pngBuf = fs.readFileSync(idlePath)
      } else {
        pngBuf = fs.readFileSync(path.join(getCharacterDir(), '七夜', 'idle.png'))
      }
      const exportBuf = pngCard.embedCardJson(pngBuf, exportData)

      const result = await dialog.showSaveDialog({
        title: '导出 PNG 角色卡',
        defaultPath: `${charName}${suffix}.png`,
        filters: [{ name: 'PNG 角色卡', extensions: ['png'] }]
      })
      if (result.canceled) return { success: false, reason: 'cancelled' }

      fs.writeFileSync(result.filePath, exportBuf)
      return { success: true, path: result.filePath }
    }

    const result = await dialog.showSaveDialog({
      title: '导出会话 (JSON)',
      defaultPath: `${charName}${suffix}.json`,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    })
    if (result.canceled) return { success: false, reason: 'cancelled' }

    fs.writeFileSync(result.filePath, JSON.stringify(exportData, null, 2), 'utf-8')
    return { success: true, path: result.filePath }
  } catch (err) {
    console.error('[Export] 导出失败:', err.message)
    return { success: false, reason: err.message }
  }
})

ipcMain.handle('knowledge:export', async (_e, options) => {
  try {
    const { includeLore, includeProfile, includeWeb } = options || {}
    const data = { exported_at: new Date().toISOString(), format: 'netpet-knowledge-v1' }
    if (includeLore) data.lore = db.getAllKnowledgeByClassification('lore')
    if (includeProfile) data.user_profile = db.getAllKnowledgeByClassification('user_profile')
    if (includeWeb) data.web = db.getAllKnowledgeByClassification('web')

    const result = await dialog.showSaveDialog({
      title: '导出知识库',
      defaultPath: `NetPet_知识库_${new Date().toISOString().slice(0, 10)}.json`,
      filters: [{ name: 'JSON 文件', extensions: ['json'] }]
    })
    if (result.canceled) return { success: false, reason: 'cancelled' }

    fs.writeFileSync(result.filePath, JSON.stringify(data, null, 2), 'utf-8')
    return { success: true, path: result.filePath }
  } catch (err) {
    console.error('[Export] 知识库导出失败:', err.message)
    return { success: false, reason: err.message }
  }
})

// ================================================================
// 应用启动
// ================================================================

// requestSingleInstanceLock() — 保证只运行一个实例
// Windows 系统通知需要设置 AppUserModelId，否则 Notification 无法弹出
app.setAppUserModelId('com.netpet.app')

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
    protocol.handle('netpet', async (request) => {
      const filePath = decodeURIComponent(request.url.slice('netpet://'.length))
      let fullPath = path.join(getCharacterDir(), filePath)
      if (!fs.existsSync(fullPath)) {
        fullPath = path.join(getCharacterDir(), '七夜', 'idle.png')
      }
      try {
        const data = await fs.promises.readFile(fullPath)
        const ext = path.extname(fullPath).toLowerCase()
        const mimeTypes = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }
        return new Response(data, { headers: { 'content-type': mimeTypes[ext] || 'application/octet-stream' } })
      } catch {
        return new Response('Not found', { status: 404 })
      }
    })

    if (config.needsMigration()) {
      try {
        config.migrate()
        console.log('[Config] 已迁移明文 API Key 到加密存储')
      } catch (err) {
        console.error('[Config] 迁移 API Key 失败:', err.message)
      }
    }

    db.getDb().then(() => {
      const session = db.getActiveSession()
      if (!session) {
        const cfg = config.load()
        const charName = cfg.active_character || '七夜'
        db.createSession(charName, '默认对话')
        console.log('[Session] 创建默认会话')
      }
    })

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
