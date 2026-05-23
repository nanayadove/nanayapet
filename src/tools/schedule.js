/**
 * ===== schedule.js — 设置定时提醒 =====
 *
 * 创建定时提醒，支持替换已有提醒（replace_id）。
 * 时间参数 trigger_at 使用 ISO 8601 格式。
 *
 * @param {object} params — { label, content, trigger_at, replace_id }
 * @returns {{ success: boolean, result: string, data?: object }}
 */
const db = require('../db')

function execute(params) {
  const { label, content, trigger_at, replace_id } = params

  if (!content && !replace_id) {
    return { success: false, result: '参数不足：需要 content（提醒内容）' }
  }

  let triggerTime
  if (trigger_at) {
    triggerTime = new Date(trigger_at)
    if (isNaN(triggerTime.getTime())) {
      return { success: false, result: `无法解析时间: ${trigger_at}。ISO 格式如: 2026-05-23T20:00:00` }
    }
  } else {
    triggerTime = new Date(Date.now() + 5 * 60 * 1000)
  }

  let replacedInfo = ''
  if (replace_id) {
    const old = db.getToolById(parseInt(replace_id))
    if (old) {
      db.completeTool(parseInt(replace_id))
      replacedInfo = ` (已替换旧提醒 #${replace_id})`
    }
  }

  const isoTime = triggerTime.toISOString()
  const id = db.saveTool('schedule', label || content.slice(0, 50), content, isoTime)

  const timeStr = triggerTime.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit'
  })

  return {
    success: true,
    result: `已设置提醒「${label || content}」于 ${timeStr} (ID: ${id})${replacedInfo}`,
    data: { id, label, content, trigger_at: isoTime, replaced_id: replace_id || null }
  }
}

module.exports = { name: 'schedule', execute }
