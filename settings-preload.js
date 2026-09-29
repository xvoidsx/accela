const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('accelaSettings', {
  get: () => ipcRenderer.invoke('get-settings'),
  setEngine: (id) => ipcRenderer.invoke('set-search-engine', id),
  toggleVertical: () => ipcRenderer.invoke('toggle-vertical-tabs'),
});
