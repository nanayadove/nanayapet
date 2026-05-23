// ===== settings-preload.js — 设置窗口的 IPC 桥接 =====
//
// 和 preload.js 类似，但是专门给设置窗口用的。
// 只暴露设置窗口需要的功能（读取/保存配置 + 获取模型列表）。
// 主窗口和设置窗口各自有独立的 preload 脚本，避免暴露不需要的功能。

const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  getModels: (baseUrl, apiKey) => ipcRenderer.invoke('llm:models', baseUrl, apiKey),
  hasEncryption: () => ipcRenderer.invoke('config:has-encryption'),
})
