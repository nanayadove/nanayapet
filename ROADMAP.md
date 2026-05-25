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

## ✅ 阶段四：知识库系统 [已完成]

目标：半结构化事实存储 + LIKE 模糊搜索 + 半自动知识补全

### 4.1 数据模型
- [x] `facts` 表：事实提取与去重
  - 字段：id, category, content, tags(JSON数组), confidence, source_msg_id, created_at, updated_at
  - 标签由 LLM 自行生成，不固定枚举
  - 保存前检查已有事实，相似则更新置信度而非重复插入
- [x] `knowledge` 表：外部知识存储
  - 字段：id, topic, content, source(web/manual), source_url, created_at

### 4.2 事实提取管道
- [x] 每轮对话后触发（3-5 条消息为一批）
- [x] LLM prompt：从对话中提取用户事实，输出 JSON `[{ category, content, tags[], confidence }]`
- [x] 去重逻辑：新事实与已有事实做 LIKE 模糊比较，70% 相似则合并（置信度+0.1）
- [x] 静默执行，不打断对话

### 4.3 画像生成
- [x] 定时触发（每日一次，或积累 20 条新事实）
- [x] LLM 阅读所有事实，生成用户画像摘要存入 `messages`（role: 'profile'）
- [x] 画像注入每次对话的 system prompt 前缀

### 4.4 知识补全
- [x] LLM 回复末尾检测知识盲区
- [x] 自然表达："这个话题吾辈不太熟，要帮你去查一下吗？"
- [x] 用户确认 → web_search → 结果存入 `knowledge` 表
- [x] 下次同类话题自动引用已有知识

### 4.5 检索与回忆
- [x] `tools:search_knowledge` — 宠物可主动调用搜索事实和知识
- [x] SQLite LIKE 模糊匹配事实和知识表
- [x] 用户对话中提及关键词 → 自动注入相关事实到 LLM 上下文

### 4.6 置信度增强 [已完成]
- [x] 时间衰减：`新置信度 = 旧置信度 × e^(-衰减率×天数) + 增量`，旧事实自然淡忘
- [x] 矛盾检测：检测到否定词（不再/讨厌/放弃等）且共享关键词时判定为矛盾，旧事实减置信度，新事实独立插入
- [x] 自动清理：置信度低于 0.05 的事实自动删除
- [x] 衰减率可视化配置（0 = 不衰减）

### 4.7 知识库模型独立配置 [已完成]
- [x] 设置界面新增"知识库处理服务商"和"模型"选项
- [x] 事实提取和画像生成共用独立模型，可选用便宜小模型节省成本

### 4.8 其他优化 [已完成]
- [x] 关闭时 SQLite 记录下线时间，启动时从数据库读间隔 → LLM 生成问候（替换原 activity.json）
- [x] API 请求失败不再提前写入用户消息到数据库
- [x] 最小化时搭话和提醒以系统通知弹窗形式推送
- [x] 单实例锁：防止重复启动，再次双击激活已有窗口
- [x] 窗口初始尺寸缩小至 200×400

## 🔜 阶段五：知识库扩展 [设计中]

### 5.1 用户自行导入知识库
- [ ] 支持从文件（JSON/CSV/TXT）批量导入事实和知识
- [ ] 设置界面新增导入入口，选择文件后预览再确认
- [ ] 导入时自动走去重管道，避免重复条目
- [ ] 支持 Markdown 格式笔记导入

### 5.2 辅助转换功能
- [ ] 对话历史导出：支持导出为 Markdown/JSON 格式
- [ ] 事实和知识导出：将知识库内容导出为可编辑的 JSON 文件
- [ ] 格式转换：导入时自动识别格式并转换（CSV→JSON facts，Markdown→按标题切片等）
- [ ] 批量编辑：设置界面提供知识库表格视图，支持手动增删改
