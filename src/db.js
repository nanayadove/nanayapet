// ===== db.js — 数据库模块 =====
//
// 用 sql.js 在内存中运行一个完整的 SQLite 数据库。
// 不需要安装任何数据库软件，sql.js 是纯 JavaScript/WebAssembly 实现的 SQLite。
//
// sql.js 是什么？
//   把 C 语言写的 SQLite 编译成了 WebAssembly，直接在 JS 里运行，
//   不需要系统安装 SQLite、不需要进程守护，一个 npm 包搞定所有。
//   数据存在磁盘文件 memory.db 里，每次操作后调用 saveDb() 写回磁盘。
//
// 两个核心概念：
//   1. 数据库对象 (Database): 初始化后得到一个 db，代表整个数据库
//   2. 预处理语句 (Statement): db.prepare(sql) 编译一条 SQL，
//      然后 bind(参数) → step() 执行 → getAsObject() 取结果

// require('sql.js') — 引入 sql.js 库
// initSqlJs 是 sql.js 的入口函数，调用后返回一个 SQL 对象，里面有 Database 类
const initSqlJs = require('sql.js')

// require('fs') — Node.js 内置的文件系统模块
// 用于读写文件。readFileSync 读文件，writeFileSync 写文件，existsSync 检查文件是否存在
const fs = require('fs')

// require('path') — Node.js 内置的路径处理模块
// path.join() 拼接路径片段，自动处理 Windows 的 \ 和 Linux 的 / 区别
// __dirname 是当前文件所在的目录路径（Node.js 内置全局变量）
const path = require('path')

const { app } = require('electron')
function getDataDir() {
  if (app.isPackaged) {
    return process.resourcesPath
  }
  return path.join(__dirname, '..')
}
const DB_PATH = path.join(getDataDir(), 'memory.db')

// 全局变量：持有 sql.js 的 Database 实例
// 初始化后一直复用，不重复创建
let db = null

// ================================================================
// 初始化数据库（异步函数）
// ================================================================
// async function — 异步函数，内部可以用 await 等待异步操作完成
// 调用方用 await getDb() 或 getDb().then() 获取数据库对象
async function getDb() {
  // 如果已经初始化过，直接返回已有的 db，避免重复初始化
  if (db) return db

  // initSqlJs() — 初始化 sql.js 的 WebAssembly 引擎
  // 这是异步操作（返回 Promise），用 await 等待它完成
  // SQL 对象包含 Database 类，用它创建或加载数据库
  const SQL = await initSqlJs()

  // fs.existsSync(路径) — 同步检查文件是否存在，返回 true/false
  if (fs.existsSync(DB_PATH)) {
    // fs.readFileSync(路径) — 同步读取文件全部内容到内存
    // 返回 Buffer（字节数组）
    const buffer = fs.readFileSync(DB_PATH)
    // new SQL.Database(buffer) — 从已有的数据库文件创建 Database 对象
    // 传入文件内容的 Buffer，sql.js 会解析它并恢复到数据库状态
    db = new SQL.Database(buffer)
  } else {
    // new SQL.Database() — 创建一个空的数据库（没有表，没有数据）
    // 第一次启动时会走这里，然后下面的 CREATE TABLE 会建表
    db = new SQL.Database()
  }

  // db.run(sql) — 执行一条不返回数据的 SQL 语句（DDL 如 CREATE TABLE）
  // CREATE TABLE IF NOT EXISTS — 如果表已存在就不重建，保证安全的启动
  // INTEGER PRIMARY KEY AUTOINCREMENT — 自增主键（每插入一条自动 +1）
  // TEXT NOT NULL — 文本类型，不能为空
  // DATETIME DEFAULT CURRENT_TIMESTAMP — 自动填入当前时间
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

  db.run(`
    CREATE TABLE IF NOT EXISTS facts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      category TEXT,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      confidence REAL DEFAULT 0.5,
      source_msg_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      content TEXT NOT NULL,
      source TEXT DEFAULT 'web',
      source_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge_base (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classification TEXT NOT NULL DEFAULT 'user_profile',
      category TEXT,
      content TEXT NOT NULL,
      tags TEXT DEFAULT '[]',
      confidence REAL DEFAULT 0.5,
      source_msg_id INTEGER,
      source TEXT,
      source_url TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `)

  // 迁移：旧 facts + knowledge → 统一 knowledge_base
  migrateToUnifiedKnowledge()

  db.run(`
    CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL,
      title TEXT,
      summary TEXT,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  try { db.run('ALTER TABLE messages ADD COLUMN session_id INTEGER') } catch {}
  try { db.run('ALTER TABLE sessions ADD COLUMN last_summarized_msg_id INTEGER') } catch {}

  db.run(`
    CREATE TABLE IF NOT EXISTS character_memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      character_id TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      confidence REAL DEFAULT 0.5,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `)

  // 迁移：messages 表拆分 (v1 → v2)
  if (!getMeta('schema_v2')) migrateSchemaV2()

  // 把建表后的数据库存盘
  saveDb()
  return db
}

// ================================================================
// 持久化：把内存中的数据库写入磁盘文件
// ================================================================
function saveDb() {
  if (!db) return
  const data = db.export()
  const buffer = Buffer.from(data)
  fs.writeFileSync(DB_PATH, buffer)
}

const _messageCache = new Map()

function getCachedMessages(sessionId) {
  const entry = _messageCache.get(sessionId)
  if (entry && (Date.now() - entry.updatedAt < 60000)) return entry.messages
  return null
}

function setCachedMessages(sessionId, messages) {
  _messageCache.set(sessionId, { messages, updatedAt: Date.now() })
}

function invalidateMessageCache(sessionId) {
  if (sessionId) _messageCache.delete(sessionId)
  else _messageCache.clear()
}

// ================================================================
// 对话消息 CRUD
// ================================================================

// saveMessage(sessionId, 角色, 内容) — 保存一条对话消息
// sessionId: 归属的会话 ID
// role: 'user' | 'assistant' | 'system'
function saveMessage(sessionId, role, content) {
  const stmt = db.prepare('INSERT INTO messages (session_id, role, content) VALUES (?, ?, ?)')
  stmt.run([sessionId, role, content])
  stmt.free()
  saveDb()
  invalidateMessageCache(sessionId)
}

// loadContextForLlm(sessionId, maxLen) — 加载指定 session 的最近对话
// sessionId: 会话 ID
// 返回 [{role, content}, ...] 格式的消息数组
// 如果有 session.summary，先注入 summary，再无 summary 部分的最近消息
function loadContextForLlm(sessionId, maxLen) {
  if (!sessionId) { const rows = []; return rows }

  const cached = getCachedMessages(sessionId)
  if (cached) return cached.slice(0, maxLen || cached.length)

  const sessionStmt = db.prepare('SELECT summary FROM sessions WHERE id = ?')
  sessionStmt.bind([sessionId])
  const sessionRow = sessionStmt.step() ? sessionStmt.getAsObject() : null
  sessionStmt.free()

  const messages = []

  if (sessionRow && sessionRow.summary) {
    messages.push({ role: 'system', content: sessionRow.summary })
  }

  const stmt = db.prepare(
    'SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC LIMIT ?'
  )
  stmt.bind([sessionId, maxLen])
  while (stmt.step()) {
    const row = stmt.getAsObject()
    messages.push({ role: row.role, content: row.content })
  }
  stmt.free()

  setCachedMessages(sessionId, messages)
  return messages
}


// ================================================================
// 记忆总结：防止对话太长导致 LLM 上下文超出限制
// ================================================================

// 统计指定 session 自上次总结以来的消息数量
function getUnsummarizedCount(sessionId) {
  const sessionStmt = db.prepare('SELECT last_summarized_msg_id FROM sessions WHERE id = ?')
  sessionStmt.bind([sessionId])
  const sessionRow = sessionStmt.step() ? sessionStmt.getAsObject() : null
  sessionStmt.free()

  let countStmt
  if (sessionRow && sessionRow.last_summarized_msg_id) {
    countStmt = db.prepare('SELECT count(*) as cnt FROM messages WHERE session_id = ? AND id > ?')
    countStmt.bind([sessionId, sessionRow.last_summarized_msg_id])
  } else {
    countStmt = db.prepare('SELECT count(*) as cnt FROM messages WHERE session_id = ?')
    countStmt.bind([sessionId])
  }

  countStmt.step()
  const result = countStmt.getAsObject()
  countStmt.free()
  return result.cnt
}

// 获取指定 session 自上次总结以来的所有消息
function getUnsummarizedMessages(sessionId) {
  const sessionStmt = db.prepare('SELECT last_summarized_msg_id FROM sessions WHERE id = ?')
  sessionStmt.bind([sessionId])
  const sessionRow = sessionStmt.step() ? sessionStmt.getAsObject() : null
  sessionStmt.free()

  let selectStmt
  if (sessionRow && sessionRow.last_summarized_msg_id) {
    selectStmt = db.prepare(
      'SELECT role, content FROM messages WHERE session_id = ? AND id > ? ORDER BY id ASC'
    )
    selectStmt.bind([sessionId, sessionRow.last_summarized_msg_id])
  } else {
    selectStmt = db.prepare(
      'SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC'
    )
    selectStmt.bind([sessionId])
  }

  const rows = []
  while (selectStmt.step()) {
    const row = selectStmt.getAsObject()
    rows.push({ role: row.role, content: row.content })
  }
  selectStmt.free()
  return rows
}

// 检查是否需要总结，返回 {prompt, messages} 或 null
function checkAndSummarize(sessionId, summaryInterval) {
  try {
    const unsummarizedCount = getUnsummarizedCount(sessionId)
    if (unsummarizedCount < summaryInterval * 2) {
      return null
    }

    const unsummarizedMsgs = getUnsummarizedMessages(sessionId)
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

// ================================================================
// 工具 CRUD（tools 表的增删改查）
// ================================================================

// saveTool(类型, 标题, 内容, 触发时间) — 保存一条工具记录
function saveTool(type, label, content, triggerAt) {
  const stmt = db.prepare(
    'INSERT INTO tools (type, label, content, status, trigger_at) VALUES (?, ?, ?, ?, ?)'
  )
  stmt.run([type, label, content, 'active', triggerAt || null])
  // db.exec(sql) — 执行 SQL 并返回结果，适合 SELECT
  // [0].values[0][0] — 套娃取第一个结果集第一行第一列的值
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
  stmt.free()
  saveDb()
  return id
}

// 按类型查询工具记录
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

// 按 ID 查单条记录
function getToolById(id) {
  const stmt = db.prepare('SELECT * FROM tools WHERE id = ?')
  stmt.bind([id])
  // 条件运算符：如果 step() 返回 true（查到数据），取 getAsObject()，否则 null
  const result = stmt.step() ? stmt.getAsObject() : null
  stmt.free()
  return result
}

// 全文搜索工具记录（按标题和内容模糊匹配）
function searchTools(query) {
  // LIKE 是 SQL 的模糊匹配，% 是通配符
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

// 获取所有活跃工具记录
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

// 标记工具记录为完成状态
function completeTool(id) {
  const stmt = db.prepare(
    "UPDATE tools SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
  )
  stmt.run([id])
  stmt.free()
  saveDb()
}

// 物理删除工具记录
function deleteTool(id) {
  const stmt = db.prepare('DELETE FROM tools WHERE id = ?')
  stmt.run([id])
  stmt.free()
  saveDb()
}

// ================================================================
// 定时提醒相关
// ================================================================

// 获取所有待触发的提醒（按触发时间升序）
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

// 标记提醒为已触发（完成）
function markScheduleFired(id) {
  const stmt = db.prepare(
    "UPDATE tools SET status = 'completed', completed_at = datetime('now') WHERE id = ?"
  )
  stmt.run([id])
  stmt.free()
  saveDb()
}

// ================================================================
// 元数据存取（key-value）
// ================================================================

function getMeta(key) {
  const stmt = db.prepare('SELECT value FROM meta WHERE key = ?')
  stmt.bind([key])
  const result = stmt.step() ? stmt.getAsObject() : null
  stmt.free()
  return result ? result.value : null
}

function setMeta(key, value) {
  const stmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
  stmt.run([key, String(value)])
  stmt.free()
  saveDb()
}

// ================================================================
// 统一知识库 (knowledge_base) CRUD
// ================================================================
// v1.5→v1.6: facts + knowledge 合并为 knowledge_base 表
// classification: 'user_profile' | 'web' | 'lore'

function saveKnowledgeItem({ classification, category, content, tags, confidence, source_msg_id, source, source_url }) {
  const stmt = db.prepare(
    'INSERT INTO knowledge_base (classification, category, content, tags, confidence, source_msg_id, source, source_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  )
  stmt.run([
    classification || 'user_profile',
    category || null,
    content,
    JSON.stringify(tags || []),
    confidence != null ? confidence : 0.5,
    source_msg_id || null,
    source || null,
    source_url || null
  ])
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
  stmt.free()
  saveDb()
  return id
}

function updateKnowledgeConfidence(id, delta, decayRate) {
  const readStmt = db.prepare("SELECT confidence, updated_at FROM knowledge_base WHERE id = ?")
  readStmt.bind([id])
  if (!readStmt.step()) { readStmt.free(); return }
  const row = readStmt.getAsObject()
  readStmt.free()

  const now = new Date()
  const updatedAt = new Date(row.updated_at || row.created_at || now)
  const daysSince = Math.max(0, (now.getTime() - updatedAt.getTime()) / (1000 * 60 * 60 * 24))
  const rate = decayRate != null ? decayRate : 0.01
  const decayed = row.confidence * Math.exp(-rate * daysSince)
  let newConf = decayed + delta
  newConf = Math.max(0, Math.min(newConf, 1.0))

  if (newConf < 0.05) {
    const delStmt = db.prepare("DELETE FROM knowledge_base WHERE id = ?")
    delStmt.run([id])
    delStmt.free()
  } else {
    const updateStmt = db.prepare("UPDATE knowledge_base SET confidence = ?, updated_at = datetime('now') WHERE id = ?")
    updateStmt.run([newConf, id])
    updateStmt.free()
  }
  saveDb()
}

function findSimilarItem(content, threshold, classification) {
  const thresh = threshold != null ? threshold : 0.7
  const searchText = (content || '').slice(0, 100).replace(/[%_]/g, '')
  if (!searchText) return null

  const keywords = searchText.split(/[\s,，。！？、]+/).filter(k => k.length >= 2).slice(0, 5)
  let candidates = []
  const seenIds = new Set()

  for (const kw of keywords) {
    let sql = "SELECT * FROM knowledge_base WHERE content LIKE ? AND content != ''"
    const params = [`%${kw}%`]
    if (classification) {
      sql += ' AND classification = ?'
      params.push(classification)
    }
    const stmt = db.prepare(sql)
    stmt.bind(params)
    while (stmt.step()) {
      const row = stmt.getAsObject()
      if (!seenIds.has(row.id)) {
        seenIds.add(row.id)
        candidates.push(row)
      }
    }
    stmt.free()
    if (candidates.length >= 10) break
  }

  let bestMatch = null
  let bestScore = 0
  const src = searchText.toLowerCase()

  for (const c of candidates) {
    const tgt = (c.content || '').toLowerCase()
    let score = 0
    const longer = src.length >= tgt.length ? src : tgt
    const shorter = src.length >= tgt.length ? tgt : src
    if (shorter.length === 0) continue
    for (let i = 0; i <= shorter.length - 3; i++) {
      const seg = shorter.substring(i, i + 3)
      if (longer.includes(seg)) score++
    }
    const similarity = score / Math.max(shorter.length - 2, 1)
    if (similarity > bestScore) {
      bestScore = similarity
      bestMatch = c
    }
  }

  if (bestScore >= thresh && bestMatch) {
    return { item: bestMatch, similarity: Math.round(bestScore * 100) / 100 }
  }
  return null
}

function searchKnowledgeBase(query, classification) {
  const q = (query || '').replace(/[%_]/g, '')
  if (!q) return []
  const like = `%${q}%`
  let sql = 'SELECT * FROM knowledge_base WHERE (content LIKE ? OR category LIKE ? OR tags LIKE ?)'
  const params = [like, like, like]
  if (classification) {
    sql += ' AND classification = ?'
    params.push(classification)
  }
  sql += ' ORDER BY confidence DESC LIMIT 10'
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) { rows.push(stmt.getAsObject()) }
  stmt.free()
  return rows
}

function getAllKnowledgeByClassification(classification) {
  let sql = 'SELECT * FROM knowledge_base WHERE 1=1'
  const params = []
  if (classification) {
    const classes = Array.isArray(classification) ? classification : [classification]
    sql += ' AND classification IN (' + classes.map(() => '?').join(',') + ')'
    params.push(...classes)
  }
  sql += ' ORDER BY id DESC'
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) { rows.push(stmt.getAsObject()) }
  stmt.free()
  return rows
}

function queryKnowledgeBase({ classification, search, page, pageSize }) {
  let where = 'WHERE 1=1'
  const params = []

  if (classification) {
    const classes = Array.isArray(classification) ? classification : [classification]
    where += ' AND classification IN (' + classes.map(() => '?').join(',') + ')'
    params.push(...classes)
  }

  const q = (search || '').replace(/[%_]/g, '')
  if (q) {
    const like = `%${q}%`
    where += ' AND (content LIKE ? OR category LIKE ? OR tags LIKE ?)'
    params.push(like, like, like)
  }

  const pg = Math.max(1, page || 1)
  const ps = Math.min(100, Math.max(5, pageSize || 20))
  const offset = (pg - 1) * ps

  const countSql = `SELECT count(*) as cnt FROM knowledge_base ${where}`
  const countStmt = db.prepare(countSql)
  countStmt.bind(params)
  countStmt.step()
  const total = countStmt.getAsObject().cnt
  countStmt.free()

  const dataSql = `SELECT * FROM knowledge_base ${where} ORDER BY id DESC LIMIT ? OFFSET ?`
  const dataStmt = db.prepare(dataSql)
  dataStmt.bind([...params, ps, offset])
  const rows = []
  while (dataStmt.step()) { rows.push(dataStmt.getAsObject()) }
  dataStmt.free()

  return { items: rows, total, page: pg, pageSize: ps }
}

function updateKnowledgeItem(id, fields) {
  const sets = []
  const params = []
  if (fields.classification !== undefined) { sets.push('classification = ?'); params.push(fields.classification) }
  if (fields.category !== undefined) { sets.push('category = ?'); params.push(fields.category) }
  if (fields.content !== undefined) { sets.push('content = ?'); params.push(fields.content) }
  if (fields.tags !== undefined) { sets.push('tags = ?'); params.push(JSON.stringify(fields.tags)) }
  if (fields.confidence !== undefined) { sets.push('confidence = ?'); params.push(fields.confidence) }
  if (fields.source !== undefined) { sets.push('source = ?'); params.push(fields.source) }
  if (fields.source_url !== undefined) { sets.push('source_url = ?'); params.push(fields.source_url) }
  if (sets.length === 0) return false

  sets.push("updated_at = datetime('now')")
  params.push(id)
  const stmt = db.prepare(`UPDATE knowledge_base SET ${sets.join(', ')} WHERE id = ?`)
  stmt.run(params)
  stmt.free()
  saveDb()
  return true
}

function deleteKnowledgeItems(ids) {
  if (!Array.isArray(ids) || ids.length === 0) return 0
  const placeholders = ids.map(() => '?').join(',')
  db.run(`DELETE FROM knowledge_base WHERE id IN (${placeholders})`, ids)
  const changes = db.exec('SELECT changes() as cnt')[0].values[0][0]
  saveDb()
  return changes
}

function getKnowledgeStats() {
  const stmt = db.prepare("SELECT classification, count(*) as cnt FROM knowledge_base GROUP BY classification")
  const stats = { user_profile: 0, web: 0, lore: 0, total: 0 }
  while (stmt.step()) {
    const row = stmt.getAsObject()
    stats[row.classification] = row.cnt
    stats.total += row.cnt
  }
  stmt.free()
  return stats
}

function getLoreMatches(userText) {
  if (!userText) return []
  const userLower = userText.toLowerCase()
  const items = getAllKnowledgeByClassification('lore')
  if (items.length === 0) return []

  const matches = []
  for (const item of items) {
    try {
      const tags = JSON.parse(item.tags || '[]')
      if (!Array.isArray(tags) || tags.length === 0) continue
      const hit = tags.some(tag => {
        const t = (tag || '').toLowerCase().trim()
        return t && userLower.includes(t)
      })
      if (hit) matches.push(item)
    } catch { /* skip malformed tags */ }
  }
  return matches
}

// ================================================================
// 向后兼容封装（facts/knowledge 接口 → knowledge_base）
// ================================================================

function saveFact(category, content, tags, confidence, sourceMsgId) {
  return saveKnowledgeItem({
    classification: 'user_profile',
    category, content, tags, confidence,
    source_msg_id: sourceMsgId
  })
}

function updateFactConfidence(id, delta, decayRate) {
  return updateKnowledgeConfidence(id, delta, decayRate)
}

function findSimilarFact(content, threshold) {
  const result = findSimilarItem(content, threshold, 'user_profile')
  if (!result) return null
  return { fact: result.item, similarity: result.similarity }
}

function searchFactsLike(query) {
  return searchKnowledgeBase(query, 'user_profile')
}

function getAllFacts() {
  return getAllKnowledgeByClassification('user_profile')
}

function saveKnowledge(topic, content, source, sourceUrl) {
  return saveKnowledgeItem({
    classification: 'web',
    category: topic,
    content,
    source: source || 'web',
    source_url: sourceUrl || null
  })
}

function searchKnowledgeLike(query) {
  return searchKnowledgeBase(query, 'web')
}

function getAllKnowledge() {
  return getAllKnowledgeByClassification('web')
}

// ================================================================
// 迁移：旧 facts + knowledge → 统一 knowledge_base
// ================================================================
function migrateToUnifiedKnowledge() {
  const hasMigrated = getMeta('knowledge_unified')
  if (hasMigrated) {
    // 迁移完成后可安全删除旧表
    try { db.run('DROP TABLE IF EXISTS facts') } catch {}
    try { db.run('DROP TABLE IF EXISTS knowledge') } catch {}
    return
  }

  let factCount = 0, knowCount = 0

  try {
    const stmt1 = db.prepare('SELECT * FROM facts')
    while (stmt1.step()) {
      const f = stmt1.getAsObject()
      saveKnowledgeItem({
        classification: 'user_profile',
        category: f.category,
        content: f.content,
        tags: typeof f.tags === 'string' ? JSON.parse(f.tags) : (f.tags || []),
        confidence: f.confidence,
        source_msg_id: f.source_msg_id
      })
      factCount++
    }
    stmt1.free()
  } catch (e) { /* facts 表可能不存在 */ }

  try {
    const stmt2 = db.prepare('SELECT * FROM knowledge')
    while (stmt2.step()) {
      const k = stmt2.getAsObject()
      saveKnowledgeItem({
        classification: 'web',
        category: k.topic,
        content: k.content,
        source: k.source || 'web',
        source_url: k.source_url || null
      })
      knowCount++
    }
    stmt2.free()
  } catch (e) { /* knowledge 表可能不存在 */ }

  try { db.run('DROP TABLE IF EXISTS facts') } catch {}
  try { db.run('DROP TABLE IF EXISTS knowledge') } catch {}

  setMeta('knowledge_unified', '1')
  console.log(`[Migration] 统一知识库迁移完成: ${factCount} 条用户画像 + ${knowCount} 条外部知识`)
}

// ================================================================
// 事实提取辅助
// ================================================================

function getMessagesForFactExtraction(sinceId, limit) {
  const stmt = db.prepare(
    "SELECT id, role, content FROM messages WHERE id > ? AND role IN ('user', 'assistant') ORDER BY id ASC LIMIT ?"
  )
  stmt.bind([sinceId, limit || 6])
  const rows = []
  while (stmt.step()) { rows.push(stmt.getAsObject()) }
  stmt.free()
  return rows
}

function getUnprocessedFactCount() {
  const lastId = parseInt(getMeta('last_fact_extraction_msg_id') || '0')
  const stmt = db.prepare(
    "SELECT count(*) as cnt FROM messages WHERE id > ? AND role IN ('user', 'assistant')"
  )
  stmt.bind([lastId])
  stmt.step()
  const result = stmt.getAsObject()
  stmt.free()
  return result.cnt
}

function getLatestMessageId() {
  const stmt = db.prepare('SELECT MAX(id) as maxId FROM messages')
  stmt.step()
  const result = stmt.getAsObject()
  stmt.free()
  return result.maxId || 0
}

// ================================================================
// 下线记录 (events 表)
// ================================================================

function saveOfflineRecord() {
  const timestamp = new Date().toISOString()
  const stmt = db.prepare("INSERT INTO events (type, content) VALUES ('offline', ?)")
  stmt.run([`[系统记录: 下线] ${timestamp}`])
  stmt.free()
  saveDb()
}

function getLastOfflineRecord() {
  const stmt = db.prepare("SELECT content, created_at as timestamp FROM events WHERE type = 'offline' ORDER BY id DESC LIMIT 1")
  const result = stmt.step() ? stmt.getAsObject() : null
  stmt.free()
  return result
}

// ================================================================
// 用户画像 (meta 表)
// ================================================================

function getLatestProfile() {
  const content = getMeta('latest_profile')
  return content ? { content } : null
}

function setLatestProfile(content) {
  setMeta('latest_profile', content)
}

// ================================================================
// Session CRUD
// ================================================================

function createSession(characterId, title) {
  const oldSession = getActiveSession()
  if (oldSession && oldSession.summary && oldSession.character_id === characterId) {
    saveCharacterMemory(characterId, 'conversation_summary', oldSession.summary, 0.7)
  }

  db.run("UPDATE sessions SET is_active = 0 WHERE is_active = 1")
  const stmt = db.prepare(
    'INSERT INTO sessions (character_id, title, is_active) VALUES (?, ?, 1)'
  )
  stmt.run([characterId, title || '新对话'])
  stmt.free()
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
  saveDb()
  return id
}

function getActiveSession() {
  const stmt = db.prepare('SELECT * FROM sessions WHERE is_active = 1 ORDER BY id DESC LIMIT 1')
  const result = stmt.step() ? stmt.getAsObject() : null
  stmt.free()
  return result
}

function getSessionList() {
  const stmt = db.prepare('SELECT * FROM sessions ORDER BY last_active_at DESC')
  const rows = []
  while (stmt.step()) { rows.push(stmt.getAsObject()) }
  stmt.free()
  return rows
}

function switchSession(sessionId) {
  db.run("UPDATE sessions SET is_active = 0 WHERE is_active = 1")
  const stmt = db.prepare("UPDATE sessions SET is_active = 1, last_active_at = datetime('now') WHERE id = ?")
  stmt.bind([sessionId])
  stmt.step()
  stmt.free()
  saveDb()
  invalidateMessageCache(sessionId)
}

function deleteSession(sessionId) {
  let stmt = db.prepare('DELETE FROM messages WHERE session_id = ?')
  stmt.bind([sessionId])
  stmt.step()
  stmt.free()
  stmt = db.prepare('DELETE FROM sessions WHERE id = ?')
  stmt.bind([sessionId])
  stmt.step()
  stmt.free()
  saveDb()
  invalidateMessageCache(sessionId)
}

function getSessionById(sessionId) {
  const stmt = db.prepare('SELECT * FROM sessions WHERE id = ?')
  stmt.bind([sessionId])
  const result = stmt.step() ? stmt.getAsObject() : null
  stmt.free()
  return result
}

function archiveSession(sessionId) {
  const stmt = db.prepare("UPDATE sessions SET is_active = 0, last_active_at = datetime('now') WHERE id = ?")
  stmt.bind([sessionId])
  stmt.step()
  stmt.free()
  saveDb()
}

function getSessionMessageCount(sessionId) {
  const stmt = db.prepare('SELECT count(*) as cnt FROM messages WHERE session_id = ?')
  stmt.bind([sessionId])
  stmt.step()
  const result = stmt.getAsObject()
  stmt.free()
  return result.cnt
}

function getLatestMessageIdForSession(sessionId) {
  const stmt = db.prepare('SELECT MAX(id) as maxId FROM messages WHERE session_id = ?')
  stmt.bind([sessionId])
  stmt.step()
  const result = stmt.getAsObject()
  stmt.free()
  return result.maxId || 0
}

function updateSessionSummary(sessionId, summaryText) {
  const stmt = db.prepare("UPDATE sessions SET summary = ? WHERE id = ?")
  stmt.run([summaryText, sessionId])
  stmt.free()
  const latestMsgId = getLatestMessageIdForSession(sessionId)
  db.run('UPDATE sessions SET last_summarized_msg_id = ? WHERE id = ?', [latestMsgId, sessionId])
  saveDb()
}

// ================================================================
// Events CRUD
// ================================================================

function saveEvent(sessionId, type, content, metadata) {
  const stmt = db.prepare(
    'INSERT INTO events (session_id, type, content, metadata) VALUES (?, ?, ?, ?)'
  )
  stmt.run([sessionId || null, type, content, JSON.stringify(metadata || {})])
  stmt.free()
  saveDb()
}

function getEventByType(type, limit) {
  const stmt = db.prepare(
    `SELECT * FROM events WHERE type = ? ORDER BY id DESC LIMIT ?`
  )
  stmt.bind([type, limit || 50])
  const rows = []
  while (stmt.step()) { rows.push(stmt.getAsObject()) }
  stmt.free()
  return rows
}

// ================================================================
// 角色记忆 (character_memories) CRUD
// ================================================================

function saveCharacterMemory(characterId, category, content, confidence) {
  const existing = findSimilarCharacterMemory(characterId, content)
  if (existing) {
    const decayed = existing.confidence * Math.exp(-0.01 * Math.max(0, (Date.now() - new Date(existing.updated_at || existing.created_at).getTime()) / (1000 * 60 * 60 * 24)))
    const newConf = Math.min(1, Math.max(0, decayed + 0.15))
    const stmt = db.prepare("UPDATE character_memories SET confidence = ?, updated_at = datetime('now') WHERE id = ?")
    stmt.run([newConf, existing.id])
    stmt.free()
    saveDb()
    return existing.id
  }

  const stmt = db.prepare(
    'INSERT INTO character_memories (character_id, category, content, confidence) VALUES (?, ?, ?, ?)'
  )
  stmt.run([characterId, category, content, confidence || 0.5])
  const id = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]
  stmt.free()
  saveDb()
  return id
}

function findSimilarCharacterMemory(characterId, content) {
  const searchText = (content || '').slice(0, 100).replace(/[%_]/g, '')
  if (!searchText) return null
  const keywords = searchText.split(/[\s,，。！？、]+/).filter(k => k.length >= 2).slice(0, 5)
  let bestMatch = null
  let bestScore = 0
  for (const kw of keywords) {
    const stmt = db.prepare('SELECT * FROM character_memories WHERE character_id = ? AND content LIKE ?')
    stmt.bind([characterId, `%${kw}%`])
    while (stmt.step()) {
      const row = stmt.getAsObject()
      const tgt = (row.content || '').toLowerCase()
      const src = searchText.toLowerCase()
      let score = 0
      const longer = src.length >= tgt.length ? src : tgt
      const shorter = src.length >= tgt.length ? tgt : src
      if (shorter.length === 0) continue
      for (let i = 0; i <= shorter.length - 3; i++) {
        if (longer.includes(shorter.substring(i, i + 3))) score++
      }
      const similarity = score / Math.max(shorter.length - 2, 1)
      if (similarity > bestScore && similarity > 0.6) {
        bestScore = similarity
        bestMatch = row
      }
    }
    stmt.free()
    if (bestMatch) break
  }
  return bestMatch
}

function getCharacterMemories(characterId, category) {
  let sql = 'SELECT * FROM character_memories WHERE character_id = ?'
  const params = [characterId]
  if (category) {
    sql += ' AND category = ?'
    params.push(category)
  }
  sql += ' ORDER BY confidence DESC LIMIT 20'
  const stmt = db.prepare(sql)
  stmt.bind(params)
  const rows = []
  while (stmt.step()) { rows.push(stmt.getAsObject()) }
  stmt.free()
  return rows
}

function deleteCharacterMemory(id) {
  const stmt = db.prepare('DELETE FROM character_memories WHERE id = ?')
  stmt.run([id])
  stmt.free()
  saveDb()
}

// ================================================================
// Schema v2 迁移：messages 表拆分为 sessions + messages + events
// ================================================================
function migrateSchemaV2() {
  try {
    const charName = getMeta('active_character_name') || '七夜'

    let stmt = db.prepare("INSERT INTO sessions (character_id, title, is_active) VALUES (?, '默认对话', 1)")
    stmt.bind([charName])
    stmt.step()
    stmt.free()
    const sessionId = db.exec('SELECT last_insert_rowid() as id')[0].values[0][0]

    const result = db.exec('SELECT id, role, content FROM messages ORDER BY id ASC')
    const allMsgs = result[0] ? result[0].values : []

    const specialIds = []
    let countSummary = 0, countProfile = 0, countOffline = 0, countTool = 0

    for (const row of allMsgs) {
      const id = row[0]
      const role = row[1] || ''
      const content = row[2] || ''

      if (role === 'offline') {
        stmt = db.prepare("INSERT INTO events (type, content) VALUES ('offline', ?)")
        stmt.bind([content])
        stmt.step()
        stmt.free()
        specialIds.push(id)
        countOffline++
      } else if (content.startsWith('[SUMMARY]')) {
        stmt = db.prepare("INSERT INTO events (session_id, type, content) VALUES (?, 'summary', ?)")
        stmt.bind([sessionId, content])
        stmt.step()
        stmt.free()
        stmt = db.prepare('UPDATE sessions SET summary = ? WHERE id = ?')
        stmt.bind([content, sessionId])
        stmt.step()
        stmt.free()
        stmt = db.prepare('UPDATE sessions SET last_summarized_msg_id = ? WHERE id = ?')
        stmt.bind([id, sessionId])
        stmt.step()
        stmt.free()
        specialIds.push(id)
        countSummary++
      } else if (content.startsWith('[PROFILE]')) {
        stmt = db.prepare("INSERT INTO events (session_id, type, content) VALUES (?, 'profile_update', ?)")
        stmt.bind([sessionId, content])
        stmt.step()
        stmt.free()
        setMeta('latest_profile', content)
        specialIds.push(id)
        countProfile++
      } else if (role === 'system' && content.startsWith('[工具调用:')) {
        stmt = db.prepare("INSERT INTO events (session_id, type, content) VALUES (?, 'tool_call', ?)")
        stmt.bind([sessionId, content])
        stmt.step()
        stmt.free()
        specialIds.push(id)
        countTool++
      }
    }

    if (specialIds.length > 0) {
      const placeholders = specialIds.map(() => '?').join(',')
      stmt = db.prepare(`DELETE FROM messages WHERE id IN (${placeholders})`)
      stmt.bind(specialIds)
      stmt.step()
      stmt.free()
    }

    stmt = db.prepare('UPDATE messages SET session_id = ? WHERE session_id IS NULL')
    stmt.bind([sessionId])
    stmt.step()
    stmt.free()

    setMeta('schema_v2', '1')
    console.log(`[Migration] Schema v2 迁移完成: session=${sessionId}, 迁移 ${specialIds.length} 条 (summary=${countSummary} profile=${countProfile} offline=${countOffline} tool=${countTool})`)
  } catch (err) {
    console.error('[Migration] Schema v2 迁移失败:', err.message || err)
  }
}

// module.exports = { ... }
// Node.js 模块导出：把函数暴露给其他文件
// 其他文件用 const db = require('./db') 引入后，用 db.getDb()、db.saveMessage() 等方式调用
module.exports = {
  getDb,
  saveMessage,
  loadContextForLlm,
  getUnsummarizedCount,
  getUnsummarizedMessages,
  checkAndSummarize,
  saveTool,
  getToolsByType,
  getToolById,
  searchTools,
  getAllActiveTools,
  completeTool,
  deleteTool,
  getUpcomingSchedules,
  markScheduleFired,
  getMeta,
  setMeta,
  saveFact,
  updateFactConfidence,
  findSimilarFact,
  searchFactsLike,
  getAllFacts,
  saveKnowledge,
  searchKnowledgeLike,
  getAllKnowledge,
  saveKnowledgeItem,
  updateKnowledgeConfidence,
  findSimilarItem,
  searchKnowledgeBase,
  getAllKnowledgeByClassification,
  queryKnowledgeBase,
  updateKnowledgeItem,
  deleteKnowledgeItems,
  getKnowledgeStats,
  getLoreMatches,
  migrateToUnifiedKnowledge,
  getMessagesForFactExtraction,
  getUnprocessedFactCount,
  getLatestMessageId,
  getLatestProfile,
  setLatestProfile,
  saveOfflineRecord,
  getLastOfflineRecord,
  saveEvent,
  getEventByType,
  createSession,
  getActiveSession,
  getSessionList,
  getSessionById,
  switchSession,
  deleteSession,
  archiveSession,
  getSessionMessageCount,
  getLatestMessageIdForSession,
  updateSessionSummary,
  migrateSchemaV2,
  getCachedMessages,
  setCachedMessages,
  invalidateMessageCache,
  saveCharacterMemory,
  findSimilarCharacterMemory,
  getCharacterMemories,
  deleteCharacterMemory,
}
