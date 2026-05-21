const OpenAI = require('openai')
const db = require('./db')

// 启动时初始化数据库
let dbReady = db.getDb()

// 总结锁：防止重复触发
let isSummarizing = false

/**
 * 向 LLM 发送消息，自动管理对话历史和记忆
 * 返回 { reply, emotion }
 */
async function sendMessage(config, userText) {
  await dbReady  // 等待数据库初始化完成
  const api = config.api_settings || {}
  const provName = api.provider || 'deepseek'
  const prov = api.providers?.[provName]

  if (!prov?.api_key || !prov?.base_url) {
    throw new Error('API 未配置，请点击设置按钮配置！')
  }

  const client = new OpenAI({
    apiKey: prov.api_key,
    baseURL: prov.base_url,
  })

  const systemPrompt = config.character_settings?.system_prompt || ''
  const model = prov.model || 'deepseek-v4-flash'
  const summaryInterval = api.summary_interval || 5
  const maxLen = Math.max(api.max_history_length || 10, summaryInterval * 2)

  // 1. 先根据时间生成带上下文的用户输入
  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    weekday: 'long'
  })
  const contextAwareInput = `[系统当前状态: 当前时间${timeStr}]\n用户说: ${userText}`

  // 2. 保存用户输入到数据库
  db.saveMessage('user', contextAwareInput)

  // 3. 从数据库构建对话上下文
  const chatHistory = [
    { role: 'system', content: systemPrompt },
    ...db.loadContextForLlm(maxLen),
  ]

  // 4. 调 LLM
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

  // 5. 保存 AI 回复
  db.saveMessage('assistant', answerText)

  // 6. 检查是否需要总结，同步执行避免重复
  const summaryData = db.checkAndSummarize(client, model, summaryInterval)
  if (summaryData) {
    try {
      await db.doSummarize(api, summaryData)
    } catch (err) {
      console.error('后台总结失败:', err.message)
    }
  }

  return result
}

/**
 * 获取模型列表（用于连接测试）
 */
async function fetchModels(baseUrl, apiKey) {
  if (!baseUrl || !apiKey) {
    throw new Error('请先填写 Base URL 和 API Key')
  }

  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }

  const data = await res.json()
  return data.data?.map(m => m.id) || []
}

/**
 * 解析 LLM 返回的 JSON
 */
function parseResponse(text) {
  try {
    const parsed = JSON.parse(text)
    return {
      reply: parsed.reply || '呃...',
      emotion: parsed.emotion || 'idle',
    }
  } catch {
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0])
        return {
          reply: parsed.reply || '呃...',
          emotion: parsed.emotion || 'idle',
        }
      } catch {}
    }
    throw new Error(`JSON 解析失败: ${text}`)
  }
}

module.exports = { sendMessage, fetchModels }
