# NetPet - 桌面LLM虚拟宠物

> v1.6.0

基于 Electron + JavaScript 的桌面 AI 宠物框架。通过在本地直接调用大语言模型 (LLM) API，打造属于你自己的 AI 桌面伙伴。

无论是傲娇猫娘、沉稳大叔还是冷酷杀手，只需修改 System Prompt，即可完美适配。

## 特性

- **Electron 桌面应用**：HTML/CSS 构建的现代 UI，支持透明窗口、可拉伸缩放、拖拽、气泡对话
- **情绪驱动立绘**：LLM 输出 `[emotion=表情]` 前缀标签，自动切换 6 种表情立绘
- **独立设置窗口**：可视化配置 API Key、模型、Provider、搜索引擎、流式传输，支持模型列表下拉选择 + 测试连接
- **SQLite 记忆系统**：自动保存对话历史，支持后台总结压缩长程记忆
- **角色设定完全解耦**：独立角色文件（`characters/<角色名>/character.json`），支持多角色切换、导入/导出、PNG 角色卡
- **Agent 工具系统**：两步推理架构，LLM 可调用工具（记笔记/设提醒/查询/联网搜索/搜索知识库）
- **联网搜索**：支持 Tavily / DuckDuckGo / Serper / Anthropic(Claude原生) 四种引擎，可配置切换
- **知识库系统**：从对话中自动提取用户事实，去重后存入数据库；基于事实生成用户画像，注入后续对话上下文
- **置信度管理**：时间衰减 + 矛盾检测，旧事实自然淡忘，观点变化时自动更新
- **知识补全**：LLM 表达不确定时，用户文字确认即可触发联网搜索，结果自动存储供下次引用
- **流式传输**：SSE 累积模式，降低首字响应延迟
- **AI SDK 双引擎**：Vercel AI SDK v6 + 裸 openai SDK 降级，多 Provider 统一调用层
- **AI 驱动任务管理**：LLM 自动判断任务是否完成，无需硬编码关键词匹配
- **角色语气提醒**：定时提醒走 LLM 生成，用角色自己的语气说出来
- **主动搭话系统**：支持启动问候 + 运行时概率递增搭话，宠物会主动找用户聊天
- **最小化通知**：窗口隐藏到托盘时，搭话和提醒以系统通知弹窗形式推送
- **单实例锁**：防止重复启动，再次双击自动激活已有窗口
- **API Key 加密存储**：系统级 safeStorage 加密，配置文件不存明文
- **可拉伸窗口**：等比缩放，关闭自动记忆尺寸
- **系统托盘**：最小化隐藏到托盘，左键恢复/右键菜单（不再消失找不回）
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
  ├→ 工具提取模型（便宜模型）→ 判断是否需要调用工具
  │                               ↓
  │                           执行工具（write_file / schedule / web_search 等）
  │                               ↓
  └→ 聊天模型（主模型） → 结合工具结果生成回复
                          ├─ reply: 回复文本
                          ├─ emotion: 情绪标签
                          └─ completed_tasks: [已完成的任务ID]
```

### 工具列表
- `write_file` — 记录笔记/待办/日记到数据库（可选写文件系统）
- `read_file` — 按类型/标签/全文搜索回顾已记录内容
- `schedule` — 设置定时提醒（自然语言时间或ISO时间），到期调LLM生成角色语气提醒
- `web_search` — 联网搜索（支持 Tavily / DuckDuckGo / Serper / Anthropic），可配置搜索引擎和 API Key
- `search_knowledge` — 搜索本地知识库（已提取的用户事实 + 已存储的外部知识）

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
待办/提醒列表动态注入到对话上下文中，LLM 根据聊天内容自行判断任务是否完成，在回复的 `completed_tasks` 数组中返回对应 ID，后端自动标记数据库。

## 项目结构

```
netpet/
├── main.js              # Electron 主进程（窗口管理 + IPC + 定时器 + netpet:// 协议）
├── preload.js           # IPC 桥接
├── config.json          # 用户配置（需从 config.example.json 复制）
├── config.example.json  # 配置模板（含完整角色预设，可安全提交）
├── memory.db            # SQLite 对话数据库（本地生成，不入库）
├── characters/          # 角色文件目录
│   └── 七夜/            #   每个角色一个文件夹
│       ├── character.json  #   角色设定
│       ├── idle.png        #   默认立绘
│       ├── happy.png
│       ├── angry.png
│       ├── sad.png
│       ├── shy.png
│       └── confused.png
├── assets/              # 全局立绘素材（角色缺失时回退）
├── src/
│   ├── index.html       # 宠物窗口 UI
│   ├── style.css        # UI 样式
│   ├── renderer.js      # 前台逻辑
│   ├── settings.html    # 设置窗口 UI（侧边栏导航，7 个配置页）
│   ├── settings.js      # 设置窗口逻辑
│   ├── settings-preload.js # 设置窗口 IPC 桥接
│   ├── config.js        # 配置读写 + API Key 加密存储 + 角色文件加载
│   ├── llm.js           # LLM 通信核心（AI SDK 双引擎 + 两步推理 + 知识库管道）
│   ├── ai-provider.js   # AI SDK 动态 import 包装层
│   ├── tool-prompt.js   # 工具提取模型提示词模板
│   ├── db.js            # SQLite 记忆存储 + 工具 CRUD + 知识库 CRUD
│   ├── png-card.js      # PNG tEXt 块读写（角色卡嵌入/提取）
│   └── tools/           # 工具模块
│       ├── index.js     # 工具路由
│       ├── write-file.js
│       ├── read-file.js
│       ├── schedule.js
│       ├── web-search.js
│       └── search-knowledge.js
├── 启动桌宠.bat         # 一键启动（双击即可）
├── 安装依赖.bat         # 一键安装依赖（首次双击，之后不用）
├── ROADMAP.md           # 演进路线图
└── README.md            # 本文件
```

## 记忆系统

对话自动存入 SQLite，每 N 轮对话自动总结为背景记忆，防止长对话 Token 溢出。同时维护 `tools` 表记录待办、笔记、提醒等工具数据。

## 回复格式

LLM 回复由系统强制注入 `[emotion=表情]` 前缀标签，表情为以下六种之一：`idle`、`happy`、`angry`、`sad`、`shy`、`confused`。

可选附加标签：
- `[completed=ID1,ID2]` — 标记已完成的任务 ID
- `[need_search=关键词]` — 表示需要联网搜索

示例：`[emotion=idle]主人又在摸鱼了，吾辈都看在眼里。`

## 进阶开发

详见 `ROADMAP.md`（演进路线图）。
