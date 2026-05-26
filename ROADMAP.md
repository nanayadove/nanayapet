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

## 🔜 阶段五：知识库重构 [施工中]

> 2026-05-26 讨论记录：当前 `knowledge` 表仅记录网页检索缓存，`facts` 表仅记录用户事实，两者割裂且 knowledge 表太薄。决定合并为统一知识库，classification 体系重新划分，用户画像归为知识库的一个子类。

### 5.1 数据库合并 [已完成 2026-05-26]
- [x] 合并 `facts` 和 `knowledge` 表为统一的 `knowledge_base` 表
- [x] 新 schema：id / classification / category / content / tags / confidence / source_msg_id / source / source_url / created_at / updated_at
- [x] classification 体系（3 类）：
  - `user_profile` — 用户画像（原 facts：偏好、习惯、计划、个人信息、观点、事件、关系等）
  - `taught` — 用户教学（用户主动告诉宠物的知识）
  - `web` — 外部知识（原 knowledge：网页检索结果缓存）
- [x] 后向兼容：旧 `saveFact`/`searchFactsLike`/`saveKnowledge`/`searchKnowledgeLike` 等接口封装到新表
- [x] 迁移脚本：启动时自动读取旧 facts + knowledge，迁入 knowledge_base，删除旧表

### 5.2 写入渠道扩展 [已完成 2026-05-26]
- [x] 用户主动教学：新增 `remember` 工具（tools/remember.js），写入 `taught` 分类
- [x] 网页搜索缓存：web_search → saveKnowledge 逻辑保留，写入 `web` 分类
- [ ] 用户分享识别：识别用户科普/教学类消息，沉淀为 `taught`（待 5.5 手动管理入口后实现自动识别）

### 5.3 设置页重构 [已完成 2026-05-26]
- [x] 知识库 Tab 描述更新为"统一知识库"
- [x] `max_facts` + `max_knowledge` 合并为 `max_items`
- [x] 画像生成从独立模块归入知识库子设置（保留原有配置项）

### 5.4 工具适配 [已完成 2026-05-26]
- [x] `search_knowledge` 工具适配新表：统一搜索 knowledge_base，结果按 classification 分组展示
- [x] 新增 `remember` 工具：tool-prompt.js 声明 + tools/remember.js 实现
- [x] `tool-prompt.js` 更新工具描述

### 5.5 导出与辅助
- [ ] 对话历史导出：Markdown/JSON 格式
- [ ] 知识库导出：按 classification 分类导出 JSON
- [ ] 格式转换：CSV→JSON 导入，Markdown 按标题切片导入
- [ ] 批量编辑表格视图

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

## 🔮 阶段六：角色系统独立化 [规划中]

> 2026-05-26 讨论记录：当前角色设定（名字、性格、语气、立绘等）散落在 `config.json` 的 `character_settings` 和 `assets/` 中，无法管理多角色。且角色自身缺乏独立记忆——当前对话记忆只看最近 N 条消息，没有角色对用户/对世界的长期认知。决定将角色抽象为独立实体，每个角色绑定专属记忆库。

### 6.1 角色设定独立 [已完成]

- [x] 角色设定从 `config.json` 中剥离为独立 JSON 文件（`characters/<角色名>/character.json`）
- [x] 角色文件结构：`name` / `displayName` / `system_prompt` / `greeting`
- [x] 立绘文件夹规范：`characters/<角色名>/idle.png`、`happy.png` 等，扁平结构
- [x] 自定义 `netpet://` 协议，渲染进程通过协议加载角色立绘（打包/开发均可用）
- [x] 设置界面"角色管理"Tab：角色下拉切换 + 编辑 + 导入/导出
- [x] 启动时根据 `active_character` 加载角色文件，回退到内建 `character_settings`
- [x] PNG 角色卡：导出时将角色 JSON 嵌入 `idle.png` 的 `tEXt` chunk（ccv3 键，兼容 SillyTavern 规范）
- [x] PNG 角色卡：导入时自动解析 PNG 中的 JSON，同时复制立绘
- [x] 导出支持 JSON / PNG 卡两种格式

### 6.2 角色长久记忆库

- [ ] 角色记忆独立于用户事实：新增 `character_memories` 表
- [ ] schema：`id` / `character_id` / `category`（user_relation / world_knowledge / self_awareness / conversation_summary）/ `content` / `confidence` / `created_at` / `updated_at`
- [ ] 角色对用户的认知（user_relation）：用户姓名、关系程度、互动风格、已知偏好快照
- [ ] 角色对世界的认知（world_knowledge）：角色从对话/搜索中学到的外部知识，独立于用户知识库
- [ ] 角色自我认知（self_awareness）：角色对自身的理解（名字、设定、用户如何看待自己等），对话中自然沉淀
- [ ] 对话摘要（conversation_summary）：每次对话关闭时自动生成摘要存入记忆，下次启动时加载为上下文
- [ ] 记忆衰减 + 强化机制：经常提及的信息 confidence 自动增加，长期未提及的自然淡化
- [ ] 角色记忆与用户知识库互相独立，通过 confidence 权重竞争决定注入上下文的优先级

### 6.3 对话新开（Session 管理）

- [ ] 新增 `sessions` 表：`id` / `title`（自动摘要生成）/ `character_id` / `created_at` / `last_active_at` / `is_active` / `summary`
- [ ] 每次对话是一个 Session，绑定一个角色
- [ ] 用户可手动"新开对话"：当前 Session 归档生成摘要 → 清空聊天上下文 → 保留角色记忆和用户知识库
- [ ] 切换角色时自动新开 Session（或提示是否保留当前会话）
- [ ] Session 历史列表：查看/恢复/删除过往对话
- [ ] 恢复历史 Session 时加载上次摘要作为起始上下文

### 6.4 角色与记忆库绑定

- [ ] 角色 JSON 文件包含 `memory_db` 字段，指向该角色的记忆库（默认为 `characters/<角色名>/memory.db`）
- [ ] 同一角色在不同 Session 间共享记忆库，不同角色记忆库完全隔离
- [ ] 用户知识库（`knowledge` 表，即阶段五重构后的统一知识库）为全局共享，不随角色切换而清空
- [ ] 角色删除时提示是否同时删除记忆库
- [ ] 角色导出时可选是否包含记忆库

### 6.5 数据流梳理

```
启动 → 加载活跃角色设定 + 角色记忆库 + 最新 Session
    → 注入角色 system prompt（来自角色 JSON）
    → 注入角色记忆摘要（来自 character_memories）
    → 注入用户画像（来自 knowledge 表 user_profile 分类）
    → 注入当前 Session 历史消息
    → LLM 对话

对话结束/新开：
    → 生成对话摘要 → 存入 character_memories（conversation_summary）
    → Session 归档，清空消息上下文
    → 角色记忆和用户知识库保留
```
