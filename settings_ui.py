import json
import os
import requests
from PyQt5.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QLabel, 
                             QLineEdit, QComboBox, QPushButton, QMessageBox, QGroupBox, QFormLayout, QApplication, QSpinBox)
from PyQt5.QtCore import Qt

CONFIG_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'config.json')

class SettingsWindow(QDialog):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.setWindowTitle("API 与模型设置")
        self.setFixedSize(450, 400)
        
        # 保证设置窗口在宠物层之上
        self.setWindowFlags(self.windowFlags() | Qt.WindowStaysOnTopHint)
        
        self.config = self.load_config()
        self.init_ui()

    def load_config(self):
        try:
            with open(CONFIG_PATH, 'r', encoding='utf-8') as f:
                return json.load(f)
        except Exception:
            return {"api_settings": {"providers": {}}}

    def save_config(self):
        with open(CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(self.config, f, indent=2, ensure_ascii=False)

    def init_ui(self):
        layout = QVBoxLayout(self)

        # 1. 选择服务商 (Provider)
        prov_layout = QHBoxLayout()
        prov_layout.addWidget(QLabel("服务商 (Provider):"))
        self.prov_combo = QComboBox()
        self.prov_combo.addItems(["deepseek", "openai", "gemini", "custom_openai"])
        prov_layout.addWidget(self.prov_combo)
        layout.addLayout(prov_layout)

        # 2. API 配置组
        group = QGroupBox("API 接口配置")
        form = QFormLayout()
        
        self.base_url_input = QLineEdit()
        self.base_url_input.setPlaceholderText("例如: https://api.deepseek.com/v1")
        form.addRow("Base URL:", self.base_url_input)
        
        self.api_key_input = QLineEdit()
        self.api_key_input.setEchoMode(QLineEdit.Password)
        self.api_key_input.setPlaceholderText("输入你的 API Key (sk-...)")
        form.addRow("API Key:", self.api_key_input)
        
        self.summary_interval_input = QSpinBox()
        self.summary_interval_input.setRange(1, 50)
        self.summary_interval_input.setToolTip("每隔多少个回答将前面对话总结成一段记忆(1代表来回2条消息算1次)")
        form.addRow("记忆总结间隔(轮):", self.summary_interval_input)
        
        group.setLayout(form)
        layout.addWidget(group)

        # 3. 测试与模型获取
        test_layout = QHBoxLayout()
        self.test_btn = QPushButton("连接并获取模型")
        self.test_btn.setStyleSheet("background-color: #4CAF50; color: white; font-weight: bold;")
        self.test_btn.clicked.connect(self.test_connection)
        test_layout.addWidget(self.test_btn)
        layout.addLayout(test_layout)

        # 4. 模型选择
        model_layout = QHBoxLayout()
        model_layout.addWidget(QLabel("当前选择的模型:"))
        self.model_combo = QComboBox()
        self.model_combo.setEditable(True) # 允许手动输入
        self.model_combo.setToolTip("选择获取到的模型，或者手动输入模型名称")
        model_layout.addWidget(self.model_combo)
        layout.addLayout(model_layout)

        layout.addStretch(1)

        # 5. 底部按钮
        btn_layout = QHBoxLayout()
        save_btn = QPushButton("保存配置")
        save_btn.clicked.connect(self.save_and_close)
        cancel_btn = QPushButton("取消")
        cancel_btn.clicked.connect(self.reject)
        btn_layout.addWidget(save_btn)
        btn_layout.addWidget(cancel_btn)
        layout.addLayout(btn_layout)

        # 初始化数据回填
        self.prov_combo.currentTextChanged.connect(self.on_provider_changed)
        current_prov = self.config.get("api_settings", {}).get("provider", "deepseek")
        if current_prov not in ["deepseek", "openai", "gemini", "custom_openai"]:
            self.prov_combo.addItem(current_prov)
        self.prov_combo.setCurrentText(current_prov)
        self.on_provider_changed(current_prov)

    def on_provider_changed(self, prov_name):
        prov_data = self.config.get("api_settings", {}).get("providers", {}).get(prov_name, {})
        self.base_url_input.setText(prov_data.get("base_url", ""))
        self.api_key_input.setText(prov_data.get("api_key", ""))
        self.summary_interval_input.setValue(self.config.get("api_settings", {}).get("summary_interval", 5))
        
        self.model_combo.clear()
        saved_model = prov_data.get("model", "")
        if saved_model:
            self.model_combo.addItem(saved_model)
            self.model_combo.setCurrentText(saved_model)

    def test_connection(self):
        base_url = self.base_url_input.text().strip()
        api_key = self.api_key_input.text().strip()
        
        if not base_url or not api_key:
            QMessageBox.warning(self, "错误", "请先填写 Base URL 和 API Key")
            return
            
        self.test_btn.setText("测试中...")
        self.test_btn.setEnabled(False)
        QApplication.processEvents()

        try:
            # 尝试通过标准 OpenAI 格式的 /models 接口获取模型列表
            headers = {"Authorization": f"Bearer {api_key}"}
            models_url = f"{base_url}/models"
            
            res = requests.get(models_url, headers=headers, timeout=10)
            res.raise_for_status()
            data = res.json()
            
            models = []
            if "data" in data:
                models = [m["id"] for m in data["data"] if "id" in m]
            
            if models:
                current_text = self.model_combo.currentText()
                self.model_combo.clear()
                self.model_combo.addItems(models)
                # 尽量恢复之前的选择
                if current_text in models:
                    self.model_combo.setCurrentText(current_text)
                elif models:
                    self.model_combo.setCurrentIndex(0)
                QMessageBox.information(self, "成功", f"连接成功！获取到 {len(models)} 个可用模型，请在下拉框中选择。")
            else:
                QMessageBox.information(self, "成功", "连接成功！但未能解析到模型列表，你可以直接在下拉框中手动输入模型名称。")
                
        except Exception as e:
            QMessageBox.critical(self, "失败", f"连接或获取模型列表失败，请检查 URL 和 Key 是否正确:\n{str(e)}")
        
        self.test_btn.setText("连接并获取模型")
        self.test_btn.setEnabled(True)

    def save_and_close(self):
        prov_name = self.prov_combo.currentText()
        if "api_settings" not in self.config:
            self.config["api_settings"] = {"providers": {}}
            
        self.config["api_settings"]["provider"] = prov_name
        if prov_name not in self.config["api_settings"]["providers"]:
            self.config["api_settings"]["providers"][prov_name] = {}
            
        self.config["api_settings"]["providers"][prov_name]["base_url"] = self.base_url_input.text().strip()
        self.config["api_settings"]["providers"][prov_name]["api_key"] = self.api_key_input.text().strip()
        self.config["api_settings"]["providers"][prov_name]["model"] = self.model_combo.currentText().strip()
        self.config["api_settings"]["summary_interval"] = self.summary_interval_input.value()
        
        self.save_config()
        self.accept()
