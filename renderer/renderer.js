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
    el.innerHTML = `<span class="tab-title">${escapeHtml(t.title || 'New Tab')}</span><button class="tab-close">×</button>`;
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
    star.textContent = '★';
  } else {
    star.classList.remove('bookmarked');
    star.textContent = '☆';
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

// Init
renderBookmarks();
window.accela.getTabs().then(list => {
  list.forEach(t => tabs.set(t.tabId, { url: t.url, title: t.title }));
  const active = list.find(t => t.active);
  if (active) activeTabId = active.tabId;
  renderTabs();
});
