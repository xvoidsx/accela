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

// Init
window.accela.getTabs().then(list => {
  list.forEach(t => tabs.set(t.tabId, { url: t.url, title: t.title }));
  const active = list.find(t => t.active);
  if (active) activeTabId = active.tabId;
  renderTabs();
});
