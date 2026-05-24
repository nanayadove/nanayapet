// ===== llm.js — LLM 通信核心 =====
//
// 这个文件负责和 LLM 大模型 API 通信。
// 用 npm 包 "openai" 提供的 OpenAI 客户端类，它可以连接任何兼容 OpenAI API 的服务。
//
// npm 包 openai 是什么？
//   标准的 OpenAI API 客户端库，支持 /chat/completions 端点。
//   虽然名叫 openai，但它可以连接 DeepSeek、Groq、本地 Ollama 等
//   任何兼容 OpenAI 接口的服务——只要设置 baseURL 指向对应的地址即可。
//
// 核心 API 调用：
//   client.chat.completions.create({
//     model: "模型名",
//     messages: [{role, content}, ...],
//     temperature: 0.7,     // 0-2，越高越随机
//     response_format: { type: 'json_object' },  // 强制 LLM 输出 JSON
//   })
//   返回：{ choices: [{ message: { content: "..." } }] }
//
// 两步推理架构：
//   用户输入
//     ↓
//   【步骤一】checkToolCall() — 调工具提取模型（便宜模型）
//   ├─ 分析：用户需要调用工具吗？（记笔记/设提醒/查询等）
//   ├─ 需要 → executeToolCall() 执行 → 结果注入上下文
//   └─ 不需要 → 直接跳步骤二
//     ↓
//   【步骤二】callChatModel() — 调主聊天模型（角色设定的 LLM）
//   ├─ 上下文：角色设定 + 未完成事项 + 最近对话 + 工具结果 + 用户输入
//   └─ 返回：{ reply, emotion }

// require('openai') — 引入 OpenAI Node.js SDK
// 类名大写开头是惯例（表示它是一个构造函数）
const OpenAI = require('openai')
const db = require('./db')
const tools = require('./tools/index')
// require('./tool-prompt') — 引入工具提取模型的提示词模板
const { buildToolPrompt } = require('./tool-prompt')

// 保存数据库就绪的 Promise，用于等待数据库初始化完成
let dbReady = db.getDb()

// ================================================================
// 辅助函数
// ================================================================

// makeClient(config, providerName) — 创建 OpenAI 客户端实例
// @param config — 完整配置对象
// @param providerName — 可选，指定服务商名称，不传就用配置里选中的
function makeClient(config, providerName) {
  // || 运算符：如果左边是 falsy (undefined/null/''/0)，取右边
  // 用于设置默认值
  const api = config.api_settings || {}
  const provName = providerName || api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key || !prov?.base_url) {
    throw new Error('API 未配置，请点击设置按钮配置！')
  }
  // new OpenAI({ apiKey, baseURL }) — 创建 API 客户端
  // apiKey: 用于 HTTP 请求认证的密钥
  // baseURL: API 基础地址，不同服务商地址不同
  return new OpenAI({ apiKey: prov.api_key, baseURL: prov.base_url })
}

// 获取当前所有活跃的工具记录（笔记、待办、提醒）
function getCurrentToolsContext() {
  return {
    notes: db.getToolsByType('note', 'active'),
    todos: db.getToolsByType('todo', 'active'),
    schedules: db.getToolsByType('schedule', 'active'),
  }
}

// buildPendingContext() — 构建"未完成事项"上下文
// 每次调主模型前动态注入，告诉 LLM 有哪些待办和提醒
// 格式示例：
//   [当前待办事项]
//   ☐ [2] 买猫粮 — 去超市买三文鱼味的猫粮 (待办)
//   ☐ [5] 休息提醒 — 去喝杯水活动一下 (提醒, 触发于 16:30)
// 返回格式 { role: 'system', content: '...' } 或 null（没有待办时）
function buildPendingContext() {
  const todos = db.getToolsByType('todo', 'active')
  const schedules = db.getToolsByType('schedule', 'active')

  if (todos.length === 0 && schedules.length === 0) return null

  // 拼接文本字符串
  let text = '\n[当前待办事项]\n'
  for (const t of todos) {
    text += `☐ [${t.id}] ${t.label || '(待办)'} — ${t.content || ''}\n`
  }
  for (const s of schedules) {
    // new Date(时间字符串) 创建日期对象
    // .toLocaleString('zh-CN', {}) 格式化为中文时间
    const timeStr = s.trigger_at
      ? new Date(s.trigger_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : ''
    text += `☐ [${s.id}] ${s.label || '提醒'} — ${s.content || ''} (提醒${timeStr ? ', 触发于 ' + timeStr : ''})\n`
  }
  text += '\n如果用户确认某件事已经做了，在回复的 completed_tasks 数组里填对应的 ID。\n'

  return { role: 'system', content: text }
}

// processCompletedTasks(tasks) — 处理 LLM 标记为完成的任务
// LLM 在回复中返回 completed_tasks: [1, 3]，表示 ID 1 和 3 的任务已完成
// 这里把对应的数据库记录标记为 completed
function processCompletedTasks(tasks) {
  // Array.isArray 是 JS 内置方法，判断值是不是数组
  if (!Array.isArray(tasks) || tasks.length === 0) return
  for (const id of tasks) {
    // parseInt 把字符串/数字转成整数
    // isNaN 判断是不是 NaN（不是数字）
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
// 用便宜模型分析用户输入，判断是否需要调用工具
async function checkToolCall(config, userText, systemPrompt) {
  const api = config.api_settings || {}
  // 工具提取服务商：如果设置了就用指定的，否则和对话用同一个
  const provName = api.tool_provider || api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key) return { tool: null, params: null }

  // 工具模型：如果设置了就用，否则用对话模型
  const toolModel = (api.tool_model && api.tool_model !== '同对话服务商') ? api.tool_model : prov.model
  const toolClient = makeClient(config, provName)

  const charName = config.character_settings?.name || '七夜喵'
  const toolCtx = getCurrentToolsContext()

  // 构建工具提取的 system prompt（告诉模型它只负责判断要不要调工具）
  const toolPrompt = buildToolPrompt(charName, toolCtx)
  // 加载最近 6 条对话作为上下文
  const recentHistory = db.loadContextForLlm(6)

  // 给用户输入加上当前时间戳，方便 AI 理解"八点""明天"等自然语言时间
  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long'
  })
  const userTextWithTime = `[当前系统时间: ${timeStr}] 用户说: ${userText}`

  try {
    // await — 等待异步操作（API 调用）返回结果
    // 函数声明为 async 后才能用 await
    const response = await toolClient.chat.completions.create({
      model: toolModel,
      messages: [
        { role: 'system', content: toolPrompt },
        // ...展开运算符：把数组的元素拆开放入
        // .slice(-4) 取数组最后 4 个元素
        ...recentHistory.slice(-4),
        { role: 'user', content: userTextWithTime },
      ],
      // response_format: { type: 'json_object' } — 告知 API 返回 JSON 格式
      // 不是所有模型都支持，不支持的会忽略
      response_format: { type: 'json_object' },
      temperature: 0.1,  // 低温度让工具判断更稳定
    })

    // response.choices[0].message.content — API 返回的文本内容
    const raw = response.choices[0].message.content
    // JSON.parse() 把 JSON 字符串转成 JS 对象
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

// executeToolCall(config, toolName, params) — 执行工具并返回结果
async function executeToolCall(config, toolName, params) {
  console.log(`[LLM] 执行工具: ${toolName}`, JSON.stringify(params))
  // tools.executeTool() 是 tools.js 的入口函数
  const result = await tools.executeTool(toolName, params, config)
  console.log(`[LLM] 工具结果:`, result.result)
  return result
}

// ================================================================
// ⭐ 步骤二：调主聊天模型（加上工具结果）
// ================================================================

// callChatModel(config, extraMessages, userContent, isSystem)
// 底层 LLM 调用 + 通用后处理
// @param config — 完整配置
// @param extraMessages — 额外的消息数组（如工具执行结果）
// @param userContent — 用户/系统输入文本
// @param isSystem — 是否为系统消息（true 时不保存为对话历史中的用户消息）
// @returns { reply: 回复文本, emotion: 情绪标签 }
async function callChatModel(config, extraMessages, userContent, isSystem) {
  // await dbReady — 等待数据库就绪后再继续
  await dbReady

  const api = config.api_settings || {}
  const provName = api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key || !prov?.base_url) throw new Error('API 未配置')

  const client = makeClient(config)
  const systemPrompt = config.character_settings?.system_prompt || ''
  // DeepSeek API 强制要求：使用 response_format json_object 时，prompt 中必须包含 "json"
  const promptHasJSON = systemPrompt.toLowerCase().includes('json')
  const effectivePrompt = promptHasJSON
    ? systemPrompt
    : systemPrompt + '\n请以JSON格式回复。'
  const model = prov.model || 'deepseek-v4-flash'
  const summaryInterval = api.summary_interval || 5
  // Math.max(a, b) — 取两个数中较大的，确保至少有足够的上下文
  const maxLen = Math.max(api.max_history_length || 10, summaryInterval * 2)

  // 给用户输入加时间戳
  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long'
  })
  // 三元表达式：条件 ? 真值 : 假值
  const finalContent = isSystem
    ? userContent
    : `[系统当前状态: 当前时间${timeStr}]\n用户说: ${userContent}`

  if (!isSystem) {
    // 保存用户消息到数据库
    db.saveMessage('user', finalContent)
  }

  // 构建完整上下文消息数组
  const pendingContext = buildPendingContext()
  const chatHistory = [
    { role: 'system', content: effectivePrompt },  // 角色设定
  ]
  if (pendingContext) chatHistory.push(pendingContext)  // 未完成事项
  // 加载最近对话历史
  chatHistory.push(...db.loadContextForLlm(maxLen))

  // 插入额外消息（如工具执行结果）
  if (extraMessages && extraMessages.length > 0) {
    for (const msg of extraMessages) {
      chatHistory.push(msg)
    }
  }

  // 当前输入
  const role = isSystem ? 'system' : 'user'
  chatHistory.push({ role, content: finalContent })

  // 调 LLM API
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
    // err.status 是 HTTP 状态码（401 未授权、429 限流、500 服务器错误等）
    if (err.status) console.error('[LLM] HTTP 状态码:', err.status)
    if (err.code) console.error('[LLM] 错误码:', err.code)
    throw new Error(`API 请求失败: ${err.message}`)
  }

  // 解析 LLM 返回的 JSON
  const answerText = response.choices[0].message.content
  const result = parseResponse(answerText)

  // 处理 completed_tasks：标记完成的任务
  if (result.completed_tasks) {
    processCompletedTasks(result.completed_tasks)
  }

  // 保存 AI 回复到数据库
  db.saveMessage('assistant', answerText)

  // 检查是否需要总结记忆（后台异步执行，不阻塞响应）
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

// ================================================================
// 用户发消息（完整两步推理）
// ================================================================
// 这是给渲染进程调用的主入口函数
async function sendMessage(config, userText) {
  let toolResult = null
  // 步骤一：工具提取
  const toolDecision = await checkToolCall(config, userText, config.character_settings?.system_prompt || '')

  if (toolDecision.tool) {
    // 执行工具
    toolResult = await executeToolCall(config, toolDecision.tool, toolDecision.params)
    if (toolResult) {
      // 把工具执行结果保存到数据库（作为对话上下文的一部分）
      db.saveMessage('system', `[工具调用: ${toolDecision.tool}] ${toolResult.result}`)
    }
  }

  // 构建额外消息：如果有工具结果，告诉主模型刚才执行了什么工具
  const extraMessages = toolResult
    ? [{ role: 'system', content: `[系统: 刚才执行了工具 "${toolDecision.tool}"，结果如下]\n${toolResult.result}` }]
    : []

  // 步骤二：调主聊天模型
  return await callChatModel(config, extraMessages, userText, false)
}

// ================================================================
// 系统主动发消息（定时提醒等，不走工具提取）
// ================================================================
// 用于定时提醒、系统通知等场景
// 和 sendMessage 的区别：不走工具提取步骤，直接调主模型
async function sendSystemMessage(config, systemContent) {
  const result = await callChatModel(config, [], systemContent, true)

  // 补存系统触发源消息，方便查看记录
  db.saveMessage('system', systemContent)

  return result
}

// ================================================================
// 获取模型列表（设置页面的"获取列表"按钮用）
// ================================================================
// fetch(url, options) — 浏览器/Node.js 内置的 HTTP 请求函数
// fetchModels(baseUrl, apiKey) 调 GET /models 获取服务商的模型列表
async function fetchModels(baseUrl, apiKey) {
  if (!baseUrl || !apiKey) throw new Error('请先填写 Base URL 和 API Key')
  // String.replace(正则, 替换) — .replace(/\/+$/, '') 去掉 URL 末尾多余的斜杠
  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  // res.ok — HTTP 状态码在 200-299 范围时为 true
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  // res.json() — 解析响应体为 JSON 对象
  const data = await res.json()
  // data.data 是 OpenAI API 返回的模型数组，每个元素是 {id: "模型名", ...}
  // .map(m => m.id) — 提取所有模型的 id 字段组成新数组
  return data.data?.map(m => m.id) || []
}

// ================================================================
// 解析 LLM 返回的 JSON（三级容错）
// ================================================================
// LLM 返回的 JSON 格式：{ reply, emotion, completed_tasks? }
// 因为 LLM 有时不严格输出纯 JSON（会多输出说明文字），所以需要容错处理
function parseResponse(text) {
  // 策略 1：直接 parse（最简单的情况，LLM 严格输出了纯 JSON）
  try {
    const parsed = JSON.parse(text)
    return {
      reply: parsed.reply || '呃...',
      emotion: parsed.emotion || 'idle',
      completed_tasks: parsed.completed_tasks || [],
    }
  } catch {}
  // 空 catch 块：忽略解析失败，继续下一个策略

  // 策略 2：提取第一个完整的 JSON 对象（LLM 在 JSON 前后加了文字）
  // 算法：用大括号计数器找到完整闭合的 { ... }
  let braceCount = 0  // 大括号深度
  let start = -1      // 第一个 { 的位置
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (start === -1) start = i  // 记录第一个 { 的位置
      braceCount++
    } else if (text[i] === '}') {
      braceCount--
      if (braceCount === 0 && start !== -1) {
        // 大括号完全闭合，提取这段子字符串
        const candidate = text.slice(start, i + 1)
        try {
          const parsed = JSON.parse(candidate)
          return {
            reply: parsed.reply || '呃...',
            emotion: parsed.emotion || 'idle',
            completed_tasks: parsed.completed_tasks || [],
          }
        } catch {}
        start = -1  // 重置，继续找下一个 JSON 块
      }
    }
  }

  // 策略 3：修复后解析（转义问题）
  // LLM 可能在 JSON 字符串值里输出未转义的换行符、反斜杠等
  // 用正则替换修复常见问题：
  //   \\(?!["\\/bfnrt]|u[0-9a-fA-F]{4}) — 匹配无效的转义字符
  //   .replace(/\n/g, '\\n') — 换行符转成 \n 字符串
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

  // 所有策略都失败，抛出错误
  throw new Error(`JSON 解析失败: ${text.slice(0, 200)}...`)
}

module.exports = { sendMessage, sendSystemMessage, fetchModels }
