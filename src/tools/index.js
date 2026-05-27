/**
 * ===== tools/index.js — 工具路由 =====
 *
 * 根据 toolName 分发到对应的工具模块。
 * 新增工具只需：新建文件 + 在 tools 对象里注册一行。
 *
 * 每个工具模块导出 { name, execute(params, config) }
 * 返回值统一: { success: boolean, result: string, data?: any }
 */

const tools = {
  write_file:      require('./write-file'),
  read_file:       require('./read-file'),
  schedule:        require('./schedule'),
  web_search:      require('./web-search'),
  search_knowledge: require('./search-knowledge'),
  remember:        require('./remember'),
}

async function executeTool(toolName, params, config) {
  // 用 [] 方括号语法动态访问属性
  const tool = tools[toolName]
  if (!tool) {
    return {
      success: false,
      result: `未知工具: ${toolName}。可用工具: ${Object.keys(tools).join(', ')}`
    }
  }

  try {
    // tool.execute() 可能是 async 也可能是同步，统一用 await
    return await tool.execute(params, config)
  } catch (err) {
    console.error(`[Tools] ${toolName} 执行失败:`, err.message)
    return {
      success: false,
      result: `工具 ${toolName} 执行出错: ${err.message}`
    }
  }
}

module.exports = { executeTool }
