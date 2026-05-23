// ===== settings.js — 设置页面逻辑 =====
//
// 新架构：左侧侧边栏导航 + 右侧内容区切换
// 关键 DOM API：
//   data-* 属性 — 自定义 HTML 属性，JS 通过 element.dataset.* 读取
//   forEach — 遍历 NodeList（querySelectorAll 返回的类似数组的集合）
//   toggle() — 切换 CSS 类：有则删，无则加
//   .checked — checkbox 的选中状态（true/false）

// ===== API 配置页元素 =====
const selProvider = document.getElementById('sel-provider')
const inpBaseUrl = document.getElementById('inp-base-url')
const inpApiKey = document.getElementById('inp-api-key')
const inpModel = document.getElementById('inp-model')
const inpTemperature = document.getElementById('inp-temperature')
const btnFetch = document.getElementById('btn-fetch')

// ===== 记忆总结页元素 =====
const selSummaryProvider = document.getElementById('sel-summary-provider')
const inpSummaryInterval = document.getElementById('inp-summary-interval')
const inpMaxHistory = document.getElementById('inp-max-history')

// ===== 工具系统页元素 =====
const selToolProvider = document.getElementById('sel-tool-provider')
const inpToolModel = document.getElementById('inp-tool-model')

// ===== 角色设定页元素 =====
const inpPrompt = document.getElementById('inp-prompt')

// ===== 主动搭话页元素 =====
const inpProactiveEnabled = document.getElementById('inp-proactive-enabled')
const inpProactiveGap = document.getElementById('inp-proactive-gap')
const inpProactiveInterval = document.getElementById('inp-proactive-interval')
const inpProactiveProbability = document.getElementById('inp-proactive-probability')
const inpProactiveEscalation = document.getElementById('inp-proactive-escalation')
const inpProactiveIncrement = document.getElementById('inp-proactive-increment')

// ===== 全局元素 =====
const btnSave = document.getElementById('btn-save')
const btnCancel = document.getElementById('btn-cancel')
const statusEl = document.getElementById('status')

let currentConfig = {}

// ================================================================
// 标签页切换
// ================================================================

// querySelectorAll — 返回匹配 CSS 选择器的所有元素（NodeList，可用 forEach 遍历）
// [data-page] — CSS 属性选择器，选中所有带 data-page 属性的元素
document.querySelectorAll('.tab').forEach(tab => {
  // addEventListener('click', fn) — 注册点击事件
  tab.addEventListener('click', () => {
    // 取消所有标签的 active 状态
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'))
    // 给当前点击的标签加 active
    tab.classList.add('active')

    // 隐藏所有内容页
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'))
    // tab.dataset.page 读取 data-page 属性值（如 "page-api"）
    // 显示对应内容页
    document.getElementById(tab.dataset.page).classList.add('active')
  })
})

// ================================================================
// 加载配置
// ================================================================
async function loadConfig() {
  try {
    currentConfig = await window.api.getConfig()
    applyToUI(currentConfig)

    // 显示加密状态
    const hasEnc = await window.api.hasEncryption()
    document.getElementById('enc-status').textContent = hasEnc ? '(已加密存储)' : '(未加密)'
    if (!hasEnc) {
      document.getElementById('enc-status').style.color = '#f44336'
    }
  } catch (err) {
    statusEl.textContent = '加载配置失败: ' + err.message
  }
}

function applyToUI(config) {
  const api = config.api_settings || {}
  const provName = api.provider || 'deepseek'
  const prov = api.providers?.[provName] || {}

  // API 页
  selProvider.value = provName
  inpBaseUrl.value = prov.base_url || ''
  inpApiKey.value = prov.api_key || ''
  inpModel.value = prov.model || ''
  inpTemperature.value = api.temperature ?? 0.7

  // 记忆页
  selSummaryProvider.value = api.summary_provider || '同对话服务商'
  inpSummaryInterval.value = api.summary_interval ?? 5
  inpMaxHistory.value = api.max_history_length ?? 10

  // 工具页
  selToolProvider.value = api.tool_provider || '同对话服务商'
  inpToolModel.value = api.tool_model || ''

  // 角色页
  inpPrompt.value = config.character_settings?.system_prompt || ''

  // 主动搭话页
  const proactive = config.proactive_settings || {}
  inpProactiveEnabled.checked = proactive.enabled !== false
  inpProactiveGap.value = proactive.gap_hours || 6
  inpProactiveInterval.value = proactive.idle_interval_minutes || 10
  inpProactiveProbability.value = (proactive.idle_base_probability ?? 0.15) * 100
  inpProactiveEscalation.checked = proactive.idle_escalation_enabled || false
  inpProactiveIncrement.value = (proactive.idle_escalation_increment ?? 0.10) * 100
}

// ================================================================
// 收集配置
// ================================================================
function collectFromUI() {
  const provName = selProvider.value
  return {
    api_settings: {
      provider: provName,
      providers: {
        [provName]: {
          base_url: inpBaseUrl.value.trim(),
          api_key: inpApiKey.value.trim(),
          model: inpModel.value.trim()
        }
      },
      temperature: parseFloat(inpTemperature.value) || 0.7,
      summary_provider: selSummaryProvider.value,
      summary_interval: parseInt(inpSummaryInterval.value) || 5,
      max_history_length: parseInt(inpMaxHistory.value) || 10,
      tool_provider: selToolProvider.value === '同对话服务商' ? '' : selToolProvider.value,
      tool_model: inpToolModel.value.trim() || '',
    },
    character_settings: {
      name: '七夜',
      system_prompt: inpPrompt.value.trim()
    },
    ui_settings: {
      window_width: 320, window_height: 650,
      image_width: 300, image_height: 440
    },
    proactive_settings: {
      enabled: inpProactiveEnabled.checked,
      gap_hours: parseInt(inpProactiveGap.value) || 6,
      idle_interval_minutes: parseInt(inpProactiveInterval.value) || 10,
      idle_base_probability: (parseFloat(inpProactiveProbability.value) || 15) / 100,
      idle_escalation_enabled: inpProactiveEscalation.checked,
      idle_escalation_increment: (parseFloat(inpProactiveIncrement.value) || 10) / 100,
    }
  }
}

// ===== "获取列表" 按钮 =====
btnFetch.addEventListener('click', async () => {
  const baseUrl = inpBaseUrl.value.trim()
  const apiKey = inpApiKey.value.trim()
  if (!baseUrl || !apiKey) { statusEl.textContent = '请先填写 Base URL 和 API Key'; return }
  btnFetch.textContent = '获取中...'; btnFetch.disabled = true
  try {
    const models = await window.api.getModels(baseUrl, apiKey)
    if (models && models.length > 0) inpModel.value = models[0]
    statusEl.textContent = `连接成功！获取到 ${models?.length || 0} 个模型`
  } catch (err) { statusEl.textContent = '获取失败: ' + err.message }
  btnFetch.textContent = '获取列表'; btnFetch.disabled = false
})

// ===== 保存 =====
btnSave.addEventListener('click', async () => {
  const config = collectFromUI()
  try {
    await window.api.saveConfig(config)
    statusEl.textContent = '配置已保存'
    setTimeout(() => window.close(), 800)
  } catch (err) { statusEl.textContent = '保存失败: ' + err.message }
})

// ===== 取消 =====
btnCancel.addEventListener('click', () => window.close())

// ===== Provider 切换 =====
selProvider.addEventListener('change', () => {
  const api = currentConfig.api_settings?.providers?.[selProvider.value]
  if (api) {
    inpBaseUrl.value = api.base_url || ''
    inpApiKey.value = api.api_key || ''
    inpModel.value = api.model || ''
  }
})

loadConfig()
