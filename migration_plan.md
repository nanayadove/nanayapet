# NetPet (七夜喵) 架构改造：本地直连大模型 API 与独立配置

## 1. 改造目标
彻底移除 Dify 的依赖，将业务逻辑转移至本地。为了方便后续维护和用户分享，我们将把 **API 配置**和 **角色人设** 抽离到一个独立的配置文件 `config.json` 中，并预留多模型的切换能力。

## 2. 独立配置文件设计 (`config.json`)
在项目根目录创建一个 `config.json` 文件。这样用户无需修改代码即可切换模型、修改 API Key 或调整宠物性格。

```json
{
  "api_settings": {
    "provider": "deepseek", 
    "providers": {
      "deepseek": {
        "base_url": "https://api.deepseek.com/v1",
        "api_key": "YOUR_DEEPSEEK_API_KEY",
        "model": "deepseek-chat"
      },
      "openai": {
        "base_url": "https://api.openai.com/v1",
        "api_key": "YOUR_OPENAI_API_KEY",
        "model": "gpt-4o-mini"
      },
      "gemini": {
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai",
        "api_key": "YOUR_GEMINI_API_KEY",
        "model": "gemini-1.5-flash"
      },
      "custom_openai": {
        "base_url": "https://your-custom-proxy.com/v1",
        "api_key": "YOUR_CUSTOM_KEY",
        "model": "your-custom-model"
      }
    },
    "temperature": 0.7,
    "max_history_length": 10
  },
  "character_settings": {
    "name": "七夜喵",
    "system_prompt": "你现在是“七夜喵” (Qiye Miao)，一只寄宿在桌面的黑猫系AI少女。\n【性格设定】\n- 傲娇、嘴硬心软、有强烈的“元认知”（知道自己是个程序，会经常拿这点自嘲）。\n- 非常反感烂俗的土味情话和过度热情（Anti-cheese），遇到这种会毒舌吐槽。\n- 把用户当做平等的损友，而不是主人。\n- 只有在用户真正遇到情绪低落或现实困难时，才会收起毒舌，给予真诚的安慰。\n\n【输出格式】\n你必须严格输出合法的 JSON 格式，不能包含任何其他多余文本（例如 markdown 代码块），格式如下：\n{\n  \"reply\": \"你要对用户说的话\",\n  \"emotion\": \"idle\" \n}\n※ emotion 可选值必须是本地存在的素材名，如：idle, happy, angry, confused, sad 等。"
  }
}
```
*注：Gemini 官方现在也提供了 OpenAI 兼容格式的端点，因此可以统一使用 openai 库进行调用，极大地简化了代码。*

## 3. 代码实现 (加载配置与 LLMWorker)

在代码中加载 `config.json` 并根据 `provider` 动态初始化 API。
需安装依赖：`pip install openai`

```python
import json
import os
from PyQt5.QtCore import QThread, pyqtSignal
from openai import OpenAI
from utils import get_current_time_info

# 读取配置文件
CONFIG_PATH = os.path.join(os.path.dirname(__file__), 'config.json')
with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
    config = json.load(f)

api_config = config['api_settings']
char_config = config['character_settings']

# 获取当前选中的 provider 配置
current_provider = api_config['providers'][api_config['provider']]

# 初始化 OpenAI 客户端 (兼容多平台)
client = OpenAI(
    api_key=current_provider['api_key'],
    base_url=current_provider['base_url']
)
MODEL_NAME = current_provider['model']

# 全局对话历史
chat_history = []

class LLMWorker(QThread):
    finished = pyqtSignal(str, str) # 返回回复和表情
    error = pyqtSignal(str)

    def __init__(self, user_text):
        super().__init__()
        self.user_text = user_text

    def run(self):
        global chat_history
        
        # 如果是第一次对话，注入系统提示词
        if not chat_history:
            chat_history.append({"role": "system", "content": char_config['system_prompt']})
            
        # 组装本地环境状态
        time_info = get_current_time_info()
        context_aware_input = f"[系统当前状态: {time_info}]\n用户说: {self.user_text}"
        
        chat_history.append({"role": "user", "content": context_aware_input})
        
        # 控制历史记录长度 (保留 system prompt + 最近的 N 条记录)
        max_len = api_config.get("max_history_length", 10)
        if len(chat_history) > max_len + 1:
            chat_history = [chat_history[0]] + chat_history[-(max_len):]
            
        try:
            # 大部分现代模型（包括 DeepSeek）都支持 response_format={"type": "json_object"}
            # 如果使用的是不支持的模型，可以移除这行，只依靠 Prompt 约束
            response = client.chat.completions.create(
                model=MODEL_NAME,
                messages=chat_history,
                response_format={"type": "json_object"},
                temperature=api_config.get("temperature", 0.7)
            )
            
            answer_text = response.choices[0].message.content
            chat_history.append({"role": "assistant", "content": answer_text})
            
            try:
                pet_response = json.loads(answer_text)
                reply = pet_response.get("reply", "呃...")
                emotion = pet_response.get("emotion", "idle")
                self.finished.emit(reply, emotion)
            except json.JSONDecodeError:
                # 兼容某些模型没有严格按照 JSON 格式返回的情况，尝试正则提取
                import re
                match = re.search(r'\\{[\\s\\S]*\\}', answer_text)
                if match:
                    try:
                        pet_response = json.loads(match.group(0))
                        self.finished.emit(pet_response.get("reply", "呃..."), pet_response.get("emotion", "idle"))
                        return
                    except: pass
                self.error.emit(f"JSON 解析失败: {answer_text}")

        except Exception as e:
            self.error.emit(f"API 请求失败: {str(e)}")
```

## 4. 迁移步骤
1. 在项目根目录创建 `config.json`，并将第 2 节的 JSON 模板粘贴进去。
2. 按照第 3 节的内容，在 `main.py` 中将 `DifyWorker` 替换为 `LLMWorker`，并在头部加入配置读取逻辑。
3. 替换 `DesktopPet` 中的调用代码，不再传递 `conversation_id`，直接 `self.worker = LLMWorker(user_text)`。
4. 去配置 `config.json` 里的对应 `api_key` 即可运行。
