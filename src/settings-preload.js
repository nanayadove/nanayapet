const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('api', {
  getConfig: () => ipcRenderer.invoke('config:get'),
  saveConfig: (config) => ipcRenderer.invoke('config:save', config),
  getModels: (baseUrl, apiKey) => ipcRenderer.invoke('llm:models', baseUrl, apiKey),
})
