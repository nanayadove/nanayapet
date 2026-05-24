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
 * @param {object} params — { query: 搜索关键词 }
 * @param {object} config — 全局配置
 */

async function execute(params, config) {
  const { query } = params
  if (!query || !query.trim()) {
    return { success: false, result: '搜索参数不足：需要 query（搜索关键词）' }
  }

  const wsConfig = config.web_search_settings || {}
  if (!wsConfig.enabled) {
    return { success: false, result: '搜索功能未启用，请在设置中开启' }
  }

  const provider = wsConfig.provider || 'duckduckgo'
  const provSettings = wsConfig.providers?.[provider] || {}

  try {
    switch (provider) {
      case 'tavily':
        return await searchTavily(query, provSettings)
      case 'serper':
        return await searchSerper(query, provSettings)
      case 'duckduckgo':
      default:
        return await searchDuckDuckGo(query)
    }
  } catch (err) {
    console.error(`[web-search] ${provider} 搜索失败:`, err.message)
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

  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  }

  const data = await res.json()
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

module.exports = { name: 'web_search', execute }
