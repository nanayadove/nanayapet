const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')
const config = require('./src/config')
const llm = require('./src/llm')

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

function createWindow() {
  // 从配置读取窗口尺寸
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

  // 主窗口关闭时退出应用
  mainWindow.on('closed', () => {
    mainWindow = null
    app.quit()
  })
}

function openSettings() {
  if (settingsWindow) {
    settingsWindow.focus()
    return
  }

  settingsWindow = new BrowserWindow({
    width: 520,
    height: 600,
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

  // 设置窗口关闭时清空引用
  settingsWindow.on('closed', () => {
    settingsWindow = null
  })
}

// ===== IPC 处理器 =====
ipcMain.handle('config:get', () => config.load())
ipcMain.handle('config:save', (_e, newConfig) => config.save(newConfig))
// 发消息给 LLM
ipcMain.handle('llm:send', async (_event, userText) => {
  const cfg = config.load()
  try {
    return await llm.sendMessage(cfg, userText)
  } catch (err) {
    logError(err)
    throw err  // 依然把错误传给前台气泡
  }
})
ipcMain.handle('llm:models', async (_e, baseUrl, apiKey) => {
  return await llm.fetchModels(baseUrl, apiKey)
})
ipcMain.handle('settings:open', () => openSettings())

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (settingsWindow) settingsWindow.close()
  app.quit()
})
