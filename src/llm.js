// ===== llm.js — LLM 通信核心 =====
//
// 两步推理架构：
//
//   用户输入（或系统提醒）
//     ↓
//   【步骤一】checkToolCall() — 调工具提取模型（便宜模型）
//     ├─ 需要工具(write_file/schedule等) → 执行 → 结果注入上下文
//     └─ 不需要 → 直接跳
//     ↓
//   【步骤二】调主聊天模型（角色设定的 LLM）
//     ├─ 上下文 = [角色设定 + 未完成事项 + 最近对话 + 工具结果 + 用户输入]
//     ├─ 调 LLM
//     └─ 返回 { reply, emotion, completed_tasks }
//          completed_tasks 数组 → 后端自动标记数据库

const OpenAI = require('openai')
const db = require('./db')
const tools = require('./tools')
const { buildToolPrompt } = require('./tool-prompt')

let dbReady = db.getDb()

// ---- 辅助函数 ----

function makeClient(config, providerName) {
  const api = config.api_settings || {}
  const provName = providerName || api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key || !prov?.base_url) {
    throw new Error('API 未配置，请点击设置按钮配置！')
  }
  return new OpenAI({ apiKey: prov.api_key, baseURL: prov.base_url })
}

function getCurrentToolsContext() {
  return {
    notes: db.getToolsByType('note', 'active'),
    todos: db.getToolsByType('todo', 'active'),
    schedules: db.getToolsByType('schedule', 'active'),
  }
}

/**
 * 构建"未完成事项"上下文消息
 * 每次调主模型前动态注入，不写在角色 prompt 里
 * 格式：
 *   [当前待办事项]
 *   ☐ [2] 买猫粮 — 去超市买三文鱼味的猫粮 (待办)
 *   ☐ [5] 休息提醒 — 去喝杯水活动一下 (提醒, 触发于 16:30)
 *
 *   如果用户确认某件事已经做了，在 completed_tasks 数组里填对应的 ID。
 */
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

/**
 * 处理 completed_tasks：把 LLM 标记为完成的任务写入数据库
 */
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

// =================================================================
// ⭐ 步骤一：工具提取模型
// =================================================================
async function checkToolCall(config, userText, systemPrompt) {
  const api = config.api_settings || {}
  const provName = api.tool_provider || api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key) return { tool: null, params: null }

  // 如果设置了工具模型就用它，否则用对话模型
  const toolModel = (api.tool_model && api.tool_model !== '同对话服务商') ? api.tool_model : prov.model
  const toolClient = makeClient(config, provName)

  const charName = config.character_settings?.name || '七夜喵'
  const toolCtx = getCurrentToolsContext()

  const toolPrompt = buildToolPrompt(charName, toolCtx)
  const recentHistory = db.loadContextForLlm(6)

  try {
    const response = await toolClient.chat.completions.create({
      model: toolModel,
      messages: [
        { role: 'system', content: toolPrompt },
        ...recentHistory.slice(-4),
        { role: 'user', content: userText },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    })

    const raw = response.choices[0].message.content
    const parsed = JSON.parse(raw)
    if (parsed && parsed.tool) {
      return { tool: parsed.tool, params: parsed.params || {}, raw }
    }
    return { tool: null, params: null, raw }
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

// =================================================================
// ⭐ 底层：真正调 LLM API，加上通用处理
// =================================================================
/**
 * 底层 LLM 调用 + 通用后处理
 *
 * 统一处理：
 *   1. 注入未完成事项上下文
 *   2. 调 API
 *   3. 解析 JSON + 提取 completed_tasks
 *   4. 保存到数据库
 *   5. 检查总结
 *
 * @param {object} config
 * @param {Array} extraMessages - 额外的消息（在用户输入之前插入）
 * @param {string} userContent - 用户/系统输入文本
 * @param {boolean} isSystem - 是否为系统消息（不保存为对话历史中的"用户"消息）
 * @returns {{ reply: string, emotion: string }}
 */
async function callChatModel(config, extraMessages, userContent, isSystem) {
  await dbReady

  const api = config.api_settings || {}
  const provName = api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key || !prov?.base_url) throw new Error('API 未配置')

  const client = makeClient(config)
  const systemPrompt = config.character_settings?.system_prompt || ''
  const model = prov.model || 'deepseek-v4-flash'
  const summaryInterval = api.summary_interval || 5
  const maxLen = Math.max(api.max_history_length || 10, summaryInterval * 2)

  // 给用户输入加时间戳（如果是用户发的）
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

  // 构建上下文：角色设定 + 未完成事项(动态注入) + 对话历史 + 额外消息 + 当前输入
  const pendingContext = buildPendingContext()
  const chatHistory = [
    { role: 'system', content: systemPrompt },
  ]
  if (pendingContext) chatHistory.push(pendingContext)
  chatHistory.push(...db.loadContextForLlm(maxLen))

  // 额外消息（如工具执行结果）
  if (extraMessages && extraMessages.length > 0) {
    // 找到最后一条对话，在它前面插入额外消息
    // 但简单点：直接追加到末尾（LLM 会按顺序理解）
    for (const msg of extraMessages) {
      chatHistory.push(msg)
    }
  }

  // 当前输入
  const role = isSystem ? 'system' : 'user'
  chatHistory.push({ role, content: finalContent })

  // 调 LLM
  let response
  try {
    response = await client.chat.completions.create({
      model: model,
      messages: chatHistory,
      response_format: { type: 'json_object' },
      temperature: api.temperature || 0.7,
    })
  } catch (err) {
    console.error('[LLM] API 请求失败:', err.message)
    if (err.status) console.error('[LLM] HTTP 状态码:', err.status)
    if (err.code) console.error('[LLM] 错误码:', err.code)
    throw new Error(`API 请求失败: ${err.message}`)
  }

  const answerText = response.choices[0].message.content
  const result = parseResponse(answerText)

  // 处理 completed_tasks
  if (result.completed_tasks) {
    processCompletedTasks(result.completed_tasks)
  }

  // 保存 AI 回复到数据库
  db.saveMessage('assistant', answerText)

  // 检查是否需要总结
  const summaryData = db.checkAndSummarize(client, model, summaryInterval)
  if (summaryData) {
    try {
      await db.doSummarize(api, summaryData)
    } catch (err) {
      console.error('后台总结失败:', err.message)
    }
  }

  return { reply: result.reply, emotion: result.emotion }
}

// =================================================================
// 用户发消息（完整两步推理）
// =================================================================
/**
 * 用户发送消息 — 走完整两步推理
 *   1. 工具提取 → 执行 → 结果注入
 *   2. 调主聊天模型
 */
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

// =================================================================
// 系统主动发消息（定时提醒等，不走工具提取）
// =================================================================
/**
 * 系统主动发送消息给主模型（不走工具提取）
 * 用于：定时提醒到期、系统通知等
 *
 * @param {object} config
 * @param {string} systemContent - 系统消息内容
 *   例如："[系统提醒: 时间已到 — 提醒用户：去喝水]"
 *   注意：不写"主人""你"等特定称呼，让 LLM 根据自身角色设定决定如何称呼用户
 * @returns {{ reply: string, emotion: string }}
 */
async function sendSystemMessage(config, systemContent) {
  // 系统消息不走工具提取，直接调主模型
  // 系统消息不保存为"用户"消息（isSystem=true 时 callChatModel 不保存）
  const result = await callChatModel(config, [], systemContent, true)

  // 但系统触发的对话需要存为一条交互，方便追溯
  // callChatModel 中 isSystem=true 时不存 user 消息，只存了 assistant
  // 这里补存 system 角色的源消息
  db.saveMessage('system', systemContent)

  return result
}

// =================================================================
// 获取模型列表
// =================================================================
async function fetchModels(baseUrl, apiKey) {
  if (!baseUrl || !apiKey) throw new Error('请先填写 Base URL 和 API Key')
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  const data = await res.json()
  return data.data?.map(m => m.id) || []
}

// =================================================================
// 解析 LLM 返回的 JSON
// =================================================================
/**
 * 解析 LLM 返回的 JSON 文本
 * 格式：{ reply, emotion, completed_tasks }
 *
 * completed_tasks 是可选的 ID 数组，用户确认完成某件事时填
 * 例如：{ reply: "搞定了喵", emotion: "happy", completed_tasks: [1, 3] }
 *
 * 使用三级容错策略，和原来一样
 */
function parseResponse(text) {
  // 策略 1：直接解析
  try {
    const parsed = JSON.parse(text)
    return {
      reply: parsed.reply || '呃...',
      emotion: parsed.emotion || 'idle',
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
            emotion: parsed.emotion || 'idle',
            completed_tasks: parsed.completed_tasks || [],
          }
        } catch {}
        start = -1
      }
    }
  }

  // 策略 3：修复后再解析
  let repaired = text
    .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  try {
    const parsed = JSON.parse(repaired)
    return {
      reply: parsed.reply || '呃...',
      emotion: parsed.emotion || 'idle',
      completed_tasks: parsed.completed_tasks || [],
    }
  } catch {}

  throw new Error(`JSON 解析失败: ${text.slice(0, 200)}...`)
}

module.exports = { sendMessage, sendSystemMessage, fetchModels }
