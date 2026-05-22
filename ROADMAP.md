# NetPet 演进路线图

## ✅ 阶段一：框架迁移 [已完成]
从 PyQt5 迁移到 Electron + JavaScript，重构核心架构。

- [x] Electron 桌面窗口（无边框透明、置顶、拖拽）
- [x] 聊天气泡 + 输入框 + 情绪驱动立绘切换
- [x] SQLite 记忆系统（sql.js，对话存库 + 自动上下文加载）
- [x] 独立设置窗口（Provider/Key/模型/温度/总结间隔/工具模型）
- [x] 后台自动总结记忆（每 N 轮触发一次）
- [x] Config 驱动 UI 尺寸

## ✅ 阶段二：Agent 工具系统 [已完成]

从纯粹聊天机器人升级为可调用工具的 Agent。

### 架构
```
用户输入
  ├→ 工具提取模型（便宜模型）→ 判断是否需要调用工具
  │                               ↓
  │                           执行工具（write_file / schedule 等）
  │                               ↓
  └→ 聊天模型（主模型） → 结合工具结果生成回复
                          ├─ reply: 回复文本
                          ├─ emotion: 情绪标签
                          └─ completed_tasks: [已完成的任务ID]
```

### 工具列表
- [x] `write_file` — 记录笔记/待办/日记到数据库（可选写文件系统）
- [x] `read_file` — 按类型/标签/全文搜索回顾已记录内容
- [x] `schedule` — 设置定时提醒（自然语言时间或ISO时间），到期自动触发

### 任务完成机制
- [x] ~~`complete_task` 硬编码工具~~ → 已移除
- [x] 未完成待办/提醒动态注入主模型上下文
- [x] LLM 根据对话自主判断任务是否完成
- [x] 通过 `completed_tasks` 字段返回已完成的任务 ID
- [x] 后端自动标记数据库

### 定时提醒
- [x] 后台定时器每15秒检查到期提醒
- [x] 到期调主聊天模型生成角色语气的提醒消息
- [x] 中性提示词（不写死"主人"等称呼），自适应角色设定
- [x] LLM 调用失败时自动降级为硬文本提醒

### 技术要点
- [x] 两步推理：工具提取模型 + 聊天模型分离，工具结果注入对话上下文
- [x] 工具执行结果自动保存到数据库并注入下一轮 LLM 上下文
- [x] System Prompt 中声明工具列表，LLM 自主决定何时调用（无硬编码触发词）
- [x] 工具通用化设计 — 所有工具通过 JSON 参数驱动
- [x] 设置界面支持工具提取模型配置（服务商 + 模型选择）
- [x] LLM 响应格式统一处理（reply + emotion + completed_tasks）

### 新增文件
- `src/tools.js` — 工具执行引擎（write_file / read_file / schedule）
- `src/tool-prompt.js` — 工具提取模型提示词模板

### 修改文件
- `src/db.js` — 新增 `tools` 表 + CRUD
- `src/llm.js` — 两步推理架构 + sendSystemMessage + completed_tasks 处理
- `main.js` — 定时提醒改调 LLM + 降级策略
- `preload.js` — 新 IPC 桥接通道
- `src/renderer.js` — 主动提醒支持 LLM 回复格式
- `src/settings.html` / `src/settings.js` — 工具模型配置 UI
- `src/config.js` — 默认配置含工具模型字段
- `src/index.html` — 初始文本动态化

## 🔜 阶段三：增强交互 [待定]

- [ ] 定时触发主动搭话（低活跃度定时器，宠物主动找主人聊天）
- [ ] 历史对话语义搜索（RAG 检索旧记忆）
- [ ] 立绘动画/GIF 支持
- [ ] 更多工具（web_search、天气查询等）
