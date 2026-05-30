// ===== llm.js — LLM 通信核心 =====
//
// AI SDK 统一调用层：generateText / streamText
// 知识库后台任务仍用裸 openai SDK（不需要 Provider 抽象）

const db = require('./db')
const tools = require('./tools/index')
const { buildToolPrompt } = require('./tool-prompt')
const fs = require('fs')
const path = require('path')

const { app } = require('electron')
function getDataDir() {
  if (app.isPackaged) {
    return process.resourcesPath
  }
  return path.join(__dirname, '..')
}
const LOG = path.join(getDataDir(), 'netpet-error.log')
const PROMPT_LOG = path.join(getDataDir(), 'netpet-prompt.log')
function errLog(msg) {
  const line = `[${new Date().toISOString()}] [LLM] ${msg}\n`
  console.error(line.trim())
  try { fs.appendFileSync(LOG, line, 'utf-8') } catch {}
}

let dbReady = db.getDb()

// === AI SDK 动态加载（懒初始化） ===
let _aiSdk = null
async function aiSdk() {
  if (_aiSdk) return _aiSdk
  try {
    const [aiMod, openaiMod] = await Promise.all([
      import('ai'),
      import('@ai-sdk/openai'),
    ])
    _aiSdk = { generateText: aiMod.generateText, streamText: aiMod.streamText, createOpenAI: openaiMod.createOpenAI }
    console.log('[LLM] AI SDK 加载成功')
    return _aiSdk
  } catch (err) {
    errLog(`AI SDK 加载失败: ${err.message}`)
    return null
  }
}

// === 客户端创建 ===
async function makeAiModel(apiKey, baseURL, modelName) {
  const sdk = await aiSdk()
  if (!sdk) return null
  try {
    const openai = sdk.createOpenAI({ apiKey, baseURL })
    const model = openai.chat(modelName)  // .chat() → /chat/completions（.responses DeepSeek 不支持）
    return model
  } catch (err) {
    errLog(`AI model 创建失败: ${err.message}`)
    return null
  }
}

// === LLM 调用（纯 AI SDK） ===
async function callLLM({ aiModel, messages, temperature, stream, label }) {
  if (!aiModel) throw new Error('AI SDK 模型未就绪')
  const sdk = await aiSdk()
  if (!sdk) throw new Error('AI SDK 不可用')

  const start = Date.now()
  const phase = label || 'LLM'
  const labelStr = `[${phase}]`

  const sep = '━'.repeat(60)
  let promptLog = `\n${sep}\n[${new Date().toISOString()}] [${phase}]\n${sep}\n`
  for (const m of messages) {
    promptLog += `\n── ROLE: ${m.role} ──\n${(m.content || '').slice(0, 2000)}\n`
  }
  promptLog += `${sep}\n`
  try { fs.appendFileSync(PROMPT_LOG, promptLog, 'utf-8') } catch {}

  if (stream) {
    console.log(`${labelStr} 流式请求开始`)
    const result = sdk.streamText({ model: aiModel, messages, temperature, maxRetries: 1,
      experimental_allowSystemInMessages: true })
    let text = ''
    for await (const chunk of result.textStream) { text += chunk }
    const elapsed = Date.now() - start
    console.log(`${labelStr} 流式完成 (${elapsed}ms, ${text.length}字)`)
    const respLog = `[回复] (${elapsed}ms, ${text.length}字)\n${text.slice(0, 3000)}\n${sep}\n\n`
    try { fs.appendFileSync(PROMPT_LOG, respLog, 'utf-8') } catch {}
    return text
  }
  console.log(`${labelStr} 请求开始`)
  const result = await sdk.generateText({ model: aiModel, messages, temperature, maxRetries: 1,
    experimental_allowSystemInMessages: true })
  const elapsed = Date.now() - start
  const usage = result.usage ? ` 输入${result.usage.promptTokens}t 输出${result.usage.completionTokens}t` : ''
  console.log(`${labelStr} 完成 (${elapsed}ms${usage})`)
  const respLog = `[回复] (${elapsed}ms${usage})\n${(result.text || '').slice(0, 3000)}\n${sep}\n\n`
  try { fs.appendFileSync(PROMPT_LOG, respLog, 'utf-8') } catch {}
  return result.text
}

// ================================================================
// 辅助函数
// ================================================================
function getCurrentToolsContext() {
  return {
    notes: db.getToolsByType('note', 'active'),
    todos: db.getToolsByType('todo', 'active'),
    schedules: db.getToolsByType('schedule', 'active'),
  }
}

function buildPendingContext() {
  const todos = db.getToolsByType('todo', 'active')
  const schedules = db.getToolsByType('schedule', 'active')
  if (todos.length === 0 && schedules.length === 0) return null
  let text = '\n[当前待办事项 — 仅供参考，无需主动提及]\n'
  for (const t of todos) text += `☐ [${t.id}] ${t.label || '(待办)'} — ${t.content || ''}\n`
  for (const s of schedules) {
    const timeStr = s.trigger_at ? new Date(s.trigger_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''
    text += `☐ [${s.id}] ${s.label || '提醒'} — ${s.content || ''} (提醒${timeStr ? ', 触发于 ' + timeStr : ''})\n`
  }
  return { role: 'system', content: text }
}

function processCompletedTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return
  for (const id of tasks) { const n = parseInt(id);     if (!isNaN(n)) { db.completeTool(n); console.log(`[LLM] completed_tasks: ID ${n}`) } }
}

// ================================================================
// 步骤一：工具提取
// ================================================================
async function checkToolCall(config, userText, systemPrompt, sessionId) {
  const api = config.api_settings || {}
  const provName = api.tool_provider || api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key) return { tool: null, params: null }
  const toolModelName = (api.tool_model && api.tool_model !== '同对话服务商') ? api.tool_model : prov.model

  const charName = config.character_settings?.name || '七夜喵'
  const toolPrompt = buildToolPrompt(charName, getCurrentToolsContext())
  const recentHistory = db.loadContextForLlm(sessionId, 6)
  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' })

  try {
    const aiModel = await makeAiModel(prov.api_key, prov.base_url, toolModelName)
    if (!aiModel) return { tool: null, params: null }

    const text = await callLLM({
      aiModel,
      messages: [{ role: 'system', content: toolPrompt }, ...recentHistory.slice(-4), { role: 'user', content: `[当前系统时间: ${timeStr}] 用户说: ${userText}` }],
      temperature: 0.1,
      stream: false,
      label: '工具模型',
    })
    const parsed = JSON.parse(text)
    if (parsed && parsed.completed_tasks) processCompletedTasks(parsed.completed_tasks)
    if (parsed && parsed.tool) { console.log(`[LLM] checkToolCall → ${parsed.tool}`); return { tool: parsed.tool, params: parsed.params || {}, raw: text } }
    return { tool: null, params: null, raw: text }
  } catch (err) { errLog(`工具提取失败: ${err.message}`); return { tool: null, params: null } }
}

async function executeToolCall(config, toolName, params) {
  console.log(`[LLM] 执行工具: ${toolName}`)
  const result = await tools.executeTool(toolName, params, config)
  console.log(`[LLM] 工具结果: ${result.result?.slice(0, 100)}`)
  return result
}

// ================================================================
// 步骤二：主聊天模型
// ================================================================
async function callChatModel(config, extraMessages, userContent, isSystem, sessionId) {
  await dbReady
  const api = config.api_settings || {}
  const provName = api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key || !prov?.base_url) throw new Error('API 未配置')

  const systemPrompt = config.character_settings?.system_prompt || ''
  const formatLock = '\n\n【回复格式——系统锁定，请勿在角色设定中重复编写】\n你的每条回复必须以一个 [emotion=表情] 开头（且仅此一个），表情后直接换行写正文。正文中禁止再次出现 [emotion=xxx]。表情只能从六种中选择：idle（默认）、happy（开心）、angry（生气）、sad（伤心）、shy（害羞）、confused（困惑）。\n格式示例:\n[emotion=idle]\n主人，今天外面的天气不错哦。\n\n注意：回复中绝对不要出现 [completed] 或 [need_search] 标签，这些由后台系统自动处理。'
  const effectivePrompt = systemPrompt
    .replace(/\n*【回复格式】[\s\S]*/g, '')
    .replace(/\n*回复时严格输出 JSON[：:][\s\S]*/g, '')
    + formatLock
  const modelName = prov.model || 'deepseek-v4-flash'
  const summaryInterval = api.summary_interval || 5
  const maxLen = api.max_history_length || 8
  const maxContextLen = api.max_context_length || 0
  const temperature = api.temperature ?? 0.7
  const stream = !!api.stream_enabled

  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' })
  const finalContent = isSystem ? userContent : `[系统当前状态: 当前时间${timeStr}]\n用户说: ${userContent}`

  const chatHistory = [{ role: 'system', content: effectivePrompt }]

  const profileRow = db.getLatestProfile()
  if (profileRow) {
    chatHistory.push({ role: 'system', content: `[用户画像]: ${profileRow.content}` })
  }

  const charName = config.character_settings?.name || config.active_character || '七夜'
  const charMemories = db.getCharacterMemories(charName)
  if (charMemories && charMemories.length > 0) {
    const relevantMemories = charMemories.filter(m => m.category !== 'conversation_summary')
    const convSummaries = charMemories.filter(m => m.category === 'conversation_summary')
    if (convSummaries.length > 0) {
      const summaryText = convSummaries.map(m => m.content).join('\n')
      chatHistory.push({ role: 'system', content: `[角色对用户的认知 — 来自历史对话]\n${summaryText}` })
    }
    if (relevantMemories.length > 0) {
      const memoryText = relevantMemories.map(m => `[${m.category}] ${m.content}`).join('\n')
      chatHistory.push({ role: 'system', content: `[角色自身记忆]\n${memoryText}` })
    }
  }

  const pending = buildPendingContext(); if (pending) chatHistory.push(pending)
  const trimStart = chatHistory.length
  chatHistory.push(...db.loadContextForLlm(sessionId, maxLen))

  if (!isSystem && userContent) {
  const relevantItems = db.searchKnowledgeBase(userContent.slice(0, 200))
  const ks = config.knowledge_settings || {}
  const autoInject = ks.auto_inject || {}
  const maxItems = autoInject.max_items ?? 8
  if (relevantItems.length > 0 && autoInject.enabled !== false) {
    let injection = '[系统: 以下是数据库中与当前话题可能相关的信息]\n'
    let injected = 0
    for (const item of relevantItems) {
      if (injected >= maxItems) break
      const label = item.classification === 'user_profile' ? '用户画像' : (item.classification === 'web' ? '外部知识' : (item.classification === 'lore' ? '世界观设定' : '知识'))
      injection += `- [${label}] ${item.content.slice(0, 200)}\n`
      injected++
    }
    chatHistory.push({ role: 'system', content: injection })
  }

  const loreMatches = db.getLoreMatches(userContent.slice(0, 200))
  if (loreMatches.length > 0) {
    const loreInjection = '[系统: 以下是与当前对话相关的世界观设定 (World Info)]\n' +
      loreMatches.map(l => {
        const t = (() => { try { return JSON.parse(l.tags || '[]') } catch { return [] } })()
        return `【${(l.category || '设定').slice(0, 20)}】${l.content.slice(0, 300)}`
      }).join('\n')
    chatHistory.push({ role: 'system', content: loreInjection })
  }
  }

  if (extraMessages?.length) for (const m of extraMessages) chatHistory.push(m)
  chatHistory.push({ role: isSystem ? 'system' : 'user', content: finalContent })

  if (maxContextLen > 0) {
    let total = chatHistory.reduce((s, m) => s + (m.content || '').length, 0)
    while (total > maxContextLen && trimStart < chatHistory.length - 1) {
      const removed = chatHistory.splice(trimStart, 1)[0]
      total -= (removed.content || '').length
    }
  }

  const aiModel = await makeAiModel(prov.api_key, prov.base_url, modelName)

  let answerText
  try {
    answerText = await callLLM({ aiModel, messages: chatHistory, temperature, stream, label: '聊天模型' })
  } catch (err) {
    const errInfo = `API 请求失败 | model=${modelName} provider=${provName} temp=${temperature} stream=${stream}: ${err.message}`
    errLog(errInfo)
    throw new Error(errInfo)
  }

  const result = parseChatResponse(answerText)
  if (!isSystem) db.saveMessage(sessionId, 'user', finalContent)
  db.saveMessage(sessionId, 'assistant', answerText)

  const summaryData = db.checkAndSummarize(sessionId, summaryInterval)
  if (summaryData) {
    try { await summarizeMemory(config, summaryData, sessionId) } catch (err) { errLog(`后台总结失败: ${err.message}`) }
  }

  return { reply: result.reply, emotion: result.emotion }
}

// ================================================================
// 对外接口
// ================================================================
async function sendMessage(config, userText) {
  const session = db.getActiveSession()
  const sessionId = session?.id || 1

  let toolResult = null
  const toolDecision = await checkToolCall(config, userText, config.character_settings?.system_prompt || '', sessionId)
  if (toolDecision.tool) {
    toolResult = await executeToolCall(config, toolDecision.tool, toolDecision.params)
    if (toolResult) {
      db.saveMessage(sessionId, 'system', `[工具调用: ${toolDecision.tool}] ${toolResult.result}`)
      if (toolDecision.tool === 'web_search' && toolDecision.params?.query) {
        db.saveKnowledge(toolDecision.params.query, toolResult.result, 'web', '')
      }
    }
  }
  const extraMessages = toolResult ? [{ role: 'system', content: `[系统: 刚才执行了工具 "${toolDecision.tool}"，结果如下]\n${toolResult.result}` }] : []
  const result = await callChatModel(config, extraMessages, userText, false, sessionId)

  const ks = config.knowledge_settings || {}
  const fe = ks.fact_extraction || {}
  if (fe.enabled !== false) {
    const batchSize = fe.batch_size || 3
    const unprocessedCount = db.getUnprocessedFactCount()
    if (unprocessedCount >= batchSize) {
      extractFacts(config).catch(err => errLog(`事实提取失败: ${err.message}`))
    }
  }

  const pg = ks.profile_generation || {}
  if (pg.enabled !== false) {
    checkAndGenerateProfile(config).catch(err => errLog(`画像检查失败: ${err.message}`))
  }

  return result
}

async function sendSystemMessage(config, systemContent) {
  const session = db.getActiveSession()
  const sessionId = session?.id || 1

  const result = await callChatModel(config, [], systemContent, true, sessionId)
  db.saveMessage(sessionId, 'system', systemContent)
  return result
}

async function fetchModels(baseUrl, apiKey) {
  if (!baseUrl || !apiKey) throw new Error('请先填写 Base URL 和 API Key')
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.data?.map(m => m.id) || []
}

// ================================================================
// 后台总结记忆
// ================================================================
async function summarizeMemory(config, summaryData, sessionId) {
  if (!summaryData) return

  const api = config.api_settings || {}
  const provName = api.summary_provider || ''
  let sApiKey, sBaseUrl, sModel

  if (provName && provName !== '同对话服务商' && api.providers?.[provName]) {
    const sumProv = api.providers[provName]
    sApiKey = sumProv.api_key
    sBaseUrl = sumProv.base_url
    sModel = sumProv.model
  } else {
    const mainProv = api.providers?.[api.provider || 'deepseek'] || {}
    sApiKey = mainProv.api_key
    sBaseUrl = mainProv.base_url
    sModel = mainProv.model
  }

  const aiModel = await makeAiModel(sApiKey, sBaseUrl, sModel)
  if (!aiModel) return

  try {
    const summaryText = (await callLLM({
      aiModel,
      messages: [
        { role: 'system', content: '你是一个对话总结助手。' },
        { role: 'user', content: summaryData.prompt }
      ],
      temperature: 0.5,
      stream: false,
      label: '总结模型',
    })).trim()
    db.updateSessionSummary(sessionId, summaryText)
    console.log('记忆总结已保存:', summaryText.substring(0, 50) + '...')
  } catch (err) {
    console.error('后台总结记忆失败:', err.message)
  }
}

// ================================================================
// 知识库模型解析（返回 AI SDK model）
// ================================================================
async function getKnowledgeModel(config) {
  const ks = config.knowledge_settings || {}
  const kProvName = ks.knowledge_provider || ''
  const kModelName = ks.knowledge_model || ''
  const api = config.api_settings || {}

  let apiKey, baseURL, modelName

  if (kProvName && kProvName !== '同对话服务商') {
    const prov = api.providers?.[kProvName]
    if (prov?.api_key) {
      apiKey = prov.api_key
      baseURL = prov.base_url
      modelName = kModelName || prov.model
    }
  }

  if (!apiKey) {
    const mainProvName = api.provider || 'deepseek'
    const mainProv = api.providers?.[mainProvName]
    if (!mainProv?.api_key || !mainProv?.base_url) return null
    apiKey = mainProv.api_key
    baseURL = mainProv.base_url
    modelName = kModelName || mainProv.model
  }

  const kcModelName = modelName
  return { aiModel: await makeAiModel(apiKey, baseURL, modelName), modelName: kcModelName }
}

// ================================================================
// 辅助：矛盾检测
// ================================================================
function isContradiction(oldContent, newContent) {
  const negMarkers = ['不再', '不', '没', '放弃', '讨厌', '厌恶', '改', '变了', '现在不喜欢', '不是', '戒了', '腻了']
  const newLower = (newContent || '').toLowerCase()
  if (!negMarkers.some(m => newLower.includes(m))) return false

  const oldLower = (oldContent || '').toLowerCase()
  const words = oldLower.split(/[\s,，。！？、]+/).filter(w => w.length >= 2)
  const shared = words.filter(w => newLower.includes(w))
  return shared.length >= 2
}

// ================================================================
// 事实提取
// ================================================================
async function extractFacts(config) {
  await dbReady
  const lastId = parseInt(db.getMeta('last_fact_extraction_msg_id') || '0')
  const messages = db.getMessagesForFactExtraction(lastId, 6)
  if (messages.length < 3) return

  const km = await getKnowledgeModel(config)
  if (!km?.aiModel) return

  const conversationText = messages.map(m => {
    const roleStr = m.role === 'user' ? '用户' : '助手'
    return `${roleStr}: ${m.content.slice(0, 300)}`
  }).join('\n')

  const prompt = `你是一个信息提取助手。请从以下对话中提取关于用户的事实信息。

输出JSON数组，每个元素包含字段：
- category: 事实分类，如"偏好"、"计划"、"个人信息"、"习惯"、"观点"、"事件"、"关系"等
- content: 事实内容，用简洁的一句话描述
- tags: 相关标签数组，如["饮食","猫"]
- confidence: 置信度0到1之间，根据明确程度严格评分

置信度评分标准（务必按此给分，不要一律给0.9-1）：
- 0.9~1.0：用户直接明确陈述，无歧义。例如"我养了一只猫"、"我最讨厌开会"
- 0.7~0.8：较明确但带有一定推断。例如"最近总熬夜"暗示熬夜习惯，"想去趟日本"暗示旅行计划
- 0.5~0.6：模糊暗示，需要结合语境推测。例如"这火锅不错"暗示偏好但不明确，"下次再说吧"暗示可能有计划
- 0.3~0.4：非常不确定，仅是可能关联。例如"朋友推荐过那个"间接提到但不确认态度
- 低于0.3的事实不应提取，直接跳过

反例（这些情况应给低分或不提取）：
- "今天下雨了" → 这是临时状态，不是用户事实，不提取
- "听说xxx不错" → 不确定是否认同，confidence 0.4
- "帮我查一下xxx" → 这是指令，不是事实，不提取
- "我之前好像说过" → 回忆中不确定的内容，confidence 0.5

如果没有可提取的事实，返回空数组[]。

对话内容：
${conversationText}

直接输出JSON数组格式如[{"category":"偏好","content":"用户喜欢吃辣","tags":["饮食"],"confidence":0.9}]，不要有其他文字。`

  try {
    const raw = await callLLM({
      aiModel: km.aiModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      stream: false,
      label: '知识模型-事实提取',
    })
    let facts = []
    try {
      const parsed = JSON.parse(raw)
      facts = Array.isArray(parsed) ? parsed : (parsed.facts || parsed.results || [])
    } catch {
      const match = raw.match(/\[[\s\S]*\]/)
      if (match) { try { facts = JSON.parse(match[0]) } catch {} }
    }

    let inserted = 0, updated = 0
    const ks = config.knowledge_settings || {}
    const simThreshold = ks.similarity_threshold != null ? ks.similarity_threshold : 0.7
    const decayRate = ks.decay_rate != null ? ks.decay_rate : 0.01
    for (const f of facts) {
      if (!f.content) continue
      const similar = db.findSimilarFact(f.content, simThreshold)
      if (similar) {
        if (isContradiction(similar.fact.content, f.content)) {
          db.updateFactConfidence(similar.fact.id, -0.2, decayRate)
          db.saveFact(f.category || '通用', f.content, f.tags || [], f.confidence || 0.7, messages[messages.length - 1]?.id)
          inserted++
        } else {
          db.updateFactConfidence(similar.fact.id, 0.1, decayRate)
          updated++
        }
      } else {
        db.saveFact(f.category || '通用', f.content, f.tags || [], f.confidence || 0.5, messages[messages.length - 1]?.id)
        inserted++
      }
    }

    const latestMsgId = messages[messages.length - 1]?.id || lastId
    db.setMeta('last_fact_extraction_msg_id', String(latestMsgId))

    if (inserted > 0 || updated > 0) {
      console.log(`[FactExtract] 新增 ${inserted} 条事实，更新 ${updated} 条`)
    }
  } catch (err) {
    errLog(`事实提取失败: ${err.message}`)
  }
}

// ================================================================
// 用户画像生成
// ================================================================
async function checkAndGenerateProfile(config) {
  const ks = config.knowledge_settings || {}
  const pg = ks.profile_generation || {}
  const minFacts = pg.min_facts || 5
  const factsCount = db.getAllFacts().length
  if (factsCount < minFacts) return

  const lastProfileAt = db.getMeta('last_profile_generation')
  const factsAtLastProfile = parseInt(db.getMeta('facts_count_at_last_profile') || '0')
  const newFacts = factsCount - factsAtLastProfile

  const intervalHours = pg.interval_hours || 24
  const hourMs = intervalHours * 60 * 60 * 1000
  const intervalPassed = lastProfileAt ? (Date.now() - new Date(lastProfileAt).getTime() > hourMs) : true
  const newFactsThreshold = pg.new_facts_threshold || 20
  const shouldGenerate = newFacts >= newFactsThreshold || (intervalPassed && newFacts >= Math.max(1, Math.floor(newFactsThreshold / 4)))

  if (!shouldGenerate) return
  await generateProfile(config)
}

async function generateProfile(config) {
  await dbReady
  const facts = db.getAllFacts()
  if (facts.length === 0) return

  const factsText = facts.map(f =>
    `[${f.category || '通用'}] ${f.content} (置信度: ${f.confidence || 0.5})`
  ).join('\n')

  const km = await getKnowledgeModel(config)
  if (!km?.aiModel) return

  const prompt = `你是一个用户画像生成助手。请根据以下已提取的用户事实，生成一段简洁的用户画像摘要。

要求：
- 用第三人称客观描述，使用"用户"作为主语
- 涵盖用户的偏好、习惯、计划、个人信息、观点等
- 长度不超过300字
- 只基于给定的事实，不推测

事实列表：
${factsText}

直接输出画像文本，不要加任何前缀说明。`

  try {
    const profileText = (await callLLM({
      aiModel: km.aiModel,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
      stream: false,
      label: '知识模型-画像生成',
    })).trim()
    db.setLatestProfile(profileText)
    db.setMeta('last_profile_generation', new Date().toISOString())
    db.setMeta('facts_count_at_last_profile', String(facts.length))
    console.log('[Profile] 用户画像已更新')
  } catch (err) {
    errLog(`画像生成失败: ${err.message}`)
  }
}

// ================================================================
// 聊天回复解析（标签提取，永不崩溃）
// ================================================================
const VALID_EMOTIONS = ['idle', 'happy', 'angry', 'sad', 'shy', 'confused']

function validEmotion(emotion) {
  const e = (emotion || '').trim().toLowerCase()
  if (VALID_EMOTIONS.includes(e)) return e
  if (emotion) errLog(`非法 emotion "${emotion}" → idle`)
  return 'idle'
}

function parseChatResponse(text) {
  let working = (text || '').trim()
  let emotion = 'idle'

  const emoM = working.match(/^\[emotion=(\w+)\]\s*/i)
  if (emoM) {
    emotion = validEmotion(emoM[1])
    working = working.slice(emoM[0].length).trim()
  } else {
    errLog(`[emotion] 标签缺失，LLM输出前100字: ${text.slice(0, 100)}`)
  }

  working = working.replace(/\[emotion=\w+\]\s*/gi, '')
  return { reply: working || '呃...', emotion }
}

module.exports = { sendMessage, sendSystemMessage, fetchModels }
