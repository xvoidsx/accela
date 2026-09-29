// Accela renderer — browser chrome logic (tabs, navigation)
let tabs = new Map();
let activeTabId = null;

const $ = id => document.getElementById(id);
const tabsEl = $('tabs');
const addrBar = $('address-bar');

function renderTabs() {
  tabsEl.innerHTML = '';
  for (const [id, t] of tabs) {
    const el = document.createElement('div');
    el.className = 'tab' + (id === activeTabId ? ' active' : '');
    el.innerHTML = `<span class="tab-title">${escapeHtml(t.title || 'New Tab')}</span><button class="tab-close"><svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button>`;
    el.querySelector('.tab-title').parentElement.addEventListener('click', (e) => {
      if (e.target.classList.contains('tab-close')) return;
      window.accela.switchTab(id);
    });
    el.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      window.accela.closeTab(id);
    });
    tabsEl.appendChild(el);
  }
  // Update address bar to active tab URL
  const active = tabs.get(activeTabId);
  if (active && document.activeElement !== addrBar) {
    addrBar.value = active.url === 'accela://newtab' ? '' : (active.url || '');
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function navigateFromBar() {
  const url = addrBar.value.trim();
  if (!url) return;
  window.accela.navigate(activeTabId, url);
  addrBar.blur();
}

// Events
$('new-tab-btn').addEventListener('click', () => window.accela.newTab());
$('back-btn').addEventListener('click', () => window.accela.goBack());
$('forward-btn').addEventListener('click', () => window.accela.goForward());
$('reload-btn').addEventListener('click', () => window.accela.reload());
$('go-btn').addEventListener('click', navigateFromBar);
addrBar.addEventListener('keydown', (e) => { if (e.key === 'Enter') navigateFromBar(); });
addrBar.addEventListener('focus', () => addrBar.select());

// IPC
window.accela.onTabCreated(({ tabId, url }) => {
  tabs.set(tabId, { url, title: 'New Tab' });
  renderTabs();
});
window.accela.onTabClosed(({ tabId }) => {
  tabs.delete(tabId);
  renderTabs();
});
window.accela.onTabActivated(({ tabId, url, title }) => {
  setTimeout(renderBookmarks, 100);
  activeTabId = tabId;
  if (!tabs.has(tabId)) tabs.set(tabId, {});
  Object.assign(tabs.get(tabId), { url, title });
  renderTabs();
});
window.accela.onTabUpdated(({ tabId, url, title, canGoBack, canGoForward }) => {
  if (!tabs.has(tabId)) tabs.set(tabId, {});
  const t = tabs.get(tabId);
  if (url !== undefined) t.url = url;
  if (title !== undefined) t.title = title;
  if (tabId === activeTabId) {
    if (canGoBack !== undefined) $('back-btn').disabled = !canGoBack;
    if (canGoForward !== undefined) $('forward-btn').disabled = !canGoForward;
  }
  renderTabs();
});

window.accela.onFocusAddressBar(() => {
  addrBar.focus();
  addrBar.select();
});


// Bookmarks
async function renderBookmarks() {
  const bm = await window.accela.getBookmarks();
  const bar = document.getElementById('bookmark-bar');
  bar.innerHTML = '';
  bm.forEach(b => {
    const el = document.createElement('button');
    el.className = 'bookmark';
    el.textContent = b.title || b.url;
    el.title = b.url;
    el.addEventListener('click', () => window.accela.navigate(activeTabId, b.url));
    el.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      if (confirm(`Remove bookmark "${b.title}"?`)) {
        await window.accela.removeBookmark(b.url);
        renderBookmarks();
      }
    });
    bar.appendChild(el);
  });
  // Update star
  const active = tabs.get(activeTabId);
  const star = document.getElementById('bookmark-btn');
  if (active && bm.find(b => b.url === active.url)) {
    star.classList.add('bookmarked');
    star.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="#ffd700"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
  } else {
    star.classList.remove('bookmarked');
    star.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z"/></svg>';
  }
}

document.getElementById('bookmark-btn').addEventListener('click', async () => {
  const active = tabs.get(activeTabId);
  if (!active || !active.url || active.url.startsWith('accela://')) return;
  const bm = await window.accela.getBookmarks();
  if (bm.find(b => b.url === active.url)) {
    await window.accela.removeBookmark(active.url);
  } else {
    await window.accela.addBookmark(active.title || active.url, active.url);
  }
  renderBookmarks();
});


// Site info popup
const siteInfoBtn = document.getElementById('site-info-btn');
const siteInfoPopup = document.getElementById('site-info-popup');
siteInfoBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  const info = await window.accela.getSiteInfo();
  if (!info) return;
  const lockSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="vertical-align:-2px"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/></svg>';
  const warnSvg = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="vertical-align:-2px"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';
  const secureIcon = info.secure ? `<span class="secure-yes">${lockSvg} Secure</span>` : `<span class="secure-no">${warnSvg} Not secure</span>`;
  siteInfoPopup.innerHTML = `
    <h3>Site information</h3>
    <div class="row"><span class="label">Status</span><span>${secureIcon}</span></div>
    <div class="row"><span class="label">Host</span><span class="value">${escapeHtml(info.host || '')}</span></div>
    <div class="row"><span class="label">Protocol</span><span class="value">${escapeHtml(info.protocol || '')}</span></div>
    <div class="row"><span class="label">Title</span><span class="value">${escapeHtml(info.title || '')}</span></div>
  `;
  siteInfoPopup.style.display = siteInfoPopup.style.display === 'none' ? 'block' : 'none';
  document.getElementById('settings-popup').style.display = 'none';
  // Update lock icon (SVG)
  siteInfoBtn.innerHTML = info.secure ? lockSvg.replace('width="14" height="14"', 'width="16" height="16"') : warnSvg.replace('width="14" height="14"', 'width="16" height="16"');
  siteInfoBtn.classList.toggle('insecure', !info.secure);
});

// Settings popup (search engine)
const settingsBtn = document.getElementById('settings-btn');
const settingsPopup = document.getElementById('settings-popup');
settingsBtn.addEventListener('click', async (e) => {
  e.stopPropagation();
  const { searchEngine, engines } = await window.accela.getSettings();
  let options = '';
  for (const [id, eng] of Object.entries(engines)) {
    options += `<option value="${id}"${id === searchEngine ? ' selected' : ''}>${escapeHtml(eng.name)}</option>`;
  }
  settingsPopup.innerHTML = `
    <h3>Settings</h3>
    <div class="row"><span class="label">Search engine</span></div>
    <select id="search-engine-select">${options}</select>
  `;
  settingsPopup.style.display = settingsPopup.style.display === 'none' ? 'block' : 'none';
  siteInfoPopup.style.display = 'none';
  document.getElementById('search-engine-select').addEventListener('change', async (ev) => {
    await window.accela.setSearchEngine(ev.target.value);
  });
});

// Close popups on outside click
document.addEventListener('click', (e) => {
  if (!siteInfoPopup.contains(e.target) && !siteInfoBtn.contains(e.target)) siteInfoPopup.style.display = 'none';
  if (!settingsPopup.contains(e.target) && !settingsBtn.contains(e.target)) settingsPopup.style.display = 'none';
});

// Update site info icon on tab change
const origRender = renderTabs;
renderTabs = async function() {
  origRender();
  const info = await window.accela.getSiteInfo().catch(() => null);
  if (info) {
    const lSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2z"/></svg>';
    const wSvg = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>';
    siteInfoBtn.innerHTML = info.secure ? lSvg : wSvg;
    siteInfoBtn.classList.toggle('insecure', !info.secure);
    siteInfoBtn.title = info.secure ? `Secure connection to ${info.host}` : `Not secure — ${info.host || info.url}`;
  }
};


// Reload animation
window.accela.onPageLoading((loading) => {
  document.getElementById('reload-btn').classList.toggle('loading', loading);
});


// Middle-click closes tab
document.getElementById('tabs').addEventListener('mousedown', (e) => {
  const tabEl = e.target.closest('.tab');
  if (tabEl && e.button === 1) {
    e.preventDefault();
    window.accela.closeTab(tabEl.dataset.id);
  }
});

// Tab right-click menu
document.getElementById('tabs').addEventListener('contextmenu', (e) => {
  const tabEl = e.target.closest('.tab');
  if (!tabEl) return;
  e.preventDefault();
  const tabId = tabEl.dataset.id;
  // Remove existing menu
  const old = document.getElementById('tab-context-menu');
  if (old) old.remove();
  const menu = document.createElement('div');
  menu.id = 'tab-context-menu';
  menu.className = 'context-menu';
  menu.innerHTML = `
    <div class="cm-item" data-action="reload">Reload</div>
    <div class="cm-item" data-action="duplicate">Duplicate</div>
    <div class="cm-sep"></div>
    <div class="cm-item" data-action="tile">Tile with another tab...</div>
    <div class="cm-item" data-action="toggle-vertical">Toggle vertical tabs</div>
    <div class="cm-sep"></div>
    <div class="cm-item" data-action="close">Close tab</div>
    <div class="cm-item" data-action="close-others">Close other tabs</div>
  `;
  menu.style.left = e.pageX + 'px';
  menu.style.top = e.pageY + 'px';
  document.body.appendChild(menu);
  menu.addEventListener('click', async (ev) => {
    const action = ev.target.dataset.action;
    if (action === 'close') window.accela.closeTab(tabId);
    else if (action === 'reload') { await window.accela.switchTab(tabId); window.accela.reload(); }
    else if (action === 'duplicate') {
      const tabs = await window.accela.getTabs();
      const t = tabs.find(x => x.id === tabId);
      if (t) window.accela.newTab(t.url);
    }
    else if (action === 'close-others') {
      const tabs = await window.accela.getTabs();
      for (const t of tabs) if (t.id !== tabId) window.accela.closeTab(t.id);
    }
    else if (action === 'toggle-vertical') {
      const vt = await window.accela.toggleVerticalTabs();
      document.body.classList.toggle('vertical-tabs', vt);
    }
    else if (action === 'tile') {
      const tabs = await window.accela.getTabs();
      const others = tabs.filter(t => t.id !== tabId);
      if (others.length === 0) return;
      // Simple picker: use first other tab, or prompt
      const otherId = others[0].id;
      await window.accela.tileTabs(tabId, otherId);
    }
    menu.remove();
  });
  const closeMenu = (ev) => { if (!menu.contains(ev.target)) { menu.remove(); document.removeEventListener('click', closeMenu); } };
  setTimeout(() => document.addEventListener('click', closeMenu), 10);
});

// Tab drag & drop reorder
let dragTabId = null;
document.getElementById('tabs').addEventListener('dragstart', (e) => {
  const tabEl = e.target.closest('.tab');
  if (tabEl) {
    dragTabId = tabEl.dataset.id;
    tabEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragTabId);
  }
});
document.getElementById('tabs').addEventListener('dragend', (e) => {
  const tabEl = e.target.closest('.tab');
  if (tabEl) tabEl.classList.remove('dragging');
  dragTabId = null;
});
document.getElementById('tabs').addEventListener('dragover', (e) => {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
});
document.getElementById('tabs').addEventListener('drop', (e) => {
  e.preventDefault();
  const tabEl = e.target.closest('.tab');
  if (tabEl && dragTabId && tabEl.dataset.id !== dragTabId) {
    // Reorder via IPC (main process will handle)
    window.accela.reorderTab(dragTabId, tabEl.dataset.id);
  }
  dragTabId = null;
});

// Untile button
document.getElementById('untile-btn').addEventListener('click', () => {
  window.accela.untileTabs();
});

// Tiling indicator
window.accela.onTilingChanged(({ tiled, tabs }) => {
  document.body.classList.toggle('tiling', tiled);
  const ind = document.getElementById('tiling-indicator');
  if (ind) ind.style.display = tiled ? 'flex' : 'none';
});

// Vertical tabs toggle (in settings popup)
async function initVerticalTabs() {
  const vt = await window.accela.getVerticalTabs();
  document.body.classList.toggle('vertical-tabs', vt);
}
initVerticalTabs();

// Tab hover tooltip (title + URL preview)
let tabTooltip = null;
let tooltipTimer = null;
document.getElementById('tabs').addEventListener('mouseover', (e) => {
  const tabEl = e.target.closest('.tab');
  if (!tabEl) return;
  const tabId = tabEl.dataset.id;
  clearTimeout(tooltipTimer);
  tooltipTimer = setTimeout(async () => {
    const tabs = await window.accela.getTabs();
    const tab = tabs.find(t => t.id === tabId);
    if (!tab) return;
    if (!tabTooltip) {
      tabTooltip = document.createElement('div');
      tabTooltip.id = 'tab-tooltip';
      document.body.appendChild(tabTooltip);
    }
    tabTooltip.innerHTML = `<div class="tt-title">${escapeHtml(tab.title || 'New tab')}</div><div class="tt-url">${escapeHtml(tab.url || '')}</div>`;
    const rect = tabEl.getBoundingClientRect();
    tabTooltip.style.display = 'block';
    const ttWidth = 300;
    const ttHeight = 60;
    let left = Math.min(rect.left, window.innerWidth - ttWidth - 16);
    left = Math.max(8, left);
    let top = rect.bottom + 8;
    if (top + ttHeight > window.innerHeight) top = rect.top - ttHeight - 8;
    tabTooltip.style.left = left + 'px';
    tabTooltip.style.top = top + 'px';
  }, 400);
});
document.getElementById('tabs').addEventListener('mouseout', (e) => {
  clearTimeout(tooltipTimer);
  if (tabTooltip) tabTooltip.style.display = 'none';
});

// Init
renderBookmarks();
window.accela.getTabs().then(list => {
  list.forEach(t => tabs.set(t.tabId, { url: t.url, title: t.title }));
  const active = list.find(t => t.active);
  if (active) activeTabId = active.tabId;
  renderTabs();
});
