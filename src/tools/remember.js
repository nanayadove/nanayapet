/**
 * ===== remember.js — 知识库记忆工具 =====
 *
 * 将用户主动教学的知识存入统一 knowledge_base 表。
 * classification = 'user_profile'
 *
 * @param {object} params — { content: 知识内容, category?: 分类标签, tags?: 标签数组 }
 * @returns {{ success: boolean, result: string }}
 */
const db = require('../db')

function execute(params) {
  const { content, category, tags } = params

  if (!content || !content.trim()) {
    return { success: false, result: '需要提供 content 参数（要记住的内容）' }
  }

  const id = db.saveKnowledgeItem({
    classification: 'user_profile',
    category: category || '用户教学',
    content: content.trim(),
    tags: tags || [],
    confidence: 0.95
  })

  return {
    success: true,
    result: `已记住: ${content.trim().slice(0, 100)}`,
    data: { id }
  }
}

module.exports = { name: 'remember', execute }
