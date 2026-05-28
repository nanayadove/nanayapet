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
  getCharacterList: () => ipcRenderer.invoke('character:list'),
  getActiveCharacter: () => ipcRenderer.invoke('character:get-active'),
  setActiveCharacter: (name) => ipcRenderer.invoke('character:set-active', name),
  saveCharacter: (name, data) => ipcRenderer.invoke('character:save', name, data),
  importCharacter: () => ipcRenderer.invoke('character:import'),
  exportCharacter: (format) => ipcRenderer.invoke('character:export', format || 'json'),

  getSessionList: () => ipcRenderer.invoke('session:list'),
  getActiveSession: () => ipcRenderer.invoke('session:get-active'),
  createSession: () => ipcRenderer.invoke('session:create'),
  createSessionForCharacter: (charName) => ipcRenderer.invoke('session:create-for-character', charName),
  switchSession: (id) => ipcRenderer.invoke('session:switch', id),
  deleteSession: (id) => ipcRenderer.invoke('session:delete', id),

  queryKnowledge: (options) => ipcRenderer.invoke('knowledge:list', options),
  createKnowledge: (item) => ipcRenderer.invoke('knowledge:create', item),
  updateKnowledge: (id, fields) => ipcRenderer.invoke('knowledge:update', id, fields),
  deleteKnowledge: (ids) => ipcRenderer.invoke('knowledge:delete', ids),
  getKnowledgeStats: () => ipcRenderer.invoke('knowledge:stats'),

  exportSession: (sessionId, options) => ipcRenderer.invoke('session:export', sessionId, options),
  exportKnowledge: (options) => ipcRenderer.invoke('knowledge:export', options),
})
