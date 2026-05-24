/**
 * ===== web-search.js — 互联网搜索工具 =====
 *
 * 支持三种搜索引擎，通过 config.web_search_settings.provider 切换：
 *   - tavily: AI 专用搜索 API，免费 1000次/月，结果干净结构化
 *   - duckduckgo: 免费无需 Key，但覆盖面窄（仅即时答案卡片）
 *   - serper: Google 搜索结果 API，付费但效果好
 *
 * 返回值统一格式: { success: boolean, result: string, data?: object }
 *
 * 错误日志写入项目根目录 netpet-error.log
 *
 * @param {object} params — { query: 搜索关键词 }
 * @param {object} config — 全局配置
 */

const fs = require('fs')
const path = require('path')

const { app } = require('electron')
function getDataDir() {
  if (app.isPackaged) {
    return process.resourcesPath
  }
  return path.join(__dirname, '..', '..')
}
const ERROR_LOG = path.join(getDataDir(), 'netpet-error.log')

function logError(msg) {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${msg}\n`
  try {
    fs.appendFileSync(ERROR_LOG, line, 'utf-8')
  } catch {}
}

async function execute(params, config) {
  const { query } = params
  logError(`[web-search] execute 被调用, query="${query}", provider=${config.web_search_settings?.provider || '未配置'}`)

  if (!query || !query.trim()) {
    logError('[web-search] 参数不足：query 为空')
    return { success: false, result: '搜索参数不足：需要 query（搜索关键词）' }
  }

  const wsConfig = config.web_search_settings || {}
  if (!wsConfig.enabled) {
    logError('[web-search] 搜索功能未启用')
    return { success: false, result: '搜索功能未启用，请在设置中开启' }
  }

  const provider = wsConfig.provider || 'duckduckgo'
  const provSettings = wsConfig.providers?.[provider] || {}
  logError(`[web-search] 开始搜索: provider=${provider}, hasKey=${!!provSettings.api_key}`)

  try {
    switch (provider) {
      case 'tavily':
        return await searchTavily(query, provSettings)
      case 'serper':
        return await searchSerper(query, provSettings)
      case 'anthropic':
        return await searchAnthropicNative(query, provSettings)
      case 'duckduckgo':
      default:
        return await searchDuckDuckGo(query)
    }
  } catch (err) {
    const msg = `[web-search] ${provider} 搜索失败: ${err.message}`
    console.error(msg)
    logError(msg)
    return { success: false, result: `搜索失败 (${provider}): ${err.message}` }
  }
}

// ================================================================
// Tavily Search API
// ================================================================
// API 文档: https://docs.tavily.com/
// POST https://api.tavily.com/search
// 免费额度: 1000 次/月
async function searchTavily(query, provSettings) {
  const apiKey = provSettings.api_key
  if (!apiKey) {
    return { success: false, result: '未配置 Tavily API Key，请在设置中填写' }
  }

  const baseUrl = provSettings.base_url || 'https://api.tavily.com'
  const url = `${baseUrl.replace(/\/+$/, '')}/search`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      query: query,
      search_depth: 'basic',
      include_answer: true,
      max_results: 5
    })
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  return formatTavilyResult(query, data)
}

function formatTavilyResult(query, data) {
  const parts = [`搜索: "${query}"`]

  if (data.answer) {
    parts.push(`\n【摘要】${data.answer}`)
  }

  const results = data.results || []
  if (results.length > 0) {
    parts.push('\n【相关结果】')
    results.forEach((r, i) => {
      parts.push(`${i + 1}. ${r.title || ''}\n   ${(r.content || '').slice(0, 200)}`)
    })
  }

  if (!data.answer && results.length === 0) {
    parts.push('\n没有找到相关结果')
  }

  return { success: true, result: parts.join('\n'), data }
}

// ================================================================
// DuckDuckGo Instant Answer API
// ================================================================
// 免费，无需 API Key
// 局限性: 只返回知识库即时答案，不返回网页搜索结果
async function searchDuckDuckGo(query) {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
  logError(`[web-search] DDG 请求: ${url}`)

  const res = await fetch(url)
  if (!res.ok) {
    const errText = await res.text()
    logError(`[web-search] DDG HTTP ${res.status}: ${errText.slice(0, 300)}`)
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }

  const data = await res.json()
  logError(`[web-search] DDG 响应: AbstractText=${!!data.AbstractText}, RelatedTopics=${(data.RelatedTopics||[]).length}`)
  return formatDDGResult(query, data)
}

function formatDDGResult(query, data) {
  const parts = [`搜索: "${query}"`]
  let hasContent = false

  if (data.AbstractText && data.AbstractText.trim()) {
    parts.push(`\n【摘要】${data.AbstractText}`)
    if (data.AbstractSource) {
      parts.push(`  来源: ${data.AbstractSource}`)
    }
    hasContent = true
  }

  if (data.Answer && data.Answer.trim()) {
    parts.push(`\n【即时答案】${data.Answer}`)
    hasContent = true
  }

  const related = data.RelatedTopics || []
  const textResults = related.filter(r => r.Text && r.Text.trim())
  if (textResults.length > 0) {
    parts.push('\n【相关内容】')
    textResults.slice(0, 5).forEach((r, i) => {
      parts.push(`${i + 1}. ${r.Text.slice(0, 200)}`)
    })
    hasContent = true
  }

  if (!hasContent) {
    parts.push('\nDuckDuckGo 未返回相关内容，建议切换到 Tavily 获得更好搜索效果')
  }

  return { success: true, result: parts.join('\n'), data }
}

// ================================================================
// Serper (Google Search) API
// ================================================================
// API 文档: https://serper.dev/
// POST https://google.serper.dev/search
async function searchSerper(query, provSettings) {
  const apiKey = provSettings.api_key
  if (!apiKey) {
    return { success: false, result: '未配置 Serper API Key，请在设置中填写' }
  }

  const baseUrl = provSettings.base_url || 'https://google.serper.dev'
  const url = `${baseUrl.replace(/\/+$/, '')}/search`

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-API-KEY': apiKey,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ q: query, num: 5 })
  })

  if (!res.ok) {
    const errText = await res.text()
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  return formatSerperResult(query, data)
}

function formatSerperResult(query, data) {
  const parts = [`搜索: "${query}"`]

  const organic = data.organic || []
  if (organic.length > 0) {
    parts.push('\n【搜索结果】')
    organic.forEach((r, i) => {
      parts.push(`${i + 1}. ${r.title || ''}`)
      if (r.snippet) parts.push(`   ${r.snippet.slice(0, 200)}`)
    })
  }

  if (data.answerBox) {
    parts.push(`\n【答案】${data.answerBox.answer || data.answerBox.snippet || JSON.stringify(data.answerBox).slice(0, 200)}`)
  }

  if (organic.length === 0 && !data.answerBox) {
    parts.push('\n没有找到相关结果')
  }

  return { success: true, result: parts.join('\n'), data }
}

// ================================================================
// Anthropic Native Web Search（Claude 内建搜索，服务端执行）
// ================================================================
// 利用 Claude API 的 web_search_20250305 工具，搜索在 Anthropic 服务端完成
// 无需外部搜索引擎，结果直接嵌入 API 响应
// 需要 Anthropic API Key（https://console.anthropic.com）
async function searchAnthropicNative(query, provSettings) {
  const apiKey = provSettings.api_key
  if (!apiKey) {
    return { success: false, result: '未配置 Anthropic API Key，请在设置中填写' }
  }

  const model = provSettings.model || 'claude-haiku-4-5'
  const baseUrl = provSettings.base_url || 'https://api.anthropic.com/v1'

  logError(`[web-search] Anthropic 请求: query="${query}", model=${model}`)

  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'web-search-2025-03-05',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: model,
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Search the web for information about: ${query}\n\nProvide a concise summary of what you find.`
        }
      ],
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
    })
  })

  if (!res.ok) {
    const errText = await res.text()
    logError(`[web-search] Anthropic HTTP ${res.status}: ${errText.slice(0, 300)}`)
    throw new Error(`HTTP ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  logError(`[web-search] Anthropic 响应: stop_reason=${data.stop_reason}`)

  return formatAnthropicResult(query, data)
}

function formatAnthropicResult(query, data) {
  const parts = [`搜索: "${query}"`]

  // 遍历 content 块：text 块是 Claude 的回复，web_search_result 块是搜索结果
  const content = data.content || []
  for (const block of content) {
    if (block.type === 'text' && block.text) {
      parts.push(`\n【搜索结果】${block.text}`)
    }
    if (block.type === 'web_search_tool_result') {
      // 服务端搜索返回的结果（如果有的版本这样返回）
      parts.push(`\n【原始搜索】${JSON.stringify(block).slice(0, 500)}`)
    }
  }

  if (content.length === 0) {
    parts.push('\n未返回有效搜索结果')
  }

  return { success: true, result: parts.join('\n'), data }
}

module.exports = { name: 'web_search', execute }
