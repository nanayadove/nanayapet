// ===== renderer.js — 一体式桌面应用（可折叠抽屉） =====

const petImage = document.getElementById('pet-image')
const emotionLabel = document.getElementById('emotion-label')
const messageList = document.getElementById('message-list')
const drawerInput = document.getElementById('drawer-input')
const sendBtn = document.getElementById('send-btn')
const terminalPanel = document.getElementById('terminal-panel')
const terminalOutput = document.getElementById('terminal-output')
const modeTabs = document.querySelectorAll('.mode-tab')
const titlebarName = document.getElementById('titlebar-name')
const collapseBtn = document.getElementById('collapse-btn')
const expandBtn = document.getElementById('expand-btn')

let currentEmotion = 'idle'
let isLoading = false
let characterName = '七夜'
let currentMode = 'chat'

window.api.getConfig().then(config => {
  characterName = config.character_settings?.name || '七夜'
  const displayName = config.character_settings?.display_name || characterName
  titlebarName.textContent = displayName
  addSystemMessage(`只是一只${displayName}。`)
  const ui = config.ui_settings || {}
  applyTheme(ui.theme_bg || ui.theme_color || '#1a1a24', ui.theme_accent || ui.theme_color || '#5a6ac0')
}).catch(() => {
  addSystemMessage('配置加载失败，请点击设置 API Key')
})

// ================================================================
// 抽屉展开/收起
// ================================================================

let savedWorkspaceWidth = 480

function expandWorkspace() {
  document.body.classList.remove('collapsed')
  collapseBtn.textContent = '◀'
  collapseBtn.title = '收起面板'
  window.api.resizeWindow(240 + savedWorkspaceWidth, null)
}

function collapseWorkspace() {
  const w = document.body.offsetWidth
  savedWorkspaceWidth = Math.max(w - 240, 280)
  document.body.classList.add('collapsed')
  collapseBtn.textContent = '▶'
  collapseBtn.title = '展开面板'
  window.api.resizeWindow(240, null)
}

function toggleWorkspace() {
  if (document.body.classList.contains('collapsed')) {
    expandWorkspace()
  } else {
    collapseWorkspace()
  }
}

collapseBtn.addEventListener('click', toggleWorkspace)
if (expandBtn) expandBtn.addEventListener('click', expandWorkspace)

// ================================================================
// 模式切换
// ================================================================

modeTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    modeTabs.forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    currentMode = tab.dataset.mode
    if (currentMode === 'work') {
      terminalPanel.classList.remove('hidden')
    } else {
      terminalPanel.classList.add('hidden')
    }
  })
})

// ================================================================
// 发送消息
// ================================================================

function sendMessage() {
  const text = drawerInput.value.trim()
  if (!text || isLoading) return

  drawerInput.value = ''
  addUserMessage(text)
  addSystemMessage('...')
  setSending(true)

  window.api.sendMessage(text)
    .then(result => {
      removePendingDots()
      currentEmotion = result.emotion || 'idle'
      updateImage(currentEmotion)
      addAssistantMessage(result.reply)
    })
    .catch(err => {
      removePendingDots()
      addSystemMessage(`故障: ${err.message}`)
      currentEmotion = 'confused'
      updateImage('confused')
    })
    .finally(() => {
      setSending(false)
    })
}

function removePendingDots() {
  const last = messageList.lastElementChild
  if (last && last.classList.contains('system') && last.textContent === '...') {
    last.remove()
  }
}

drawerInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendMessage()
})

sendBtn.addEventListener('click', sendMessage)

function setSending(loading) {
  isLoading = loading
  sendBtn.disabled = loading
  drawerInput.disabled = loading
}

// ================================================================
// 消息列表
// ================================================================

function addUserMessage(text) {
  const el = document.createElement('div')
  el.className = 'message user'
  el.innerHTML = `${escapeHtml(text)}<span class="msg-time">${formatTime(new Date())}</span>`
  messageList.appendChild(el)
  scrollToBottom()
}

function addAssistantMessage(text) {
  const el = document.createElement('div')
  el.className = 'message assistant'
  el.innerHTML = `${escapeHtml(text)}<span class="msg-time">${formatTime(new Date())}</span>`
  messageList.appendChild(el)
  scrollToBottom()
}

function addSystemMessage(text) {
  const el = document.createElement('div')
  el.className = 'message system'
  el.textContent = text
  messageList.appendChild(el)
  scrollToBottom()
}

function scrollToBottom() {
  messageList.scrollTop = messageList.scrollHeight
}

// ================================================================
// 终端输出
// ================================================================

function setTerminalOutput(text) {
  terminalOutput.textContent = text
  terminalPanel.classList.remove('hidden')
}

function clearTerminal() {
  terminalOutput.textContent = ''
}

document.getElementById('terminal-copy-btn').addEventListener('click', () => {
  navigator.clipboard.writeText(terminalOutput.textContent).catch(() => {})
})

document.getElementById('terminal-expand-btn').addEventListener('click', () => {
  const isMax = terminalPanel.style.maxHeight === '60vh'
  terminalPanel.style.maxHeight = isMax ? '200px' : '60vh'
})

// ================================================================
// 立绘更新
// ================================================================

function updateImage(emotion) {
  const charUrl = window.api.getCharacterAssetUrl(characterName, emotion)
  const fallbackUrl = 'netpet://%E4%B8%83%E5%A4%9C/idle.png'
  petImage.style.opacity = '0.5'
  const img = new Image()
  img.onload = () => {
    petImage.src = charUrl
    petImage.style.opacity = '1'
  }
  img.onerror = () => {
    petImage.src = fallbackUrl
    petImage.style.opacity = '1'
  }
  img.src = charUrl
  petImage.onerror = () => {
    petImage.alt = `【缺少素材: ${emotion}.png】`
  }
  emotionLabel.textContent = emotion
}

// ================================================================
// 标题栏按钮
// ================================================================

document.getElementById('settings-btn').addEventListener('click', () => {
  window.api.openSettings()
})

document.getElementById('min-btn').addEventListener('click', () => {
  window.api.minimizeWindow()
})

document.getElementById('close-btn').addEventListener('click', () => {
  window.close()
})

// ================================================================
// 主进程推送监听
// ================================================================

window.api.onScheduleTriggered((data) => {
  currentEmotion = data.emotion || 'idle'
  updateImage(currentEmotion)
  addAssistantMessage(data.reply)
})

window.api.onProactiveGreeting((data) => {
  currentEmotion = data.emotion || 'idle'
  updateImage(currentEmotion)
  addAssistantMessage(data.reply)
})

window.api.onSessionChanged((data) => {
  messageList.innerHTML = ''
  currentEmotion = 'idle'
  updateImage('idle')
  characterName = data.characterId || characterName
  titlebarName.textContent = characterName
  addSystemMessage(`已切换到 ${characterName}`)
})

// ================================================================
// 主题实时推送（设置窗口修改时）
// ================================================================

window.api.onThemeApply((data) => {
  applyTheme(data.bg, data.accent)
})

// ================================================================
// 工具函数
// ================================================================

function escapeHtml(text) {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

function formatTime(date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
}

function applyTheme(bgHex, accentHex) {
  const root = document.documentElement

  const pc = (hex, start) => parseInt(hex.slice(start, start + 2), 16) / 255
  const rr = pc(bgHex, 1), gg = pc(bgHex, 3), bb = pc(bgHex, 5)
  const max = Math.max(rr, gg, bb), min = Math.min(rr, gg, bb)
  let h = 0, s = 0, l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0)
      : max === gg ? (bb - rr) / d + 2
      : (rr - gg) / d + 4
    h /= 6
  }
  const isDark = l < 0.25
  const hs = (dl) => `hsl(${Math.round(h * 360)}, ${Math.round(s * 100)}%, ${Math.round(Math.max(0, Math.min(100, (l + dl) * 100)))}%)`

  root.style.setProperty('--bg', bgHex)
  root.style.setProperty('--bg-titlebar', hs(-0.04))
  root.style.setProperty('--bg-sidebar', hs(0.02))
  root.style.setProperty('--bg-workspace', hs(0.04))
  root.style.setProperty('--bg-input-area', hs(0))
  root.style.setProperty('--bg-input-field', hs(-0.04))
  root.style.setProperty('--bg-terminal', hs(-0.06))
  root.style.setProperty('--bg-bubble-assistant', hs(0.05))
  root.style.setProperty('--bg-hover', hs(0.05))
  root.style.setProperty('--bg-hover2', hs(0.08))
  root.style.setProperty('--text', isDark ? '#ddd' : '#222')
  root.style.setProperty('--text-dim', isDark ? '#888' : '#666')
  root.style.setProperty('--text-muted', isDark ? '#555' : '#999')
  root.style.setProperty('--text-bright', isDark ? '#a0a0b8' : '#555')
  root.style.setProperty('--text-user-bubble', isDark ? '#e0e8ff' : '#fff')
  root.style.setProperty('--text-time', isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)')
  root.style.setProperty('--border', hs(isDark ? 0.08 : -0.08))
  root.style.setProperty('--border-terminal', hs(isDark ? 0.1 : -0.1))
  root.style.setProperty('--expand-btn-bg', hs(0.08))
  root.style.setProperty('--expand-btn-text', isDark ? '#888' : '#666')

  const ar = pc(accentHex, 1), ag = pc(accentHex, 3), ab = pc(accentHex, 5)
  const cl = (v) => Math.min(255, Math.max(0, Math.round(v)))
  root.style.setProperty('--accent', accentHex)
  root.style.setProperty('--accent-light', `rgb(${cl(ar*255+90)}, ${cl(ag*255+80)}, ${cl(ab*255+70)})`)
  root.style.setProperty('--accent-bg', `rgba(${cl(ar*255)}, ${cl(ag*255)}, ${cl(ab*255)}, 0.6)`)
  root.style.setProperty('--accent-hover', `rgba(${cl(ar*255)}, ${cl(ag*255)}, ${cl(ab*255)}, 0.75)`)
  root.style.setProperty('--accent-focus', `rgba(${cl(ar*255)}, ${cl(ag*255)}, ${cl(ab*255)}, 0.5)`)
}
