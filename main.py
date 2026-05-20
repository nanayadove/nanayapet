import sys
import os
import json
from PyQt5.QtWidgets import QApplication, QLabel, QWidget, QLineEdit, QVBoxLayout, QHBoxLayout, QPushButton
from PyQt5.QtGui import QPixmap, QFont
from PyQt5.QtCore import Qt, QPoint, QThread, pyqtSignal
from openai import OpenAI

from utils import get_current_time_info
from settings_ui import SettingsWindow
from utils import get_current_time_info
from settings_ui import SettingsWindow
from db import init_db, save_message, load_context_for_llm, get_unsummarized_count, get_unsummarized_messages

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')

# 1. 启动时初始化数据库
init_db()

class LLMWorker(QThread):
    finished = pyqtSignal(str, str) 
    error = pyqtSignal(str)         

    def __init__(self, user_text):
        super().__init__()
        self.user_text = user_text

    def run(self):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                config = json.load(f)
        except Exception as e:
            self.error.emit("读取配置失败，请检查设置。")
            return

        api_config = config.get('api_settings', {})
        char_config = config.get('character_settings', {})
        
        provider_name = api_config.get('provider', 'deepseek')
        current_provider = api_config.get('providers', {}).get(provider_name, {})
        
        api_key = current_provider.get('api_key', '')
        base_url = current_provider.get('base_url', '')
        model_name = current_provider.get('model', '')

        if not api_key or not base_url:
            self.error.emit("API 未配置，请点击设置按钮配置！")
            return

        client = OpenAI(api_key=api_key, base_url=base_url)

        # 2. 动态获取 System Prompt 和最大历史长度
        system_prompt = char_config.get('system_prompt', '')
        summary_interval = api_config.get("summary_interval", 5)
        # 确保加载的数量大于等于总结间隔所需的消息数
        max_len = max(api_config.get("max_history_length", 10), summary_interval * 2)

        time_info = get_current_time_info()
        context_aware_input = f"[系统当前状态: {time_info}]\n用户说: {self.user_text}"
        
        # 3. 保存用户的输入到数据库
        save_message("user", context_aware_input)
        
        # 4. 从数据库完全构建这一次对话的上下文（无状态设计）
        chat_history = [{"role": "system", "content": system_prompt}]
        chat_history.extend(load_context_for_llm(max_len))
        
        try:
            response = client.chat.completions.create(
                model=model_name,
                messages=chat_history,
                response_format={"type": "json_object"},
                temperature=api_config.get("temperature", 0.7)
            )
            
            answer_text = response.choices[0].message.content
            
            # 5. 保存 AI 的回复到数据库
            save_message("assistant", answer_text)
            
            # 6. 立刻把结果发送给界面（界面更新不会被后面的总结阻塞）
            try:
                pet_response = json.loads(answer_text)
                reply = pet_response.get("reply", "呃...")
                emotion = pet_response.get("emotion", "idle")
                self.finished.emit(reply, emotion)
            except json.JSONDecodeError:
                import re
                match = re.search(r'\{[\s\S]*\}', answer_text)
                if match:
                    try:
                        pet_response = json.loads(match.group(0))
                        self.finished.emit(pet_response.get("reply", "呃..."), pet_response.get("emotion", "idle"))
                    except: pass
                else:
                    self.error.emit(f"JSON 解析失败: {answer_text}")

            # 7. 后台检查：如果超过总结间隔，发起一个请求进行压缩
            unsummarized_count = get_unsummarized_count()
            if unsummarized_count >= summary_interval * 2:
                unsummarized_msgs = get_unsummarized_messages()
                
                summary_prompt = "请以第三人称客观视角（使用“用户”和“AI”/“桌宠”作为主语）将以下对话总结为一段简短的背景记忆，保留核心事件、双方的状态和情感态度，字数不超过200字。直接输出总结文本即可：\n\n"
                for msg in unsummarized_msgs:
                    role_str = "用户" if msg['role'] == "user" else "你"
                    summary_prompt += f"{role_str}: {msg['content']}\n"
                    
                try:
                    summary_provider_name = api_config.get("summary_provider", "")
                    if summary_provider_name and summary_provider_name != "同对话服务商":
                        sum_prov_cfg = api_config.get("providers", {}).get(summary_provider_name, {})
                        s_api_key = sum_prov_cfg.get("api_key", api_key)
                        s_base_url = sum_prov_cfg.get("base_url", base_url)
                        s_model = sum_prov_cfg.get("model", model_name)
                    else:
                        s_api_key, s_base_url, s_model = api_key, base_url, model_name
                    
                    s_client = OpenAI(api_key=s_api_key, base_url=s_base_url)
                    
                    summary_res = s_client.chat.completions.create(
                        model=s_model,
                        messages=[{"role": "system", "content": "你是一个对话总结助手。"},
                                  {"role": "user", "content": summary_prompt}],
                        temperature=0.5
                    )
                    summary_text = summary_res.choices[0].message.content.strip()
                    save_message("summary", summary_text)
                except Exception as e:
                    print(f"后台总结记忆失败: {str(e)}")

        except Exception as e:
            self.error.emit(f"API 请求失败: {str(e)}")


class DesktopPet(QWidget):
    def __init__(self):
        super().__init__()
        
        self.setWindowFlags(Qt.FramelessWindowHint | Qt.WindowStaysOnTopHint | Qt.SubWindow)
        self.setAttribute(Qt.WA_TranslucentBackground)

        main_layout = QVBoxLayout(self)
        main_layout.setContentsMargins(0, 0, 0, 0)
        
        top_bar = QHBoxLayout()
        top_bar.addStretch(1) 
        
        settings_btn = QPushButton("⚙️", self)
        settings_btn.setFixedSize(30, 30)
        settings_btn.setStyleSheet("""
            QPushButton {
                background-color: rgba(100, 100, 100, 200);
                color: white;
                border-radius: 15px;
            }
            QPushButton:hover { background-color: rgba(150, 150, 150, 255); }
        """)
        settings_btn.clicked.connect(self.open_settings)
        top_bar.addWidget(settings_btn)

        close_btn = QPushButton("×", self)
        close_btn.setFixedSize(30, 30)
        close_btn.setStyleSheet("""
            QPushButton {
                background-color: rgba(255, 100, 100, 200);
                color: white;
                font-weight: bold;
                border-radius: 15px;
            }
            QPushButton:hover { background-color: rgba(255, 50, 50, 255); }
        """)
        close_btn.clicked.connect(self.close)
        top_bar.addWidget(close_btn)
        
        main_layout.addLayout(top_bar)

        self.chat_bubble = QLabel("...正在加载系统...", self)
        self.chat_bubble.setStyleSheet("background-color: rgba(255, 255, 255, 200); border-radius: 10px; padding: 10px; color: black;")
        self.chat_bubble.setFont(QFont("Microsoft YaHei", 10))
        self.chat_bubble.setAlignment(Qt.AlignCenter)
        self.chat_bubble.setWordWrap(True)
        self.chat_bubble.hide()
        main_layout.addWidget(self.chat_bubble)

        self.image_label = QLabel(self)
        self.image_label.setScaledContents(False)
        self.image_label.setFixedSize(300, 440)
        self.image_label.setAlignment(Qt.AlignCenter)
        main_layout.addWidget(self.image_label, alignment=Qt.AlignCenter)

        self.input_field = QLineEdit(self)
        self.input_field.setStyleSheet("background-color: rgba(255, 255, 255, 230); border-radius: 5px; padding: 5px; color: black;")
        self.input_field.setPlaceholderText("在这里输入你想对它说的话... (按回车发送)")
        self.input_field.returnPressed.connect(self.send_message)
        main_layout.addWidget(self.input_field)

        self.current_emotion = "idle"
        self.update_image()
        self.drag_position = QPoint()
        self.show()
        
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                char_name = json.load(f).get('character_settings', {}).get('name', '七夜喵')
        except Exception:
            char_name = '七夜喵'
            
        self.show_bubble(f"只是一只{char_name}。")

    def open_settings(self):
        dialog = SettingsWindow(self)
        if dialog.exec_():
            self.show_bubble("配置已更新！")

    def update_image(self):
        base_dir = os.path.dirname(os.path.abspath(__file__))
        image_path = os.path.join(base_dir, "assets", f"{self.current_emotion}.png")
        pixmap = QPixmap(image_path)
        if not pixmap.isNull():
            scaled_pixmap = pixmap.scaled(300, 440, Qt.KeepAspectRatio, Qt.SmoothTransformation)
            self.image_label.setPixmap(scaled_pixmap)
        else:
            self.image_label.setText(f"【缺少素材: {self.current_emotion}.png】")

    def show_bubble(self, text):
        self.chat_bubble.setText(text)
        self.chat_bubble.show()

    def send_message(self):
        user_text = self.input_field.text().strip()
        if not user_text: return
        self.input_field.clear()
        self.show_bubble("...")
        self.worker = LLMWorker(user_text)
        self.worker.finished.connect(self.on_llm_replied)
        self.worker.error.connect(self.on_llm_error)
        self.worker.start()

    def on_llm_replied(self, reply, emotion):
        self.current_emotion = emotion
        self.update_image()
        self.show_bubble(reply)

    def on_llm_error(self, err_msg):
        self.show_bubble(f"故障:\n{err_msg}")
        self.current_emotion = "confused"
        self.update_image()

    def mousePressEvent(self, event):
        if event.button() == Qt.LeftButton:
            self.drag_position = event.globalPos() - self.frameGeometry().topLeft()
            event.accept()

    def mouseMoveEvent(self, event):
        if event.buttons() == Qt.LeftButton:
            self.move(event.globalPos() - self.drag_position)
            event.accept()

    def mouseReleaseEvent(self, event):
        if event.button() == Qt.RightButton:
            self.close()

if __name__ == '__main__':
    app = QApplication(sys.argv)
    pet = DesktopPet()
    sys.exit(app.exec_())
