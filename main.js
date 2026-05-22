// ===== main.js — Electron 主进程 =====
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const config = require('./src/config')
const llm = require('./src/llm')
const db = require('./src/db')

function getLogPath() {
  return path.join(__dirname, 'netpet-error.log')
}

function logError(err) {
  const msg = `[${new Date().toISOString()}] ${err.message}\n${err.stack || ''}\n`
  fs.appendFileSync(getLogPath(), msg, 'utf-8')
  console.error(msg)
}

let mainWindow = null
let settingsWindow = null
let scheduleInterval = null

// ---- 创建主窗口 ----
function createWindow() {
  const cfg = config.load()
  const ui = cfg.ui_settings || {}
  const winW = ui.window_width || 320
  const winH = ui.window_height || 650

  mainWindow = new BrowserWindow({
    width: winW,
    height: winH,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    }
  })

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'))

  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools()
  }

  mainWindow.on('closed', () => {
    mainWindow = null
    app.quit()
  })

  mainWindow.webContents.on('did-finish-load', () => {
    startScheduleChecker()
  })
}

// ---- 创建设置窗口 ----
function openSettings() {
  if (settingsWindow) {
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 560,
    height: 660,
    resizable: false,
    alwaysOnTop: true,
    parent: mainWindow,
    modal: true,
    title: 'NetPet 设置',
    webPreferences: {
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

// ===== 定时提醒检查 =====
function startScheduleChecker() {
  if (scheduleInterval) clearInterval(scheduleInterval)

  Promise.resolve(db.getDb ? db.getDb() : Promise.resolve()).then(() => {
    scheduleInterval = setInterval(() => {
      checkSchedules()
    }, 15000)
    checkSchedules()
  }).catch(err => {
    console.error('[Schedule] 数据库初始化失败，定时检查未启动:', err.message)
  })
}

function checkSchedules() {
  try {
    const now = new Date()
    const upcoming = db.getUpcomingSchedules()

    for (const sch of upcoming) {
      if (!sch.trigger_at) continue
      const triggerTime = new Date(sch.trigger_at)

      if (triggerTime <= now) {
        db.markScheduleFired(sch.id)

        // 调 LLM 生成角色语气的提醒
        // 中性提示词，不写特定称呼，让 LLM 根据自身设定决定语气
        const reminderContent = `[系统提醒: 时间已到 — 提醒用户：${sch.content || sch.label || '有一条提醒'}]`
        triggerScheduleReminder(sch, reminderContent)
      }
    }
  } catch (err) {
    console.error('[Schedule] 检查提醒失败:', err.message)
  }
}

/**
 * 定时提醒触发 — 调 LLM 生成角色语气的提醒消息
 * 成功后推给前端，失败时降级为硬文本
 */
function triggerScheduleReminder(sch, systemContent) {
  const cfg = config.load()

  llm.sendSystemMessage(cfg, systemContent)
    .then(result => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('schedule:triggered', {
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
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('schedule:triggered', {
          id: sch.id,
          label: sch.label || '提醒',
          reply: `⏰ 提醒: ${sch.content || sch.label}`,
          emotion: 'idle',
        })
      }
    })
}

// ===== IPC 处理器 =====
ipcMain.handle('config:get', () => config.load())
ipcMain.handle('config:save', (_e, newConfig) => config.save(newConfig))

ipcMain.handle('llm:send', async (_event, userText) => {
  const cfg = config.load()
  try {
    return await llm.sendMessage(cfg, userText)
  } catch (err) {
    logError(err)
    throw err
  }
})

ipcMain.handle('llm:models', async (_e, baseUrl, apiKey) => {
  return await llm.fetchModels(baseUrl, apiKey)
})

ipcMain.handle('settings:open', () => openSettings())

// 工具管理
ipcMain.handle('tools:list', async (_e, type) => {
  return db.getToolsByType(type, 'active')
})
ipcMain.handle('tools:all-active', async () => {
  return db.getAllActiveTools()
})
ipcMain.handle('tools:delete', async (_e, id) => {
  db.deleteTool(id)
  return { success: true }
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (scheduleInterval) clearInterval(scheduleInterval)
  if (settingsWindow) settingsWindow.close()
  app.quit()
})
