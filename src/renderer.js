// ===== 页面元素 =====
const bubble = document.getElementById('bubble')
const petImage = document.getElementById('pet-image')
const petImageArea = document.getElementById('image-area')
const inputField = document.getElementById('input-field')
const topBar = document.getElementById('top-bar')

let currentEmotion = 'idle'
let isLoading = false

// ===== 启动时加载配置 =====
window.api.getConfig().then(config => {
  // 从配置读取 UI 尺寸
  const ui = config.ui_settings || {}
  const imgW = ui.image_width || 300
  const imgH = ui.image_height || 440

  // 应用到所有元素（宽度统一 = 图片宽度）
  petImageArea.style.width = imgW + 'px'
  petImageArea.style.height = imgH + 'px'
  bubble.style.width = imgW + 'px'
  inputField.style.width = imgW + 'px'
  topBar.style.width = imgW + 'px'

  const name = config.character_settings?.name || '七夜喵'
  showBubble(`只是一只${name}。`)
}).catch(() => {
  showBubble('配置加载失败，请点击 ⚙️ 设置 API Key')
})

// ===== 发送消息 =====
inputField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = inputField.value.trim()
    if (!text || isLoading) return

    inputField.value = ''
    showBubble('...')
    isLoading = true

    window.api.sendMessage(text)
      .then(result => {
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
        isLoading = false
      })
  }
})

// ===== 更新立绘 =====
function updateImage(emotion) {
  petImage.src = `../assets/${emotion}.png`
  petImage.onerror = () => {
    petImage.alt = `【缺少素材: ${emotion}.png】`
  }
}

// ===== 显示气泡 =====
function showBubble(text) {
  bubble.textContent = text
  bubble.classList.add('show')
}

// ===== 关闭按钮 =====
document.getElementById('close-btn').addEventListener('click', () => {
  window.close()
})

// ===== 设置按钮 =====
document.getElementById('settings-btn').addEventListener('click', () => {
  window.api.openSettings()
})
