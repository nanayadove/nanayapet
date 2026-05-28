# NetPet - 桌面LLM虚拟宠物

> v1.7.0

基于 Electron + JavaScript 的桌面 AI 宠物框架，定位为 **轻量级酒馆 + 轻量级 Agent 框架**。通过在本地直接调用大语言模型 (LLM) API，打造属于你自己的 AI 桌面伙伴。

无论是傲娇猫娘、沉稳大叔还是冷酷杀手，只需修改 System Prompt，即可完美适配。

## 特性

- **Electron 桌面应用**：HTML/CSS 构建的现代 UI，支持透明窗口、可拉伸缩放、拖拽、气泡对话
- **情绪驱动立绘**：LLM 输出 `[emotion=表情]` 前缀标签，自动切换 6 种表情立绘
- **独立设置窗口**：9 个配置标签页（API/记忆/工具/搜索/知识库/角色管理/搭话/对话管理/知识库管理），支持模型列表下拉选择 + 测试连接
- **SQLite 记忆系统**：7 表数据库（messages/sessions/events/knowledge_base/character_memories/tools/meta），支持 Session 对话管理和自动总结压缩
- **Session 对话管理**：多会话容器，支持新建/切换/导出/删除对话，切换角色弹窗确认后自动新开 Session，历史 Session 恢复时加载 summary
- **角色长久记忆**：`character_memories` 表存储角色跨对话记忆（user_relation/world_knowledge/self_awareness/conversation_summary），Session 归档摘要自动沉淀为角色记忆
- **角色设定完全解耦**：独立角色文件（`characters/<角色名>/character.json`），支持多角色切换、导入/导出、PNG 角色卡（SillyTavern 兼容）
- **Agent 工具系统**：两步推理架构，工具模型负责决策，聊天模型专注回复
- **联网搜索**：支持 Tavily / DuckDuckGo / Serper / Anthropic(Claude原生) 四种引擎，可配置切换
- **知识库系统**：统一 knowledge_base，三类分类：user_profile（用户画像）/ lore（世界观设定）/ web（外部知识），自动去重 + 置信度衰减
- **World Info (Lore)**：世界观设定分类，支持关键词精确匹配触发，对话时自动注入 LLM 上下文；设置界面可快速添加/编辑/删除
- **知识库管理 UI**：设置界面可直接浏览、搜索、筛选、编辑、删除知识库条目，支持分页和批量操作
- **导出**：角色设定 Tab 支持导出角色卡 + 会话 + 知识库 (PNG/JSON)，对话管理 Tab 支持快捷导出单个会话
- **置信度管理**：时间衰减 + 矛盾检测，旧事实自然淡忘，观点变化时自动更新
- **上下文长度控制**：可配置最近对话轮数 + 总长度上限，超出自动裁剪最早对话，保护角色设定和记忆
- **流式传输**：SSE 累积模式，降低首字响应延迟
- **AI SDK**：Vercel AI SDK v6，全链路统一调用层
- **AI 驱动任务管理**：工具模型自动判断任务完成，无需硬编码关键词匹配
- **角色语气提醒**：定时提醒走 LLM 生成，用角色自己的语气说出来
- **主动搭话系统**：支持启动问候 + 运行时概率递增搭话，宠物会主动找用户聊天
- **最小化通知**：窗口隐藏到托盘时，搭话和提醒以系统通知弹窗形式推送
- **单实例锁**：防止重复启动，再次双击自动激活已有窗口
- **API Key 加密存储**：系统级 safeStorage 加密，配置文件不存明文
- **可拉伸窗口**：等比缩放，关闭自动记忆尺寸
- **系统托盘**：最小化隐藏到托盘，左键恢复/右键菜单
- **一键打包分发**：`npx electron-builder --win zip` 生成免安装压缩包

## 快速开始

> 如果你拿到了打包好的 `NetPet-*.zip`，直接解压双击 `NetPet.exe` 即可，跳到第 2 步。

### 0. 准备环境（只需一次）

桌宠运行需要 Node.js 作为底层环境：

1. 访问 **<https://nodejs.org>**，点左边的 **LTS** 按钮下载安装
2. 一路点"下一步"，全部默认
3. **装完重启电脑**

### 1. 安装依赖 ＋ 启动

在 `netpet` 文件夹里，双击 **`安装依赖.bat`**，等它自动关闭（1-3 分钟）。
之后双击 **`启动桌宠.bat`**，桌宠就出现在桌面了。

> 以后每次也只需要双击 `启动桌宠.bat`。

### 2. 配置 API Key

右键桌宠 → **设置**，或者点击桌宠身上的设置图标，在设置界面里填入你的 API Key。

- DeepSeek 注册：https://platform.deepseek.com
- OpenAI 注册：https://platform.openai.com/api-keys
- Gemini 注册：https://aistudio.google.com/apikey
- tavily 注册（如需联网搜索功能）： https://www.tavily.com/

> 首次写入的 API Key 会被系统级加密存储，配置文件里不存明文。

### 3. 自定义角色

设置界面的 **「角色管理」** 标签页可切换/编辑/导入/导出角色。

**角色文件结构**（`characters/<角色名>/`）：
```
characters/七夜/
├── character.json   # 角色设定（name, displayName, system_prompt）
├── idle.png         # 默认立绘（也是 PNG 角色卡导出底图）
├── happy.png
├── angry.png
├── sad.png
├── shy.png
└── confused.png
```

**PNG 角色卡**：导出时角色 JSON 会嵌入 `idle.png` 的 `tEXt` 块（ccv3 键），兼容 SillyTavern 规范。导入 PNG 时自动解析 JSON + 复制立绘。立绘缺失时自动回退到 `七夜/idle.png`。

---

### 常见问题

**Q: 双击 `安装依赖.bat` 显示"npm 不是内部或外部命令"？**  
Node.js 没装好，重新安装并**重启电脑**。

**Q: 桌宠出来了但不回消息？**  
打开设置 → 检查 API Key 是否填对、账户是否还有余额。

**Q: 最小化后桌面没了，怎么找回来？**  
v1.4.1 起桌面右下角有托盘图标（猫猫头），双击即可恢复。如果看不到，点任务栏 `^` 展开隐藏图标。

**Q: 双击 `启动桌宠.bat` 一闪而过？**  
在 `netpet` 文件夹地址栏输入 `cmd` 回车，输入 `npm start` 看具体报错。

## Agent 工具系统

### 架构
```
用户输入
  ├→ 工具模型（便宜模型）→ 判断是否需要调用工具 + 任务完成检测
  │                           ↓
  │                       执行工具（write_file / schedule / web_search 等）
  │                           ↓
  │                       工具结果注入上下文
  │                           ↓
  └→ 聊天模型（主模型） → 结合工具结果生成角色化回复
                          └─ [emotion=xxx] 换行 + 回复正文
```

工具模型输出 JSON `{tool, params, completed_tasks}`，聊天模型只输出 `[emotion=xxx]` 标签 + 自然语言正文，职责完全分离。

### 工具列表
- `write_file` — 记录笔记/待办/日记到数据库
- `read_file` — 按类型/标签/全文搜索回顾已记录内容
- `schedule` — 设置定时提醒（自然语言时间或ISO时间），到期调LLM生成角色语气提醒
- `web_search` — 联网搜索（支持 Tavily / DuckDuckGo / Serper / Anthropic），可配置搜索引擎和 API Key
- `search_knowledge` — 搜索本地统一知识库
- `remember` — 用户主动教学，存入知识库 user_profile 分类

### 主动搭话系统
- **启动问候**：检测离线间隔，超过阈值自动生成角色语气问候
- **运行时概率搭话**：可配置间隔/基础概率/递增机制，宠物随机主动发起对话
- 用户发言时概率自动重置，避免连续打扰
- **最小化通知**：窗口隐藏到托盘时，搭话和提醒自动转为系统通知弹窗，不会错过

### 知识库系统
- **事实提取**：每 N 轮对话自动触发（N 可配，默认3），LLM 从对话中提取关于用户的事实
- **去重与置信度**：LIKE 模糊匹配 + 3-gram 滑动窗口相似度比对，相似事实合并而非重复插入；置信度支持时间衰减和矛盾检测，观点变化时自动更新
- **用户画像**：定时（每日/累积阈值）读取所有事实，LLM 生成用户画像摘要，注入后续每次对话的上下文
- **知识补全**：LLM 表达不确定时，用户回复确认词即可自动 web_search，结果存入知识库，下次同类话题自动引用
- **可配置模型**：知识库处理（事实提取 + 画像生成）支持独立选择服务商和模型，可用便宜小模型节省成本
- **设置页可视化**：相似度阈值、衰减率、触发轮数、画像间隔等全部可在设置界面调节

### 联网搜索
- 通过设置界面选择搜索引擎（DuckDuckGo 免费无需 Key / Tavily 1000次/月 / Serper Google搜索）
- 宠物根据对话内容自动判断是否需要搜索，搜索结果以角色语气转述
- API Key 同样经过系统级加密存储

### 任务完成判断
待办/提醒列表动态注入对话上下文，**工具模型**根据聊天内容自行判断任务是否完成，在 JSON 输出的 `completed_tasks` 字段中返回对应 ID，后端自动标记数据库。

## 项目结构

```
netpet/
├── main.js              # Electron 主进程（窗口管理 + IPC + 定时器 + netpet:// 协议）
├── preload.js           # 主窗口 IPC 桥接
├── config.json          # 用户配置（需从 config.example.json 复制）
├── config.example.json  # 配置模板（含完整角色预设，可安全提交）
├── memory.db            # SQLite 数据库（本地生成，不入库）
├── characters/          # 角色文件目录
│   └── 七夜/            #   每个角色一个文件夹
│       ├── character.json  #   角色设定
│       ├── idle.png        #   默认立绘（PNG 角色卡导出底图）
│       └── *.png           #   情绪立绘 (happy/angry/sad/shy/confused)
├── assets/              # 全局立绘素材（角色缺失时回退）
├── src/
│   ├── index.html       # 宠物窗口 UI
│   ├── style.css        # UI 样式
│   ├── renderer.js      # 前台逻辑
│   ├── settings.html    # 设置窗口 UI（侧边栏导航，9 个配置页）
│   ├── settings.js      # 设置窗口逻辑
│   ├── settings-preload.js # 设置窗口 IPC 桥接
│   ├── config.js        # 配置读写 + API Key 加密存储 + 角色文件加载
│   ├── llm.js           # LLM 通信核心（两步推理 + 知识库管道 + 标签解析）
│   ├── ai-provider.js   # AI SDK 动态 import 包装层
│   ├── tool-prompt.js   # 工具模型提示词模板（含 completed_tasks 规范）
│   ├── db.js            # SQLite 数据库（7 表：messages/sessions/events/knowledge_base/character_memories/tools/meta）
│   ├── png-card.js      # PNG tEXt 块读写（角色卡嵌入/提取）
│   └── tools/           # 工具模块
│       ├── index.js     # 工具路由
│       ├── write-file.js
│       ├── read-file.js
│       ├── schedule.js
│       ├── web-search.js
│       ├── search-knowledge.js
│       └── remember.js
├── 启动桌宠.bat         # 一键启动（双击即可）
├── 安装依赖.bat         # 一键安装依赖（首次双击，之后不用）
├── ROADMAP.md           # 演进路线图
└── README.md            # 本文件
```

## 记忆系统

对话自动存入 SQLite（`messages` 表，归属 `session_id`），每 N 轮对话自动总结为背景记忆存入 `sessions.summary`。同时维护 `tools` 表记录待办、笔记、提醒等工具数据。

### 数据库表
| 表 | 用途 |
|----|------|
| `messages` | 对话消息 (session_id, role, content) |
| `sessions` | 对话容器 (character_id, title, summary, is_active) |
| `events` | 系统事件日志 (offline/summary/profile_update/tool_call) |
| `knowledge_base` | 统一知识库 (user_profile/lore/web) |
| `character_memories` | 角色长久记忆 (user_relation/world_knowledge/self_awareness/conversation_summary) |
| `tools` | 工具记录 (note/todo/schedule) |
| `meta` | 键值配置 |

## 回复格式

LLM 回复由系统强制注入格式锁，聊天模型**只输出** `[emotion=xxx]` 标签，后接换行和正文。表情为以下六种之一：`idle`、`happy`、`angry`、`sad`、`shy`、`confused`。

示例：`[emotion=idle]\n主人又在摸鱼了，吾辈都看在眼里。`

## 进阶开发

详见 `ROADMAP.md`（演进路线图）。
