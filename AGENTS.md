# AGENTS.md — NetPet 架构决策与技术路线

## 项目定位

NetPet 是一个**独特的混合体**：它既不是标准聊天 UI（不需要 React hooks），也不是编码 Agent（不需要 Bash/Edit 工具）。它是一个**角色聊天伴侣 + 轻量 Agent 工具**的 Electron 桌面应用。

核心链路：
```
用户输入 → 工具提取模型（便宜模型）→ 执行工具（如需要）
         → 主聊天模型（角色设定）→ JSON { reply, emotion, completed_tasks }
```

---

## 技术框架决策

### AI SDK（Vercel AI SDK v6）→ 采纳

**用于：替换 `llm.js` 中的原始 `openai` SDK，作为统一 LLM 调用层。**

| 解决的问题 | 说明 |
|-----------|------|
| 多 Provider 抽象 | 一套代码同时支持 OpenAI 格式 (DeepSeek/OpenAI/Gemini) 和 Anthropic 格式 (DeepSeek Anthropic/Claude) |
| 结构化输出 | `Output` + Zod schema 比当前手写正则 JSON 解析更可靠 |
| Provider 原生 Web Search | Anthropic Claude 内建 `webSearch_20250305`，无需外部 API |
| Cache Control | 降低角色设定 System Prompt 的重复成本 |
| Streaming | 未来可实现角色逐字打字效果 |

**集成策略**：渐进式替换。`@ai-sdk/openai` 接管现有 OpenAI 兼容调用，`@ai-sdk/anthropic` 新增 Anthropic API 支持。两步推理管线、工具系统、记忆系统保持不动。

### Claude Agent SDK → 暂不集成，预留扩展点

**用于：未来复杂多步自主任务（非核心聊天循环）。**

| 不适合的原因 | 说明 |
|-------------|------|
| 范式错配 | Agent SDK 是为自主编码 Agent 设计的，核心能力是 Bash/Edit/Read/Grep，对虚拟桌宠无意义 |
| 体积沉重 | TypeScript SDK 打包完整的 Claude Code 二进制 |
| 交互模型冲突 | Agent SDK 是多步自主执行，NetPet 是单轮对话回复 |
| 成本模型 | 2026.6 起订阅方案需额外 Agent SDK 配额 |

**未来用法**：当用户对宠物说"帮我重构这个项目的 XX 模块"时，NetPet 可 spawn 一个 Claude Agent SDK session 处理，完成后将结果注入对话上下文。这是可选的高级功能，非核心路径。

---

## Provider 兼容矩阵

| Provider | API 格式 | SDK | Web Search |
|----------|---------|-----|------------|
| DeepSeek | OpenAI `/v1` | `@ai-sdk/openai` | ❌ 外部 (Tavily/DDG/Serper) |
| DeepSeek | Anthropic `/anthropic` | `@ai-sdk/anthropic` | ❌ 外部 (DS 不支持此 tool) |
| OpenAI | OpenAI `/v1` | `@ai-sdk/openai` | ❌ 外部 |
| Gemini | OpenAI `/v1beta/openai` | `@ai-sdk/openai` | ❌ 外部 |
| Claude | Anthropic `/v1` | `@ai-sdk/anthropic` | ✅ 原生 `webSearch_20250305` |
| 自定义 OpenAI | OpenAI 兼容 | `@ai-sdk/openai` | ❌ 外部 |

## Web Search 策略

```
搜索触发
  ├─ Provider 原生支持? (Claude Anthropic API)
  │   └─ ✅ → 使用 AI SDK 内建 webSearch_20250305
  └─ ❌ → 使用 web_search_settings 配置的外部搜索引擎
          ├─ tavily (推荐, 1000次/月免费)
          ├─ duckduckgo (免费, 覆盖窄)
          └─ serper (付费, Google 搜索)
```

配置键 `web_search_settings.use_native`：
- `true` / 不填：优先使用 provider 原生搜索，降级到外部
- `false`：强制使用外部搜索引擎

---

## 实现路线图

### ✅ 已完成
- [x] Electron 框架 + 透明窗口 + 立绘系统
- [x] SQLite 记忆 + 自动总结
- [x] Agent 工具系统 (write_file / read_file / schedule)
- [x] 主动搭话 (离线检测 + 概率递增)
- [x] web_search 外部搜索工具 (Tavily/DDG/Serper)
- [x] 模型列表下拉选择

### 🔜 阶段 3.3：AI SDK 集成
- [ ] 安装 `ai` + `@ai-sdk/openai` + `@ai-sdk/anthropic`
- [ ] 重构 `llm.js`：
  - 将 `makeClient()` 改为基于 AI SDK 的 provider 工厂
  - OpenAI 格式 provider → `createOpenAI({ apiKey, baseURL })`
  - Anthropic 格式 provider → `createAnthropic({ apiKey, baseURL })`
  - 保留两步推理管线、工具提取、JSON 解析
- [ ] Provider 路由：根据 `api_settings.provider` 决定用哪种 API 格式
  - 新增 `api_format` 字段：`"openai"` | `"anthropic"`
  - DeepSeek 默认 `"openai"`，可切换为 `"anthropic"`
- [ ] 动态 Web Search：
  - Anthropic provider → `anthropic.tools.webSearch_20250305()`
  - 其他 provider → 自定义 `web_search` 工具
  - 修改 `llm.js` checkToolCall 中针对 web_search 的判断逻辑
- [ ] 设置界面更新：新增 `api_format` 选择（OpenAI / Anthropic）
- [ ] 设置界面更新：搜索页新增 `use_native` 开关

### 🔮 阶段 4：可选高级功能
- [ ] Live2D 立绘 (SDK 调研)
- [ ] RAG 记忆语义搜索
- [ ] Claude Agent SDK 接入（复杂任务委托）

---

## 代码规范

### 文件编码
- 所有 `.js` 文件使用 UTF-8
- 行尾 LF (`\n`)

### 模块格式
- 当前：CommonJS (`require` / `module.exports`)
- AI SDK 包是 ESM-only，通过动态 `import()` 在 CJS 中加载
- 不修改 `package.json` 的 `"type"` 字段，保持向后兼容

### 注释风格
- 每个源文件头部用 `===== 文件名 — 职责 =====` 声明
- 关键 JavaScript/Node.js 概念附带内联中文注释
- API 调用、库函数、设计模式必须注释原理

### 配置安全
- API Key 禁止明文存储，必须通过 `safeStorage` 加密
- 加密格式：`__enc__:` + Base64(encrypted bytes)
- `config.example.json` 不含真实密钥，可安全提交

### 错误处理
- 所有 IPC handler 必须 try/catch
- 错误写入 `netpet-error.log`（通过 `main.js` 的 `logError()`）
- LLM 调用失败时降级到硬编码回复，不崩溃

---

## 关键架构约束

1. **两步推理不变**：不管用什么 SDK，工具提取 + 主模型推理的两步管线保持
2. **JSON 输出不变**：主模型必须输出 `{ reply, emotion, completed_tasks? }` 格式
3. **响应格式兼容性**：Anthropic API 不原生支持 `response_format: json_object`，需在 System Prompt 中强调 JSON 输出，并保留三级容错解析（直接 parse → 提取 JSON 块 → 转义修复）
4. **数据库不迁移**：SQLite schema 保持稳定，不因 SDK 切换而修改
5. **IPC 通道稳定**：`preload.js` 暴露的 API 接口不改变，前端无感知
