/**
 * ===== tools.js — 工具执行引擎 =====
 *
 * 这个文件的任务很简单：执行工具。
 *
 * 入口函数 executeTool(toolName, params, config)：
 *   收到一个工具名和参数 → 找到对应的函数去执行 → 返回 { success, result }
 *
 * 当前支持 4 个工具：
 *   write_file    — 写笔记/待办/日记
 *   read_file     — 读已保存的内容
 *   schedule      — 设定时提醒
 *
 * 设计原则：
 *   - 每个工具只做一件事，做好
 *   - 参数全部从 params 对象里取，不依赖外部状态
 *   - 返回值统一格式：{ success: boolean, result: string, data?: any }
 *   - 错误不要抛异常，而是返回 { success: false, result: "错误信息" }
 */
const db = require('./db')

/**
 * ⭐ 工具主入口
 *
 * 这是一个路由函数，根据 toolName 决定调哪个工具。
 * 所有工具都包在 try/catch 里，任何错误都会返回失败结果而不是抛异常。
 *
 * @param {string} toolName - 工具名
 * @param {object} params - 参数对象
 * @param {object} config - 全局配置（传给 write_file 用于文件路径）
 * @returns {{ success: boolean, result: string, data?: any }}
 */
async function executeTool(toolName, params, config) {
  try {
    switch (toolName) {
      case 'write_file':
        return await writeFile(params, config)
      case 'read_file':
        return readFile(params)
      case 'schedule':
        return schedule(params)
      default:
        return {
          success: false,
          result: `未知工具: ${toolName}。可用工具: write_file, read_file, schedule`
        }
    }
  } catch (err) {
    console.error(`[Tools] 工具 ${toolName} 执行失败:`, err.message)
    return {
      success: false,
      result: `工具 ${toolName} 执行出错: ${err.message}`
    }
  }
}

// =================================================================
// 工具 1：write_file — 保存笔记/待办/日记
// =================================================================
/**
 * 参数说明：
 *   type: "note" 笔记 | "todo" 待办 | "diary" 日记
 *   label: 标题（可选）
 *   content: 内容（必填）
 *   file_path: 可选，如果传了就同时写入文件系统
 *
 * 数据流向：
 *   db.saveTool() → 写入 SQLite 的 tools 表
 *   如果传了 file_path → 额外写入文件系统
 *
 * 返回示例：
 *   { success: true, result: "已保存笔记「学习计划」 (ID: 5)", data: { id: 5, ... } }
 */
async function writeFile(params, config) {
  const { type, label, content, file_path } = params

  // 参数校验：type 和 content 是必填的
  if (!type || !content) {
    return {
      success: false,
      result: '参数不足：需要 type (note/todo/diary) 和 content'
    }
  }

  // 如果传了非法 type，默认存为 note
  const validTypes = ['note', 'todo', 'diary']
  const actualType = validTypes.includes(type) ? type : 'note'

  // 如果传了 file_path，也写入文件系统
  if (file_path) {
    const fs = require('fs')
    const path = require('path')
    const absPath = path.isAbsolute(file_path)
      ? file_path
      : path.join(path.dirname(require.resolve('./tools.js')), '..', file_path)

    const dir = path.dirname(absPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })  // 自动创建不存在的目录
    }
    fs.writeFileSync(absPath, content, 'utf-8')
  }

  // 写入数据库
  const id = db.saveTool(actualType, label || label, content, null)

  // 返回人类可读的结果
  const typeLabel = { note: '笔记', todo: '待办', diary: '日记' }
  return {
    success: true,
    result: `已保存${typeLabel[actualType] || '记录'}${label ? '「' + label + '」' : ''} (ID: ${id})`,
    data: { id, type: actualType, label, content }
  }
}

// =================================================================
// 工具 2：read_file — 读取已保存的信息
// =================================================================
/**
 * 参数说明：
 *   type: "note"|"todo"|"diary"|"all" — 按类型筛选，默认 all
 *   label: 按标题模糊搜索（可选）
 *   query: 全文搜索关键词（可选）
 *   limit: 返回条数上限（可选，默认 10，最大 50）
 *
 * 搜索优先级：
 *   1. 如果传了 query → 全文搜索
 *   2. 如果传了 type → 按类型查
 *   3. 否则 → 查全部
 *
 * 返回示例：
 *   { success: true, result: "找到 2 条记录:\n📝 [1] 学习计划\n   ..." }
 */
function readFile(params) {
  const { type, label, query, limit } = params

  let rows = []

  if (query) {
    // 全文搜索：在 label 和 content 字段里模糊匹配
    rows = db.searchTools(query)
  } else if (type && type !== 'all') {
    rows = db.getToolsByType(type, 'active')
  } else {
    rows = db.getAllActiveTools()
  }

  // 如果传了 label，再按标题过滤（大小写不敏感）
  if (label && rows.length > 0) {
    rows = rows.filter(r => (r.label || '').toLowerCase().includes(label.toLowerCase()))
  }

  // 限制返回条数
  const max = Math.min(limit || 10, 50)
  rows = rows.slice(0, max)

  // 没有找到记录
  if (rows.length === 0) {
    return {
      success: true,
      result: type === 'all' || !type
        ? '没有任何已保存的记录'
        : `没有找到任何${type}类型的记录`
    }
  }

  // 格式化为人类可读的文本
  const formatted = rows.map(r => {
    const typeLabel = { note: '📝', todo: '☐', diary: '📔', schedule: '⏰' }
    const icon = typeLabel[r.type] || '📄'
    return `${icon} [${r.id}] ${r.label || '(无标题)'}\n   ${r.content.slice(0, 120)}${r.content.length > 120 ? '...' : ''}`
  }).join('\n')

  return {
    success: true,
    result: `找到 ${rows.length} 条记录:\n${formatted}`,
    data: rows
  }
}

// =================================================================
// 工具 3：schedule — 设置定时提醒
// =================================================================
/**
 * 参数说明：
 *   label: 提醒标题（必填，给用户看的）
 *   content: 提醒内容（必填）
 *   trigger_at: ISO 时间字符串（与 relative 二选一）
 *   relative: 自然语言相对时间（与 trigger_at 二选一）
 *
 * 时间解析优先级：
 *   1. trigger_at → 直接转 Date
 *   2. relative → 调用 parseRelative() 解析自然语言
 *   3. 都没传 → 默认 5 分钟后
 *
 * 提醒触发：
 *   main.js 里的 checkSchedules() 每 15 秒检查一次
 *   到期后 → 标记完成 → IPC 推送给前端 → 弹出气泡
 *
 * 返回示例：
 *   { success: true, result: "已设置提醒「休息」于 2026/05/22 16:00 (ID: 3)" }
 */
function schedule(params) {
  const { label, content, trigger_at, relative } = params

  if (!content) {
    return {
      success: false,
      result: '参数不足：需要 content（提醒内容）'
    }
  }

  let triggerTime

  if (trigger_at) {
    // 解析 ISO 时间字符串
    triggerTime = new Date(trigger_at)
    if (isNaN(triggerTime.getTime())) {
      return {
        success: false,
        result: `无法解析时间: ${trigger_at}。请使用 ISO 格式如 2026-05-22T16:00:00`
      }
    }
  } else if (relative) {
    // 解析自然语言时间（如"30分钟""明天""1小时后"）
    const now = new Date()
    triggerTime = parseRelative(relative, now)
    if (!triggerTime) {
      // 解析失败则默认 5 分钟后
      triggerTime = new Date(now.getTime() + 5 * 60 * 1000)
    }
  } else {
    // 默认 5 分钟后
    triggerTime = new Date(Date.now() + 5 * 60 * 1000)
  }

  // ISO 字符串格式：2026-05-22T15:30:00.000Z
  const isoTime = triggerTime.toISOString()
  const id = db.saveTool('schedule', label || label, content, isoTime)

  // 格式化为中文时间显示
  const timeStr = triggerTime.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })

  return {
    success: true,
    result: `已设置提醒「${label || content}」于 ${timeStr} (ID: ${id})`,
    data: { id, label, content, trigger_at: isoTime }
  }
}

// =================================================================
// 辅助函数：解析自然语言相对时间
// =================================================================
/**
 * 把"5分钟""1小时""明天"这种自然语言转成 Date 对象
 *
 * 支持格式：
 *   "5分钟" / "5分" / "5分钟后" → 当前时间 + 5 分钟
 *   "1小时" / "1时" / "1小时后" → 当前时间 + 1 小时
 *   "2天" / "2天后"             → 当前时间 + 2 天
 *   "30秒" / "30秒后"           → 当前时间 + 30 秒
 *   "明天"                      → 明天的当前时间
 *
 * @param {string} text - 自然语言时间表达式
 * @param {Date} from - 基准时间
 * @returns {Date|null} 解析成功返回 Date，失败返回 null
 */
function parseRelative(text, from) {
  const now = new Date(from)

  // match() 用正则表达式匹配字符串
  // \d+ 匹配一个或多个数字
  // \s* 匹配零个或多个空格
  // (?:) 是非捕获分组，匹配但不保存

  // "X分钟" / "X分" / "X分钟后"
  let m = text.match(/(\d+)\s*分(?:钟)?(?:后)?/)
  if (m) return new Date(now.getTime() + parseInt(m[1]) * 60 * 1000)

  // "X小时" / "X时" / "X小时后"
  m = text.match(/(\d+)\s*小?时?(?:后)?/)
  if (m) return new Date(now.getTime() + parseInt(m[1]) * 60 * 60 * 1000)

  // "X天" / "X天后"
  m = text.match(/(\d+)\s*天(?:后)?/)
  if (m) return new Date(now.getTime() + parseInt(m[1]) * 24 * 60 * 60 * 1000)

  // "X秒" / "X秒后"
  m = text.match(/(\d+)\s*秒(?:后)?/)
  if (m) return new Date(now.getTime() + parseInt(m[1]) * 1000)

  // "明天" → 明天的当前时间
  if (text.includes('明天')) {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)  // setDate() 会自动处理跨月
    return tomorrow
  }

  return null
}

module.exports = { executeTool }
