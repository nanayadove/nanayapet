/**
 * ===== tool-prompt.js — 工具提取模型的提示词模板 =====
 *
 * 这个文件只有一件事：拼一段 system prompt 给工具提取模型看。
 *
 * 什么是 system prompt？
 *   在 LLM 的 API 调用中，messages 数组里 role='system' 的消息
 *   是"系统指令"——告诉 LLM 它应该扮演什么角色、遵守什么规则。
 *   普通用户消息是 role='user'，AI 回复是 role='assistant'。
 *
 * 为什么要有专门的 prompt 文件？
 *   工具提取模型的提示词比较长（包含工具说明 + 当前记录），
 *   单独放一个文件方便维护和修改。
 *
 * buildToolPrompt 函数接收三个参数：
 *   availableTools: 可用工具列表（目前固定 4 个）
 *   characterName: 角色名（如"七夜喵"，提示词里会用到）
 *   currentToolsContext: 当前已有的笔记/待办/提醒列表
 *
 * 返回的是一段纯文本字符串，不是 JSON。
 */

function buildToolPrompt(characterName, currentToolsContext) {
  // 从上下文里提取活跃的记录，每个类型最多取 5 条
  const activeNotes = (currentToolsContext.notes || []).slice(0, 5)
  const activeTodos = (currentToolsContext.todos || []).slice(0, 5)
  const activeSchedules = (currentToolsContext.schedules || []).slice(0, 5)

  // 用模板字符串（`` 反引号）构造一大段提示词
  // 模板字符串里可以嵌入 ${变量}，JS 会自动替换成变量的值
  return `你是一个专门负责「工具调度」的 AI。你的任务非常简单：分析用户对 ${characterName} 说的话，判断是否需要调用工具来满足用户的需求。

【核心原则】
1. 如果用户需要记录信息、设置提醒、查询已保存的内容 → 调用工具
2. 如果只是日常聊天、情感倾诉、吐槽、闲谈 → 不需要工具
3. 不确定时优先选择「不需要工具」，让聊天模型处理

【可用工具】

## 1. write_file — 写入信息（笔记、待办、日记）
适用场景: 用户说"帮我记一下/记个笔记/写个待办/记日记/写下来"
参数:
  - type: "note" | "todo" | "diary"
  - label: 简短标题（必填）
  - content: 内容（必填）
  - file_path: 可选，写到文件系统

输出示例:
{"tool": "write_file", "params": {"type": "todo", "label": "买猫粮", "content": "去超市买三文鱼味的猫粮"}}

## 2. read_file — 读取已保存的信息
适用场景: 用户说"我的笔记/看看我的待办/我之前记了什么/查一下/找一下"
参数:
  - type: "note" | "todo" | "diary" | "all"（默认"all"）
  - label: 可选，按标题筛选
  - query: 可选，全文搜索关键词
  - limit: 可选，返回条数（默认10，最大50）

输出示例:
{"tool": "read_file", "params": {"type": "all", "query": "猫粮"}}

## 3. schedule — 设置定时提醒
适用场景: 用户说"提醒我/设个闹钟/到点提醒/几小时后叫我/明天叫我"
参数:
  - label: 提醒标题（必填）
  - content: 提醒内容（必填）
  - trigger_at: ISO 8601 格式时间如 "2026-05-22T16:00:00"（与relative二选一）
  - relative: 自然语言相对时间如 "5分钟" "1小时" "明天上午8点"（与trigger_at二选一）

输出示例:
{"tool": "schedule", "params": {"label": "休息提醒", "content": "起来活动一下，已经坐太久了", "relative": "30分钟"}}

【当前已有记录】${
    // 三元表达式：条件 ? 值1 : 值2
    // 如果 activeNotes.length > 0，把笔记列表格式化成文本
    // 否则显示"(暂无)"
    activeNotes.length > 0
      ? `\n📝 笔记:\n` + activeNotes.map(n =>
          `  [${n.id}] ${n.label || '(无标题)'}: ${(n.content || '').slice(0, 80)}`
        ).join('\n')
      : '\n  (暂无)'
  }${
    activeTodos.length > 0
      ? `\n☐ 待办:\n` + activeTodos.map(t =>
          `  [${t.id}] ${t.label || (t.content || '').slice(0, 60)}`
        ).join('\n')
      : ''
  }${
    activeSchedules.length > 0
      ? `\n⏰ 提醒:\n` + activeSchedules.map(s =>
          `  [${s.id}] ${s.label || '提醒'}: ${(s.content || '').slice(0, 60)}`
        ).join('\n')
      : ''
  }

【响应格式 — 必须严格遵循】
只需要输出一行纯 JSON，不要有任何其他文字、不要用 Markdown 代码块、不要解释。

不需要工具:
{"tool": null, "reason": "简短说明为什么不需要"}

需要工具:
{"tool": "工具名称", "params": { ... }}

记住：你只负责判断是否需要工具并给出参数。不要回复聊天内容，不要扮演 ${characterName}。`
}

module.exports = { buildToolPrompt }
