// ===== llm.js 鈥?LLM 閫氫俊鏍稿績 =====
//
// 杩欎釜鏂囦欢璐熻矗鍜?LLM 澶фā鍨?API 閫氫俊銆?// 鐢?npm 鍖?"openai" 鎻愪緵鐨?OpenAI 瀹㈡埛绔被锛屽畠鍙互杩炴帴浠讳綍鍏煎 OpenAI API 鐨勬湇鍔°€?//
// npm 鍖?openai 鏄粈涔堬紵
//   鏍囧噯鐨?OpenAI API 瀹㈡埛绔簱锛屾敮鎸?/chat/completions 绔偣銆?//   铏界劧鍚嶅彨 openai锛屼絾瀹冨彲浠ヨ繛鎺?DeepSeek銆丟roq銆佹湰鍦?Ollama 绛?//   浠讳綍鍏煎 OpenAI 鎺ュ彛鐨勬湇鍔♀€斺€斿彧瑕佽缃?baseURL 鎸囧悜瀵瑰簲鐨勫湴鍧€鍗冲彲銆?//
// 鏍稿績 API 璋冪敤锛?//   client.chat.completions.create({
//     model: "妯″瀷鍚?,
//     messages: [{role, content}, ...],
//     temperature: 0.7,     // 0-2锛岃秺楂樿秺闅忔満
//     response_format: { type: 'json_object' },  // 寮哄埗 LLM 杈撳嚭 JSON
//   })
//   杩斿洖锛歿 choices: [{ message: { content: "..." } }] }
//
// 涓ゆ鎺ㄧ悊鏋舵瀯锛?//   鐢ㄦ埛杈撳叆
//     鈫?//   銆愭楠や竴銆慶heckToolCall() 鈥?璋冨伐鍏锋彁鍙栨ā鍨嬶紙渚垮疁妯″瀷锛?//   鈹溾攢 鍒嗘瀽锛氱敤鎴烽渶瑕佽皟鐢ㄥ伐鍏峰悧锛燂紙璁扮瑪璁?璁炬彁閱?鏌ヨ绛夛級
//   鈹溾攢 闇€瑕?鈫?executeToolCall() 鎵ц 鈫?缁撴灉娉ㄥ叆涓婁笅鏂?//   鈹斺攢 涓嶉渶瑕?鈫?鐩存帴璺虫楠や簩
//     鈫?//   銆愭楠や簩銆慶allChatModel() 鈥?璋冧富鑱婂ぉ妯″瀷锛堣鑹茶瀹氱殑 LLM锛?//   鈹溾攢 涓婁笅鏂囷細瑙掕壊璁惧畾 + 鏈畬鎴愪簨椤?+ 鏈€杩戝璇?+ 宸ュ叿缁撴灉 + 鐢ㄦ埛杈撳叆
//   鈹斺攢 杩斿洖锛歿 reply, emotion }

// require('openai') 鈥?寮曞叆 OpenAI Node.js SDK
// 绫诲悕澶у啓寮€澶存槸鎯緥锛堣〃绀哄畠鏄竴涓瀯閫犲嚱鏁帮級
const OpenAI = require('openai')
const db = require('./db')
const tools = require('./tools/index')
// require('./tool-prompt') 鈥?寮曞叆宸ュ叿鎻愬彇妯″瀷鐨勬彁绀鸿瘝妯℃澘
const { buildToolPrompt } = require('./tool-prompt')

// 淇濆瓨鏁版嵁搴撳氨缁殑 Promise锛岀敤浜庣瓑寰呮暟鎹簱鍒濆鍖栧畬鎴?let dbReady = db.getDb()

// ================================================================
// 杈呭姪鍑芥暟
// ================================================================

// makeClient(config, providerName) 鈥?鍒涘缓 OpenAI 瀹㈡埛绔疄渚?// @param config 鈥?瀹屾暣閰嶇疆瀵硅薄
// @param providerName 鈥?鍙€夛紝鎸囧畾鏈嶅姟鍟嗗悕绉帮紝涓嶄紶灏辩敤閰嶇疆閲岄€変腑鐨?function makeClient(config, providerName) {
  // || 杩愮畻绗︼細濡傛灉宸﹁竟鏄?falsy (undefined/null/''/0)锛屽彇鍙宠竟
  // 鐢ㄤ簬璁剧疆榛樿鍊?  const api = config.api_settings || {}
  const provName = providerName || api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key || !prov?.base_url) {
    throw new Error('API 鏈厤缃紝璇风偣鍑昏缃寜閽厤缃紒')
  }
  // new OpenAI({ apiKey, baseURL }) 鈥?鍒涘缓 API 瀹㈡埛绔?  // apiKey: 鐢ㄤ簬 HTTP 璇锋眰璁よ瘉鐨勫瘑閽?  // baseURL: API 鍩虹鍦板潃锛屼笉鍚屾湇鍔″晢鍦板潃涓嶅悓
  return new OpenAI({ apiKey: prov.api_key, baseURL: prov.base_url })
}

// 鑾峰彇褰撳墠鎵€鏈夋椿璺冪殑宸ュ叿璁板綍锛堢瑪璁般€佸緟鍔炪€佹彁閱掞級
function getCurrentToolsContext() {
  return {
    notes: db.getToolsByType('note', 'active'),
    todos: db.getToolsByType('todo', 'active'),
    schedules: db.getToolsByType('schedule', 'active'),
  }
}

// buildPendingContext() 鈥?鏋勫缓"鏈畬鎴愪簨椤?涓婁笅鏂?// 姣忔璋冧富妯″瀷鍓嶅姩鎬佹敞鍏ワ紝鍛婅瘔 LLM 鏈夊摢浜涘緟鍔炲拰鎻愰啋
// 鏍煎紡绀轰緥锛?//   [褰撳墠寰呭姙浜嬮」]
//   鈽?[2] 涔扮尗绮?鈥?鍘昏秴甯備拱涓夋枃楸煎懗鐨勭尗绮?(寰呭姙)
//   鈽?[5] 浼戞伅鎻愰啋 鈥?鍘诲枬鏉按娲诲姩涓€涓?(鎻愰啋, 瑙﹀彂浜?16:30)
// 杩斿洖鏍煎紡 { role: 'system', content: '...' } 鎴?null锛堟病鏈夊緟鍔炴椂锛?function buildPendingContext() {
  const todos = db.getToolsByType('todo', 'active')
  const schedules = db.getToolsByType('schedule', 'active')

  if (todos.length === 0 && schedules.length === 0) return null

  // 鎷兼帴鏂囨湰瀛楃涓?  let text = '\n[褰撳墠寰呭姙浜嬮」]\n'
  for (const t of todos) {
    text += `鈽?[${t.id}] ${t.label || '(寰呭姙)'} 鈥?${t.content || ''}\n`
  }
  for (const s of schedules) {
    // new Date(鏃堕棿瀛楃涓? 鍒涘缓鏃ユ湡瀵硅薄
    // .toLocaleString('zh-CN', {}) 鏍煎紡鍖栦负涓枃鏃堕棿
    const timeStr = s.trigger_at
      ? new Date(s.trigger_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })
      : ''
    text += `鈽?[${s.id}] ${s.label || '鎻愰啋'} 鈥?${s.content || ''} (鎻愰啋${timeStr ? ', 瑙﹀彂浜?' + timeStr : ''})\n`
  }
  text += '\n濡傛灉鐢ㄦ埛纭鏌愪欢浜嬪凡缁忓仛浜嗭紝鍦ㄥ洖澶嶇殑 completed_tasks 鏁扮粍閲屽～瀵瑰簲鐨?ID銆俓n'

  return { role: 'system', content: text }
}

// processCompletedTasks(tasks) 鈥?澶勭悊 LLM 鏍囪涓哄畬鎴愮殑浠诲姟
// LLM 鍦ㄥ洖澶嶄腑杩斿洖 completed_tasks: [1, 3]锛岃〃绀?ID 1 鍜?3 鐨勪换鍔″凡瀹屾垚
// 杩欓噷鎶婂搴旂殑鏁版嵁搴撹褰曟爣璁颁负 completed
function processCompletedTasks(tasks) {
  // Array.isArray 鏄?JS 鍐呯疆鏂规硶锛屽垽鏂€兼槸涓嶆槸鏁扮粍
  if (!Array.isArray(tasks) || tasks.length === 0) return
  for (const id of tasks) {
    // parseInt 鎶婂瓧绗︿覆/鏁板瓧杞垚鏁存暟
    // isNaN 鍒ゆ柇鏄笉鏄?NaN锛堜笉鏄暟瀛楋級
    const numId = parseInt(id)
    if (!isNaN(numId)) {
      db.completeTool(numId)
      console.log(`[LLM] completed_tasks: ID ${numId} 鏍囪瀹屾垚`)
    }
  }
}

// ================================================================
// 猸?姝ラ涓€锛氬伐鍏锋彁鍙栨ā鍨?// ================================================================
// 鐢ㄤ究瀹滄ā鍨嬪垎鏋愮敤鎴疯緭鍏ワ紝鍒ゆ柇鏄惁闇€瑕佽皟鐢ㄥ伐鍏?async function checkToolCall(config, userText, systemPrompt) {
  const api = config.api_settings || {}
  // 宸ュ叿鎻愬彇鏈嶅姟鍟嗭細濡傛灉璁剧疆浜嗗氨鐢ㄦ寚瀹氱殑锛屽惁鍒欏拰瀵硅瘽鐢ㄥ悓涓€涓?  const provName = api.tool_provider || api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key) return { tool: null, params: null }

  // 宸ュ叿妯″瀷锛氬鏋滆缃簡灏辩敤锛屽惁鍒欑敤瀵硅瘽妯″瀷
  const toolModel = (api.tool_model && api.tool_model !== '鍚屽璇濇湇鍔″晢') ? api.tool_model : prov.model
  const toolClient = makeClient(config, provName)

  const charName = config.character_settings?.name || '涓冨鍠?
  const toolCtx = getCurrentToolsContext()

  // 鏋勫缓宸ュ叿鎻愬彇鐨?system prompt锛堝憡璇夋ā鍨嬪畠鍙礋璐ｅ垽鏂涓嶈璋冨伐鍏凤級
  const toolPrompt = buildToolPrompt(charName, toolCtx)
  // 鍔犺浇鏈€杩?6 鏉″璇濅綔涓轰笂涓嬫枃
  const recentHistory = db.loadContextForLlm(6)

  // 缁欑敤鎴疯緭鍏ュ姞涓婂綋鍓嶆椂闂存埑锛屾柟渚?AI 鐞嗚В"鍏偣""鏄庡ぉ"绛夎嚜鐒惰瑷€鏃堕棿
  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long'
  })
  const userTextWithTime = `[褰撳墠绯荤粺鏃堕棿: ${timeStr}] 鐢ㄦ埛璇? ${userText}`

  try {
    // await 鈥?绛夊緟寮傛鎿嶄綔锛圓PI 璋冪敤锛夎繑鍥炵粨鏋?    // 鍑芥暟澹版槑涓?async 鍚庢墠鑳界敤 await
    const response = await toolClient.chat.completions.create({
      model: toolModel,
      messages: [
        { role: 'system', content: toolPrompt },
        // ...灞曞紑杩愮畻绗︼細鎶婃暟缁勭殑鍏冪礌鎷嗗紑鏀惧叆
        // .slice(-4) 鍙栨暟缁勬渶鍚?4 涓厓绱?        ...recentHistory.slice(-4),
        { role: 'user', content: userTextWithTime },
      ],
      // response_format: { type: 'json_object' } 鈥?鍛婄煡 API 杩斿洖 JSON 鏍煎紡
      // 涓嶆槸鎵€鏈夋ā鍨嬮兘鏀寔锛屼笉鏀寔鐨勪細蹇界暐
      response_format: { type: 'json_object' },
      temperature: 0.1,  // 浣庢俯搴﹁宸ュ叿鍒ゆ柇鏇寸ǔ瀹?    })

    // response.choices[0].message.content 鈥?API 杩斿洖鐨勬枃鏈唴瀹?    const raw = response.choices[0].message.content
    // JSON.parse() 鎶?JSON 瀛楃涓茶浆鎴?JS 瀵硅薄
    const parsed = JSON.parse(raw)
    if (parsed && parsed.tool) {
      console.log(`[LLM] checkToolCall 鍐冲畾璋冪敤宸ュ叿: ${parsed.tool}`, parsed.params)
      return { tool: parsed.tool, params: parsed.params || {}, raw }
    }
    console.log(`[LLM] checkToolCall 涓嶉渶瑕佸伐鍏? reason: ${parsed?.reason || '鏃?}`)
    return { tool: null, params: null, raw }
  } catch (err) {
    console.error('[LLM] 宸ュ叿鎻愬彇妯″瀷璋冪敤澶辫触:', err.message)
    return { tool: null, params: null }
  }
}

// executeToolCall(config, toolName, params) 鈥?鎵ц宸ュ叿骞惰繑鍥炵粨鏋?async function executeToolCall(config, toolName, params) {
  console.log(`[LLM] 鎵ц宸ュ叿: ${toolName}`, JSON.stringify(params))
  // tools.executeTool() 鏄?tools.js 鐨勫叆鍙ｅ嚱鏁?  const result = await tools.executeTool(toolName, params, config)
  console.log(`[LLM] 宸ュ叿缁撴灉:`, result.result)
  return result
}

// ================================================================
// 猸?姝ラ浜岋細璋冧富鑱婂ぉ妯″瀷锛堝姞涓婂伐鍏风粨鏋滐級
// ================================================================

// callChatModel(config, extraMessages, userContent, isSystem)
// 搴曞眰 LLM 璋冪敤 + 閫氱敤鍚庡鐞?// @param config 鈥?瀹屾暣閰嶇疆
// @param extraMessages 鈥?棰濆鐨勬秷鎭暟缁勶紙濡傚伐鍏锋墽琛岀粨鏋滐級
// @param userContent 鈥?鐢ㄦ埛/绯荤粺杈撳叆鏂囨湰
// @param isSystem 鈥?鏄惁涓虹郴缁熸秷鎭紙true 鏃朵笉淇濆瓨涓哄璇濆巻鍙蹭腑鐨勭敤鎴锋秷鎭級
// @returns { reply: 鍥炲鏂囨湰, emotion: 鎯呯华鏍囩 }
async function callChatModel(config, extraMessages, userContent, isSystem) {
  // await dbReady 鈥?绛夊緟鏁版嵁搴撳氨缁悗鍐嶇户缁?  await dbReady

  const api = config.api_settings || {}
  const provName = api.provider || 'deepseek'
  const prov = api.providers?.[provName]
  if (!prov?.api_key || !prov?.base_url) throw new Error('API 鏈厤缃?)

  const client = makeClient(config)
  const systemPrompt = config.character_settings?.system_prompt || ''
  // DeepSeek API 寮哄埗瑕佹眰锛氫娇鐢?response_format json_object 鏃讹紝prompt 涓繀椤诲寘鍚?"json"
  const promptHasJSON = systemPrompt.toLowerCase().includes('json')
  const effectivePrompt = promptHasJSON
    ? systemPrompt
    : systemPrompt + '\n璇蜂互JSON鏍煎紡鍥炲銆?
  const model = prov.model || 'deepseek-v4-flash'
  const summaryInterval = api.summary_interval || 5
  // Math.max(a, b) 鈥?鍙栦袱涓暟涓緝澶х殑锛岀‘淇濊嚦灏戞湁瓒冲鐨勪笂涓嬫枃
  const maxLen = Math.max(api.max_history_length || 10, summaryInterval * 2)

  // 缁欑敤鎴疯緭鍏ュ姞鏃堕棿鎴?  const now = new Date()
  const timeStr = now.toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'long'
  })
  // 涓夊厓琛ㄨ揪寮忥細鏉′欢 ? 鐪熷€?: 鍋囧€?  const finalContent = isSystem
    ? userContent
    : `[绯荤粺褰撳墠鐘舵€? 褰撳墠鏃堕棿${timeStr}]\n鐢ㄦ埛璇? ${userContent}`

  if (!isSystem) {
    // 淇濆瓨鐢ㄦ埛娑堟伅鍒版暟鎹簱
    db.saveMessage('user', finalContent)
  }

  // 鏋勫缓瀹屾暣涓婁笅鏂囨秷鎭暟缁?  const pendingContext = buildPendingContext()
  const chatHistory = [
    { role: 'system', content: effectivePrompt },  // 瑙掕壊璁惧畾
  ]
  if (pendingContext) chatHistory.push(pendingContext)  // 鏈畬鎴愪簨椤?  // 鍔犺浇鏈€杩戝璇濆巻鍙?  chatHistory.push(...db.loadContextForLlm(maxLen))

  // 鎻掑叆棰濆娑堟伅锛堝宸ュ叿鎵ц缁撴灉锛?  if (extraMessages && extraMessages.length > 0) {
    for (const msg of extraMessages) {
      chatHistory.push(msg)
    }
  }

  // 褰撳墠杈撳叆
  const role = isSystem ? 'system' : 'user'
  chatHistory.push({ role, content: finalContent })

  // 璋?LLM API
  let answerText
  try {
    // stream: true 鏃堕€愬潡绱Н锛岄檷浣庨瀛楀欢杩?TTFB)锛沠alse 鏃剁洿鎺ユ嬁瀹屾暣鍝嶅簲
    if (api.stream_enabled) {
      const stream = await client.chat.completions.create({
        model: model,
        messages: chatHistory,
        response_format: { type: 'json_object' },
        temperature: api.temperature || 0.7,
        stream: true,
      })
      let fullContent = ''
      for await (const chunk of stream) {
        // chunk.choices[0]?.delta?.content 鏄閲忔枃鏈紙鍙兘涓?undefined锛?        fullContent += chunk.choices[0]?.delta?.content || ''
      }
      answerText = fullContent
    } else {
      const response = await client.chat.completions.create({
        model: model,
        messages: chatHistory,
        response_format: { type: 'json_object' },
        temperature: api.temperature || 0.7,
      })
      answerText = response.choices[0].message.content
    }
  } catch (err) {
    console.error('[LLM] API 璇锋眰澶辫触:', err.message)
    if (err.status) console.error('[LLM] HTTP 鐘舵€佺爜:', err.status)
    if (err.code) console.error('[LLM] 閿欒鐮?', err.code)
    throw new Error(`API 璇锋眰澶辫触: ${err.message}`)
  }

  // 瑙ｆ瀽 LLM 杩斿洖鐨?JSON
  const result = parseResponse(answerText)

  // 澶勭悊 completed_tasks锛氭爣璁板畬鎴愮殑浠诲姟
  if (result.completed_tasks) {
    processCompletedTasks(result.completed_tasks)
  }

  // 淇濆瓨 AI 鍥炲鍒版暟鎹簱
  db.saveMessage('assistant', answerText)

  // 妫€鏌ユ槸鍚﹂渶瑕佹€荤粨璁板繂锛堝悗鍙板紓姝ユ墽琛岋紝涓嶉樆濉炲搷搴旓級
  const summaryData = db.checkAndSummarize(client, model, summaryInterval)
  if (summaryData) {
    try {
      await db.doSummarize(api, summaryData)
    } catch (err) {
      console.error('鍚庡彴鎬荤粨澶辫触:', err.message)
    }
  }

  return { reply: result.reply, emotion: result.emotion }
}

// ================================================================
// 鐢ㄦ埛鍙戞秷鎭紙瀹屾暣涓ゆ鎺ㄧ悊锛?// ================================================================
// 杩欐槸缁欐覆鏌撹繘绋嬭皟鐢ㄧ殑涓诲叆鍙ｅ嚱鏁?async function sendMessage(config, userText) {
  let toolResult = null
  // 姝ラ涓€锛氬伐鍏锋彁鍙?  const toolDecision = await checkToolCall(config, userText, config.character_settings?.system_prompt || '')

  if (toolDecision.tool) {
    // 鎵ц宸ュ叿
    toolResult = await executeToolCall(config, toolDecision.tool, toolDecision.params)
    if (toolResult) {
      // 鎶婂伐鍏锋墽琛岀粨鏋滀繚瀛樺埌鏁版嵁搴擄紙浣滀负瀵硅瘽涓婁笅鏂囩殑涓€閮ㄥ垎锛?      db.saveMessage('system', `[宸ュ叿璋冪敤: ${toolDecision.tool}] ${toolResult.result}`)
    }
  }

  // 鏋勫缓棰濆娑堟伅锛氬鏋滄湁宸ュ叿缁撴灉锛屽憡璇変富妯″瀷鍒氭墠鎵ц浜嗕粈涔堝伐鍏?  const extraMessages = toolResult
    ? [{ role: 'system', content: `[绯荤粺: 鍒氭墠鎵ц浜嗗伐鍏?"${toolDecision.tool}"锛岀粨鏋滃涓媇\n${toolResult.result}` }]
    : []

  // 姝ラ浜岋細璋冧富鑱婂ぉ妯″瀷
  return await callChatModel(config, extraMessages, userText, false)
}

// ================================================================
// 绯荤粺涓诲姩鍙戞秷鎭紙瀹氭椂鎻愰啋绛夛紝涓嶈蛋宸ュ叿鎻愬彇锛?// ================================================================
// 鐢ㄤ簬瀹氭椂鎻愰啋銆佺郴缁熼€氱煡绛夊満鏅?// 鍜?sendMessage 鐨勫尯鍒細涓嶈蛋宸ュ叿鎻愬彇姝ラ锛岀洿鎺ヨ皟涓绘ā鍨?async function sendSystemMessage(config, systemContent) {
  const result = await callChatModel(config, [], systemContent, true)

  // 琛ュ瓨绯荤粺瑙﹀彂婧愭秷鎭紝鏂逛究鏌ョ湅璁板綍
  db.saveMessage('system', systemContent)

  return result
}

// ================================================================
// 鑾峰彇妯″瀷鍒楄〃锛堣缃〉闈㈢殑"鑾峰彇鍒楄〃"鎸夐挳鐢級
// ================================================================
// fetch(url, options) 鈥?娴忚鍣?Node.js 鍐呯疆鐨?HTTP 璇锋眰鍑芥暟
// fetchModels(baseUrl, apiKey) 璋?GET /models 鑾峰彇鏈嶅姟鍟嗙殑妯″瀷鍒楄〃
async function fetchModels(baseUrl, apiKey) {
  if (!baseUrl || !apiKey) throw new Error('璇峰厛濉啓 Base URL 鍜?API Key')
  // String.replace(姝ｅ垯, 鏇挎崲) 鈥?.replace(/\/+$/, '') 鍘绘帀 URL 鏈熬澶氫綑鐨勬枩鏉?  const url = `${baseUrl.replace(/\/+$/, '')}/models`
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${apiKey}` }
  })
  // res.ok 鈥?HTTP 鐘舵€佺爜鍦?200-299 鑼冨洿鏃朵负 true
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`)
  // res.json() 鈥?瑙ｆ瀽鍝嶅簲浣撲负 JSON 瀵硅薄
  const data = await res.json()
  // data.data 鏄?OpenAI API 杩斿洖鐨勬ā鍨嬫暟缁勶紝姣忎釜鍏冪礌鏄?{id: "妯″瀷鍚?, ...}
  // .map(m => m.id) 鈥?鎻愬彇鎵€鏈夋ā鍨嬬殑 id 瀛楁缁勬垚鏂版暟缁?  return data.data?.map(m => m.id) || []
}

// ================================================================
// 瑙ｆ瀽 LLM 杩斿洖鐨?JSON锛堜笁绾у閿欙級
// ================================================================
// LLM 杩斿洖鐨?JSON 鏍煎紡锛歿 reply, emotion, completed_tasks? }
// 鍥犱负 LLM 鏈夋椂涓嶄弗鏍艰緭鍑虹函 JSON锛堜細澶氳緭鍑鸿鏄庢枃瀛楋級锛屾墍浠ラ渶瑕佸閿欏鐞?
// 鍚堟硶鐨勬儏缁爣绛剧櫧鍚嶅崟锛堝墠绔珛缁樻枃浠跺悕渚濊禆姝ゅ垪琛級
const VALID_EMOTIONS = ['idle', 'happy', 'angry', 'sad', 'shy', 'confused']

// validEmotion(raw) 鈥?鏍￠獙鎯呯华鏍囩锛岄潪娉曞€奸檷绾т负 idle 骞惰褰曟棩蹇?function validEmotion(emotion) {
  const e = (emotion || '').trim().toLowerCase()
  if (VALID_EMOTIONS.includes(e)) return e
  if (emotion) console.error(`[LLM] 闈炴硶 emotion 鍊? "${emotion}" 鈫?闄嶇骇涓?idle`)
  return 'idle'
}

function parseResponse(text) {
  // 绛栫暐 1锛氱洿鎺?parse锛堟渶绠€鍗曠殑鎯呭喌锛孡LM 涓ユ牸杈撳嚭浜嗙函 JSON锛?  try {
    const parsed = JSON.parse(text)
    return {
      reply: parsed.reply || '鍛?..',
      emotion: validEmotion(parsed.emotion),
      completed_tasks: parsed.completed_tasks || [],
    }
  } catch {}
  // 绌?catch 鍧楋細蹇界暐瑙ｆ瀽澶辫触锛岀户缁笅涓€涓瓥鐣?
  // 绛栫暐 2锛氭彁鍙栫涓€涓畬鏁寸殑 JSON 瀵硅薄锛圠LM 鍦?JSON 鍓嶅悗鍔犱簡鏂囧瓧锛?  // 绠楁硶锛氱敤澶ф嫭鍙疯鏁板櫒鎵惧埌瀹屾暣闂悎鐨?{ ... }
  let braceCount = 0  // 澶ф嫭鍙锋繁搴?  let start = -1      // 绗竴涓?{ 鐨勪綅缃?  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{') {
      if (start === -1) start = i  // 璁板綍绗竴涓?{ 鐨勪綅缃?      braceCount++
    } else if (text[i] === '}') {
      braceCount--
      if (braceCount === 0 && start !== -1) {
        // 澶ф嫭鍙峰畬鍏ㄩ棴鍚堬紝鎻愬彇杩欐瀛愬瓧绗︿覆
        const candidate = text.slice(start, i + 1)
        try {
          const parsed = JSON.parse(candidate)
          return {
            reply: parsed.reply || '鍛?..',
            emotion: validEmotion(parsed.emotion),
            completed_tasks: parsed.completed_tasks || [],
          }
        } catch {}
        start = -1  // 閲嶇疆锛岀户缁壘涓嬩竴涓?JSON 鍧?      }
    }
  }

  // 绛栫暐 3锛氫慨澶嶅悗瑙ｆ瀽锛堣浆涔夐棶棰橈級
  // LLM 鍙兘鍦?JSON 瀛楃涓插€奸噷杈撳嚭鏈浆涔夌殑鎹㈣绗︺€佸弽鏂滄潬绛?  // 鐢ㄦ鍒欐浛鎹慨澶嶅父瑙侀棶棰橈細
  //   \\(?!["\\/bfnrt]|u[0-9a-fA-F]{4}) 鈥?鍖归厤鏃犳晥鐨勮浆涔夊瓧绗?  //   .replace(/\n/g, '\\n') 鈥?鎹㈣绗﹁浆鎴?\n 瀛楃涓?  let repaired = text
    .replace(/\\(?!["\\/bfnrt]|u[0-9a-fA-F]{4})/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
  try {
    const parsed = JSON.parse(repaired)
    return {
      reply: parsed.reply || '鍛?..',
      emotion: validEmotion(parsed.emotion),
      completed_tasks: parsed.completed_tasks || [],
    }
  } catch {}

  // 鎵€鏈夌瓥鐣ラ兘澶辫触锛屾姏鍑洪敊璇?  throw new Error(`JSON 瑙ｆ瀽澶辫触: ${text.slice(0, 200)}...`)
}

module.exports = { sendMessage, sendSystemMessage, fetchModels }
