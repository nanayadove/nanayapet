const fs = require('fs')
const path = require('path')

const CONFIG_PATH = path.join(__dirname, '..', 'config.json')

function load() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    return JSON.parse(raw)
  } catch (err) {
    console.error('配置文件读取失败:', err.message)
    return {
      api_settings: {
        provider: 'deepseek',
        providers: {},
        tool_provider: '',
        tool_model: '',
        temperature: 0.7,
        summary_provider: '同对话服务商',
        summary_interval: 5,
        max_history_length: 10,
      },
      character_settings: {
        name: '七夜',
        system_prompt: ''
      },
      ui_settings: {
        window_width: 320,
        window_height: 650,
        image_width: 300,
        image_height: 440
      }
    }
  }
}

function save(config) {
  // 合并：保留原有配置中没被覆盖的字段
  const current = load()
  const merged = { ...current, ...config }
  // 确保 providers 不丢失已有数据
  if (config.api_settings?.providers) {
    merged.api_settings = merged.api_settings || {}
    merged.api_settings.providers = {
      ...(current.api_settings?.providers || {}),
      ...config.api_settings.providers
    }
    merged.api_settings.provider = config.api_settings.provider
  }
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(merged, null, 2), 'utf-8')
  return merged
}

module.exports = { load, save }
