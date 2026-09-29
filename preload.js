const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('accela', {
  newTab: (url) => ipcRenderer.invoke('new-tab', url),
  closeTab: (tabId) => ipcRenderer.invoke('close-tab', tabId),
  switchTab: (tabId) => ipcRenderer.invoke('switch-tab', tabId),
  navigate: (tabId, url) => ipcRenderer.invoke('navigate', { tabId, url }),
  goBack: () => ipcRenderer.invoke('go-back'),
  goForward: () => ipcRenderer.invoke('go-forward'),
  reload: () => ipcRenderer.invoke('reload'),
  getTabs: () => ipcRenderer.invoke('get-tabs'),
  onTabCreated: (cb) => ipcRenderer.on('tab-created', (e, d) => cb(d)),
  onTabClosed: (cb) => ipcRenderer.on('tab-closed', (e, d) => cb(d)),
  onTabActivated: (cb) => ipcRenderer.on('tab-activated', (e, d) => cb(d)),
  onTabUpdated: (cb) => ipcRenderer.on('tab-updated', (e, d) => cb(d)),
  onFocusAddressBar: (cb) => ipcRenderer.on('focus-address-bar', () => cb()),
  getBookmarks: () => ipcRenderer.invoke('get-bookmarks'),
  addBookmark: (title, url) => ipcRenderer.invoke('add-bookmark', { title, url }),
  removeBookmark: (url) => ipcRenderer.invoke('remove-bookmark', url),
  toggleDevTools: () => ipcRenderer.invoke('toggle-devtools'),
  getSettings: () => ipcRenderer.invoke('get-settings'),
  setSearchEngine: (id) => ipcRenderer.invoke('set-search-engine', id),
  getSiteInfo: () => ipcRenderer.invoke('get-site-info'),
});
