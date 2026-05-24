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
const inpStream = document.getElementById('inp-stream')
const btnFetch = document.getElementById('btn-fetch')

// ===== 记忆总结页元素 =====
const selSummaryProvider = document.getElementById('sel-summary-provider')
const inpSummaryInterval = document.getElementById('inp-summary-interval')
const inpMaxHistory = document.getElementById('inp-max-history')

// ===== 工具系统页元素 =====
const selToolProvider = document.getElementById('sel-tool-provider')
const inpToolModel = document.getElementById('inp-tool-model')
const btnToolFetch = document.getElementById('btn-tool-fetch')
const toolModelSelect = document.getElementById('tool-model-select')

// ===== 联网搜索页元素 =====
const inpSearchEnabled = document.getElementById('inp-search-enabled')
const selSearchProvider = document.getElementById('sel-search-provider')
const inpSearchKey = document.getElementById('inp-search-key')
const searchKeyStatus = document.getElementById('search-key-status')

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
const modelSelect = document.getElementById('model-select')

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
  inpStream.checked = api.stream_enabled !== false

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

  // 搜索页
  const search = config.web_search_settings || {}
  inpSearchEnabled.checked = search.enabled !== false
  selSearchProvider.value = search.provider || 'duckduckgo'
  const searchProv = search.providers?.[selSearchProvider.value] || {}
  inpSearchKey.value = searchProv.api_key || ''
  updateSearchKeyHint()
}

// ================================================================
// 收集配置
// ================================================================
function collectFromUI() {
  const provName = selProvider.value
  // 防守：textarea 为空时保留已有的 system_prompt，防止误覆盖丢失
  const promptValue = inpPrompt.value.trim()
  const existingPrompt = currentConfig.character_settings?.system_prompt || ''
  const finalPrompt = promptValue || existingPrompt
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
      stream_enabled: inpStream.checked,
      summary_provider: selSummaryProvider.value,
      summary_interval: parseInt(inpSummaryInterval.value) || 5,
      max_history_length: parseInt(inpMaxHistory.value) || 10,
      tool_provider: selToolProvider.value === '同对话服务商' ? '' : selToolProvider.value,
      tool_model: inpToolModel.value.trim() || '',
    },
    character_settings: {
      name: '七夜',
      system_prompt: finalPrompt
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
    },
    web_search_settings: {
      enabled: inpSearchEnabled.checked,
      provider: selSearchProvider.value,
      providers: {
        [selSearchProvider.value]: {
          api_key: inpSearchKey.value.trim(),
        }
      }
    }
  }
}

// ===== 模型列表获取（通用） =====
// fetchAndShowModels(baseUrl, apiKey, btn, selectEl, inputEl) — 获取模型并填充下拉框
async function fetchAndShowModels(baseUrl, apiKey, btn, selectEl, inputEl) {
  const origText = btn.textContent
  btn.textContent = '获取中...'; btn.disabled = true
  try {
    const models = await window.api.getModels(baseUrl, apiKey)
    if (!models || models.length === 0) {
      statusEl.textContent = '未获取到模型'
      return
    }
    populateModelSelect(selectEl, models, inputEl)
    statusEl.textContent = `连接成功！获取到 ${models.length} 个模型`
  } catch (err) {
    statusEl.textContent = '获取失败: ' + err.message
  }
  btn.textContent = origText; btn.disabled = false
}

// populateModelSelect(selectEl, models, inputEl) — 填充下拉列表并显示
function populateModelSelect(selectEl, models, inputEl) {
  selectEl.innerHTML = ''
  models.forEach(m => {
    const opt = document.createElement('option')
    opt.value = m; opt.textContent = m
    selectEl.appendChild(opt)
  })
  selectEl.style.display = 'block'
  // 点击下拉选项 → 填入输入框 → 隐藏下拉
  selectEl.onchange = () => {
    inputEl.value = selectEl.value
    selectEl.style.display = 'none'
  }
}

// ===== "获取列表" 按钮（对话 API 页） =====
btnFetch.addEventListener('click', () => {
  const baseUrl = inpBaseUrl.value.trim()
  const apiKey = inpApiKey.value.trim()
  if (!baseUrl || !apiKey) { statusEl.textContent = '请先填写 Base URL 和 API Key'; return }
  fetchAndShowModels(baseUrl, apiKey, btnFetch, modelSelect, inpModel)
})

// ===== "获取列表" 按钮（工具模型页） =====
// 工具提取服务商和对话服务商可能是不同的，需要拿到对应服务商的 base_url 和 api_key
btnToolFetch.addEventListener('click', () => {
  const toolProvName = selToolProvider.value
  if (toolProvName === '同对话服务商') {
    // 复用对话 API 配置
    const baseUrl = inpBaseUrl.value.trim()
    const apiKey = inpApiKey.value.trim()
    if (!baseUrl || !apiKey) { statusEl.textContent = '请先在对话 API 页填写 Base URL 和 API Key'; return }
    fetchAndShowModels(baseUrl, apiKey, btnToolFetch, toolModelSelect, inpToolModel)
    return
  }
  // 独立服务商：从已加载配置中取
  const prov = currentConfig.api_settings?.providers?.[toolProvName] || {}
  const baseUrl = prov.base_url || ''
  const apiKey = prov.api_key || ''
  if (!baseUrl || !apiKey) { statusEl.textContent = `请先在对话 API 页配置 ${toolProvName} 的 Base URL 和 API Key`; return }
  fetchAndShowModels(baseUrl, apiKey, btnToolFetch, toolModelSelect, inpToolModel)
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

// ===== 搜索引擎切换 =====
function updateSearchKeyHint() {
  if (selSearchProvider.value === 'duckduckgo') {
    inpSearchKey.placeholder = 'DuckDuckGo 无需 API Key'
    inpSearchKey.disabled = true
    searchKeyStatus.textContent = '(无需 Key)'
  } else {
    inpSearchKey.placeholder = '搜索服务商 API Key'
    inpSearchKey.disabled = false
    searchKeyStatus.textContent = ''
  }
  // 切换时回填已保存的 Key
  const search = currentConfig.web_search_settings || {}
  const prov = search.providers?.[selSearchProvider.value] || {}
  inpSearchKey.value = prov.api_key || ''
}
selSearchProvider.addEventListener('change', updateSearchKeyHint)

loadConfig()
