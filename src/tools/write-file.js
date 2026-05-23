/**
 * ===== write-file.js — 写入信息（笔记/待办/日记） =====
 *
 * 把 LLM 输出的内容存入 SQLite 数据库，可选同时写入文件系统。
 *
 * @param {object} params — { type, label, content, file_path }
 * @param {object} config — 全局配置
 * @returns {{ success: boolean, result: string, data?: object }}
 */
const db = require('../db')

async function execute(params, config) {
  const { type, label, content, file_path } = params

  if (!type || !content) {
    return { success: false, result: '参数不足：需要 type (note/todo/diary) 和 content' }
  }

  const validTypes = ['note', 'todo', 'diary']
  const actualType = validTypes.includes(type) ? type : 'note'

  if (file_path) {
    const fs = require('fs')
    const path = require('path')
    const absPath = path.isAbsolute(file_path)
      ? file_path
      : path.join(path.dirname(require.resolve('./write-file.js')), '..', '..', file_path)

    const dir = path.dirname(absPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(absPath, content, 'utf-8')
  }

  // content.slice(0, 50) — 没有标题时用内容前 50 字代替
  const id = db.saveTool(actualType, label || content.slice(0, 50), content, null)

  const typeLabel = { note: '笔记', todo: '待办', diary: '日记' }
  return {
    success: true,
    result: `已保存${typeLabel[actualType] || '记录'}${label ? '「' + label + '」' : ''} (ID: ${id})`,
    data: { id, type: actualType, label, content }
  }
}

module.exports = { name: 'write_file', execute }
