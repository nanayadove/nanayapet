const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  sendMessage: (userText) => ipcRenderer.invoke('llm:send', userText),
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  getModels: (baseUrl, apiKey) => ipcRenderer.invoke('llm:models', baseUrl, apiKey),
  openSettings: () => ipcRenderer.invoke('settings:open'),
})
