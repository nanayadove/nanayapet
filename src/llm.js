// ===== llm.js — LLM 通信核心 =====
//
// 用 Vercel AI SDK v6 统一多 Provider 调用层。
// 通过动态 import() 加载 ESM-only 的 ai / @ai-sdk/openai，在 CommonJS 中使用。
//
// AI SDK 核心 API：
//   createOpenAI({ apiKey, baseURL }) → provider(modelName) → 兼容所有 OpenAI 格式服务
//   generateText({ model, messages, ... }) → { text }
//   streamText({ model, messages, ... }) → { textStream }
//
// 两步推理架构不变：
//   用户输入
//     ↓
//   【步骤一】checkToolCall() — 调工具提取模型（便宜模型）
//   ├─ 分析：用户需要调用工具吗？
//   ├─ 需要 → executeToolCall() 执行 → 结果注入上下文
//   └─ 不需要 → 直接跳步骤二
//     ↓
//   【步骤二】callChatModel() — 调主聊天模型（角色设定的 LLM）
//   ├─ 上下文：角色设定 + 未完成事项 + 最近对话 + 工具结果 + 用户输入
//   └─ 返回：{ reply, emotion }

const { createProvider, chatCompletion } = require('./ai-provider')
const db = require('./db')
const tools = require('./tools/index')
const { buildToolPrompt } = require('./tool-prompt')

let dbReady = db.getDb()

// ================================================================
// 辅助函数
// ================================================================

// makeModel(config, providerName) — 异步创建 AI SDK 模型实例
// 替换原来的 makeClient()，通过 AI SDK 统一创建 provider + model
async function makeModel(config, providerName) {
  const api = config.api_settings || {}
  const provName = providerName || api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key || !prov?.base_url) {
    throw new Error('API 未配置，请点击设置按钮配置！')
  }
  const provider = await createProvider(prov.api_key, prov.base_url)
  return { model: (modelName) => provider.model(modelName || prov.model) }
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
  for (const t of todos) {
    text += `☐ [${t.id}] ${t.label || '(待办)'} — ${t.content || ''}\n`
  }
  for (const s of schedules) {
    const timeStr = s.trigger_at
      ? new Date(s.trigger_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : ''
    text += `☐ [${s.id}] ${s.label || '提醒'} — ${s.content || ''} (提醒${timeStr ? ', 触发于 ' + timeStr : ''})\n`
  }
  text += '\n如果用户确认某件事已经做了，在回复的 completed_tasks 数组里填对应的 ID。\n'
  return { role: 'system', content: text }
}

function processCompletedTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) return
  for (const id of tasks) {
    const numId = parseInt(id)
    if (!isNaN(numId)) {
      db.completeTool(numId)
      console.log(`[LLM] completed_tasks: ID ${numId} 标记完成`)
    }
  }
}

// ================================================================
// ⭐ 步骤一：工具提取模型
// ================================================================
async function checkToolCall(config, userText, systemPrompt) {
  const api = config.api_settings || {}
  const provName = api.tool_provider || api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key) return { tool: null, params: null }

  const toolModelName = (api.tool_model && api.tool_model !== '同对话服务商')
    ? api.tool_model : prov.model

  const charName = config.character_settings?.name || '七夜喵'
  const toolCtx = getCurrentToolsContext()
  const toolPrompt = buildToolPrompt(charName, toolCtx)
  const recentHistory = db.loadContextForLlm(6)

  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long'
  })
  const userTextWithTime = `[当前系统时间: ${timeStr}] 用户说: ${userText}`

  try {
    // 通过 AI SDK 创建 model
    const { model: createModel } = await makeModel(config, provName)
    const model = createModel(toolModelName)

    const { text } = await chatCompletion({
      model,
      messages: [
        { role: 'system', content: toolPrompt },
        ...recentHistory.slice(-4),
        { role: 'user', content: userTextWithTime },
      ],
      temperature: 0.1,
      stream: false,
      jsonMode: true,  // → providerOptions.openai.responseFormat: json_object
    })

    const parsed = JSON.parse(text)
    if (parsed && parsed.tool) {
      console.log(`[LLM] checkToolCall 决定调用工具: ${parsed.tool}`, parsed.params)
      return { tool: parsed.tool, params: parsed.params || {}, raw: text }
    }
    console.log(`[LLM] checkToolCall 不需要工具, reason: ${parsed?.reason || '无'}`)
    return { tool: null, params: null, raw: text }
  } catch (err) {
    console.error('[LLM] 工具提取模型调用失败:', err.message)
    return { tool: null, params: null }
  }
}

async function executeToolCall(config, toolName, params) {
  console.log(`[LLM] 执行工具: ${toolName}`, JSON.stringify(params))
  const result = await tools.executeTool(toolName, params, config)
  console.log(`[LLM] 工具结果:`, result.result)
  return result
}

// ================================================================
// ⭐ 步骤二：调主聊天模型（加上工具结果）
// ================================================================
async function callChatModel(config, extraMessages, userContent, isSystem) {
  await dbReady

  const api = config.api_settings || {}
  const provName = api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key || !prov?.base_url) throw new Error('API 未配置')

  const systemPrompt = config.character_settings?.system_prompt || ''
  const promptHasJSON = systemPrompt.toLowerCase().includes('json')
  const effectivePrompt = promptHasJSON
    ? systemPrompt
    : systemPrompt + '\n请以JSON格式回复。'
  const modelName = prov.model || 'deepseek-v4-flash'
  const summaryInterval = api.summary_interval || 5
  const maxLen = Math.max(api.max_history_length || 10, summaryInterval * 2)

  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long'
  })
  const finalContent = isSystem
    ? userContent
    : `[系统当前状态: 当前时间${timeStr}]\n用户说: ${userContent}`

  if (!isSystem) {
    db.saveMessage('user', finalContent)
  }

  const pendingContext = buildPendingContext()
  const chatHistory = [
    { role: 'system', content: effectivePrompt },
  ]
  if (pendingContext) chatHistory.push(pendingContext)
  chatHistory.push(...db.loadContextForLlm(maxLen))

  if (extraMessages && extraMessages.length > 0) {
    for (const msg of extraMessages) {
      chatHistory.push(msg)
    }
  }

  const role = isSystem ? 'system' : 'user'
  chatHistory.push({ role, content: finalContent })

  // 通过 AI SDK 调用 LLM
  const { model: createModel } = await makeModel(config)
  const model = createModel(modelName)
  console.log(`[LLM] model created:`, typeof model, model?.modelId || 'unknown')

  let answerText
  try {
    const result = await chatCompletion({
      model,
      messages: chatHistory,
      temperature: api.temperature || 0.7,
      stream: !!api.stream_enabled,
      jsonMode: true,
    })
    answerText = result.text
    // 调试：完整 result 对象
    console.log('[LLM] AI SDK result keys:', Object.keys(result))
    console.log('[LLM] AI SDK result:', JSON.stringify(result, null, 2).slice(0, 1000))
    // 写完整响应到日志文件，方便排查 JSON 解析失败
    try {
      const fs = require('fs')
      const path = require('path')
      fs.appendFileSync(path.join(__dirname, '..', 'netpet-error.log'),
        `[${new Date().toISOString()}] [LLM] Raw response:\n${answerText}\n---END---\n`, 'utf-8')
    } catch {}
    console.log(`[LLM] 原始响应:`, answerText)
  } catch (err) {
    console.error('[LLM] API 请求失败:', err.message)
    if (err.statusCode) console.error('[LLM] HTTP 状态码:', err.statusCode)
    throw new Error(`API 请求失败: ${err.message}`)
  }

  const parsed = parseResponse(answerText)

  if (parsed.completed_tasks) {
    processCompletedTasks(parsed.completed_tasks)
  }

  db.saveMessage('assistant', answerText)

  // 检查是否需要总结记忆
  const summaryData = db.checkAndSummarize(null, modelName, summaryInterval)
  if (summaryData) {
    try {
      await db.doSummarize(api, summaryData)
    } catch (err) {
      console.error('后台总结失败:', err.message)
    }
  }

  return { reply: parsed.reply, emotion: parsed.emotion }
}

// ================================================================
// 用户发消息（完整两步推理）
// ================================================================
async function sendMessage(config, userText) {
  let toolResult = null
  const toolDecision = await checkToolCall(config, userText, config.character_settings?.system_prompt || '')

  if (toolDecision.tool) {
    toolResult = await executeToolCall(config, toolDecision.tool, toolDecision.params)
    if (toolResult) {
      db.saveMessage('system', `[工具调用: ${toolDecision.tool}] ${toolResult.result}`)
    }
  }

  const extraMessages = toolResult
    ? [{ role: 'system', content: `[系统: 刚才执行了工具 "${toolDecision.tool}"，结果如下]\n${toolResult.result}` }]
    : []

  return await callChatModel(config, extraMessages, userText, false)
}

// ================================================================
// 系统主动发消息（定时提醒等，不走工具提取）
// ================================================================
async function sendSystemMessage(config, systemContent) {
  const result = await callChatModel(config, [], systemContent, true)
  db.saveMessage('system', systemContent)
  return result
}

// ================================================================
// 获取模型列表（设置页面的"获取列表"按钮用）
// ================================================================
async function fetchModels(baseUrl, apiKey) {
  if (!baseUrl || !apiKey) throw new Error('请先填写 Base URL 和 API Key')
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  const data = await res.json()
  return data.data?.map(m => m.id) || []
}

// ================================================================
// 解析 LLM 返回的 JSON（三级容错）
// ================================================================

const VALID_EMOTIONS = ['idle', 'happy', 'angry', 'sad', 'shy', 'confused']

function validEmotion(emotion) {
  const e = (emotion || '').trim().toLowerCase()
  if (VALID_EMOTIONS.includes(e)) return e
  if (emotion) console.error(`[LLM] 非法 emotion 值: "${emotion}" → 降级为 idle`)
  return 'idle'
}

function parseResponse(text) {
  // 策略 1：直接 parse
  try {
    const parsed = JSON.parse(text)
    return {
      reply: parsed.reply || '呃...',
      emotion: validEmotion(parsed.emotion),
      completed_tasks: parsed.completed_tasks || [],
    }
  } catch {}

  // 策略 2：提取第一个完整的 JSON 对象
  let braceCount = 0
  let start = -1
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (start === -1) start = i
      braceCount++
    } else if (text[i] === '}') {
      braceCount--
      if (braceCount === 0 && start !== -1) {
        const candidate = text.slice(start, i + 1)
        try {
          const parsed = JSON.parse(candidate)
          return {
            reply: parsed.reply || '呃...',
            emotion: validEmotion(parsed.emotion),
            completed_tasks: parsed.completed_tasks || [],
          }
        } catch {}
        start = -1
      }
    }
  }

  // 策略 3：修复后解析
  let repaired = text
    .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  try {
    const parsed = JSON.parse(repaired)
    return {
      reply: parsed.reply || '呃...',
      emotion: validEmotion(parsed.emotion),
      completed_tasks: parsed.completed_tasks || [],
    }
  } catch {}

  throw new Error(`JSON 解析失败: ${text.slice(0, 200)}...`)
}

module.exports = { sendMessage, sendSystemMessage, fetchModels }
