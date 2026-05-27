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
const selCharacter = document.getElementById('sel-character')
const inpCharName = document.getElementById('inp-char-name')
const inpCharDisplay = document.getElementById('inp-char-display')
const btnImportChar = document.getElementById('btn-import-char')
const btnExportChar = document.getElementById('btn-export-char')
const selExportFormat = document.getElementById('sel-export-format')
const charStatus = document.getElementById('char-status')

// ===== 主动搭话页元素 =====
const inpProactiveEnabled = document.getElementById('inp-proactive-enabled')
const inpProactiveGap = document.getElementById('inp-proactive-gap')
const inpProactiveInterval = document.getElementById('inp-proactive-interval')
const inpProactiveProbability = document.getElementById('inp-proactive-probability')
const inpProactiveEscalation = document.getElementById('inp-proactive-escalation')
const inpProactiveIncrement = document.getElementById('inp-proactive-increment')

// ===== 知识库页元素 =====
const inpFactEnabled = document.getElementById('inp-fact-enabled')
const inpFactBatch = document.getElementById('inp-fact-batch')
const inpFactSimilarity = document.getElementById('inp-fact-similarity')
const inpFactDecay = document.getElementById('inp-fact-decay')
const inpProfileEnabled = document.getElementById('inp-profile-enabled')
const inpProfileFacts = document.getElementById('inp-profile-facts')
const inpProfileHours = document.getElementById('inp-profile-hours')
const inpProfileMin = document.getElementById('inp-profile-min')
const inpAutoInject = document.getElementById('inp-auto-inject')
const inpMaxItems = document.getElementById('inp-max-items')

// ===== 知识库模型元素 =====
const selKnowledgeProvider = document.getElementById('sel-knowledge-provider')
const inpKnowledgeModel = document.getElementById('inp-knowledge-model')
const btnKnowledgeFetch = document.getElementById('btn-knowledge-fetch')
const knowledgeModelSelect = document.getElementById('knowledge-model-select')

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

    if (tab.dataset.page === 'page-sessions') {
      loadSessionList()
    }
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
  inpCharName.value = config.character_settings?.name || ''
  inpCharDisplay.value = config.character_settings?.display_name || config.character_settings?.name || ''
  loadCharacterList(config.active_character || config.character_settings?.name || '')

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

  // 知识库页
  const ks = config.knowledge_settings || {}
  selKnowledgeProvider.value = ks.knowledge_provider || '同对话服务商'
  inpKnowledgeModel.value = ks.knowledge_model || ''
  const fe = ks.fact_extraction || {}
  inpFactEnabled.checked = fe.enabled !== false
  inpFactBatch.value = fe.batch_size || 3
  inpFactSimilarity.value = ks.similarity_threshold ?? 0.7
  inpFactDecay.value = ks.decay_rate ?? 0.01
  const pg = ks.profile_generation || {}
  inpProfileEnabled.checked = pg.enabled !== false
  inpProfileFacts.value = pg.new_facts_threshold || 20
  inpProfileHours.value = pg.interval_hours || 24
  inpProfileMin.value = pg.min_facts || 5
  const ai = ks.auto_inject || {}
  inpAutoInject.checked = ai.enabled !== false
  inpMaxItems.value = ai.max_items ?? 8
}

// ================================================================
// 角色管理
// ================================================================

async function loadCharacterList(activeName) {
  try {
    const list = await window.api.getCharacterList()
    selCharacter.innerHTML = ''
    let found = false
    list.forEach(c => {
      const opt = document.createElement('option')
      opt.value = c.name
      opt.textContent = c.displayName || c.name
      selCharacter.appendChild(opt)
      if (c.name === activeName) found = true
    })
    if (activeName && !found) {
      const opt = document.createElement('option')
      opt.value = activeName
      opt.textContent = activeName + ' (内建)'
      selCharacter.appendChild(opt)
    }
    selCharacter.value = activeName || list[0]?.name || ''
    charStatus.textContent = activeName ? '已选中' : ''
  } catch (err) {
    charStatus.textContent = '加载失败: ' + err.message
  }
}

selCharacter.addEventListener('change', async () => {
  const name = selCharacter.value
  if (!name) return
  try {
    await window.api.setActiveCharacter(name)
    const cfg = await window.api.getConfig()
    currentConfig = cfg
    inpCharName.value = cfg.character_settings?.name || ''
    inpCharDisplay.value = cfg.character_settings?.display_name || cfg.character_settings?.name || ''
    inpPrompt.value = cfg.character_settings?.system_prompt || ''
    charStatus.textContent = '已切换'
    setTimeout(() => { charStatus.textContent = '已选中' }, 2000)
  } catch (err) {
    charStatus.textContent = '切换失败: ' + err.message
  }
})

btnImportChar.addEventListener('click', async () => {
  try {
    const result = await window.api.importCharacter()
    if (result.success) {
      charStatus.textContent = `已导入: ${result.displayName}`
      await loadCharacterList(result.name)
      selCharacter.value = result.name
      await window.api.setActiveCharacter(result.name)
      const cfg = await window.api.getConfig()
      currentConfig = cfg
      inpCharName.value = cfg.character_settings?.name || ''
      inpCharDisplay.value = cfg.character_settings?.display_name || ''
      inpPrompt.value = cfg.character_settings?.system_prompt || ''
    } else if (result.reason !== 'cancelled') {
      charStatus.textContent = '导入失败: ' + (result.reason || '未知错误')
    }
  } catch (err) {
    charStatus.textContent = '导入失败: ' + err.message
  }
})

btnExportChar.addEventListener('click', async () => {
  try {
    const format = selExportFormat.value || 'json'
    const result = await window.api.exportCharacter(format)
    if (result.success) {
      charStatus.textContent = '已导出到: ' + result.path
    } else if (result.reason) {
      charStatus.textContent = '导出失败: ' + result.reason
    }
  } catch (err) {
    charStatus.textContent = '导出失败: ' + err.message
  }
})

// ================================================================
// 收集配置
// ================================================================
function collectFromUI() {
  const provName = selProvider.value
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
      name: inpCharName.value.trim() || '七夜',
      system_prompt: finalPrompt
    },
    ui_settings: {
      window_width: 200, window_height: 400,
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
    },
    knowledge_settings: {
      knowledge_provider: selKnowledgeProvider.value === '同对话服务商' ? '' : selKnowledgeProvider.value,
      knowledge_model: inpKnowledgeModel.value.trim() || '',
      fact_extraction: {
        enabled: inpFactEnabled.checked,
        batch_size: parseInt(inpFactBatch.value) || 3,
      },
      similarity_threshold: parseFloat(inpFactSimilarity.value) || 0.7,
      decay_rate: parseFloat(inpFactDecay.value) || 0.01,
      profile_generation: {
        enabled: inpProfileEnabled.checked,
        new_facts_threshold: parseInt(inpProfileFacts.value) || 20,
        interval_hours: parseInt(inpProfileHours.value) || 24,
        min_facts: parseInt(inpProfileMin.value) || 5,
      },
      auto_inject: {
        enabled: inpAutoInject.checked,
        max_items: parseInt(inpMaxItems.value) || 8,
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

// ===== "获取列表" 按钮（知识库模型页） =====
btnKnowledgeFetch.addEventListener('click', () => {
  const kProvName = selKnowledgeProvider.value
  if (kProvName === '同对话服务商') {
    const baseUrl = inpBaseUrl.value.trim()
    const apiKey = inpApiKey.value.trim()
    if (!baseUrl || !apiKey) { statusEl.textContent = '请先在对话 API 页填写 Base URL 和 API Key'; return }
    fetchAndShowModels(baseUrl, apiKey, btnKnowledgeFetch, knowledgeModelSelect, inpKnowledgeModel)
    return
  }
  const prov = currentConfig.api_settings?.providers?.[kProvName] || {}
  const baseUrl = prov.base_url || ''
  const apiKey = prov.api_key || ''
  if (!baseUrl || !apiKey) { statusEl.textContent = `请先在对话 API 页配置 ${kProvName} 的 Base URL 和 API Key`; return }
  fetchAndShowModels(baseUrl, apiKey, btnKnowledgeFetch, knowledgeModelSelect, inpKnowledgeModel)
})

// ===== 保存 =====
btnSave.addEventListener('click', async () => {
  const config = collectFromUI()
  try {
    await window.api.saveConfig(config)
    const activeChar = currentConfig.active_character || selCharacter.value
    if (activeChar) {
      await window.api.saveCharacter(activeChar, {
        name: inpCharName.value.trim() || activeChar,
        displayName: inpCharDisplay.value.trim() || activeChar,
        system_prompt: inpPrompt.value.trim() || '',
      })
    }
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
  } else if (selSearchProvider.value === 'anthropic') {
    inpSearchKey.placeholder = 'Anthropic API Key (sk-ant-...)'
    inpSearchKey.disabled = false
    searchKeyStatus.textContent = '(需key，Claude内建搜索)'
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

// ===== 对话管理 (Session) =====

async function loadSessionList() {
  const listEl = document.getElementById('session-list')
  const infoEl = document.getElementById('active-session-info')
  try {
    const sessions = await window.api.getSessionList()
    const active = await window.api.getActiveSession()

    if (active) {
      infoEl.textContent = `当前活跃：${active.title || '未命名'} · ${active.messageCount || 0} 条消息 · 角色: ${active.characterId}`
    } else {
      infoEl.textContent = '当前活跃：无 (请新建对话)'
    }

    if (sessions.length === 0) {
      listEl.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:13px;">暂无历史对话</div>'
      return
    }

    listEl.innerHTML = sessions.map(s => {
      const isActive = s.isActive ? 'background:#e8f5e9;border-left:3px solid #4CAF50;' : 'border-left:3px solid transparent;'
      const timeStr = s.lastActiveAt ? new Date(s.lastActiveAt).toLocaleString('zh-CN') : ''
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px;margin-bottom:4px;border-radius:5px;${isActive}background:#f9f9fb;">
          <div style="flex:1;min-width:0;">
            <div style="font-size:13px;font-weight:bold;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${s.title || '未命名'}</div>
            <div style="font-size:11px;color:#999;">${s.characterId} · ${s.messageCount} 条 · ${timeStr}</div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0;">
            ${!s.isActive ? `<button data-action="switch" data-id="${s.id}" style="padding:4px 10px;border:1px solid #2196F3;background:white;color:#2196F3;border-radius:3px;cursor:pointer;font-size:12px;">切换</button>` : ''}
            <button data-action="delete" data-id="${s.id}" style="padding:4px 8px;border:1px solid #f44336;background:white;color:#f44336;border-radius:3px;cursor:pointer;font-size:12px;" ${s.isActive ? 'disabled title="不能删除活跃会话"' : ''}>删除</button>
          </div>
        </div>
      `
    }).join('')

    // 绑定按钮事件
    listEl.querySelectorAll('[data-action="switch"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id)
        await window.api.switchSession(id)
        statusEl.textContent = '已切换对话'
        loadSessionList()
      })
    })
    listEl.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = parseInt(btn.dataset.id)
        if (!confirm('确定删除此对话吗？消息记录将被永久删除。')) return
        await window.api.deleteSession(id)
        statusEl.textContent = '已删除对话'
        loadSessionList()
      })
    })
  } catch (err) {
    listEl.innerHTML = `<div style="padding:20px;text-align:center;color:#f44336;font-size:13px;">加载失败: ${err.message}</div>`
  }
}

document.getElementById('btn-new-session').addEventListener('click', async () => {
  const result = await window.api.createSession()
  if (result.success) {
    statusEl.textContent = '已创建新对话'
    loadSessionList()
  } else {
    statusEl.textContent = '创建失败: ' + result.error
  }
})

loadConfig()
