// 页面元素
const selProvider = document.getElementById('sel-provider')
const inpBaseUrl = document.getElementById('inp-base-url')
const inpApiKey = document.getElementById('inp-api-key')
const inpModel = document.getElementById('inp-model')
const inpTemperature = document.getElementById('inp-temperature')
const inpPrompt = document.getElementById('inp-prompt')
const selSummaryProvider = document.getElementById('sel-summary-provider')
const inpSummaryInterval = document.getElementById('inp-summary-interval')
const inpMaxHistory = document.getElementById('inp-max-history')
const selToolProvider = document.getElementById('sel-tool-provider')
const inpToolModel = document.getElementById('inp-tool-model')
const btnFetch = document.getElementById('btn-fetch')
const btnSave = document.getElementById('btn-save')
const btnCancel = document.getElementById('btn-cancel')
const statusEl = document.getElementById('status')

let currentConfig = {}

async function loadConfig() {
  try {
    currentConfig = await window.api.getConfig()
    applyToUI(currentConfig)
  } catch (err) {
    statusEl.textContent = '加载配置失败: ' + err.message
  }
}

function applyToUI(config) {
  const api = config.api_settings || {}
  const provName = api.provider || 'deepseek'
  const prov = api.providers?.[provName] || {}

  selProvider.value = provName
  inpBaseUrl.value = prov.base_url || ''
  inpApiKey.value = prov.api_key || ''
  inpModel.value = prov.model || ''
  inpTemperature.value = api.temperature ?? 0.7
  selSummaryProvider.value = api.summary_provider || '同对话服务商'
  inpSummaryInterval.value = api.summary_interval ?? 5
  inpMaxHistory.value = api.max_history_length ?? 10
  selToolProvider.value = api.tool_provider || '同对话服务商'
  inpToolModel.value = api.tool_model || ''
  inpPrompt.value = config.character_settings?.system_prompt || ''
}

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
      window_width: 320,
      window_height: 650,
      image_width: 300,
      image_height: 440
    }
  }
}

// 获取模型列表
btnFetch.addEventListener('click', async () => {
  const baseUrl = inpBaseUrl.value.trim()
  const apiKey = inpApiKey.value.trim()
  if (!baseUrl || !apiKey) {
    statusEl.textContent = '请先填写 Base URL 和 API Key'
    return
  }
  btnFetch.textContent = '获取中...'
  btnFetch.disabled = true
  try {
    const models = await window.api.getModels(baseUrl, apiKey)
    if (models && models.length > 0) {
      inpModel.value = models[0]
    }
    statusEl.textContent = `连接成功！获取到 ${models?.length || 0} 个模型`
  } catch (err) {
    statusEl.textContent = '获取失败: ' + err.message
  }
  btnFetch.textContent = '获取列表'
  btnFetch.disabled = false
})

// 保存
btnSave.addEventListener('click', async () => {
  const config = collectFromUI()
  try {
    await window.api.saveConfig(config)
    statusEl.textContent = '配置已保存 ✓'
    setTimeout(() => window.close(), 800)
  } catch (err) {
    statusEl.textContent = '保存失败: ' + err.message
  }
})

// 取消
btnCancel.addEventListener('click', () => window.close())

// Provider 切换自动更新 URL/Key/Model
selProvider.addEventListener('change', () => {
  const api = currentConfig.api_settings?.providers?.[selProvider.value]
  if (api) {
    inpBaseUrl.value = api.base_url || ''
    inpApiKey.value = api.api_key || ''
    inpModel.value = api.model || ''
  }
})

loadConfig()
