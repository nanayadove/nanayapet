/**
 * ===== search-knowledge.js — 知识库搜索工具 =====
 *
 * 搜索统一 knowledge_base 表。
 * 支持按 classification 过滤。
 *
 * @param {object} params — { query: 搜索关键词, classification?: 'user_profile'|'taught'|'web' }
 * @returns {{ success: boolean, result: string, data?: object }}
 */
const db = require('../db')

function execute(params) {
  const { query, classification } = params

  if (!query || !query.trim()) {
    return { success: false, result: '需要提供 query 参数（搜索关键词）' }
  }

  const items = db.searchKnowledgeBase(query, classification || null)

  if (items.length === 0) {
    return {
      success: true,
      result: `搜索 "${query}": 未找到相关信息`,
      data: { items: [] }
    }
  }

  const parts = [`搜索: "${query}"`]

  // 按 classification 分组展示
  const groups = {}
  for (const item of items) {
    const cls = item.classification || 'user_profile'
    if (!groups[cls]) groups[cls] = []
    groups[cls].push(item)
  }

  const labels = { user_profile: '用户画像', taught: '用户教学', web: '外部知识' }
  for (const [cls, group] of Object.entries(groups)) {
    parts.push(`\n【${labels[cls] || cls}】`)
    group.forEach((item, i) => {
      const confStr = item.confidence ? ` (置信度: ${item.confidence})` : ''
      const catStr = item.category ? `[${item.category}] ` : ''
      parts.push(`${i + 1}. ${catStr}${item.content.slice(0, 200)}${confStr}`)
    })
  }

  return {
    success: true,
    result: parts.join('\n'),
    data: { items }
  }
}

module.exports = { name: 'search_knowledge', execute }
