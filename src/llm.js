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

const LOG = path.join(__dirname, '..', 'netpet-error.log')
function log(msg) {
  const line = `[${new Date().toISOString()}] [LLM] ${msg}\n`
  console.log(line.trim())
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
    log('AI SDK 加载成功')
    return _aiSdk
  } catch (err) {
    log(`AI SDK 加载失败: ${err.message}`)
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
    const model = openai(modelName)
    log(`AI model 创建: modelId=${model?.modelId || '???'}`)
    return model
  } catch (err) {
    log(`AI model 创建失败: ${err.message}`)
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
        log(`AI SDK 调用成功, text 长度=${text.length}, 前100字符="${text.slice(0,100)}"`)
        if (!text || text.trim() === '') {
          log('AI SDK 返回空文本，降级到 raw SDK')
        } else {
          return text
        }
      } catch (err) {
        log(`AI SDK 调用异常: ${err.message}，降级到 raw SDK`)
      }
    }
  }
  // 降级：原始 OpenAI SDK
  log(`使用 raw SDK 调用, model=${modelName}`)
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
  for (const id of tasks) { const n = parseInt(id); if (!isNaN(n)) { db.completeTool(n); log(`completed_tasks: ID ${n} 标记完成`) } }
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
    if (parsed && parsed.tool) { log(`checkToolCall → ${parsed.tool}`); return { tool: parsed.tool, params: parsed.params || {}, raw } }
    return { tool: null, params: null, raw }
  } catch (err) { log(`工具提取失败: ${err.message}`); return { tool: null, params: null } }
}

async function executeToolCall(config, toolName, params) {
  log(`执行工具: ${toolName}`)
  const result = await tools.executeTool(toolName, params, config)
  log(`工具结果: ${result.result?.slice(0, 100)}`)
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
  const effectivePrompt = systemPrompt.toLowerCase().includes('json') ? systemPrompt : systemPrompt + '\n请以JSON格式回复。'
  const modelName = prov.model || 'deepseek-v4-flash'
  const summaryInterval = api.summary_interval || 5
  const maxLen = Math.max(api.max_history_length || 10, summaryInterval * 2)
  const temperature = api.temperature ?? 0.7
  const stream = !!api.stream_enabled

  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long' })
  const finalContent = isSystem ? userContent : `[系统当前状态: 当前时间${timeStr}]\n用户说: ${userContent}`
  if (!isSystem) db.saveMessage('user', finalContent)

  const chatHistory = [{ role: 'system', content: effectivePrompt }]
  const pending = buildPendingContext(); if (pending) chatHistory.push(pending)
  chatHistory.push(...db.loadContextForLlm(maxLen))
  if (extraMessages?.length) for (const m of extraMessages) chatHistory.push(m)
  chatHistory.push({ role: isSystem ? 'system' : 'user', content: finalContent })

  // 准备双引擎
  const client = makeClient(config)
  const aiModel = await makeAiModel(prov.api_key, prov.base_url, modelName)

  let answerText
  try {
    answerText = await callLLM({ client, aiModel, messages: chatHistory, temperature, stream, modelName })
  } catch (err) {
    log(`API 请求失败: ${err.message}`)
    throw new Error(`API 请求失败: ${err.message}`)
  }

  const result = parseResponse(answerText)
  if (result.completed_tasks) processCompletedTasks(result.completed_tasks)
  db.saveMessage('assistant', answerText)

  const summaryData = db.checkAndSummarize(client, modelName, summaryInterval)
  if (summaryData) {
    try { await db.doSummarize(api, summaryData) } catch (err) { log(`后台总结失败: ${err.message}`) }
  }

  return { reply: result.reply, emotion: result.emotion }
}

// ================================================================
// 对外接口（不变）
// ================================================================
async function sendMessage(config, userText) {
  let toolResult = null
  const toolDecision = await checkToolCall(config, userText, config.character_settings?.system_prompt || '')
  if (toolDecision.tool) {
    toolResult = await executeToolCall(config, toolDecision.tool, toolDecision.params)
    if (toolResult) db.saveMessage('system', `[工具调用: ${toolDecision.tool}] ${toolResult.result}`)
  }
  const extraMessages = toolResult ? [{ role: 'system', content: `[系统: 刚才执行了工具 "${toolDecision.tool}"，结果如下]\n${toolResult.result}` }] : []
  return await callChatModel(config, extraMessages, userText, false)
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
// JSON 解析（三级容错）
// ================================================================
const VALID_EMOTIONS = ['idle', 'happy', 'angry', 'sad', 'shy', 'confused']

function validEmotion(emotion) {
  const e = (emotion || '').trim().toLowerCase()
  if (VALID_EMOTIONS.includes(e)) return e
  if (emotion) log(`非法 emotion "${emotion}" → idle`)
  return 'idle'
}

function parseResponse(text) {
  try { const p = JSON.parse(text); return { reply: p.reply || '呃...', emotion: validEmotion(p.emotion), completed_tasks: p.completed_tasks || [] } } catch {}
  let bc = 0, st = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') { if (st === -1) st = i; bc++ }
    else if (text[i] === '}') { bc--; if (bc === 0 && st !== -1) { try { const p = JSON.parse(text.slice(st, i+1)); return { reply: p.reply||'呃...', emotion: validEmotion(p.emotion), completed_tasks: p.completed_tasks||[] } } catch {} st = -1 } }
  }
  let r = text.replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')
  try { const p = JSON.parse(r); return { reply: p.reply||'呃...', emotion: validEmotion(p.emotion), completed_tasks: p.completed_tasks||[] } } catch {}
  throw new Error(`JSON 解析失败: ${text.slice(0, 200)}...`)
}

module.exports = { sendMessage, sendSystemMessage, fetchModels }
