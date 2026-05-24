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

- [x] 两步推理：工具提取模型 + 聊天模型分离
- [x] `write_file` — 笔记/待办/日记
- [x] `read_file` — 类型/标签/全文搜索
- [x] `schedule` — 定时提醒（自然语言/ISO时间）
- [x] LLM 自主判断任务完成（`completed_tasks` 字段）
- [x] 后台定时器检查到期提醒 + LLM 生成角色语气通知

## ✅ 阶段三：增强交互 [已完成]

### 3.1 主动搭话系统 [已完成]
- [x] 启动问候（离线间隔检测）
- [x] 运行时概率递增搭话
- [x] 用户发言时概率重置

### 3.2 web_search 工具 [已完成]
- [x] 三种搜索引擎：Tavily / DuckDuckGo / Serper
- [x] 设置界面独立配置（启用/引擎选择/API Key）
- [x] 搜索结果注入对话上下文，LLM 角色语气转述
- [x] API Key 加密存储

### 3.3 模型列表下拉 [已完成]
- [x] 点击"获取列表"弹出模型选择下拉框
- [x] 对话模型和工具提取模型各自独立获取
- [x] 工具提取模型复用对应服务商的 Base URL + API Key

## 🔜 阶段 3.4：AI SDK 集成

用 Vercel AI SDK v6 替换原始 `openai` SDK，统一 LLM 调用层。

- [ ] 安装 `ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic`
- [ ] Provider 路由：根据 `api_format` 决定使用哪种 SDK backend
- [ ] 动态 Web Search：Anthropic 原生 vs 外部搜索引擎自动切换
- [ ] 设置界面新增 `api_format` 选择 + `use_native` 开关

详见 `AGENTS.md`

## 🔮 阶段四：视觉升级
- [ ] Live2D 立绘 (SDK 调研)
- [ ] RAG 记忆语义搜索
- [ ] Claude Agent SDK 接入（复杂任务委托）

---

## 🐛 已修复问题

- [x] CSS rgba() 透明度值修正（0-255 量纲 → 0-1 范围）
- [x] tools.js 回退表达式修正
- [x] 设置窗口宽度统一
- [x] Electron GPU 缓存权限错误
- [x] max_history_length UI 上限提升到 500
- [x] 启动批处理文件名乱码修复
- [x] API Key 加密存储（safeStorage + `__enc__:` 前缀）
- [x] 全项目代码添加中文注释
- [x] 配置保存时 web_search_settings.providers 合并缺失
