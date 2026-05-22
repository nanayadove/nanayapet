// ===== 页面元素 =====
// document.getElementById 是浏览器提供的 API，通过 HTML 元素的 id 找到它
const bubble = document.getElementById('bubble')
const petImage = document.getElementById('pet-image')
const petImageArea = document.getElementById('image-area')
const inputField = document.getElementById('input-field')
const topBar = document.getElementById('top-bar')

let currentEmotion = 'idle'
let isLoading = false  // 锁：防止用户在等待回复时连续按回车

// ===== 启动时加载配置 =====
// window.api.getConfig() 是通过 preload.js 暴露出来的函数
// 它在幕后通过 Electron 的 IPC 机制，通知主进程读取 config.json
// .then(config => { ... }) 是 Promise 的写法：等 getConfig() 返回结果后再执行
window.api.getConfig().then(config => {
  // 从配置读取 UI 尺寸
  const ui = config.ui_settings || {}
  const imgW = ui.image_width || 300
  const imgH = ui.image_height || 440

  // 把配置里的尺寸应用到页面元素上
  // style.width 和 style.height 是 DOM 元素的 CSS 属性
  // 加 'px' 是因为 CSS 尺寸必须带单位
  petImageArea.style.width = imgW + 'px'
  petImageArea.style.height = imgH + 'px'
  bubble.style.width = imgW + 'px'
  inputField.style.width = imgW + 'px'
  topBar.style.width = imgW + 'px'

  const name = config.character_settings?.name || '七夜喵'
  showBubble(`只是一只${name}。`)
}).catch(() => {
  // .catch() 是 Promise 的"失败处理"分支
  // getConfig() 失败时（比如配置文件损坏）执行这里
  showBubble('配置加载失败，请点击 ⚙️ 设置 API Key')
})

// ===== 发送消息 =====
// addEventListener('keydown', callback) 是浏览器标准事件监听
// 当用户按下键盘键时触发，e.key 告诉你按的是哪个键
inputField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {            // 侦测到回车键
    const text = inputField.value.trim()  // 拿到用户输入的文本，trim() 去掉首尾空格
    if (!text || isLoading) return     // 空文本或正在加载就不处理

    inputField.value = ''              // 清空输入框
    showBubble('...')                  // 显示"..."告诉用户正在处理
    isLoading = true                   // 上锁，防止重复发送

    // ⭐ window.api.sendMessage(text) 是调用 preload.js 暴露的函数
    // 它背后走的是 Electron IPC 通道，把 text 传给 main.js
    // 然后 main.js 调用 llm.sendMessage()，最终调 LLM API
    // 整个过程是异步的——sendMessage 立即返回一个 Promise
    // Promise 有三种状态：pending（进行中）、fulfilled（成功）、rejected（失败）
    // .then() 处理成功，.catch() 处理失败，.finally() 不管成败最后都执行
    window.api.sendMessage(text)
      .then(result => {
        // result 就是 LLM 返回的对象：{ reply: "回复文本", emotion: "情绪标签" }
        currentEmotion = result.emotion || 'idle'
        updateImage(currentEmotion)
        showBubble(result.reply)
      })
      .catch(err => {
        showBubble(`故障:\n${err.message}`)
        currentEmotion = 'confused'
        updateImage('confused')
      })
      .finally(() => {
        isLoading = false  // 解锁，允许用户发下一条消息
      })
  }
})

// ===== 更新立绘 =====
// emotion 参数是 LLM 返回的情绪标签：idle/happy/angry/sad/shy/confused
// 对应 assets/ 目录下的 idle.png / happy.png / angry.png / sad.png / shy.png / confused.png
function updateImage(emotion) {
  petImage.src = `../assets/${emotion}.png`
  petImage.onerror = () => {
    // 图片加载失败时的兜底：显示文字提示
    petImage.alt = `【缺少素材: ${emotion}.png】`
  }
}

// ===== 显示气泡 =====
// textContent 是 DOM 元素的纯文本内容（不解析 HTML）
// classList.add('show') 给元素加上 CSS 类名，类名对应的样式控制它是否可见
function showBubble(text) {
  bubble.textContent = text
  bubble.classList.add('show')
}

// ===== 关闭按钮 =====
document.getElementById('close-btn').addEventListener('click', () => {
  window.close()  // 浏览器内置 API：关闭当前窗口
})

// ===== 设置按钮 =====
document.getElementById('settings-btn').addEventListener('click', () => {
  window.api.openSettings()  // 通知主进程打开设置窗口
})

// ===== 定时提醒触发（主进程主动推过来的） =====
// 提醒文本已经是 LLM 生成的，用角色的语气说出来的
// 不需要再加 ⏰ 前缀，直接显示即可
window.api.onScheduleTriggered((data) => {
  showBubble(data.reply)
  currentEmotion = data.emotion || 'idle'
  updateImage(currentEmotion)
})
