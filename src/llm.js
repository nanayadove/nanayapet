// ===== llm.js — LLM 通信核心 =====
//
// 双引擎架构：AI SDK 主引擎 + 裸 openai SDK 降级
// 所有错误写入 netpet-error.log

const OpenAI = require('openai')
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
function makeRawClient(apiKey, baseURL) {
  return new OpenAI({ apiKey, baseURL })
}

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

// === LLM 调用（AI SDK 优先，失败降级 raw） ===
async function callLLM({ client, aiModel, messages, temperature, stream, modelName }) {
  // 优先 AI SDK
  if (aiModel) {
    const sdk = await aiSdk()
    if (sdk) {
      try {
        let text
        if (stream) {
          const result = sdk.streamText({ model: aiModel, messages, temperature })
          text = ''
          for await (const chunk of result.textStream) { text += chunk }
        } else {
          const result = await sdk.generateText({ model: aiModel, messages, temperature })
          text = result.text
        }
        if (!text || text.trim() === '') {
          errLog('AI SDK 返回空文本，降级到 raw SDK')
        } else {
          return text
        }
      } catch (err) {
        errLog(`AI SDK 调用异常: ${err.message}，降级到 raw SDK`)
      }
    }
  }
  // 降级：原始 OpenAI SDK
  console.log(`[LLM] 使用 raw SDK 调用, model=${modelName}`)
  if (stream) {
    const streamResp = await client.chat.completions.create({
      model: modelName, messages, response_format: { type: 'json_object' }, temperature, stream: true,
    })
    let text = ''
    for await (const chunk of streamResp) { text += chunk.choices[0]?.delta?.content || '' }
    return text
  }
  const response = await client.chat.completions.create({
    model: modelName, messages, response_format: { type: 'json_object' }, temperature,
  })
  return response.choices[0].message.content
}

// ================================================================
// 辅助函数（不变）
// ================================================================
function makeClient(config, providerName) {
  const api = config.api_settings || {}
  const provName = providerName || api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key || !prov?.base_url) throw new Error('API 未配置')
  return new OpenAI({ apiKey: prov.api_key, baseURL: prov.base_url })
}

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
  let text = '\n[当前待办事项]\n'
  for (const t of todos) text += `☐ [${t.id}] ${t.label || '(待办)'} — ${t.content || ''}\n`
  for (const s of schedules) {
    const timeStr = s.trigger_at ? new Date(s.trigger_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''
    text += `☐ [${s.id}] ${s.label || '提醒'} — ${s.content || ''} (提醒${timeStr ? ', 触发于 ' + timeStr : ''})\n`
  }
  text += '\n如果用户确认某件事已经做了，在回复的 completed_tasks 数组里填对应的 ID。\n'
  return { role: 'system', content: text }
}

function processCompletedTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return
  for (const id of tasks) { const n = parseInt(id);     if (!isNaN(n)) { db.completeTool(n); console.log(`[LLM] completed_tasks: ID ${n}`) } }
}

// ================================================================
// 步骤一：工具提取
// ================================================================
async function checkToolCall(config, userText, systemPrompt) {
  const api = config.api_settings || {}
  const provName = api.tool_provider || api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key) return { tool: null, params: null }
  const toolModelName = (api.tool_model && api.tool_model !== '同对话服务商') ? api.tool_model : prov.model
  const client = makeClient(config, provName)

  const charName = config.character_settings?.name || '七夜喵'
  const toolPrompt = buildToolPrompt(charName, getCurrentToolsContext())
  const recentHistory = db.loadContextForLlm(6)
  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' })

  try {
    const response = await client.chat.completions.create({
      model: toolModelName,
      messages: [{ role: 'system', content: toolPrompt }, ...recentHistory.slice(-4), { role: 'user', content: `[当前系统时间: ${timeStr}] 用户说: ${userText}` }],
      response_format: { type: 'json_object' }, temperature: 0.1,
    })
    const raw = response.choices[0].message.content
    const parsed = JSON.parse(raw)
    if (parsed && parsed.tool) { console.log(`[LLM] checkToolCall → ${parsed.tool}`); return { tool: parsed.tool, params: parsed.params || {}, raw } }
    return { tool: null, params: null, raw }
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
async function callChatModel(config, extraMessages, userContent, isSystem) {
  await dbReady
  const api = config.api_settings || {}
  const provName = api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key || !prov?.base_url) throw new Error('API 未配置')

  const systemPrompt = config.character_settings?.system_prompt || ''
  let effectivePrompt = systemPrompt.toLowerCase().includes('json') ? systemPrompt : systemPrompt + '\n请以JSON格式回复。'
  effectivePrompt += '\n如果你在回复中涉及不确定的事实性内容，可在JSON中加入"need_search":true和"search_topic":"关键词"。'
  const modelName = prov.model || 'deepseek-v4-flash'
  const summaryInterval = api.summary_interval || 5
  const maxLen = Math.max(api.max_history_length || 10, summaryInterval * 2)
  const temperature = api.temperature ?? 0.7
  const stream = !!api.stream_enabled

  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' })
  const finalContent = isSystem ? userContent : `[系统当前状态: 当前时间${timeStr}]\n用户说: ${userContent}`

  const chatHistory = [{ role: 'system', content: effectivePrompt }]

  // 注入用户画像
  const profileRow = db.getLatestProfile()
  if (profileRow) {
    chatHistory.push({ role: 'system', content: `[用户画像]: ${profileRow.content}` })
  }

  const pending = buildPendingContext(); if (pending) chatHistory.push(pending)
  chatHistory.push(...db.loadContextForLlm(maxLen))

  // 自动注入相关事实和知识
  if (!isSystem && userContent) {
  const relevantFacts = db.searchFactsLike(userContent.slice(0, 200))
  const relevantKnowledge = db.searchKnowledgeLike(userContent.slice(0, 200))
  const ks = config.knowledge_settings || {}
  const autoInject = ks.auto_inject || {}
  const maxF = autoInject.max_facts ?? 5
  const maxK = autoInject.max_knowledge ?? 5
  if ((relevantFacts.length > 0 || relevantKnowledge.length > 0) && autoInject.enabled !== false) {
    let injection = '[系统: 以下是数据库中与当前话题可能相关的信息]\n'
    if (relevantFacts.length > 0) {
      injection += relevantFacts.slice(0, maxF).map(f => `- [${f.category || '事实'}] ${f.content}`).join('\n') + '\n'
    }
    if (relevantKnowledge.length > 0) {
      injection += relevantKnowledge.slice(0, maxK).map(k => `- [知识: ${k.topic}] ${k.content.slice(0, 200)}`).join('\n')
    }
    chatHistory.push({ role: 'system', content: injection })
  }
  }

  if (extraMessages?.length) for (const m of extraMessages) chatHistory.push(m)
  chatHistory.push({ role: isSystem ? 'system' : 'user', content: finalContent })

  // 准备双引擎
  const client = makeClient(config)
  const aiModel = await makeAiModel(prov.api_key, prov.base_url, modelName)

  let answerText
  try {
    answerText = await callLLM({ client, aiModel, messages: chatHistory, temperature, stream, modelName })
  } catch (err) {
    errLog(`API 请求失败: ${err.message}`)
    throw new Error(`API 请求失败: ${err.message}`)
  }

  const result = parseResponse(answerText)
  if (result.completed_tasks) processCompletedTasks(result.completed_tasks)
  if (!isSystem) db.saveMessage('user', finalContent)
  db.saveMessage('assistant', answerText)

  const summaryData = db.checkAndSummarize(client, modelName, summaryInterval)
  if (summaryData) {
    try { await db.doSummarize(api, summaryData) } catch (err) { errLog(`后台总结失败: ${err.message}`) }
  }

  return { reply: result.reply, emotion: result.emotion, need_search: result.need_search, search_topic: result.search_topic }
}

// ================================================================
// 对外接口
// ================================================================
async function sendMessage(config, userText) {
  let toolResult = null
  const toolDecision = await checkToolCall(config, userText, config.character_settings?.system_prompt || '')
  if (toolDecision.tool) {
    toolResult = await executeToolCall(config, toolDecision.tool, toolDecision.params)
    if (toolResult) db.saveMessage('system', `[工具调用: ${toolDecision.tool}] ${toolResult.result}`)
  }
  const extraMessages = toolResult ? [{ role: 'system', content: `[系统: 刚才执行了工具 "${toolDecision.tool}"，结果如下]\n${toolResult.result}` }] : []
  const result = await callChatModel(config, extraMessages, userText, false)

  // 后台：事实提取
  const ks = config.knowledge_settings || {}
  const fe = ks.fact_extraction || {}
  if (fe.enabled !== false) {
    const batchSize = fe.batch_size || 3
    const unprocessedCount = db.getUnprocessedFactCount()
    if (unprocessedCount >= batchSize) {
      extractFacts(config).catch(err => errLog(`事实提取失败: ${err.message}`))
    }
  }

  // 后台：画像生成检查
  const pg = ks.profile_generation || {}
  if (pg.enabled !== false) {
    checkAndGenerateProfile(config).catch(err => errLog(`画像检查失败: ${err.message}`))
  }

  return result
}

async function sendSystemMessage(config, systemContent) {
  const result = await callChatModel(config, [], systemContent, true)
  db.saveMessage('system', systemContent)
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
// 知识补全：等待确认状态
// ================================================================
let pendingSearch = null

function getPendingSearch() { return pendingSearch }
function setPendingSearch(topic) { pendingSearch = { topic, timestamp: Date.now() } }
function clearPendingSearch() { pendingSearch = null }

// ================================================================
// 知识库模型解析
// ================================================================
function getKnowledgeConfig(config) {
  const ks = config.knowledge_settings || {}
  const kProvName = ks.knowledge_provider || ''
  const kModelName = ks.knowledge_model || ''
  const api = config.api_settings || {}

  if (kProvName && kProvName !== '同对话服务商') {
    const prov = api.providers?.[kProvName]
    if (prov?.api_key) {
      return {
        client: new OpenAI({ apiKey: prov.api_key, baseURL: prov.base_url }),
        modelName: kModelName || prov.model,
        providerName: kProvName,
      }
    }
  }

  const mainProvName = api.provider || 'deepseek'
  const mainProv = api.providers?.[mainProvName]
  return {
    client: new OpenAI({ apiKey: mainProv.api_key, baseURL: mainProv.base_url }),
    modelName: kModelName || mainProv.model,
    providerName: mainProvName,
  }
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

  const kc = getKnowledgeConfig(config)
  if (!kc.client) return

  const conversationText = messages.map(m => {
    const roleStr = m.role === 'user' ? '用户' : '助手'
    return `${roleStr}: ${m.content.slice(0, 300)}`
  }).join('\n')

  const prompt = `你是一个信息提取助手。请从以下对话中提取关于用户的事实信息。

输出JSON数组，每个元素包含字段：
- category: 事实分类，如"偏好"、"计划"、"个人信息"、"习惯"、"观点"、"事件"、"关系"等
- content: 事实内容，用简洁的一句话描述
- tags: 相关标签数组，如["饮食","猫"]
- confidence: 置信度0到1之间，越明确越高

只提取明确的事实，不推测。如果没有可提取的事实，返回空数组[]。

对话内容：
${conversationText}

直接输出JSON数组格式如[{"category":"偏好","content":"用户喜欢吃辣","tags":["饮食"],"confidence":0.9}]，不要有其他文字。`

  try {
    const response = await kc.client.chat.completions.create({
      model: kc.modelName,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
    })
    const raw = response.choices[0].message.content
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

  const kc = getKnowledgeConfig(config)

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
    const response = await kc.client.chat.completions.create({
      model: kc.modelName,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.5,
    })
    const profileText = response.choices[0].message.content.trim()
    db.saveMessage('profile', profileText)
    db.setMeta('last_profile_generation', new Date().toISOString())
    db.setMeta('facts_count_at_last_profile', String(facts.length))
    console.log('[Profile] 用户画像已更新')
  } catch (err) {
    errLog(`画像生成失败: ${err.message}`)
  }
}

// ================================================================
// JSON 解析（三级容错）
// ================================================================
const VALID_EMOTIONS = ['idle', 'happy', 'angry', 'sad', 'shy', 'confused']

function validEmotion(emotion) {
  const e = (emotion || '').trim().toLowerCase()
  if (VALID_EMOTIONS.includes(e)) return e
  if (emotion) errLog(`非法 emotion "${emotion}" → idle`)
  return 'idle'
}

function parseResponse(text) {
  try { const p = JSON.parse(text); return { reply: p.reply || '呃...', emotion: validEmotion(p.emotion), completed_tasks: p.completed_tasks || [], need_search: !!p.need_search, search_topic: p.search_topic || null } } catch {}
  let bc = 0, st = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (st === -1) st = i; bc++ }
    else if (text[i] === '}') { bc--; if (bc === 0 && st !== -1) { try { const p = JSON.parse(text.slice(st, i+1)); return { reply: p.reply||'呃...', emotion: validEmotion(p.emotion), completed_tasks: p.completed_tasks||[], need_search: !!p.need_search, search_topic: p.search_topic||null } } catch {} st = -1 } }
  }
  let r = text.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  try { const p = JSON.parse(r); return { reply: p.reply||'呃...', emotion: validEmotion(p.emotion), completed_tasks: p.completed_tasks||[], need_search: !!p.need_search, search_topic: p.search_topic||null } } catch {}
  throw new Error(`JSON 解析失败: ${text.slice(0, 200)}...`)
}

module.exports = { sendMessage, sendSystemMessage, fetchModels, getPendingSearch, setPendingSearch, clearPendingSearch }
