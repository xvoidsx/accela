// Accela main process — Electron browser shell
// Manages windows, tabs (WebContentsView), blackice adblocking, navigation.

const { app, BrowserWindow, WebContentsView, ipcMain, session, Menu, globalShortcut } = require('electron');
const path = require('path');
const { initBlackice } = require('./blackice/engine');

let mainWindow = null;
const tabs = new Map(); // tabId -> { view, url, title }
let activeTabId = null;
let tabCounter = 0;
let tiledTabIds = null; // [id1, id2] when tiling, null otherwise
let verticalTabs = false;

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


// !bangs — offline shortcuts (Helium-style)
const BANGS = {
  // navi / xvoidsx
  '!radio': 'https://xvoidsx.github.io/navi-radio',
  '!nl': 'https://neighborli.xyz',
  '!apps': 'https://xvoidsx.github.io/naviApps',
  '!wired': 'https://navi.xvoidsx.org',
  '!xvoidsx': 'https://xvoidsx.org',
  // general
  '!yt': 'https://www.youtube.com/results?search_query=%s',
  '!gh': 'https://github.com/search?q=%s',
  '!w': 'https://en.wikipedia.org/wiki/Special:Search?search=%s',
  '!so': 'https://stackoverflow.com/search?q=%s',
  '!mdn': 'https://developer.mozilla.org/en-US/search?q=%s',
  '!npm': 'https://www.npmjs.com/search?q=%s',
  '!pypi': 'https://pypi.org/search/?q=%s',
  '!arch': 'https://wiki.archlinux.org/index.php?search=%s',
  '!deb': 'https://packages.debian.org/search?keywords=%s',
  '!g': 'https://www.google.com/search?q=%s',
  '!ddg': 'https://duckduckgo.com/?q=%s',
  '!brave': 'https://search.brave.com/search?q=%s',
  '!sp': 'https://www.startpage.com/sp/search?query=%s',
  '!maps': 'https://www.openstreetmap.org/search?query=%s',
  '!osm': 'https://www.openstreetmap.org/search?query=%s',
  '!r': 'https://www.reddit.com/search?q=%s',
  '!hn': 'https://hn.algolia.com/?q=%s',
  '!lobsters': 'https://lobste.rs/search?q=%s',
};
function resolveBang(input) {
  const parts = input.trim().split(/\s+/);
  const bang = parts[0].toLowerCase();
  if (BANGS[bang]) {
    const query = parts.slice(1).join(' ');
    const tmpl = BANGS[bang];
    if (tmpl.includes('%s')) {
      return tmpl.replace('%s', encodeURIComponent(query));
    }
    return tmpl; // no query needed (e.g. !radio)
  }
  return null;
}

// Search engines
const SEARCH_ENGINES = {
  brave:   { name: 'Brave Search',  url: 'https://search.brave.com/search?q=%s' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  google:  { name: 'Google',        url: 'https://www.google.com/search?q=%s' },
  bing:    { name: 'Bing',          url: 'https://www.bing.com/search?q=%s' },
  startpage: { name: 'Startpage',   url: 'https://www.startpage.com/sp/search?query=%s' },
  mojeek:  { name: 'Mojeek',        url: 'https://www.mojeek.com/search?q=%s' },
  searxng: { name: 'SearXNG',       url: 'https://search.inetol.net/search?q=%s' },
};
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
function loadSettings() {
  try {
    if (fs.existsSync(settingsPath)) return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  } catch {}
  return { searchEngine: 'brave' };
}
function saveSettings(s) {
  try { fs.writeFileSync(settingsPath, JSON.stringify(s, null, 2)); } catch {}
}
function searchUrl(query) {
  const s = loadSettings();
  const engine = SEARCH_ENGINES[s.searchEngine] || SEARCH_ENGINES.brave;
  return engine.url.replace('%s', encodeURIComponent(query));
}

function createWindow() {
  verticalTabs = !!loadSettings().verticalTabs;
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    icon: path.join(__dirname, 'icons', 'icon.png'),
    title: 'Accela',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: url === 'accela://settings'
        ? path.join(__dirname, 'settings-preload.js')
        : path.join(__dirname, 'preload.js'),
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
      mainWindow.focus();
      mainWindow.webContents.focus();
      setTimeout(() => {
        if (!mainWindow.isDestroyed()) mainWindow.webContents.send('focus-address-bar');
      }, 100);
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
      preload: url === 'accela://settings'
        ? path.join(__dirname, 'settings-preload.js')
        : path.join(__dirname, 'preload.js'),
      // Explicit font defaults — generic families (monospace, etc.) must resolve
      // or sites falling back from webfonts render invisible text
      defaultFontFamily: {
        standard: 'Noto Sans',
        serif: 'Noto Serif',
        sansSerif: 'Noto Sans',
        monospace: 'JetBrains Mono',
        cursive: 'Noto Sans',
        fantasy: 'Noto Sans',
      },
      defaultFontSize: 16,
      defaultMonospaceFontSize: 13,
    },
  });
  // Right-click context menu (Chrome-like)
  view.webContents.on('context-menu', (event, params) => {
    const menu = Menu.buildFromTemplate([
      ...(params.linkURL ? [
        { label: 'Open link in new tab', click: () => createTab(params.linkURL) },
        { label: 'Copy link address', click: () => { require('electron').clipboard.writeText(params.linkURL); } },
        { type: 'separator' },
      ] : []),
      ...(params.hasImageContents ? [
        { label: 'Copy image address', click: () => { require('electron').clipboard.writeText(params.srcURL); } },
        { type: 'separator' },
      ] : []),
      ...(params.selectionText ? [
        { label: `Search for "${params.selectionText.slice(0, 30)}"`, click: () => createTab(searchUrl(params.selectionText)) },
        { label: 'Copy', role: 'copy' },
        { type: 'separator' },
      ] : []),
      { label: 'Back', click: () => { const t = tabs.get(activeTabId); if (t && t.view.webContents.canGoBack()) t.view.webContents.goBack(); } },
      { label: 'Forward', click: () => { const t = tabs.get(activeTabId); if (t && t.view.webContents.canGoForward()) t.view.webContents.goForward(); } },
      { label: 'Reload', click: () => { const t = tabs.get(activeTabId); if (t) t.view.webContents.reload(); } },
      { type: 'separator' },
      { label: 'Inspect', click: () => { const t = tabs.get(activeTabId); if (t) t.view.webContents.inspectElement(params.x, params.y); } },
    ]);
    menu.popup();
  });

  // Neon pink scrollbar in page content
  view.webContents.on('dom-ready', () => {
    view.webContents.insertCSS(`
      ::-webkit-scrollbar { width: 10px; height: 10px; }
      ::-webkit-scrollbar-track { background: #0d0d14; }
      ::-webkit-scrollbar-thumb {
        background: linear-gradient(180deg, #ff2d95, #ff71ce) !important;
        border-radius: 8px !important;
        border: 2px solid #0d0d14 !important;
      }
      ::-webkit-scrollbar-thumb:hover { background: #ff2d95 !important; }
    `).catch(() => {});
  });

  // Masquerade as Chrome for site compatibility
  view.webContents.setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.8059.12 Safari/537.36");

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
  view.webContents.on('did-start-loading', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('page-loading', true);
  });
  view.webContents.on('did-stop-loading', () => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('page-loading', false);
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
  if (accelaUrl === 'accela://settings') {
    view.webContents.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
    return;
  }
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
  // If tiling, keep tiled views visible; otherwise hide all except active
  if (tiledTabIds && tiledTabIds.includes(tabId)) {
    // Switching within tiled views — keep both visible
    activeTabId = tabId;
  } else {
    // Exit tiling when switching to non-tiled tab
    tiledTabIds = null;
    for (const [, tab] of tabs) {
      tab.view.setVisible(false);
    }
    t.view.setVisible(true);
    activeTabId = tabId;
  }
  layoutViews();
  sendToChrome('tab-activated', { tabId, url: t.url, title: t.title });
  sendToChrome('tiling-changed', { tiled: !!tiledTabIds, tabs: tiledTabIds });
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
  const chromeWidth = verticalTabs ? 220 : 0; // vertical tab strip width
  const chromeTop = verticalTabs ? 48 : CHROME_HEIGHT; // toolbar height when vertical
  const availWidth = bounds.width - chromeWidth;
  const availHeight = Math.max(0, bounds.height - chromeTop);

  if (tiledTabIds && tiledTabIds.length === 2) {
    // Tiling: two views side by side
    const [id1, id2] = tiledTabIds;
    const t1 = tabs.get(id1), t2 = tabs.get(id2);
    const halfW = Math.floor(availWidth / 2);
    if (t1) {
      t1.view.setVisible(true);
      t1.view.setBounds({ x: chromeWidth, y: chromeTop, width: halfW, height: availHeight });
    }
    if (t2) {
      t2.view.setVisible(true);
      t2.view.setBounds({ x: chromeWidth + halfW, y: chromeTop, width: availWidth - halfW, height: availHeight });
    }
    // Hide others
    for (const [id, t] of tabs) {
      if (id !== id1 && id !== id2) t.view.setVisible(false);
    }
  } else {
    // Normal: single active view
    for (const [id, t] of tabs) {
      const visible = id === activeTabId;
      t.view.setVisible(visible);
      if (visible) {
        t.view.setBounds({ x: chromeWidth, y: chromeTop, width: availWidth, height: availHeight });
      }
    }
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
ipcMain.handle('tile-tabs', (e, { leftId, rightId }) => {
  if (tabs.has(leftId) && tabs.has(rightId) && leftId !== rightId) {
    tiledTabIds = [leftId, rightId];
    activeTabId = leftId;
    layoutViews();
    sendToChrome('tiling-changed', { tiled: true, tabs: tiledTabIds });
  }
});
ipcMain.handle('untile-tabs', () => {
  tiledTabIds = null;
  layoutViews();
  if (activeTabId) setActiveTab(activeTabId);
  sendToChrome('tiling-changed', { tiled: false, tabs: null });
});
ipcMain.handle('toggle-vertical-tabs', () => {
  verticalTabs = !verticalTabs;
  layoutViews();
  const s = loadSettings();
  s.verticalTabs = verticalTabs;
  saveSettings(s);
  return verticalTabs;
});
ipcMain.handle('get-vertical-tabs', () => verticalTabs);
ipcMain.handle('open-settings', () => { createTab('accela://settings'); });
ipcMain.handle('show-blackice-menu', () => {
  const { getStats } = require('./blackice/engine');
  const stats = getStats();
  const menu = Menu.buildFromTemplate([
    { label: `blackice — ${stats.blockedCount} blocked this session`, enabled: false },
    { type: 'separator' },
    { label: 'Open settings', click: () => createTab('accela://settings') },
  ]);
  menu.popup({ window: mainWindow });
});
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
      target = resolveBang(target) || searchUrl(target);
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
ipcMain.handle('get-settings', () => ({ ...loadSettings(), engines: SEARCH_ENGINES }));
ipcMain.handle('set-search-engine', (e, id) => {
  const s = loadSettings();
  if (SEARCH_ENGINES[id]) { s.searchEngine = id; saveSettings(s); }
  return s;
});
ipcMain.handle('get-site-info', () => {
  const t = tabs.get(activeTabId);
  if (!t) return null;
  try {
    const u = new URL(t.url);
    return {
      url: t.url,
      host: u.host,
      protocol: u.protocol,
      secure: u.protocol === 'https:',
      title: t.title,
    };
  } catch { return { url: t.url, secure: false }; }
});
ipcMain.handle('show-tab-menu', (e, { tabId, x, y }) => {
  const t = tabs.get(tabId);
  if (!t) return;
  const menu = Menu.buildFromTemplate([
    { label: 'Reload', click: () => t.view.webContents.reload() },
    { label: 'Duplicate', click: () => createTab(t.url) },
    { type: 'separator' },
    { label: 'Tile with next tab', click: async () => {
      const ids = [...tabs.keys()];
      const idx = ids.indexOf(tabId);
      if (idx >= 0 && idx + 1 < ids.length) {
        const { tileTabs } = require('./main.js');
      }
      // Use existing tile-tabs handler
      const nextId = ids[(idx + 1) % ids.length];
      if (nextId !== tabId) {
        // Call via IPC
        tiledTabIds = [tabId, nextId];
        activeTabId = tabId;
        layoutViews();
        sendToChrome('tiling-changed', { tiled: true, tabs: tiledTabIds });
      }
    }},
    { label: verticalTabs ? 'Use horizontal tabs' : 'Use vertical tabs', click: () => {
      verticalTabs = !verticalTabs;
      const s = loadSettings(); s.verticalTabs = verticalTabs; saveSettings(s);
      layoutViews();
      sendToChrome('vertical-changed', verticalTabs);
    }},
    { type: 'separator' },
    { label: 'Close tab', click: () => closeTab(tabId) },
    { label: 'Close other tabs', click: () => {
      for (const [id] of [...tabs]) if (id !== tabId) closeTab(id);
    }},
    { label: 'Close tabs to the right', click: () => {
      const ids = [...tabs.keys()];
      const idx = ids.indexOf(tabId);
      for (let i = idx + 1; i < ids.length; i++) closeTab(ids[i]);
    }},
  ]);
  menu.popup({ window: mainWindow, x, y });
});
ipcMain.handle('reorder-tab', (e, { fromId, toId }) => {
  // Reorder tabs map by rebuilding in new order
  const entries = [...tabs.entries()];
  const fromIdx = entries.findIndex(([id]) => id === fromId);
  const toIdx = entries.findIndex(([id]) => id === toId);
  if (fromIdx >= 0 && toIdx >= 0) {
    const [moved] = entries.splice(fromIdx, 1);
    entries.splice(toIdx, 0, moved);
    tabs.clear();
    for (const [id, t] of entries) tabs.set(id, t);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('tabs-changed', [...tabs.entries()].map(([id, t]) => ({ id, url: t.url, title: t.title, active: id === activeTabId })));
    }
  }
});
ipcMain.handle('get-tabs', () => {
  return [...tabs.entries()].map(([id, t]) => ({ id: id, url: t.url, title: t.title, active: id === activeTabId }));
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
