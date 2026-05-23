/**
 * ===== read-file.js — 查询已保存的记录 =====
 *
 * 从 SQLite 查询笔记/待办/日记/提醒，支持全文搜索。
 *
 * 搜索优先级：query（全文）> type（按类型）> 全部
 *
 * @param {object} params — { type, label, query, limit }
 * @returns {{ success: boolean, result: string, data?: array }}
 */
const db = require('../db')

function execute(params) {
  const { type, label, query, limit } = params

  let rows = []

  if (query) {
    rows = db.searchTools(query)
  } else if (type && type !== 'all') {
    rows = db.getToolsByType(type, 'active')
  } else {
    rows = db.getAllActiveTools()
  }

  if (label && rows.length > 0) {
    rows = rows.filter(r => (r.label || '').toLowerCase().includes(label.toLowerCase()))
  }

  const max = Math.min(limit || 10, 50)
  rows = rows.slice(0, max)

  if (rows.length === 0) {
    return {
      success: true,
      result: type === 'all' || !type
        ? '没有任何已保存的记录'
        : `没有找到任何${type}类型的记录`
    }
  }

  const typeLabel = { note: '', todo: '', diary: '', schedule: '' }
  const icon = (t) => typeLabel[t] || ''

  const formatted = rows.map(r => {
    return `${icon(r.type)} [${r.id}] ${r.label || '(无标题)'}\n   ${r.content.slice(0, 120)}${r.content.length > 120 ? '...' : ''}`
  }).join('\n')

  return {
    success: true,
    result: `找到 ${rows.length} 条记录:\n${formatted}`,
    data: rows
  }
}

module.exports = { name: 'read_file', execute }
