# NetPet - 桌面LLM虚拟宠物

> v1.1.0

基于 Electron + JavaScript 的桌面 AI 宠物框架。通过在本地直接调用大语言模型 (LLM) API，打造属于你自己的 AI 桌面伙伴。

无论是傲娇猫娘、沉稳大叔还是冷酷杀手，只需修改 System Prompt，即可完美适配。

## 特性

- **Electron 桌面应用**：HTML/CSS 构建的现代 UI，支持透明窗口、拖拽、气泡对话
- **情绪驱动立绘**：LLM 输出 JSON 格式 `{ reply, emotion }`，自动切换 6 种表情立绘
- **独立设置窗口**：可视化配置 API Key、模型、Provider，支持测试连接
- **SQLite 记忆系统**：自动保存对话历史，支持后台总结压缩长程记忆
- **角色设定完全解耦**：修改 `config.json` 中的 System Prompt 即可换人设
- **Agent 工具系统**：两步推理架构，LLM 可调用工具（记笔记/设提醒/查询）
- **AI 驱动任务管理**：LLM 自动判断任务是否完成，无需硬编码关键词匹配
- **角色语气提醒**：定时提醒走 LLM 生成，用角色自己的语气说出来
- **主动搭话系统**：支持启动问候 + 运行时概率递增搭话，宠物会主动找用户聊天

## Agent 工具系统

### 架构
```
用户输入
  ├→ 工具提取模型（便宜模型）→ 判断是否需要调用工具
  │                               ↓
  │                           执行工具（write_file / schedule 等）
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

### 主动搭话系统
- **启动问候**：检测离线间隔，超过阈值自动生成角色语气问候
- **运行时概率搭话**：可配置间隔/基础概率/递增机制，宠物随机主动发起对话
- 用户发言时概率自动重置，避免连续打扰

### 任务完成判断
不再使用独立的 `complete_task` 工具。待办/提醒列表动态注入到对话上下文中，LLM 根据聊天内容自行判断任务是否完成，在回复的 `completed_tasks` 数组中返回对应 ID，后端自动标记数据库。

## 快速开始

### 1. 安装依赖

确保已安装 [Node.js](https://nodejs.org/) (推荐 v20+)。

```bash
cd D:\code\netpet
npm install
```

### 2. 配置

复制模板并填入你的 API Key：

```bash
copy config.example.json config.json
```

然后编辑 `config.json`，填入你的 API Key：

```json
"deepseek": {
    "base_url": "https://api.deepseek.com/v1",
    "api_key": "你的API-Key",
    "model": "deepseek-v4-flash"
}
```

支持：DeepSeek / OpenAI / Gemini / 自定义 OpenAI 兼容接口

### 3. 启动

```bash
npm start
```

或双击 `启动桌宠.bat`。

调试模式（带 DevTools）：
```bash
npm run dev
```

### 4. 自定义角色

修改 `config.json` 中的 `character_settings.system_prompt`，即可更换角色性格、语气、口癖。

## 项目结构

```
netpet/
├── main.js              # Electron 主进程（窗口管理 + IPC + 定时器）
├── preload.js           # IPC 桥接
├── config.json          # 用户配置（需从 config.example.json 复制）
├── config.example.json  # 配置模板（不含敏感信息，可安全提交）
├── memory.db            # SQLite 对话数据库（本地生成，不入库）
├── src/
│   ├── index.html       # 宠物窗口 UI
│   ├── style.css        # UI 样式
│   ├── renderer.js      # 前台逻辑
│   ├── settings.html    # 设置窗口 UI
│   ├── settings.js      # 设置窗口逻辑
│   ├── settings-preload.js # 设置窗口 IPC 桥接
│   ├── config.js        # 配置读写 + API Key 加密存储
│   ├── llm.js           # LLM 通信核心（两步推理架构）
│   ├── tool-prompt.js   # 工具提取模型提示词模板
│   ├── db.js            # SQLite 记忆存储 + 工具 CRUD
│   └── tools/           # 工具模块
│       ├── index.js     # 工具路由
│       ├── write-file.js
│       ├── read-file.js
│       └── schedule.js
├── assets/              # 立绘素材 (PNG)
├── 启动桌宠.bat         # 一键启动
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
