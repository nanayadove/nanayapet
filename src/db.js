const initSqlJs = require('sql.js')
const fs = require('fs')
const path = require('path')

const DB_PATH = path.join(__dirname, '..', 'memory.db')
let db = null

async function getDb() {
  if (db) return db

  const SQL = await initSqlJs()

  // 如果已有数据库文件，加载它
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH)
    db = new SQL.Database(buffer)
  } else {
    db = new SQL.Database()
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS tools (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      label TEXT,
      content TEXT,
      status TEXT DEFAULT 'active',
      trigger_at TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      completed_at DATETIME
    )
  `)

  saveDb()
  return db
}

function saveDb() {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(DB_PATH, buffer)
}

function saveMessage(role, content) {
  const stmt = db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)')
  stmt.run([role, content])
  stmt.free()
  saveDb()
}

function loadContextForLlm(maxLen) {
  // 查找最近的一次总结
  const summaryStmt = db.prepare(
    "SELECT id, content FROM messages WHERE role='summary' ORDER BY id DESC LIMIT 1"
  )
  summaryStmt.step()
  const summaryRow = summaryStmt.getAsObject()
  summaryStmt.free()

  const messages = []

  if (summaryRow && summaryRow.id) {
    messages.push({
      role: 'system',
      content: `[前情提要/记忆总结]: ${summaryRow.content}`
    })
    const recentStmt = db.prepare(
      'SELECT role, content FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?'
    )
    recentStmt.bind([summaryRow.id, maxLen])
    while (recentStmt.step()) {
      const row = recentStmt.getAsObject()
      // 安全过滤：summary 角色转 system（DeepSeek API 不认 summary）
      const role = row.role === 'summary' ? 'system' : row.role
      messages.push({ role, content: row.content })
    }
    recentStmt.free()
  } else {
    const recentStmt = db.prepare(
      'SELECT role, content FROM messages ORDER BY id DESC LIMIT ?'
    )
    recentStmt.bind([maxLen])
    const rows = []
    while (recentStmt.step()) {
      const row = recentStmt.getAsObject()
      rows.push(row)
    }
    recentStmt.free()
    for (const row of rows.reverse()) {
      const role = row.role === 'summary' ? 'system' : row.role
      messages.push({ role, content: row.content })
    }
  }

  return messages
}

function getUnsummarizedCount() {
  const summaryStmt = db.prepare(
    "SELECT id FROM messages WHERE role='summary' ORDER BY id DESC LIMIT 1"
  )
  summaryStmt.step()
  const summaryRow = summaryStmt.getAsObject()
  summaryStmt.free()

  let countStmt
  if (summaryRow && summaryRow.id) {
    countStmt = db.prepare("SELECT count(*) as cnt FROM messages WHERE id > ?")
    countStmt.bind([summaryRow.id])
  } else {
    countStmt = db.prepare("SELECT count(*) as cnt FROM messages")
  }

  countStmt.step()
  const result = countStmt.getAsObject()
  countStmt.free()
  return result.cnt
}

function getUnsummarizedMessages() {
  const summaryStmt = db.prepare(
    "SELECT id FROM messages WHERE role='summary' ORDER BY id DESC LIMIT 1"
  )
  summaryStmt.step()
  const summaryRow = summaryStmt.getAsObject()
  summaryStmt.free()

  let selectStmt
  if (summaryRow && summaryRow.id) {
    selectStmt = db.prepare(
      'SELECT role, content FROM messages WHERE id > ? ORDER BY id ASC'
    )
    selectStmt.bind([summaryRow.id])
  } else {
    selectStmt = db.prepare(
      'SELECT role, content FROM messages ORDER BY id ASC'
    )
  }

  const rows = []
  while (selectStmt.step()) {
    const row = selectStmt.getAsObject()
    rows.push({ role: row.role, content: row.content })
  }
  selectStmt.free()
  return rows
}

function checkAndSummarize(client, model, summaryInterval) {
  try {
    const unsummarizedCount = getUnsummarizedCount()
    if (unsummarizedCount < summaryInterval * 2) {
      return null
    }

    const unsummarizedMsgs = getUnsummarizedMessages()
    let summaryPrompt = '请以第三人称客观视角（使用"用户"和"AI"/"桌宠"作为主语）将以下对话总结为一段简短的背景记忆，保留核心事件、双方的状态和情感态度，字数不超过200字。直接输出总结文本即可：\n\n'

    for (const msg of unsummarizedMsgs) {
      const roleStr = msg.role === 'user' ? '用户' : '你'
      summaryPrompt += `${roleStr}: ${msg.content}\n`
    }

    return { prompt: summaryPrompt, messages: unsummarizedMsgs }
  } catch (err) {
    console.error('检查总结失败:', err.message)
    return null
  }
}

async function doSummarize(apiConfig, summaryData) {
  if (!summaryData) return

  const OpenAI = require('openai')

  const provName = apiConfig.summary_provider || ''
  let sApiKey, sBaseUrl, sModel

  if (provName && provName !== '同对话服务商' && apiConfig.providers?.[provName]) {
    const sumProv = apiConfig.providers[provName]
    sApiKey = sumProv.api_key
    sBaseUrl = sumProv.base_url
    sModel = sumProv.model
  } else {
    const mainProv = apiConfig.providers?.[apiConfig.provider || 'deepseek'] || {}
    sApiKey = mainProv.api_key
    sBaseUrl = mainProv.base_url
    sModel = mainProv.model
  }

  const client = new OpenAI({ apiKey: sApiKey, baseURL: sBaseUrl })

  try {
    const res = await client.chat.completions.create({
      model: sModel,
      messages: [
        { role: 'system', content: '你是一个对话总结助手。' },
        { role: 'user', content: summaryData.prompt }
      ],
      temperature: 0.5,
    })

    const summaryText = res.choices[0].message.content.trim()
    saveMessage('summary', summaryText)
    console.log('记忆总结已保存:', summaryText.substring(0, 50) + '...')
  } catch (err) {
    console.error('后台总结记忆失败:', err.message)
  }
}

// ===== 工具 CRUD =====

function saveTool(type, label, content, triggerAt) {
  const stmt = db.prepare(
    'INSERT INTO tools (type, label, content, status, trigger_at) VALUES (?, ?, ?, ?, ?)'
  )
  stmt.run([type, label, content, 'active', triggerAt || null])
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
  stmt.free()
  saveDb()
  return id
}

function getToolsByType(type, status) {
  let sql = 'SELECT * FROM tools WHERE type = ?'
  const params = [type]
  if (status) {
    sql += ' AND status = ?'
    params.push(status)
  }
  sql += ' ORDER BY id DESC'
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

function getToolById(id) {
  const stmt = db.prepare('SELECT * FROM tools WHERE id = ?')
  stmt.bind([id])
  const result = stmt.step() ? stmt.getAsObject() : null
  stmt.free()
  return result
}

function searchTools(query) {
  const like = `%${query}%`
  const stmt = db.prepare(
    'SELECT * FROM tools WHERE (label LIKE ? OR content LIKE ?) AND status = ? ORDER BY id DESC LIMIT 20'
  )
  stmt.bind([like, like, 'active'])
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

function getAllActiveTools() {
  const stmt = db.prepare(
    "SELECT * FROM tools WHERE status = 'active' ORDER BY type, id DESC"
  )
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

function completeTool(id) {
  const stmt = db.prepare(
    "UPDATE tools SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
  )
  stmt.run([id])
  stmt.free()
  saveDb()
}

function deleteTool(id) {
  const stmt = db.prepare('DELETE FROM tools WHERE id = ?')
  stmt.run([id])
  stmt.free()
  saveDb()
}

function getUpcomingSchedules() {
  const stmt = db.prepare(
    "SELECT * FROM tools WHERE type = 'schedule' AND status = 'active' AND trigger_at IS NOT NULL ORDER BY trigger_at ASC"
  )
  const rows = []
  while (stmt.step()) {
    rows.push(stmt.getAsObject())
  }
  stmt.free()
  return rows
}

function markScheduleFired(id) {
  const stmt = db.prepare(
    "UPDATE tools SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
  )
  stmt.run([id])
  stmt.free()
  saveDb()
}

module.exports = {
  getDb,
  saveMessage,
  loadContextForLlm,
  getUnsummarizedCount,
  getUnsummarizedMessages,
  checkAndSummarize,
  doSummarize,
  saveTool,
  getToolsByType,
  getToolById,
  searchTools,
  getAllActiveTools,
  completeTool,
  deleteTool,
  getUpcomingSchedules,
  markScheduleFired,
}
