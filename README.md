# NetPet - 桌面LLM虚拟宠物

> v1.4.0

基于 Electron + JavaScript 的桌面 AI 宠物框架。通过在本地直接调用大语言模型 (LLM) API，打造属于你自己的 AI 桌面伙伴。

无论是傲娇猫娘、沉稳大叔还是冷酷杀手，只需修改 System Prompt，即可完美适配。

## 特性

- **Electron 桌面应用**：HTML/CSS 构建的现代 UI，支持透明窗口、可拉伸缩放、拖拽、气泡对话
- **情绪驱动立绘**：LLM 输出 JSON 格式 `{ reply, emotion }`，自动切换 6 种表情立绘
- **独立设置窗口**：可视化配置 API Key、模型、Provider、搜索引擎、流式传输，支持模型列表下拉选择 + 测试连接
- **SQLite 记忆系统**：自动保存对话历史，支持后台总结压缩长程记忆
- **角色设定完全解耦**：修改 `config.json` 中的 System Prompt 即可换人设
- **Agent 工具系统**：两步推理架构，LLM 可调用工具（记笔记/设提醒/查询/联网搜索）
- **联网搜索**：支持 Tavily / DuckDuckGo / Serper / Anthropic(Claude原生) 四种引擎，可配置切换
- **流式传输**：SSE 累积模式，降低首字响应延迟
- **AI SDK 双引擎**：Vercel AI SDK v6 + 裸 openai SDK 降级，多 Provider 统一调用层
- **AI 驱动任务管理**：LLM 自动判断任务是否完成，无需硬编码关键词匹配
- **角色语气提醒**：定时提醒走 LLM 生成，用角色自己的语气说出来
- **主动搭话系统**：支持启动问候 + 运行时概率递增搭话，宠物会主动找用户聊天
- **API Key 加密存储**：系统级 safeStorage 加密，配置文件不存明文
- **可拉伸窗口**：等比缩放，关闭自动记忆尺寸

## 快速开始

> 本教程假设你**完全没有编程经验**。不需要懂代码，跟着一步步做就行。全部配置只需做一次，以后双击就能启动。

---

### 0. 安装 Node.js（只需一次）

桌宠运行需要 Node.js 作为底层环境，装一次就行。

1. 打开浏览器，访问 **https://nodejs.org**
2. 点左边那个大的 **LTS** 按钮下载
3. 双击下载的安装包，一路点"下一步"，全部默认
4. **装完重启电脑**

---

### 1. 安装项目依赖

在解压后的 `netpet` 文件夹里，双击 **`安装依赖.bat`**。

会弹出一个黑色窗口，耐心等它自己关闭（1-3 分钟），不要手动关。

---

### 2. 获取 API Key

桌宠依赖大模型 API 才能"说话"。推荐 DeepSeek（国内网络友好，便宜）：

1. 打开 **https://platform.deepseek.com** 注册账号
2. 登录后左侧菜单 → **「API Keys」** → **「创建 API Key」**
3. **立即复制保存**，这个 Key 只显示一次

> 新用户通常有免费额度，够玩很久。
>
> 其他服务商：OpenAI https://platform.openai.com/api-keys | Gemini https://aistudio.google.com/apikey

---

### 3. 配置

在 `netpet` 文件夹中，右键 `config.example.json` → 复制 → 粘贴 → 把副本重命名为 `config.json`。

右键 `config.json` → 用记事本打开，找到 `api_settings.providers` 对应服务商的位置：

```
"api_key": "在此填入你的 DeepSeek API Key",
```

把引号里的中文替换成你的真实 API Key，例如 `"api_key": "sk-abc123..."`，保存关闭。

> 首次启动时，明文 API Key 会被自动加密。之后 `config.json` 里的 Key 会变为 `__enc__:` 开头的密文。
>
> 如果用 OpenAI 或 Gemini，把 `"provider"` 的值改成对应名称即可。

---

### 4. 启动

双击 `netpet` 文件夹里的 **`启动桌宠.bat`**，几秒后桌宠就会出现在桌面上。

以后每次使用也只需要双击这个文件就行。

### 5. 自定义角色

修改 `config.json` 中的 `character_settings.system_prompt`，即可更换角色性格、语气、口癖。立绘图片替换 `assets/` 文件夹里的 PNG 文件即可。

---

### 常见问题

**Q: 双击 `安装依赖.bat` 显示"npm 不是内部或外部命令"？**  
Node.js 没装好，重新安装并**重启电脑**。

**Q: 双击 `启动桌宠.bat` 一闪而过？**  
打开 `netpet` 文件夹，在地址栏输入 `cmd` 回车，输入 `npm start` 看具体报错。

**Q: 桌宠出来了但不回消息？**  
检查 `config.json` 里 API Key 是否填对、有无多余空格，以及账户是否还有余额。

**Q: 设置里保存后角色提示词消失了？**  
请升级到 v1.2.0，已修复该问题。旧版本若遇此问题，重新编辑 `config.json` 填入 system_prompt 即可。

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
- `web_search` — 联网搜索（支持 Tavily / DuckDuckGo / Serper），可配置搜索引擎和 API Key

### 主动搭话系统
- **启动问候**：检测离线间隔，超过阈值自动生成角色语气问候
- **运行时概率搭话**：可配置间隔/基础概率/递增机制，宠物随机主动发起对话
- 用户发言时概率自动重置，避免连续打扰

### 联网搜索
- 通过设置界面选择搜索引擎（DuckDuckGo 免费无需 Key / Tavily 1000次/月 / Serper Google搜索）
- 宠物根据对话内容自动判断是否需要搜索，搜索结果以角色语气转述
- API Key 同样经过系统级加密存储

### 任务完成判断
待办/提醒列表动态注入到对话上下文中，LLM 根据聊天内容自行判断任务是否完成，在回复的 `completed_tasks` 数组中返回对应 ID，后端自动标记数据库。

## 项目结构

```
netpet/
├── AGENTS.md            # 架构决策文档（技术路线、框架选型说明）
├── main.js              # Electron 主进程（窗口管理 + IPC + 定时器）
├── preload.js           # IPC 桥接
├── config.json          # 用户配置（需从 config.example.json 复制）
├── config.example.json  # 配置模板（含完整角色预设，可安全提交）
├── memory.db            # SQLite 对话数据库（本地生成，不入库）
├── src/
│   ├── index.html       # 宠物窗口 UI
│   ├── style.css        # UI 样式
│   ├── renderer.js      # 前台逻辑
│   ├── settings.html    # 设置窗口 UI（侧边栏导航，6 个配置页）
│   ├── settings.js      # 设置窗口逻辑
│   ├── settings-preload.js # 设置窗口 IPC 桥接
│   ├── config.js        # 配置读写 + API Key 加密存储
│   ├── llm.js           # LLM 通信核心（AI SDK 双引擎 + 两步推理）
│   ├── ai-provider.js   # AI SDK 动态 import 包装层
│   ├── tool-prompt.js   # 工具提取模型提示词模板
│   ├── db.js            # SQLite 记忆存储 + 工具 CRUD
│   └── tools/           # 工具模块
│       ├── index.js     # 工具路由
│       ├── write-file.js
│       ├── read-file.js
│       ├── schedule.js
│       └── web-search.js # 联网搜索（Tavily/DDG/Serper/Anthropic）
├── assets/              # 立绘素材 (PNG)
├── 启动桌宠.bat         # 一键启动（双击即可）
├── 安装依赖.bat         # 一键安装依赖（首次双击，之后不用）
├── ROADMAP.md           # 演进路线图
└── README.md            # 本文件
```

## 记忆系统

对话自动存入 SQLite，每 N 轮对话自动总结为背景记忆，防止长对话 Token 溢出。同时维护 `tools` 表记录待办、笔记、提醒等工具数据。

## JSON 响应格式

LLM 每次回复需要输出以下 JSON：

```json
{
  "reply": "回复文本，包含颜文字和角色语气",
  "emotion": "情绪标签：[idle, happy, angry, sad, shy, confused]",
  "completed_tasks": [1, 3]
}
```

其中 `completed_tasks` 为可选字段，当用户确认某件事已完成时，填入对应任务的数据库 ID。

## 进阶开发

详见 `AGENTS.md`（技术架构决策）和 `ROADMAP.md`（演进路线图）。
