# NetPet - 桌面LLM虚拟宠物

基于 Electron + JavaScript 的桌面 AI 宠物框架。通过在本地直接调用大语言模型 (LLM) API，打造属于你自己的 AI 桌面伙伴。

无论是傲娇猫娘、沉稳大叔还是冷酷杀手，只需修改 System Prompt，即可完美适配。

## 特性

- **Electron 桌面应用**：HTML/CSS 构建的现代 UI，支持透明窗口、拖拽、气泡对话
- **情绪驱动立绘**：LLM 输出 JSON 格式 `{ reply, emotion }`，自动切换 6 种表情立绘
- **独立设置窗口**：可视化配置 API Key、模型、Provider，支持测试连接
- **SQLite 记忆系统**：自动保存对话历史，支持后台总结压缩长程记忆
- **角色设定完全解耦**：修改 `config.json` 中的 System Prompt 即可换人设

## 快速开始

### 1. 安装依赖

确保已安装 [Node.js](https://nodejs.org/) (推荐 v20+)。

```bash
cd D:\code\netpet
npm install
```

### 2. 配置

编辑 `config.json`，填入你的 API Key：

```json
"deepseek": {
    "base_url": "https://api.deepseek.com/v1",
    "api_key": "sk-你的key",
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
├── main.js              # Electron 主进程（窗口管理 + IPC）
├── preload.js           # IPC 桥接
├── config.json          # 配置（API Key、角色设定、UI尺寸）
├── memory.db            # SQLite 对话数据库
├── src/
│   ├── index.html       # 宠物窗口 UI
│   ├── style.css        # UI 样式
│   ├── renderer.js      # 前台逻辑
│   ├── settings.html    # 设置窗口 UI
│   ├── settings.js      # 设置窗口逻辑
│   ├── config.js        # 配置读写
│   ├── llm.js           # LLM API 通信
│   └── db.js            # SQLite 记忆存储
├── assets/              # 立绘素材 (PNG)
└── 启动桌宠.bat         # 一键启动
```

## 记忆系统

对话自动存入 SQLite，每 N 轮对话自动总结为背景记忆，防止长对话 Token 溢出。

## 许可证

ISC
