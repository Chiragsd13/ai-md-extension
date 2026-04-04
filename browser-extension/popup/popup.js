'use strict';

// ─── Supported platforms ───────────────────────────────────────────────────────
const SUPPORTED = {
  'claude.ai':           'Claude',
  'chat.openai.com':     'ChatGPT',
  'chatgpt.com':         'ChatGPT',
  'gemini.google.com':   'Gemini',
  'aistudio.google.com': 'AI Studio',
};

// ─── Elements ──────────────────────────────────────────────────────────────────
const platformBadge  = document.getElementById('platformBadge');
const platformName   = document.getElementById('platformName');
const syncDot        = document.getElementById('syncDot');
const syncText       = document.getElementById('syncText');
const syncTime       = document.getElementById('syncTime');
const projectInput   = document.getElementById('projectInput');
const btnInject      = document.getElementById('btnInject');
const btnInjectLabel = document.getElementById('btnInjectLabel');
const btnCopy        = document.getElementById('btnCopy');
const btnRefresh     = document.getElementById('btnRefresh');
const optionsBtn     = document.getElementById('optionsBtn');
const optionsLink    = document.getElementById('optionsLink');
const filesSection   = document.getElementById('filesSection');
const filesList      = document.getElementById('filesList');
const feedbackBar    = document.getElementById('feedbackBar');

let currentTabId   = null;
let currentPlatform = null;   // e.g. 'Claude'
let isConnected    = false;

// ─── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  // Restore saved project name
  const { defaultProject } = await chrome.storage.sync.get('defaultProject');
  if (defaultProject) projectInput.value = defaultProject;

  // Detect current tab platform
  await detectCurrentTab();

  // Connection status + file list (in parallel)
  await Promise.all([refreshSyncStatus(), loadFileList()]);

  // Keyboard shortcut: Enter in project input = inject
  projectInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !btnInject.disabled) btnInject.click();
  });
}

// ─── Tab / platform detection ──────────────────────────────────────────────────

async function detectCurrentTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.url) return;

    currentTabId = tab.id;
    const host = new URL(tab.url).hostname;
    const match = Object.keys(SUPPORTED).find(k => host.includes(k));

    if (match) {
      currentPlatform = SUPPORTED[match];
      platformBadge.classList.add('active');
      platformName.textContent = currentPlatform;
      btnInjectLabel.textContent = `Inject into ${currentPlatform}`;
    } else {
      currentPlatform = null;
      platformBadge.classList.remove('active');
      platformName.textContent = 'not on AI page';
      btnInjectLabel.textContent = 'Inject into chat';
    }
  } catch { /* ignore — no activeTab permission yet */ }

  updateInjectButton();
}

function updateInjectButton() {
  if (!isConnected) {
    btnInject.disabled = true;
    btnInjectLabel.textContent = 'Configure GitHub token first';
    return;
  }
  if (!currentPlatform) {
    btnInject.disabled = true;
    btnInjectLabel.textContent = 'Navigate to Claude / ChatGPT / Gemini';
    return;
  }
  btnInject.disabled = false;
  btnInjectLabel.textContent = `Inject into ${currentPlatform}`;
}

// ─── Sync status ───────────────────────────────────────────────────────────────

async function refreshSyncStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (!resp?.ok) throw new Error(resp?.error ?? 'No response');

    isConnected = resp.configured;

    if (resp.configured && resp.hasGist) {
      setSyncStatus('ok', 'Synced with GitHub Gist');
    } else if (resp.configured) {
      setSyncStatus('warn', 'Ready — no Gist yet (save first)');
    } else {
      setSyncStatus('err', 'No token — open Settings');
    }

    if (resp.lastSync) {
      syncTime.textContent = relTime(new Date(resp.lastSync));
    }
  } catch (e) {
    setSyncStatus('err', 'Error: ' + e.message);
  }

  updateInjectButton();
}

function setSyncStatus(type, msg) {
  syncDot.className = 'sdot ' + type;
  syncText.textContent = msg;
}

// ─── File list ──────────────────────────────────────────────────────────────────

async function loadFileList() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'LIST_FILES' });
    if (!resp?.ok || !resp.files?.length) {
      filesSection.style.display = 'none';
      return;
    }

    const currentVal = projectInput.value.trim();
    filesList.innerHTML = '';

    resp.files.forEach(name => {
      const proj = name.endsWith('.ai.md') ? name.slice(0, -6) : name;
      const isDefault = (proj === 'ai');
      const displayName = isDefault ? 'ai.md (default)' : proj;

      const li = document.createElement('li');
      const isSelected = toFilename(currentVal) === name;
      if (isSelected) li.classList.add('selected');

      li.innerHTML = `<span class="ficon">◆</span><span class="fname">${displayName}</span><span class="fcheck">✓</span>`;
      li.title = `Select "${name}"`;

      li.addEventListener('click', () => {
        projectInput.value = isDefault ? '' : proj;
        filesList.querySelectorAll('li').forEach(el => el.classList.remove('selected'));
        li.classList.add('selected');
        chrome.storage.sync.set({ defaultProject: projectInput.value.trim() });
      });

      filesList.appendChild(li);
    });

    filesSection.style.display = 'block';
  } catch { /* non-critical */ }
}

// ─── Inject into chat ───────────────────────────────────────────────────────────

btnInject.addEventListener('click', async () => {
  if (btnInject.disabled) return;
  const project  = projectInput.value.trim();
  const filename = toFilename(project);

  setWorking(btnInject, btnInjectLabel, `↓  Loading ${filename}…`);

  try {
    await chrome.storage.sync.set({ defaultProject: project });

    if (!currentTabId) throw new Error('No active tab');

    const result = await chrome.tabs.sendMessage(currentTabId, {
      type: 'AIMD_INJECT', filename,
    });

    if (result?.error) throw new Error(result.error);

    showFeedback(`✓ Injected into ${currentPlatform ?? 'chat'}`, 'ok');
    syncTime.textContent = 'just now';
    await loadFileList();
  } catch (e) {
    const msg = e.message ?? '';
    if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
      showFeedback('Page is still loading — wait a moment and try again', 'error');
    } else {
      showFeedback('✗ ' + msg, 'error');
    }
  } finally {
    resetBtn(btnInject, btnInjectLabel, `Inject into ${currentPlatform ?? 'chat'}`);
  }
});

// ─── Copy ──────────────────────────────────────────────────────────────────────

btnCopy.addEventListener('click', async () => {
  const project  = projectInput.value.trim();
  const filename = toFilename(project);
  const origHTML = btnCopy.innerHTML;
  btnCopy.innerHTML = '⟳ …';
  btnCopy.disabled  = true;

  try {
    await chrome.storage.sync.set({ defaultProject: project });

    const resp = await chrome.runtime.sendMessage({ type: 'LOAD_CONTEXT', filename });
    if (!resp?.ok) throw new Error(resp?.error ?? 'Load failed');

    await navigator.clipboard.writeText(resp.content);
    showFeedback(`✓ ${filename} copied — paste into any AI chat`, 'ok');
  } catch (e) {
    showFeedback('✗ ' + (e.message ?? 'Copy failed'), 'error');
  } finally {
    btnCopy.innerHTML = origHTML;
    btnCopy.disabled  = false;
  }
});

// ─── Refresh ───────────────────────────────────────────────────────────────────

btnRefresh.addEventListener('click', async () => {
  const origHTML = btnRefresh.innerHTML;
  btnRefresh.innerHTML = '↺ …';
  btnRefresh.disabled  = true;
  await Promise.all([loadFileList(), refreshSyncStatus()]);
  btnRefresh.innerHTML = origHTML;
  btnRefresh.disabled  = false;
});

// ─── Settings ─────────────────────────────────────────────────────────────────

optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
optionsLink.addEventListener('click', () => chrome.runtime.openOptionsPage());

// ─── Project input: save on change ────────────────────────────────────────────

projectInput.addEventListener('input', () => {
  // Highlight matching file in list
  const val = toFilename(projectInput.value.trim());
  filesList.querySelectorAll('li').forEach(li => {
    const fname = li.querySelector('.fname')?.textContent ?? '';
    const proj  = fname === 'ai.md (default)' ? 'ai' : fname;
    li.classList.toggle('selected', toFilename(proj) === val || (val === 'ai.md' && fname === 'ai.md (default)'));
  });
});

projectInput.addEventListener('change', () => {
  chrome.storage.sync.set({ defaultProject: projectInput.value.trim() });
});

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toFilename(project) {
  if (!project || project === 'ai.md') return 'ai.md';
  if (project.endsWith('.ai.md')) return project;
  return `${project.toLowerCase().replace(/\s+/g, '-')}.ai.md`;
}

function setWorking(btn, labelEl, text) {
  btn.disabled = true;
  if (labelEl) labelEl.textContent = text;
  else btn.textContent = text;
}

function resetBtn(btn, labelEl, text) {
  btn.disabled = false;
  if (labelEl) labelEl.textContent = text;
}

function showFeedback(msg, type) {
  feedbackBar.textContent = msg;
  feedbackBar.className   = 'feedback-bar show ' + type;
  clearTimeout(feedbackBar._timer);
  feedbackBar._timer = setTimeout(() => {
    feedbackBar.className = 'feedback-bar';
  }, type === 'ok' ? 3500 : 6000);
}

function relTime(date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)  return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

init();
