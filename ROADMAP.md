# NetPet 演进路线图

## ✅ 阶段一：框架迁移 [已完成]
从 PyQt5 迁移到 Electron + JavaScript。

- [x] Electron 桌面窗口（无边框透明、置顶、拖拽、可拉伸等比缩放）
- [x] 聊天气泡 + 输入框 + 情绪驱动立绘切换
- [x] SQLite 记忆系统（sql.js）
- [x] 独立设置窗口（Provider/Key/模型/温度/总结/工具模型/搜索引擎/流式）
- [x] 后台自动总结记忆
- [x] Config 驱动 UI 尺寸
- [x] 窗口最小化按钮
- [x] 系统托盘图标（最小化隐藏到托盘，左键恢复/右键菜单）
- [x] Electron-builder zip 打包
- [x] 配置文件预设随包分发
- [x] 打包后路径修复（asar 内外读写分离）

## ✅ 阶段二：Agent 工具系统 [已完成]

- [x] 两步推理：工具提取模型 + 聊天模型
- [x] `write_file` — 笔记/待办/日记
- [x] `read_file` — 类型/标签/全文搜索
- [x] `schedule` — 定时提醒
- [x] LLM 自主判断任务完成（`completed_tasks`）
- [x] 后台定时器 + LLM 语气提醒

## ✅ 阶段三：增强交互 [已完成]

### 3.1 主动搭话系统
- [x] 启动问候（离线间隔检测）
- [x] 运行时概率递增搭话
- [x] 用户发言时概率重置

### 3.2 web_search 工具
- [x] 四种引擎：Tavily / DuckDuckGo / Serper / Anthropic(Claude原生)
- [x] 设置界面独立配置
- [x] API Key 加密存储

### 3.3 模型下拉列表
- [x] 点击获取列表弹出选择框
- [x] 对话模型 + 工具模型各自独立获取

### 3.4 AI SDK 集成
- [x] 安装 `ai` + `@ai-sdk/openai` + `zod`
- [x] `ai-provider.js` 动态 import 包装层
- [x] `llm.js` AI SDK 双引擎：优先 AI SDK，失败降级 raw SDK
- [x] Provider 路由：`openai.chat()` → `/chat/completions`（规避 `/responses` 不兼容）

### 3.5 流式传输
- [x] SSE 累积模式，降低首字延迟
- [x] 设置界面开关 toggle

### 3.6 窗口增强
- [x] 可拉伸 + 等比缩放（`setAspectRatio`）
- [x] 关闭自动记忆尺寸
- [x] 最小化按钮

## 🐛 已修复

- [x] 跨机器复制 config → `decryptKey` 崩溃 → prompt/全配置清空
- [x] system_prompt 缺 "json" 字样 → 400 报错
- [x] emotion 白名单校验
- [x] textarea 空时保存覆盖已有 prompt
- [x] 模型下拉列表
- [x] 气泡文字可选取复制

## 🔜 阶段四：知识库系统 [设计中]

目标：半结构化事实存储 + LIKE 模糊搜索 + 半自动知识补全

### 4.1 数据模型
- [ ] `facts` 表：事实提取与去重
  - 字段：id, category, content, tags(JSON数组), confidence, source_msg_id, created_at, updated_at
  - 标签由 LLM 自行生成，不固定枚举
  - 保存前检查已有事实，相似则更新置信度而非重复插入
- [ ] `knowledge` 表：外部知识存储
  - 字段：id, topic, content, source(web/manual), source_url, created_at

### 4.2 事实提取管道
- [ ] 每轮对话后触发（3-5 条消息为一批）
- [ ] LLM prompt：从对话中提取用户事实，输出 JSON `[{ category, content, tags[], confidence }]`
- [ ] 去重逻辑：新事实与已有事实做 LIKE 模糊比较，70% 相似则合并（置信度+0.1）
- [ ] 静默执行，不打断对话

### 4.3 画像生成
- [ ] 定时触发（每日一次，或积累 20 条新事实）
- [ ] LLM 阅读所有事实，生成用户画像摘要存入 `messages`（role: 'profile'）
- [ ] 画像注入每次对话的 system prompt 前缀

### 4.4 知识补全
- [ ] LLM 回复末尾检测知识盲区
- [ ] 自然表达："这个话题吾辈不太熟，要帮你去查一下吗？"
- [ ] 用户确认 → web_search → 结果存入 `knowledge` 表
- [ ] 下次同类话题自动引用已有知识

### 4.5 检索与回忆
- [ ] `tools:search_knowledge` — 宠物可主动调用搜索事实和知识
- [ ] SQLite LIKE 模糊匹配事实和知识表
- [ ] 用户对话中提及关键词 → 自动注入相关事实到 LLM 上下文
