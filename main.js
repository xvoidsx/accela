// Accela main process — Electron browser shell
// Manages windows, tabs (WebContentsView), blackice adblocking, navigation.

const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, globalShortcut } = require('electron');
const path = require('path');
const { initBlackice } = require('./blackice/engine');

let mainWindow = null;
const tabs = new Map(); // tabId -> { view, url, title }
let activeTabId = null;
let tabCounter = 0;

const CHROME_HEIGHT = 100; // tab strip + toolbar (measured)

// Bookmarks storage
const fs = require('fs');
const bookmarksPath = path.join(app.getPath('userData'), 'bookmarks.json');
function loadBookmarks() {
  try {
    if (fs.existsSync(bookmarksPath)) return JSON.parse(fs.readFileSync(bookmarksPath, 'utf8'));
  } catch {}
  return [];
}
function saveBookmarks(bm) {
  try { fs.writeFileSync(bookmarksPath, JSON.stringify(bm, null, 2)); } catch {}
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'icons', 'icon.png'),
    title: 'Accela',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    autoHideMenuBar: true,
    backgroundColor: '#000000',
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Initialize blackice adblocking on the default session
  initBlackice(session.defaultSession);

  // Create the first tab
  createTab('accela://newtab');

  // Application menu
  const menu = Menu.buildFromTemplate([
    { label: 'File', submenu: [
      { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: () => createTab('accela://newtab') },
      { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: () => { if (activeTabId) closeTab(activeTabId); } },
      { type: 'separator' },
      { label: 'Quit', accelerator: 'CmdOrCtrl+Q', click: () => app.quit() },
    ]},
    { label: 'View', submenu: [
      { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: () => { const t = tabs.get(activeTabId); if (t) t.view.webContents.reload(); } },
      { label: 'Toggle DevTools', accelerator: 'CmdOrCtrl+Shift+I', click: () => {
        const t = tabs.get(activeTabId);
        if (t) t.view.webContents.toggleDevTools();
      }},
      { type: 'separator' },
      { label: 'Zoom In', accelerator: 'CmdOrCtrl+Plus', click: () => {
        const t = tabs.get(activeTabId);
        if (t) t.view.webContents.setZoomLevel(t.view.webContents.getZoomLevel() + 0.5);
      }},
      { label: 'Zoom Out', accelerator: 'CmdOrCtrl+-', click: () => {
        const t = tabs.get(activeTabId);
        if (t) t.view.webContents.setZoomLevel(t.view.webContents.getZoomLevel() - 0.5);
      }},
      { label: 'Reset Zoom', accelerator: 'CmdOrCtrl+0', click: () => {
        const t = tabs.get(activeTabId);
        if (t) t.view.webContents.setZoomLevel(0);
      }},
    ]},
    { label: 'History', submenu: [
      { label: 'Back', accelerator: 'Alt+Left', click: () => {
        const t = tabs.get(activeTabId);
        if (t && t.view.webContents.canGoBack()) t.view.webContents.goBack();
      }},
      { label: 'Forward', accelerator: 'Alt+Right', click: () => {
        const t = tabs.get(activeTabId);
        if (t && t.view.webContents.canGoForward()) t.view.webContents.goForward();
      }},
    ]},
  ]);
  Menu.setApplicationMenu(menu);
  mainWindow.setMenuBarVisibility(false); // hidden, Alt shows it

  // Global shortcuts for address bar focus
  globalShortcut.register('CmdOrCtrl+L', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('focus-address-bar');
    }
  });

  // Layout on resize
  mainWindow.on('resize', layoutViews);
  mainWindow.on('closed', () => {
    globalShortcut.unregisterAll();
    mainWindow = null;
  });
}

function createTab(url) {
  const tabId = `tab-${++tabCounter}`;
  const view = new WebContentsView({
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Handle accela:// protocol internally
  view.webContents.on('will-navigate', (e, navUrl) => {
    if (navUrl.startsWith('accela://')) {
      e.preventDefault();
      loadAccelaPage(view, navUrl);
    }
  });

  view.webContents.on('did-navigate', (e, navUrl) => {
    const t = tabs.get(tabId);
    if (t) t.url = navUrl;
    sendToChrome('tab-updated', { tabId, url: navUrl });
  });
  view.webContents.on('page-title-updated', (e, title) => {
    const t = tabs.get(tabId);
    if (t) t.title = title;
    sendToChrome('tab-updated', { tabId, title });
  });
  view.webContents.on('did-finish-load', () => {
    sendToChrome('tab-updated', { tabId, canGoBack: view.webContents.canGoBack(), canGoForward: view.webContents.canGoForward() });
  });

  tabs.set(tabId, { view, url, title: 'New Tab' });
  mainWindow.contentView.addChildView(view);
  setActiveTab(tabId);

  if (url === 'accela://newtab') {
    loadAccelaPage(view, url);
  } else {
    view.webContents.loadURL(url);
  }

  layoutViews();
  sendToChrome('tab-created', { tabId, url });
  return tabId;
}

function loadAccelaPage(view, accelaUrl) {
  if (accelaUrl === 'accela://newtab') {
    view.webContents.loadFile(path.join(__dirname, 'renderer', 'newtab.html'));
  } else if (accelaUrl === 'accela://settings') {
    view.webContents.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  } else if (accelaUrl === 'accela://about') {
    view.webContents.loadFile(path.join(__dirname, 'renderer', 'about.html'));
  }
}

function setActiveTab(tabId) {
  const t = tabs.get(tabId);
  if (!t) return;
  // Hide all, show active
  for (const [, tab] of tabs) {
    tab.view.setVisible(false);
  }
  t.view.setVisible(true);
  activeTabId = tabId;
  layoutViews();
  sendToChrome('tab-activated', { tabId, url: t.url, title: t.title });
}

function closeTab(tabId) {
  const t = tabs.get(tabId);
  if (!t) return;
  mainWindow.contentView.removeChildView(t.view);
  t.view.webContents.close();
  tabs.delete(tabId);
  sendToChrome('tab-closed', { tabId });
  if (activeTabId === tabId) {
    const remaining = [...tabs.keys()];
    if (remaining.length > 0) {
      setActiveTab(remaining[remaining.length - 1]);
    } else {
      createTab('accela://newtab');
    }
  }
  layoutViews();
}

function layoutViews() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  const bounds = mainWindow.getContentBounds();
  const height = Math.max(0, bounds.height - CHROME_HEIGHT);
  for (const [, t] of tabs) {
    t.view.setBounds({ x: 0, y: CHROME_HEIGHT, width: bounds.width, height });
  }
}

function sendToChrome(channel, data) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

// IPC from renderer (browser chrome UI)
ipcMain.handle('new-tab', (e, url) => createTab(url || 'accela://newtab'));
ipcMain.handle('close-tab', (e, tabId) => closeTab(tabId));
ipcMain.handle('switch-tab', (e, tabId) => setActiveTab(tabId));
ipcMain.handle('navigate', (e, { tabId, url }) => {
  const t = tabs.get(tabId || activeTabId);
  if (!t) return;
  let target = url.trim();
  if (target.startsWith('accela://')) {
    loadAccelaPage(t.view, target);
    return;
  }
  // Smart URL handling: domain-like -> https, else search
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(target)) {
    if (/^[\w-]+(\.[\w-]+)+/.test(target)) {
      target = 'https://' + target;
    } else {
      target = 'https://search.brave.com/search?q=' + encodeURIComponent(target);
    }
  }
  t.view.webContents.loadURL(target);
});
ipcMain.handle('go-back', () => {
  const t = tabs.get(activeTabId);
  if (t && t.view.webContents.canGoBack()) t.view.webContents.goBack();
});
ipcMain.handle('go-forward', () => {
  const t = tabs.get(activeTabId);
  if (t && t.view.webContents.canGoForward()) t.view.webContents.goForward();
});
ipcMain.handle('reload', () => {
  const t = tabs.get(activeTabId);
  if (t) t.view.webContents.reload();
});
ipcMain.handle('get-bookmarks', () => loadBookmarks());
ipcMain.handle('add-bookmark', (e, { title, url }) => {
  const bm = loadBookmarks();
  if (!bm.find(b => b.url === url)) {
    bm.push({ title, url, added: Date.now() });
    saveBookmarks(bm);
  }
  return bm;
});
ipcMain.handle('remove-bookmark', (e, url) => {
  const bm = loadBookmarks().filter(b => b.url !== url);
  saveBookmarks(bm);
  return bm;
});
ipcMain.handle('toggle-devtools', () => {
  const t = tabs.get(activeTabId);
  if (t) t.view.webContents.toggleDevTools();
});
ipcMain.handle('get-tabs', () => {
  return [...tabs.entries()].map(([id, t]) => ({ tabId: id, url: t.url, title: t.title, active: id === activeTabId }));
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Keep views laid out on resize
app.on('browser-window-created', (e, win) => {
  win.on('resize', layoutViews);
});
