// ===== config.js — 配置文件读写 =====
//
// 负责读取和写入 config.json 配置文件。
//
// 关键功能：
//   1. load() — 读取 config.json 并解密 API Key（只存在于内存中）
//   2. save() — 加密 API Key 后写入 config.json（磁盘上永远加密）
//
// 用到的 Node.js 内置模块：
//   fs (File System) — 读写文件
//   path — 拼接文件路径
//
// 用到的 Electron API：
//   safeStorage — 操作系统级加密（Windows DPAPI / macOS Keychain / Linux libsecret）
//     encryptString(明文) → Buffer（加密后的字节）
//     decryptString(Buffer) → 明文
//     isEncryptionAvailable() → 系统是否支持加密

const fs = require('fs')
const path = require('path')

// path.join() 把参数拼成完整路径
// __dirname 是当前文件目录，'..' 是上一级，最终指向项目根目录的 config.json
const CONFIG_PATH = path.join(__dirname, '..', 'config.json')

// 保存 safeStorage 实例的引用（由 main.js 在启动时传入）
let safeStorage = null

// ================================================================
// 初始化
// ================================================================

// init(ss) — 接收 Electron 的 safeStorage 实例
// main.js 在启动时调用 config.init(safeStorage)
function init(ss) {
  safeStorage = ss
}

// isEncryptionAvailable() — 检查当前操作系统是否支持安全加密存储
// !! 是双非运算符，把值强制转成布尔值（truthy → true, falsy → false）
function isEncryptionAvailable() {
  return !!(safeStorage && safeStorage.isEncryptionAvailable())
}

// ================================================================
// 错误日志
// ================================================================

const ERROR_LOG = path.join(__dirname, '..', 'netpet-error.log')

function logToFile(msg) {
  const timestamp = new Date().toISOString()
  const line = `[${timestamp}] ${msg}\n`
  try {
    fs.appendFileSync(ERROR_LOG, line, 'utf-8')
  } catch {}
}

// ================================================================
// 加密 / 解密
// ================================================================

// encryptKey(明文) — 加密单条 API Key
// 加密后的格式：'__enc__:' + base64(加密字节)
// 存到 config.json 里大概是 "__enc__:dGhpcyBpcyBh...==" 这样
function encryptKey(plainKey) {
  if (!plainKey) return plainKey
  // 如果系统不支持加密，退回明文存储
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) return plainKey
  // 已经加密过的不用重复加密（以 '__enc__:' 开头）
  if (plainKey.startsWith('__enc__:')) return plainKey
  // safeStorage.encryptString(字符串) → Buffer
  // .toString('base64') 把 Buffer 转成 Base64 字符串（方便存在 JSON 里）
  const encrypted = safeStorage.encryptString(plainKey)
  return '__enc__:' + encrypted.toString('base64')
}

// decryptKey(存储值) — 解密单条 API Key
// 如果存储值不是 '__enc__:' 开头，就是明文（旧格式），直接返回
// 解密失败时不会抛异常，返回 '' 并记录日志（防止跨机器复制 config 导致整个 load 失败）
function decryptKey(stored) {
  if (!stored) return stored
  if (!stored.startsWith('__enc__:')) return stored
  if (!safeStorage || !safeStorage.isEncryptionAvailable()) {
    logToFile('[Config] safeStorage 不可用，无法解密 API Key，返回空值')
    return ''
  }
  try {
    const b64 = stored.slice(8)
    const buf = Buffer.from(b64, 'base64')
    return safeStorage.decryptString(buf)
  } catch (err) {
    // 最常见场景：config.json 从另一台机器复制过来，加密绑定原账户，解密失败
    logToFile(`[Config] API Key 解密失败（可能来自另一台机器）: ${err.message}`)
    return ''
  }
}

// processAllProviderKeys(config, processor) — 遍历所有 provider 分组执行加/解密
// 统一处理 api_settings.providers 和 web_search_settings.providers 两套密钥
function processAllProviderKeys(config, processor) {
  const groups = [
    config?.api_settings?.providers,
    config?.web_search_settings?.providers,
  ]
  for (const providers of groups) {
    if (!providers) continue
    for (const name of Object.keys(providers)) {
      if (providers[name].api_key) {
        providers[name].api_key = processor(providers[name].api_key)
      }
    }
  }
}

// 批量解密配置中所有 provider 的 api_key
function decryptProviders(config) {
  processAllProviderKeys(config, decryptKey)
}

// 批量加密配置中所有 provider 的 api_key
function encryptProviders(config) {
  processAllProviderKeys(config, encryptKey)
}

// ================================================================
// 读取
// ================================================================

function load() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const config = JSON.parse(raw)
    // 解密所有 API Key（解密失败时单个 key 降级为空串，不会导致整个 load 失败）
    decryptProviders(config)
    return config
  } catch (err) {
    const msg = `[Config] 配置文件读取/解析失败: ${err.message} — 使用默认配置`
    console.error(msg)
    logToFile(msg)
    // 读取失败时返回默认配置
    return {
      api_settings: {
        provider: 'deepseek',
        providers: {},          // 空的 provider 列表
        tool_provider: '',
        tool_model: '',
        temperature: 0.7,
        stream_enabled: true,
        summary_provider: '同对话服务商',
        summary_interval: 5,
        max_history_length: 10,
      },
      character_settings: {
        name: '七夜',
        system_prompt: '你是一只寄宿在用户桌面的电子宠物"七夜"（ななや），自称"吾辈"的高傲黑猫娘。\n回复时严格输出 JSON：{"reply": "回复内容", "emotion": "idle|happy|angry|sad|shy|confused"}'
      },
      ui_settings: {
        window_width: 400,
        window_height: 800,
        image_width: 300,
        image_height: 440
      },
      proactive_settings: {
        enabled: true,
        gap_hours: 6,
        idle_interval_minutes: 10,
        idle_base_probability: 0.15,
        idle_escalation_enabled: false,
        idle_escalation_increment: 0.10,
      },
      web_search_settings: {
        enabled: true,
        provider: 'duckduckgo',
        providers: {
          tavily: { base_url: 'https://api.tavily.com', api_key: '' },
          duckduckgo: { base_url: 'https://api.duckduckgo.com', api_key: '' },
          serper: { base_url: 'https://google.serper.dev', api_key: '' },
          anthropic: { base_url: 'https://api.anthropic.com/v1', api_key: '' },
        }
      }
    }
  }
}

// ================================================================
// 迁移（旧明文 → 新加密）
// ================================================================

// needsMigration() — 检查磁盘上的 config.json 是否还有明文 API Key
// 直接读文件（不走 load()，load 会把解密的也当明文），检查是否有未加密的 key
function needsMigration() {
  if (!isEncryptionAvailable()) return false
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const onDisk = JSON.parse(raw)
    const allProviders = [
      ...Object.values(onDisk?.api_settings?.providers || {}),
      ...Object.values(onDisk?.web_search_settings?.providers || {}),
    ]
    return allProviders.some(
      p => p.api_key && !p.api_key.startsWith('__enc__:') && p.api_key !== '***'
    )
  } catch {
    return false
  }
}

// migrate() — 执行迁移：加载→加密→存盘
function migrate() {
  const config = load()
  save(config)
}

// ================================================================
// 保存
// ================================================================

// save(config) — 合并并保存配置到磁盘
// 参数 config 是来自设置窗口的新配置（可能只包含部分字段）
// 需要和磁盘上的现有配置合并，避免丢失未修改的字段
function save(config) {
  // load() 会解密，所以 current 里的 key 是明文
  const current = load()
  // 展开运算符 ... — 把对象的属性复制到新对象
  // { ...current, ...config } 效果：后面的覆盖前面的同名属性
  const merged = { ...current, ...config }
  // providers 需要特殊合并：保留所有 provider，只更新修改的那一个
  if (config.api_settings?.providers) {
    merged.api_settings = merged.api_settings || {}
    merged.api_settings.providers = {
      // 先把旧的 providers 铺开
      ...(current.api_settings?.providers || {}),
      // 再把新的 providers 铺开（同名 key 会覆盖旧的）
      ...config.api_settings.providers
    }
    // 同步更新当前选中的 provider 名称
    merged.api_settings.provider = config.api_settings.provider
  }
  // web_search_settings providers 也需要特殊合并
  if (config.web_search_settings?.providers) {
    merged.web_search_settings = merged.web_search_settings || {}
    merged.web_search_settings.providers = {
      ...(current.web_search_settings?.providers || {}),
      ...config.web_search_settings.providers
    }
    merged.web_search_settings.provider = config.web_search_settings.provider
  }
  // 写入前加密所有 API Key
  encryptProviders(merged)
  // JSON.stringify(obj, null, 2) — 把 JS 对象转成 JSON 字符串
  // null 是不需要转换函数，2 是缩进空格数（美化格式）
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

// module.exports — Node.js 模块导出
// 键值对：{ 对外名称: 本地函数 }
// 其他文件 require('./config') 后可以调用 config.load()、config.save() 等
module.exports = { init, load, save, isEncryptionAvailable, needsMigration, migrate }
