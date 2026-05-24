/**
 * ===== ai-test.js — AI SDK 连通性最小测试 =====
 * 直接在 Node.js 跑：node src/ai-test.js
 * 所有输出写入 netpet-error.log
 */
const fs = require('fs')
const path = require('path')
function getDataDir() {
  try {
    const { app } = require('electron')
    if (app.isPackaged) return process.resourcesPath
  } catch {}
  return path.join(__dirname, '..')
}
const LOG = path.join(getDataDir(), 'netpet-error.log')

function log(msg) {
  const line = `[${new Date().toISOString()}] [AI-TEST] ${msg}\n`
  console.log(line.trim())
  try { fs.appendFileSync(LOG, line, 'utf-8') } catch {}
}

async function main() {
  // 1. 读 config.json 拿 api_settings
  const rawCfg = fs.readFileSync(path.join(getDataDir(), 'config.json'), 'utf-8')
  const cfg = JSON.parse(rawCfg)
  // 注意：config.json 里的 key 是加密的，这里只测连通性，手动解不了，跳过加密
  // 如果 config.json 的 key 是明文就直接用，是 __enc__: 开头则需要从程序内获取
  const prov = cfg.api_settings?.providers?.deepseek
  if (!prov?.api_key || !prov?.base_url) {
    log('FAIL: 未找到 deepseek 配置')
    return
  }
  log(`baseURL: ${prov.base_url}`)
  log(`model: ${prov.model}`)
  log(`apiKey 长度: ${prov.api_key.length}`)

  // 2. 动态 import AI SDK
  log('正在加载 AI SDK...')
  const [aiMod, openaiMod] = await Promise.all([
    import('ai'),
    import('@ai-sdk/openai'),
  ])
  log(`AI SDK 加载成功. generateText=${typeof aiMod.generateText}`)

  // 3. 创建 provider
  const openai = openaiMod.createOpenAI({
    apiKey: prov.api_key,
    baseURL: prov.base_url,
  })
  const model = openai(prov.model)
  log(`model 创建成功. modelId=${model.modelId}`)

  // 4. 调用 generateText
  log('正在调用 generateText...')
  try {
    const result = await aiMod.generateText({
      model,
      messages: [
        { role: 'system', content: '回复纯 JSON：{"reply":"你好","emotion":"happy"}' },
        { role: 'user', content: '说你好' },
      ],
      temperature: 0.1,
    })
    log(`generateText 成功!`)
    log(`result.text = "${result.text}"`)
    log(`result 的所有 key: ${Object.keys(result).join(', ')}`)
    log(`usage: ${JSON.stringify(result.usage)}`)
    log(`finishReason: ${result.finishReason}`)
    
    // 尝试解析 JSON
    try {
      const parsed = JSON.parse(result.text)
      log(`JSON 解析成功: ${JSON.stringify(parsed)}`)
    } catch (e) {
      log(`JSON 解析失败: ${e.message}`)
    }
  } catch (err) {
    log(`generateText 失败: ${err.message}`)
    log(`错误详情: ${err.stack}`)
    if (err.cause) log(`错误根因: ${err.cause.message || err.cause}`)
  }
}

main().catch(e => log(`顶级异常: ${e.message}\n${e.stack}`))
