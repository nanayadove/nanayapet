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
- [x] `llm.js` 全链路 AI SDK 调用（聊天、工具、知识提取、画像、总结）
- [x] Provider 路由：`openai.chat()` → `/chat/completions`（规避 `/responses` 不兼容）
- [x] 2026-05-26 消除裸 `openai` SDK 依赖，所有 LLM 调用统一走 `callLLM`

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

## ✅ 阶段五：知识库重构 [已完成]

> 2026-05-26 — 2026-05-28: 合并 facts + knowledge 为统一 knowledge_base，新增 lore 世界观分类，合并 taught 入 user_profile，完成导出功能（PNG/JSON，角色卡 + 会话 + 知识库捆绑），完成知识库管理 UI（浏览/搜索/编辑/删除/分页）。

### 5.1 数据库合并 [已完成 2026-05-26]
- [x] 合并 `facts` 和 `knowledge` 表为统一的 `knowledge_base` 表
- [x] 新 schema：id / classification / category / content / tags / confidence / source_msg_id / source / source_url / created_at / updated_at
- [x] classification 体系（3 类）：
  - `user_profile` — 用户画像（原 facts + taught：偏好、习惯、计划、个人信息、用户教学等）
  - `lore` — 世界观设定（World Info，关键词精确匹配触发，手动录入）
  - `web` — 外部知识（原 knowledge：网页检索结果缓存）
- [x] 后向兼容：旧 `saveFact`/`searchFactsLike`/`saveKnowledge`/`searchKnowledgeLike` 等接口封装到新表
- [x] 迁移脚本：启动时自动读取旧 facts + knowledge，迁入 knowledge_base，删除旧表

### 5.2 写入渠道扩展 [已完成 2026-05-26]
- [x] 用户主动教学：新增 `remember` 工具（tools/remember.js），写入 `user_profile` 分类，置信度 0.95
- [x] 网页搜索缓存：web_search → saveKnowledge 逻辑保留，写入 `web` 分类
- [x] 2026-05-28: `taught` 分类合并入 `user_profile`，新增 `lore` 世界观分类

### 5.3 设置页重构 [已完成 2026-05-26]
- [x] 知识库 Tab 描述更新为"统一知识库"
- [x] `max_facts` + `max_knowledge` 合并为 `max_items`
- [x] 画像生成从独立模块归入知识库子设置（保留原有配置项）

### 5.4 工具适配 [已完成 2026-05-26]
- [x] `search_knowledge` 工具适配新表：统一搜索 knowledge_base，结果按 classification 分组展示
- [x] 新增 `remember` 工具：tool-prompt.js 声明 + tools/remember.js 实现
- [x] `tool-prompt.js` 更新工具描述

### 5.5 导出与辅助 [已完成 2026-05-28]
- [x] 对话历史导出：按 Session + 角色卡捆绑导出 (PNG/JSON)，支持选择附带知识库分类
- [x] 知识库导出：按 classification 分类导出 JSON
- [x] 知识库管理 UI：内嵌表格浏览/搜索/筛选/编辑/删除/分页
- [x] Lore 快速添加：设置界面一键录入世界观设定

---

## 🐛 待修复

### B1. JSON 解析崩溃 [已修复 2026-05-26]
- [x] 聊天模型不再输出 JSON，改为 `[emotion=xxx]` 前缀标签格式
- [x] `parseResponse` 替换为 `parseChatResponse`，纯正则提取，永不抛异常
- [x] `main.js` 不再二次 throw，异常兜底返回安全默认响应
- [x] 影响文件：`src/llm.js`（删三级容错 JSON 解析，加标签提取）、`main.js`（catch 内 return 代替 throw）、`config.example.json`（更新 system prompt 模板）

### B2. 置信度区分度不足 [已修复 2026-05-26]
- [x] 事实提取 prompt（`src/llm.js:349-362`）未给出置信度区分指南，LLM 默认给 0.9-1
- [x] 修复：在 prompt 中加入置信度评分标准——明确事实(0.9-1.0) / 较明确但有推断(0.7-0.8) / 模糊暗示(0.5-0.6) / 不确定(0.3-0.4)
- [x] 同时补充反例示例，让 LLM 理解什么情况该给低分

### B3. 裸 OpenAI SDK 冗余 [已修复 2026-05-26]
- [x] `extractFacts`、`generateProfile`、`doSummarize` 三处使用 `require('openai')` 绕过 AI SDK
- [x] 重写 `getKnowledgeConfig` → `getKnowledgeModel`，返回 AI SDK model
- [x] `doSummarize` 从 `db.js` 迁到 `llm.js` 为 `summarizeMemory`，统一走 `callLLM`
- [x] 全项目 `require('openai')` / `new OpenAI()` 清零

### B4. LLM 调用日志不足 [已修复 2026-05-26]
- [x] `callLLM` 增加 `label` 参数，区分聊天模型/工具模型/知识模型/总结模型
- [x] 每次调用来带日志：请求开始 → 完成（耗时 + token 用量 + 字符数）
- [x] 报错日志带 model / provider / temperature / stream 上下文

### B5. 聊天模型标签泄漏 [已修复 2026-05-27]
- [x] `[need_search]` 和 `[completed]` 标签混入聊天模型自然语言输出，散落在正文各处
- [x] 责任分离：聊天模型只输出 `[emotion=xxx]`，工具决策（completed_tasks）交还工具模型
- [x] `formatLock` 收紧为只提及 `[emotion=xxx]`，移除 need_search/completed 指令
- [x] `parseChatResponse` 简化为只提取 `[emotion=xxx]`
- [x] `tool-prompt.js` 响应格式增加 `completed_tasks` 字段
- [x] `checkToolCall` 解析并执行 `completed_tasks`
- [x] 清理 `main.js` / `llm.js` 中废弃的 `pendingSearch` 流程
---

## 🔜 阶段七：后端 Docker 化 + 前后端分离 [规划中]

> 2026-05-26 讨论记录：参照 Hermes Agent 的 Docker 方案，将 NetPet 的 LLM 调用、记忆系统、工具执行、文件操作等后端逻辑封装为独立 Docker 服务，Electron 窗口退化为纯展示前端。实现前后端分离，便于部署升级和数据持久化。

> 参考架构：[Hermes Agent Docker](https://hermes-agent.nousresearch.com/docs/user-guide/docker) — 核心模式：单数据卷挂载（`/opt/data`）、无状态镜像升级、Gateway API 端口暴露、Docker Compose 多服务编排。

### 7.1 架构拆分

```
当前:
  Electron 主进程
    ├── main.js (窗口管理 + IPC)
    ├── llm.js (LLM 调用)
    ├── db.js  (SQLite 记忆)
    └── tools/ (工具执行)

目标:
  ┌─────────────────────────────┐
  │  Electron 前端 (渲染进程)    │  ← 纯 UI：立绘/气泡/输入框
  │  HTTP/WS ────────────────→  │
  └─────────────────────────────┘
  ┌─────────────────────────────┐
  │  NetPet 后端 (Docker)        │
  │  ├── API Server (Express)   │  ← REST + WebSocket
  │  ├── LLM 模块               │
  │  ├── 记忆系统 (SQLite)       │
  │  ├── 工具执行               │
  │  └── 知识库管道             │
  │  /opt/data ← 挂载宿主机目录  │
  └─────────────────────────────┘
```

### 7.2 Docker 化要点

- [ ] Dockerfile：基于 `node:22-alpine`，安装系统工具（ripgrep 等），复制后端代码
- [ ] 单数据卷：`-v ~/.netpet:/opt/data` 映射 `config.json` + `memory.db` + `netpet-error.log` + `skills/`
- [ ] 无状态镜像：升级只需 `docker pull` + 重建容器，数据在卷中不受影响
- [ ] 环境变量注入：API Key 等敏感信息通过 `-e` 或 `.env` 传入，不在 `config.json` 存明文
- [ ] 资源限制：`--memory=1g --cpus=1`（无 browser 工具，轻量）
- [ ] Docker Compose 编排：
  ```yaml
  services:
    netpet-backend:
      image: netpet/backend:latest
      restart: unless-stopped
      ports:
        - "9248:9248"
      volumes:
        - ~/.netpet:/opt/data
      environment:
        - NETPET_API_KEY=${NETPET_API_KEY}
  ```

### 7.3 API 设计

- [ ] REST API：
  - `POST /api/chat` — 发送消息，返回 `{ reply, emotion }`
  - `GET /api/models` — 获取可用模型列表
  - `POST /api/tools/:name` — 手动调用工具
  - `GET /api/knowledge?q=xxx` — 搜索知识库
- [ ] WebSocket：`ws://localhost:9248/ws` — 流式传输 + 主动推送（搭话、提醒）
- [ ] Health check：`GET /health` — Docker healthcheck 用

### 7.4 前端适配

- [ ] Electron 主进程剥离 LLM/DB/Tools 逻辑，只保留窗口管理和托盘
- [ ] 前端通过 `fetch` / `WebSocket` 与后端通信，替换 IPC invoke
- [ ] 设置窗口通过 API 读写配置（取代 `config:get` / `config:save` IPC）
- [ ] 打包时后端镜像随 Electron 一起分发，或作为独立服务部署

### 7.5 部署模式

- [ ] **本地模式**（默认）：`docker compose up` 启动后端 → 双击 NetPet.exe 连 `localhost:9248`
- [ ] **远程模式**：后端部署在 NAS/云服务器，前端配置远程地址
- [ ] **一键启动脚本**：`启动桌宠.bat` 内嵌 `docker compose up -d` + 启动 Electron

### 7.6 升级与维护

- [ ] `docker compose pull && docker compose up -d` 升级后端，数据不受影响
- [ ] `memory.db` 备份：直接 copy 宿主机 `~/.netpet/memory.db`
- [ ] 日志：`docker compose logs -f` 实时查看，或挂载的 `netpet-error.log`

---

## ✅ 阶段六：数据层重构 + 角色记忆系统 [已完成]

> **2026-05-28 修订**：全部子阶段 (6.1-6.6) 已完成。Session 管理、角色长久记忆、知识库 UI、World Info/Lore、导出功能均已交付。

### 6.6 数据流终态 [已完成核心流程 2026-05-28]

```
启动
  → 加载活跃角色设定 (character.json → system_prompt)
  → 加载角色记忆 (character_memories → conversation_summary + user_relation + self_awareness + world_knowledge)
  → 恢复活跃 Session (sessions.is_active=1 → messages 历史，含 summary 注入)
  → 注入用户画像 (knowledge_base → 画像摘要)
  → 组装 context → LLM 对话

对话中
  → messages 记录每条消息 (归属 session_id)
  → 后台：事实提取 → knowledge_base
  → 后台：画像生成 → knowledge_base / events

新开对话
  → 当前 Session 归档 (is_active=0)
  → 角色记忆追加 conversation_summary → character_memories
  → 新建 Session (is_active=1) → 清空对话上下文
  → 角色记忆 + 知识库保留

切换角色
  → 弹窗确认 → 自动新开 Session
  → 旧 Session 摘要归档到旧角色 character_memories
  → 新 Session 加载新角色记忆

导出
  → 按 Session 导出对话历史 (Markdown/JSON)  [→ 5.5]
  → 按 classification 导出知识库 (JSON)      [→ 5.5]
```

### 6.1 角色设定独立 [已完成]

- [x] 角色设定从 `config.json` 中剥离为独立 JSON 文件（`characters/<角色名>/character.json`）
- [x] 角色文件结构：`name` / `displayName` / `system_prompt` / `greeting`
- [x] 立绘文件夹规范：`characters/<角色名>/idle.png`、`happy.png` 等，扁平结构
- [x] 自定义 `netpet://` 协议，渲染进程通过协议加载角色立绘（打包/开发均可用）
- [x] 设置界面"角色管理"Tab：角色下拉切换 + 编辑 + 导入/导出
- [x] 启动时根据 `active_character` 加载角色文件，回退到内建 `character_settings`
- [x] PNG 角色卡：导出时嵌入 `tEXt` chunk（ccv3 键，SillyTavern 兼容）
- [x] 导出支持 JSON / PNG 卡两种格式

### 6.2 Messages 表拆分 [已完成 2026-05-27]

> 核心思路：参照 SillyTavern 的 Chat → Messages 模型，将 `messages` 一锅炖拆为 4 张职责明确的表。

**现状诊断** — `messages` 表承载了 6 种不同性质的数据：

| 数据类型 | role | 检索方式 | 问题 |
|---------|------|---------|------|
| 用户发言 | `user` | — | |
| LLM 回复 | `assistant` | — | |
| 对话摘要 | `system` | `LIKE '[SUMMARY]%'` | 数据与元数据不分 |
| 用户画像 | `system` | `LIKE '[PROFILE]%'` | 画像应归知识库 |
| 工具执行 | `system` | — | 辅助日志混入对话 |
| 下线记录 | `offline` | — | 辅助日志混入对话 |

**目标结构**：

```
现在: messages (6种数据混在一起)
       ↓
优化后:
  sessions           ← 对话容器 (ST 的 Chat)
  messages           ← 纯对话消息，归属 session_id
  knowledge_base     ← 已有，不动 (user_profile/lore/web)
  events             ← 工具执行 / 下线 / 画像生成 等辅助记录
```

#### 6.2.1 新表 Schema

**sessions** — 对话容器
```
id            INTEGER PRIMARY KEY AUTOINCREMENT
character_id  TEXT NOT NULL
title         TEXT          -- LLM 自动生成标题
summary       TEXT          -- 归档时生成摘要（取代 [SUMMARY] 魔数）
is_active     INTEGER DEFAULT 1
created_at    DATETIME
last_active_at DATETIME
```

**messages** — 纯对话消息
```
id            INTEGER PRIMARY KEY AUTOINCREMENT
session_id    INTEGER NOT NULL REFERENCES sessions(id)
role          TEXT NOT NULL      -- user / assistant / system
content       TEXT NOT NULL
created_at    DATETIME
```

**events** — 系统事件日志
```
id            INTEGER PRIMARY KEY AUTOINCREMENT
session_id    INTEGER            -- 可选，关联 session
type          TEXT NOT NULL      -- tool_call / schedule_fire / offline / profile_update / summary / fact_extraction
content       TEXT NOT NULL
metadata      TEXT               -- JSON，存额外信息
created_at    DATETIME
```

#### 6.2.2 具体任务

- [x] `db.js` 新增 `sessions` / `events` 两张表的 CREATE 和 CRUD 接口
- [x] 迁移脚本 `migrateV2()`：
  - 旧 messages → 按角色创建默认 session，逐条迁入新 messages
  - `[SUMMARY]` 记录 → 写入对应 session.summary 字段
  - `[PROFILE]` 记录 → 提取内容存到 `events`（type=profile_update），保持 knowledge_base 最新画像不变
  - `offline` 记录 → 迁入 `events`（type=offline）
  - 工具调用 system 消息 → 迁入 `events`（type=tool_call）
- [x] 升级 `loadContextForLlm(sessionId, maxLen)` — 改为从 sessions + messages 组装，消除 `LIKE '[SUMMARY]%'` 魔数查询
- [x] 升级 `saveMessage(role, content)` → `saveMessage(sessionId, role, content)`
- [x] `llm.js` 中所有读写 messages 的调用适配新签名
- [x] `main.js` IPC handler 适配：`chat:send` 传入 session_id，初始化时获取 active session
- [x] 迁移后手动验证：对话功能、总结、画像、工具调用无回归

### 6.3 Session 管理（对话新开/归档/恢复）[已完成 2026-05-27]

> 依赖：6.2 完成

- [x] 用户可手动"新开对话"：当前 Session 归档生成 summary → 新建 Session → 清空上下文，保留角色记忆和知识库
- [x] 设置界面新增"对话管理"Tab：
  - Session 列表：按时间倒序，显示 title / character / 消息数 / 时间
  - 切换 / 恢复 / 删除 Session
- [x] IPC 通道：session:list / session:create / session:switch / session:delete / session:get-active
- [x] 切换角色时自动新开 Session（弹窗确认）[2026-05-28]
- [x] 恢复历史 Session 时加载 summary 作为起始上下文 [2026-05-28]
- [x] 活跃 Session 的消息在内存中缓存，切换时释放 [2026-05-28]

### 6.4 角色长久记忆库 [已完成 2026-05-28]

> 依赖：6.2 完成

- [x] 新增 `character_memories` 表
- [x] Schema：id / character_id / category / content / confidence / created_at / updated_at
- [x] `user_relation`：角色对用户的认知（称呼、关系、互动风格、已知偏好）
- [x] `world_knowledge`：角色从对话/搜索中学到的外部知识
- [x] `self_awareness`：角色对自身的理解（名字、设定、用户如何看待自己）
- [x] `conversation_summary`：Session 归档时生成摘要存入，下次启动时加载为上下文
- [x] 记忆去重：相似记忆自动合并置信度而非重复插入
- [x] 记忆注入 LLM 上下文：对话时自动加载角色记忆作为 system prompt 前缀

### 6.5 角色与记忆绑定 [已完成 2026-05-28]

- [x] 角色记忆通过 `character_id` 列绑定到角色
- [x] 同一角色不同 Session 共享记忆库，不同角色记忆完全隔离
- [x] 知识库（`knowledge_base`）为全局共享，不随角色切换清空
- [x] Session 归档时摘要自动写入 `character_memories`（conversation_summary）

### 6.6 数据流终态 [核心流程已完成 2026-05-28]

> 角色记忆加载 + Session 管理 + 知识库注入已全部到位。待 5.5 导出功能后正式关闭阶段六。

```
启动
  → 加载活跃角色设定 (character.json → system_prompt)
  → 加载角色记忆 (character_memories → conversation_summary + user_relation + self_awareness + world_knowledge)
  → 恢复活跃 Session (sessions.is_active=1 → messages 历史，含 summary 注入)
  → 注入用户画像 (knowledge_base → 画像摘要)
  → 组装 context → LLM 对话

对话中
  → messages 记录每条消息 (归属 session_id)
  → 后台：事实提取 → knowledge_base
  → 后台：画像生成 → knowledge_base / events

新开对话
  → 当前 Session 归档 (is_active=0)
  → 角色记忆追加 conversation_summary → character_memories
  → 新建 Session (is_active=1) → 清空对话上下文
  → 角色记忆 + 知识库保留

切换角色
  → 弹窗确认 → 自动新开 Session
  → 旧 Session 摘要归档到旧角色 character_memories
  → 新 Session 加载新角色记忆

导出 [→ 5.5]
  → 按 Session 导出对话历史 (Markdown/JSON)
  → 按 classification 导出知识库 (JSON)
```

---

## 🔜 阶段八：UI 重构 — 分体式面板 [规划中]

> 当前 UI 为单气泡 + 立绘 + 输入框的极简结构，无法展示聊天历史、工具执行过程、终端输出等内容。
> 目标：**宠物立绘保持独立浮窗** + **右侧可收起的抽屉面板**，兼顾观赏性和功能性。

### 8.1 主窗口架构

```
┌─────────────────┬──────────────────────────┐
│                 │                          │
│   宠物立绘区    │   [聊天区]                │
│   (透明浮窗)    │   对话历史 (滚动)         │
│                 │   系统消息 (工具调用等)    │
│   300×440       │   命令行输出              │
│                 │                          │
│                 │  ──────────────────────  │
│   立绘切换      │   [输入区]                │
│   动画保留      │   <input> + 发送按钮      │
│                 │   模式切换标签            │
│                 │                          │
└─────────────────┴──────────────────────────┘
         ↑                    ↑
   独立透明窗口         右侧可收起抽屉
   (始终可见)           (hover/点击展开)
```

### 8.2 右侧面板设计

| 区域 | 内容 | 说明 |
|------|------|------|
| **对话历史** | 滚动消息列表（user/assistant/system） | user 消息右对齐蓝色气泡，assistant 左对齐白色气泡，system 灰色小字 |
| **工具执行状态** | 内联展示工具调用过程 | `🔧 正在搜索...` → `✅ 搜索完成 (3条结果)` |
| **终端输出** | 命令行执行结果展示 | 折叠/展开，语法高亮，长输出截断 + "查看完整输出"按钮 |
| **模式标签栏** | 闲聊 / 工作 模式切换 | 闲聊模式隐藏终端面板，工作模式展开全功能 |
| **输入区** | 输入框 + 发送 + 模式切换 | 固定底部，类似聊天应用 |

### 8.3 UI 组件树

```
index.html (重构)
├── #left-panel (宠物浮窗 — 保留现有逻辑)
│   ├── #top-bar (设置/最小化/关闭)
│   ├── #image-area (立绘区，保留拖拽置顶)
│   └── #emotion-indicator (可选: 当前情绪小标签)
│
└── #right-drawer (右侧抽屉面板 — 新增)
    ├── #drawer-handle (拖拽手柄/收起按钮)
    ├── #drawer-tabs (模式标签: 💬闲聊 / 💻工作)
    ├── #message-list (对话历史 — 新增)
    │   ├── .msg-user (用户消息气泡)
    │   ├── .msg-assistant (助手消息气泡)
    │   └── .msg-system (系统/工具消息)
    ├── #terminal-panel (终端输出区 — 新增，工作模式可见)
    │   ├── #terminal-output (命令执行结果)
    │   └── #terminal-toolbar (复制/展开/收起)
    └── #input-area (输入区 — 重构)
        ├── #input-field (输入框)
        └── #send-btn (发送按钮)
```

### 8.4 交互设计

- **抽屉收起/展开**：右侧面板默认半透明贴合屏幕右侧，鼠标 hover 时滑出，离开后延迟缩回；点击抽屉手柄锁定展开
- **模式切换**：标签切换闲聊模式（只显示聊天历史）和工作模式（聊天历史 + 终端面板）
- **宠物始终可见**：左侧立绘区不受右侧面板影响，始终保持透明浮窗特性
- **窗口拖拽**：左侧立绘区保留 `-webkit-app-region: drag`，右侧面板不参与拖拽
- **尺寸记忆**：窗口整体尺寸记忆（宽度 = 立绘 + 面板），面板宽度可拖拽调整
- **`[emotion=xxx]` 动画**：立绘切换增加淡入淡出过渡（CSS transition）

### 8.5 设置窗口适配

- settings.html 可能合并入右侧面板的"设置"标签，也可能保持独立窗口
- 短期：保持独立设置窗口不变，右侧面板仅承载聊天和终端功能
- 长期：设置窗口改为面板内的全屏覆盖层（减少窗口数量）

### 8.6 技术约束

- Electron 透明窗口 `transparent: true` 需保持，立绘区继续使用透明背景
- 右侧面板使用半透明毛玻璃效果（`backdrop-filter: blur()`）或纯色背景
- CSP 策略需放开 `img-src` 和 `style-src` 以支持 netpet:// 协议
- 现有 renderer.js 逻辑尽量保留，新增 drawer.js 处理面板逻辑

---

## 🔜 阶段九：命令行工作协助 [规划中]

> 目标：NetPet 成为真正的 Agent 框架，能执行 shell 命令、读写文件、搜索代码、操作 Git，辅助用户完成软件开发等 CLI 工作。

### 9.1 Shell 执行工具 (`run_command`)

- **功能**：在工作目录下执行任意 shell 命令，返回 stdout + stderr + exit code
- **参数**：`command` (必填), `cwd` (可选，默认 workspace_root), `timeout` (可选，默认 30s)
- **实现**：`child_process.exec()` + 超时 kill + 输出截断（>2000 行存临时文件）
- **输出展示**：结果注入对话上下文 + 终端面板实时打印

### 9.2 文件系统工具

| 工具 | 用途 | 参数 |
|------|------|------|
| `read_file` (真实文件) | 读取磁盘文件内容 | `path`, `offset?`, `limit?` |
| `list_dir` | 列出目录结构 | `path?`, `depth?` (默认 2) |
| `search_files` | ripgrep 全文搜索 | `pattern`, `path?`, `include?` (如 `*.js`) |
| `edit_file` | 精确字符串替换编辑 | `path`, `oldString`, `newString`, `replaceAll?` |
| `write_file` | 写入/创建文件 | `path`, `content` (覆盖现有文件) |

### 9.3 Git 集成工具

| 工具 | 用途 | 需确认 |
|------|------|--------|
| `git_status` | 查看工作区状态 | 否 |
| `git_diff` | 查看差异（staged/unstaged） | 否 |
| `git_log` | 查看提交历史 | 否 |
| `git_commit` | 提交更改 (message 由 LLM 生成) | **是** |
| `git_branch` | 查看/切换分支 | 否（切换需确认） |

### 9.4 开发流程工具

| 工具 | 用途 | 实现方式 |
|------|------|---------|
| `run_test` | 运行测试 | 读 package.json 的 test script |
| `run_lint` | 运行代码检查 | 读 package.json 的 lint script |
| `npm_install` | 安装依赖 | `npm install`，需确认 |
| `task_multi` | LLM 多步自主执行 | 循环：读取→修改→运行测试→看结果→继续改 |

### 9.5 安全与权限模型

```
危险级别:
  L0 (安全) — 只读命令         → 自动执行，不询问
    ls, dir, cat, type, git status, git diff, git log,
    npm list, node --version, echo, pwd, which, where

  L1 (需确认) — 修改工作区     → 首次弹窗确认，可"记住本次会话"
    git add, git commit, npm install, npm run build,
    mkdir, touch, cp, mv

  L2 (强制拦截) — 危险操作      → 永远弹窗警告，不可记住
    rm -rf, del /s /q, git push --force,
    git reset --hard, npm publish, curl/wget 下载执行,
    任何包含 ; 或 && 的多命令链

  工作目录限制:
    - 默认 workspace_root (config 配置)
    - 禁止访问系统目录 (C:\Windows, /etc, ~/.ssh 等)
    - 禁止写入 .env / config.json 等敏感文件
```

### 9.6 配置项

```json
{
  "cli_settings": {
    "enabled": true,
    "workspace_root": "C:\\Users\\用户名",
    "shell": "powershell",          // powershell / cmd / bash
    "default_timeout": 30000,       // 默认命令超时 (ms)
    "max_output_lines": 2000,       // 输出截断行数
    "confirm_dangerous": true,      // 危险命令是否弹窗确认
    "whitelist_commands": [],       // 额外白名单命令
    "blacklist_commands": [],       // 额外黑名单命令
    "auto_detect_git": true         // 自动检测 Git 仓库作为工作目录
  }
}
```

### 9.7 IPC 通道 (新增)

| 通道 | 方向 | 用途 |
|------|------|------|
| `cli:execute` | Renderer → Main | 执行 shell 命令 |
| `cli:cancel` | Renderer → Main | 取消正在执行的命令 |
| `cli:output` | Main → Renderer | 流式推送命令输出（大输出分批推送） |
| `cli:confirm` | Main → Renderer | 请求用户确认危险操作 |
| `cli:confirm-reply` | Renderer → Main | 用户确认结果 |

### 9.8 工具模型适配

- `tool-prompt.js` 新增 7 个工具声明（run_command + 5 文件系统 + git_*）
- 工具模型 prompt 中加入工作目录上下文和 Git 状态摘要
- `tools/index.js` 注册新工具方法，复用现有路由模式
- 新增 `tools/run-command.js`、`tools/list-dir.js`、`tools/search-files.js`、`tools/edit-file.js`、`tools/git.js`

### 9.9 渐进式交付计划

```
第一阶段 — 基础 CLI (配合 UI 重构同步交付)
  └─ run_command     (核心 shell 执行)
  └─ read_file       (真实文件读取)
  └─ list_dir        (目录浏览)
  └─ 右侧终端面板    (UI 展示)

第二阶段 — 开发辅助
  └─ search_files    (代码搜索)
  └─ edit_file       (文件编辑)
  └─ git_status / git_diff / git_log

第三阶段 — 自动化工作流
  └─ git_commit      (带确认)
  └─ run_test / run_lint
  └─ task_multi      (多步自主执行循环)
```

---

## 🔜 阶段十：多平台 + 高级特性 [远期规划]

### 10.1 跨平台支持
- [ ] macOS 适配（透明窗口、系统托盘、safeStorage Keychain、command 键修饰符）
- [ ] Linux 适配（X11/Wayland 透明窗口、libsecret 加密、AppIndicator 托盘）
- [ ] macOS DMG + Linux AppImage 打包

### 10.2 语音交互
- [ ] TTS 语音合成（读回复），支持 Edge TTS / OpenAI TTS
- [ ] STT 语音输入（说消息），支持 Whisper API / Web Speech API
- [ ] 语音唤醒词（"小七" 等）

### 10.3 多模态
- [ ] 图片识别：用户发截图 → 视觉模型理解内容
- [ ] 桌面截图工具：`take_screenshot` 工具，分析屏幕内容

### 10.4 插件系统
- [ ] 工具插件化：第三方可注册自定义工具和 prompt
- [ ] 角色市场：在线下载/分享角色卡和立绘
- [ ] 工作流模板：预设 Agent 行为链（代码审查、写周报等）
