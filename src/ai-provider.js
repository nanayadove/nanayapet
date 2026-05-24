/**
 * ===== ai-provider.js — AI SDK 动态加载层 =====
 *
 * AI SDK (ai, @ai-sdk/openai) 是 ESM-only 包，NetPet 使用 CommonJS。
 * 通过动态 import() 在 CJS 中按需加载，对外暴露同步风格 API。
 *
 * 用到的 AI SDK API：
 *   generateText({ model, messages, ... }) → { text, output? }
 *   streamText({ model, messages, ... })   → { textStream }
 *   output.object({ schema })              → 结构化输出约束
 *   tool({ description, inputSchema, execute }) → 函数调用工具
 *   createOpenAI({ apiKey, baseURL })      → OpenAI 兼容 provider 工厂
 *
 * 用到的 Zod API：
 *   z.string() / z.number() / z.enum() / z.array() / z.nullable() / z.optional()
 *   z.object({})  → 定义 JSON schema，供 output.object() 使用
 */

let _ai = null
let _zod = null

async function loadSDK() {
  if (_ai && _zod) return { ai: _ai, zod: _zod }
  const [aiModule, openaiModule, zodModule] = await Promise.all([
    import('ai'),
    import('@ai-sdk/openai'),
    import('zod'),
  ])
  _ai = { ...aiModule, ...openaiModule }
  _zod = zodModule
  return { ai: _ai, zod: _zod }
}

/**
 * createProvider(apiKey, baseURL) → { model: (name) => model, ... }
 * 异步创建 OpenAI 兼容 provider（DeepSeek / OpenAI / Gemini / 自定义）
 * 在 CommonJS 中通过动态 import 加载 ESM-only 的 @ai-sdk/openai
 */
async function createProvider(apiKey, baseURL) {
  const { ai } = await loadSDK()
  const openai = ai.createOpenAI({ apiKey, baseURL })
  return {
    model: (name) => openai(name),
    // temperature 等参数在 generateText 调用时传入
  }
}

/**
 * chatCompletion({ model, messages, temperature, stream, jsonMode }) → { text }
 * 底层 LLM 调用，封装 generateText / streamText
 * jsonMode: true 时通过 providerOptions 设置 response_format: json_object
 */
async function chatCompletion({ model, messages, temperature, stream, jsonMode }) {
  const { ai } = await loadSDK()

  // AI SDK 内部映射: type: 'json' → response_format: { type: 'json_object' }
  // 传 'json_object' 反而会被丢弃（SDK 只检查 type === 'json'）
  const providerOpts = jsonMode
    ? { openai: { responseFormat: { type: 'json' } } }
    : {}

  if (stream) {
    const result = ai.streamText({
      model,
      messages,
      temperature: temperature ?? 0.7,
      providerOptions: providerOpts,
    })
    let text = ''
    for await (const chunk of result.textStream) {
      text += chunk
    }
    if (jsonMode) console.log('[AI SDK] stream response preview:', text.slice(0, 200))
    return { text }
  }

  const result = await ai.generateText({
    model,
    messages,
    temperature: temperature ?? 0.7,
    providerOptions: providerOpts,
  })
  if (jsonMode) console.log('[AI SDK] response preview:', result.text.slice(0, 200))
  return { text: result.text }
}

module.exports = { loadSDK, createProvider, chatCompletion }
