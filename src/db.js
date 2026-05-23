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

// 数据库文件路径：上一层目录的 memory.db
const DB_PATH = path.join(__dirname, '..', 'memory.db')

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

  // 把建表后的数据库存盘
  saveDb()
  return db
}

// ================================================================
// 持久化：把内存中的数据库写入磁盘文件
// ================================================================
function saveDb() {
  if (!db) return
  // db.export() — 把整个数据库序列化为 Uint8Array（字节数组）
  const data = db.export()
  // Buffer.from(data) — 把 Uint8Array 转成 Node.js 的 Buffer 类型
  // fs.writeFileSync 要求 Buffer 类型作为输入
  const buffer = Buffer.from(data)
  // fs.writeFileSync(路径, 内容) — 同步写入文件，覆盖原有内容
  fs.writeFileSync(DB_PATH, buffer)
}

// ================================================================
// 对话消息 CRUD
// ================================================================

// saveMessage(角色, 内容) — 保存一条对话消息
// role: 'user' | 'assistant' | 'system' | 'summary'
function saveMessage(role, content) {
  // db.prepare(sql) — 编译一条 SQL 语句，返回一个 Statement 对象
  // 用 ? 做占位符，后续 bind() 绑定参数，防止 SQL 注入
  const stmt = db.prepare('INSERT INTO messages (role, content) VALUES (?, ?)')
  // stmt.run([参数...]) — 绑定参数并执行 SQL
  // [role, content] 按顺序替换上面的两个 ?
  stmt.run([role, content])
  // stmt.free() — 释放 Statement 占用的内存
  // sql.js 需要手动释放，否则会内存泄漏
  stmt.free()
  // 每次写入后立即存盘，保证数据不丢失
  saveDb()
}

// loadContextForLlm(maxLen) — 加载最近对话，供 LLM 上下文使用
// 返回 [{role, content}, ...] 格式的消息数组
// 如果有总结，先加载总结，再加载总结之后的对话
function loadContextForLlm(maxLen) {
  // 查找最近一条总结
  // ORDER BY id DESC LIMIT 1 — 按 ID 倒序取第一条（最新的）
  const summaryStmt = db.prepare(
    "SELECT id, content FROM messages WHERE role='summary' ORDER BY id DESC LIMIT 1"
  )
  // stmt.step() — 执行查询，返回 true 表示取到一行，false 表示没更多行了
  // 必须先调 step()，再调 getAsObject() 才能拿到数据
  summaryStmt.step()
  // stmt.getAsObject() — 把当前行转成 JS 对象 {id: 1, content: "..."}
  const summaryRow = summaryStmt.getAsObject()
  summaryStmt.free()

  // messages 数组是最终返回给 LLM 的对话历史
  const messages = []

  if (summaryRow && summaryRow.id) {
    // 有总结的情况：先放总结，再放总结之后的对话
    messages.push({
      role: 'system',
      content: `[前情提要/记忆总结]: ${summaryRow.content}`
    })
    // 查询 ID 大于总结 ID 的所有消息（即总结之后的新消息）
    const recentStmt = db.prepare(
      'SELECT role, content FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?'
    )
    // stmt.bind([参数...]) — 绑定 SQL 中的 ? 占位符
    recentStmt.bind([summaryRow.id, maxLen])
    // while (stmt.step()) — 循环取所有行，每调一次 step() 前进一行
    while (recentStmt.step()) {
      const row = recentStmt.getAsObject()
      // DeepSeek API 不支持 'summary' 角色，统一转为 'system'
      const role = row.role === 'summary' ? 'system' : row.role
      messages.push({ role, content: row.content })
    }
    recentStmt.free()
  } else {
    // 没有总结：直接取最近 maxLen 条数据
    const recentStmt = db.prepare(
      'SELECT role, content FROM messages ORDER BY id DESC LIMIT ?'
    )
    recentStmt.bind([maxLen])
    // 因为 SQL 是倒序取的（DESC），需要先收集再反转（reverse）恢复正序
    const rows = []
    while (recentStmt.step()) {
      const row = recentStmt.getAsObject()
      rows.push(row)
    }
    recentStmt.free()
    // rows.reverse() — 数组反转，把倒序变正序
    for (const row of rows.reverse()) {
      const role = row.role === 'summary' ? 'system' : row.role
      messages.push({ role, content: row.content })
    }
  }

  return messages
}

// ================================================================
// 记忆总结：防止对话太长导致 LLM 上下文超出限制
// ================================================================

// 统计自上次总结以来的消息数量
function getUnsummarizedCount() {
  // 找最近一条总结的 ID
  const summaryStmt = db.prepare(
    "SELECT id FROM messages WHERE role='summary' ORDER BY id DESC LIMIT 1"
  )
  summaryStmt.step()
  const summaryRow = summaryStmt.getAsObject()
  summaryStmt.free()

  let countStmt
  if (summaryRow && summaryRow.id) {
    // count(*) 统计行数
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

// 获取自上次总结以来的所有消息
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

// 检查是否需要总结，返回 {prompt, messages} 或 null
function checkAndSummarize(client, model, summaryInterval) {
  try {
    const unsummarizedCount = getUnsummarizedCount()
    // summaryInterval * 2：间隔 × 2 是触发阈值
    // 例如间隔 5 意味着累积 10 条未总结消息时触发总结
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

// doSummarize(apiConfig, summaryData) — 调 LLM 生成总结并存入数据库
// 异步函数，用 await 等待 LLM API 返回
async function doSummarize(apiConfig, summaryData) {
  if (!summaryData) return

  // OpenAI 是 npm 包 openai 的入口类
  // 它实现了标准的 OpenAI API 客户端，可以连接任何兼容 OpenAI 接口的服务
  const OpenAI = require('openai')

  // 判断用哪个服务商的模型做总结
  // summary_provider 是设置里的"后台总结服务商"字段
  const provName = apiConfig.summary_provider || ''
  let sApiKey, sBaseUrl, sModel

  if (provName && provName !== '同对话服务商' && apiConfig.providers?.[provName]) {
    // 如果指定了独立的总结服务商，用它的配置
    const sumProv = apiConfig.providers[provName]
    sApiKey = sumProv.api_key
    sBaseUrl = sumProv.base_url
    sModel = sumProv.model
  } else {
    // 否则复用在对话 API 的服务商（同对话服务商）
    const mainProv = apiConfig.providers?.[apiConfig.provider || 'deepseek'] || {}
    sApiKey = mainProv.api_key
    sBaseUrl = mainProv.base_url
    sModel = mainProv.model
  }

  // 创建 OpenAI 客户端实例
  // apiKey: API 密钥（用于请求认证）
  // baseURL: API 接口地址（不同服务商的地址不同）
  const client = new OpenAI({ apiKey: sApiKey, baseURL: sBaseUrl })

  try {
    // client.chat.completions.create() — 调用 LLM 对话 API
    // model: 模型名
    // messages: 对话消息数组 [{role, content}, ...]
    // temperature: 0-2，越高越随机，越低越稳定
    const res = await client.chat.completions.create({
      model: sModel,
      messages: [
        { role: 'system', content: '你是一个对话总结助手。' },
        { role: 'user', content: summaryData.prompt }
      ],
      temperature: 0.5,
    })

    // res.choices[0].message.content — LLM 返回的文本内容
    const summaryText = res.choices[0].message.content.trim()
    // 把总结存入 messages 表，role='summary'
    saveMessage('summary', summaryText)
    console.log('记忆总结已保存:', summaryText.substring(0, 50) + '...')
  } catch (err) {
    console.error('后台总结记忆失败:', err.message)
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
