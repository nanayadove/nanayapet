/**
 * ===== search-knowledge.js — 知识库搜索工具 =====
 *
 * 搜索 facts 表（用户事实）和 knowledge 表（外部知识）。
 * 支持 LIKE 模糊匹配。
 *
 * @param {object} params — { query: 搜索关键词 }
 * @returns {{ success: boolean, result: string, data?: object }}
 */
const db = require('../db')

function execute(params) {
  const { query } = params

  if (!query || !query.trim()) {
    return { success: false, result: '需要提供 query 参数（搜索关键词）' }
  }

  const facts = db.searchFactsLike(query)
  const knowledge = db.searchKnowledgeLike(query)

  const parts = [`搜索: "${query}"`]
  let found = false

  if (facts.length > 0) {
    parts.push('\n【已知事实】')
    facts.forEach((f, i) => {
      parts.push(`${i + 1}. [${f.category || '事实'}] ${f.content} (置信度: ${f.confidence || 0.5})`)
    })
    found = true
  }

  if (knowledge.length > 0) {
    parts.push('\n【相关知识】')
    knowledge.forEach((k, i) => {
      parts.push(`${i + 1}. ${k.topic}: ${k.content.slice(0, 200)}`)
    })
    found = true
  }

  if (!found) {
    parts.push('\n未找到相关信息')
  }

  return {
    success: true,
    result: parts.join('\n'),
    data: { facts, knowledge }
  }
}

module.exports = { name: 'search_knowledge', execute }
