// ===== renderer.js — 宠物窗口前端逻辑 =====
//
// 这个文件在渲染进程（网页环境）中运行，可以访问浏览器 DOM API，
// 但不能直接访问 Node.js 或 Electron 的内部 API。
// 要通过 window.api（preload.js 暴露）和主进程通信。
//
// 浏览器 DOM API 速查：
//   document.getElementById(id)     — 按 ID 获取页面元素
//   element.textContent = '文本'     — 设置元素的纯文本内容
//   element.style.属性 = '值'        — 设置 CSS 样式
//   element.classList.add('类名')   — 添加 CSS 类
//   element.addEventListener(事件, fn) — 注册事件监听
//   element.src = '路径'             — 设置图片的源路径

// ===== 获取页面元素 =====
// document.getElementById() — 浏览器内置方法，通过 HTML 中元素的 id 属性找到它
// 如果找不到返回 null
const bubble = document.getElementById('bubble')
const petImage = document.getElementById('pet-image')
const petImageArea = document.getElementById('image-area')
const inputField = document.getElementById('input-field')
const topBar = document.getElementById('top-bar')

// 当前情绪状态（初始 idle）
let currentEmotion = 'idle'
// isLoading 是互斥锁：用户发送消息后设为 true，收到回复后才设为 false
// 防止用户在等待回复时连续按回车发多条消息
let isLoading = false

// ===== 启动时加载配置 =====
// 窗口尺寸由 CSS flex + 比例自适应，不再硬编码像素
let characterName = '七夜'

window.api.getConfig().then(config => {
  characterName = config.character_settings?.name || '七夜'
  showBubble(`只是一只${config.character_settings?.display_name || characterName}。`)
}).catch(() => {
  showBubble('配置加载失败，请点击 设置 API Key')
})

// ===== 发送消息 =====
// addEventListener('keydown', callback) — 键盘按下事件监听
// e.key 是按下的是哪个键（'Enter'、'a'、'Escape' 等）
inputField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    // .trim() — 去掉字符串首尾空白字符
    const text = inputField.value.trim()
    // 空文本或正在加载中，不处理
    if (!text || isLoading) return

    // 清空输入框，显示加载状态
    inputField.value = ''
    showBubble('...')
    isLoading = true

    // window.api.sendMessage(text) — 通过 IPC 发送消息给主进程
    // 返回 Promise：.then() 成功 / .catch() 失败 / .finally() 无论成败都执行
    window.api.sendMessage(text)
      .then(result => {
        // result = { reply: '回复文本', emotion: '情绪标签' }
        currentEmotion = result.emotion || 'idle'
        updateImage(currentEmotion)
        showBubble(result.reply)
      })
      .catch(err => {
        // 网络错误或 API 故障时显示错误信息
        showBubble(`故障:\n${err.message}`)
        currentEmotion = 'confused'
        updateImage('confused')
      })
      .finally(() => {
        // 不管成功还是失败，最后都要解锁
        isLoading = false
      })
  }
})

// ===== 更新立绘 =====
// emotion 是 LLM 返回的情绪标签，对应 assets/ 目录下的 PNG 图片
// idle → assets/idle.png, happy → assets/happy.png, ...
function updateImage(emotion) {
  const charUrl = window.api.getCharacterAssetUrl(characterName, emotion)
  const fallbackUrl = 'netpet://%E4%B8%83%E5%A4%9C/idle.png'
  const img = new Image()
  img.onload = () => { petImage.src = charUrl }
  img.onerror = () => { petImage.src = fallbackUrl }
  img.src = charUrl
  petImage.onerror = () => {
    petImage.alt = `【缺少素材: ${emotion}.png】`
  }
}

// ===== 显示聊天气泡 =====
// textContent — 设置元素的纯文本（不会被解析为 HTML，安全）
// classList.add('show') — 添加 CSS 类，类对应的样式控制气泡的显示/隐藏
function showBubble(text) {
  bubble.textContent = text
  bubble.classList.add('show')
}

// ===== 最小化按钮 =====
document.getElementById('min-btn').addEventListener('click', () => {
  window.api.minimizeWindow()
})

// ===== 关闭按钮 =====
// window.close() — 浏览器 API，关闭当前窗口（Electron 中等于关闭窗口）
document.getElementById('close-btn').addEventListener('click', () => {
  window.close()
})

// ===== 设置按钮 =====
// 通知主进程打开设置窗口
document.getElementById('settings-btn').addEventListener('click', () => {
  window.api.openSettings()
})

// ===== 定时提醒触发监听（主进程推送过来的） =====
// 当定时提醒到期时，主进程通过 IPC 推送 schedule:triggered 事件
// 提醒文本已经由 LLM 生成好了，直接显示即可
window.api.onScheduleTriggered((data) => {
  showBubble(data.reply)
  currentEmotion = data.emotion || 'idle'
  updateImage(currentEmotion)
})

// ===== 主动问候触发监听 =====
// 当用户长时间离线后重新打开时，主进程通过 IPC 推送 proactive:greeting
// data = { reply, emotion, gap } （LLM 生成的关心话语 + 间隔描述）
window.api.onProactiveGreeting((data) => {
  showBubble(data.reply)
  currentEmotion = data.emotion || 'idle'
  updateImage(currentEmotion)
})

// ===== Session 变更监听 =====
// 当用户在设置窗口切换角色、新开会话、恢复历史会话时触发
window.api.onSessionChanged((data) => {
  bubble.textContent = ''
  bubble.classList.remove('show')
  currentEmotion = 'idle'
  updateImage('idle')
  characterName = data.characterId || characterName
})
