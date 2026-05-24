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

## 🔜 阶段 3.7：后续迭代

- [ ] `@ai-sdk/anthropic` 接入（Claude API 原生调用）
- [ ] `api_format` 字段：openai / anthropic 格式切换
- [ ] Web Search 动态降级：Provider 原生 → 外部引擎
- [ ] 打字机效果（streaming 推送到前端逐字显示）

## 🔮 阶段四：视觉升级

- [ ] Live2D 立绘
- [ ] RAG 记忆语义搜索
- [ ] Claude Agent SDK 复杂任务委托
