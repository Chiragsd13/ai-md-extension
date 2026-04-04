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
const platformBadge    = document.getElementById('platformBadge');
const platformName     = document.getElementById('platformName');
const syncDot          = document.getElementById('syncDot');
const syncText         = document.getElementById('syncText');
const syncTime         = document.getElementById('syncTime');
const projectInput     = document.getElementById('projectInput');
const btnInject        = document.getElementById('btnInject');
const btnInjectLabel   = document.getElementById('btnInjectLabel');
const btnCopy          = document.getElementById('btnCopy');
const btnRefresh       = document.getElementById('btnRefresh');
const btnSaveChat      = document.getElementById('btnSaveChat');
const btnSaveChatLabel = document.getElementById('btnSaveChatLabel');
const btnAiUpdate      = document.getElementById('btnAiUpdate');
const btnAiUpdateLabel = document.getElementById('btnAiUpdateLabel');
const trackingBar      = document.getElementById('trackingBar');
const trackingText     = document.getElementById('trackingText');
const optionsBtn       = document.getElementById('optionsBtn');
const optionsLink      = document.getElementById('optionsLink');
const filesSection     = document.getElementById('filesSection');
const filesList        = document.getElementById('filesList');
const feedbackBar      = document.getElementById('feedbackBar');

let currentTabId    = null;
let currentPlatform = null;
let isConnected     = false;
let aiUpdateMode    = 'suggest';

// ─── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const { defaultProject, aiUpdateMode: mode } = await chrome.storage.sync.get(['defaultProject', 'aiUpdateMode']);
  if (defaultProject) projectInput.value = defaultProject;
  aiUpdateMode = mode ?? 'suggest';

  await detectCurrentTab();
  await Promise.all([refreshSyncStatus(), loadFileList(), refreshTrackingStatus()]);

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
  } catch { /* no activeTab permission yet */ }

  updateInjectButton();
  updateSaveChatButton();
  updateAiUpdateButton();
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

function updateSaveChatButton() {
  if (!isConnected) {
    btnSaveChat.disabled = true;
    btnSaveChatLabel.textContent = 'Configure GitHub token first';
    return;
  }
  if (!currentPlatform) {
    btnSaveChat.disabled = true;
    btnSaveChatLabel.textContent = 'Save Chat \u2014 navigate to an AI page';
    return;
  }
  btnSaveChat.disabled = false;
  btnSaveChatLabel.textContent = `Save ${currentPlatform} Chat to Context`;
}

function updateAiUpdateButton() {
  if (!isConnected) {
    btnAiUpdate.disabled = true;
    btnAiUpdateLabel.textContent = 'Configure token first';
    return;
  }
  if (!currentPlatform) {
    btnAiUpdate.disabled = true;
    btnAiUpdateLabel.textContent = 'Navigate to an AI page';
    return;
  }
  btnAiUpdate.disabled = false;
  const modeLabels = { suggest: 'Ask AI to Update Context', auto: 'Auto-Update via AI', watch: 'Watching for Context...' };
  btnAiUpdateLabel.textContent = modeLabels[aiUpdateMode] ?? 'Update Context via AI';
}

// ─── Smart tracking status ───────────────────────────────────────────────────

async function refreshTrackingStatus() {
  if (!currentTabId || !currentPlatform) {
    trackingBar.classList.remove('active');
    trackingText.textContent = 'Smart tracking inactive';
    return;
  }

  try {
    const stats = await chrome.tabs.sendMessage(currentTabId, { type: 'GET_TURN_STATS' });
    if (stats?.ok) {
      trackingBar.classList.add('active');
      const buf = stats.buffered;
      const total = stats.totalTracked;
      trackingText.textContent = buf > 0
        ? `Tracking: ${total} turns, ${buf} buffered for save`
        : total > 0
          ? `Tracking: ${total} turns monitored`
          : 'Smart tracking active';
    }
  } catch {
    trackingBar.classList.remove('active');
    trackingText.textContent = 'Smart tracking inactive';
  }
}

// ─── Sync status ───────────────────────────────────────────────────────────────

async function refreshSyncStatus() {
  try {
    const resp = await chrome.runtime.sendMessage({ type: 'GET_STATUS' });
    if (!resp?.ok) throw new Error(resp?.error ?? 'No response');

    isConnected = resp.configured || resp.cloudProvider === 'download';
    aiUpdateMode = resp.aiUpdateMode ?? 'suggest';

    if (resp.configured && resp.hasGist) {
      setSyncStatus('ok', 'Synced with GitHub Gist');
    } else if (resp.configured) {
      setSyncStatus('warn', 'Ready \u2014 no Gist yet (save first)');
    } else if (resp.cloudProvider === 'download') {
      setSyncStatus('ok', 'Local download mode');
    } else {
      setSyncStatus('err', 'No token \u2014 open Settings');
    }

    if (resp.lastSync) {
      syncTime.textContent = relTime(new Date(resp.lastSync));
    }
  } catch (e) {
    setSyncStatus('err', 'Error: ' + e.message);
  }

  updateInjectButton();
  updateSaveChatButton();
  updateAiUpdateButton();
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

      li.innerHTML = `<span class="ficon">\u25C6</span><span class="fname">${displayName}</span><span class="fcheck">\u2713</span>`;
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

  // Try dual-file first (technical + preferences), fall back to legacy single file
  const techFile = toTechFilename(project);
  const prefFile = toPrefFilename(project);
  const legacyFile = toFilename(project);

  setWorking(btnInject, btnInjectLabel, `\u2193  Loading context\u2026`);

  try {
    await chrome.storage.sync.set({ defaultProject: project });
    if (!currentTabId) throw new Error('No active tab');

    // Load technical context (try new name, fall back to legacy)
    let techResp = await chrome.runtime.sendMessage({ type: 'LOAD_CONTEXT', filename: techFile }).catch(() => null);
    if (!techResp?.ok) {
      techResp = await chrome.runtime.sendMessage({ type: 'LOAD_CONTEXT', filename: legacyFile });
    }
    if (!techResp?.ok) throw new Error(techResp?.error ?? 'No context found');

    // Load preferences (optional)
    let prefContent = '';
    try {
      const prefResp = await chrome.runtime.sendMessage({ type: 'LOAD_CONTEXT', filename: prefFile });
      if (prefResp?.ok && prefResp.content) {
        prefContent = '\n\n---\n\n' + prefResp.content;
      }
    } catch { /* preferences file doesn't exist yet — fine */ }

    const combined = techResp.content + prefContent;

    // Inject combined content
    const result = await chrome.tabs.sendMessage(currentTabId, {
      type: 'AIMD_INJECT_RAW', content: combined,
    });

    if (result?.error) throw new Error(result.error);
    const fileCount = prefContent ? '2 files' : '1 file';
    showFeedback(`\u2713 Injected ${fileCount} into ${currentPlatform ?? 'chat'}`, 'ok');
    syncTime.textContent = 'just now';
    await loadFileList();
  } catch (e) {
    const msg = e.message ?? '';
    if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
      showFeedback('Page is still loading \u2014 wait a moment and try again', 'error');
    } else {
      showFeedback('\u2717 ' + msg, 'error');
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
  btnCopy.innerHTML = '\u27F3 \u2026';
  btnCopy.disabled  = true;

  try {
    await chrome.storage.sync.set({ defaultProject: project });
    const resp = await chrome.runtime.sendMessage({ type: 'LOAD_CONTEXT', filename });
    if (!resp?.ok) throw new Error(resp?.error ?? 'Load failed');

    await navigator.clipboard.writeText(resp.content);
    showFeedback(`\u2713 ${filename} copied \u2014 paste into any AI chat`, 'ok');
  } catch (e) {
    showFeedback('\u2717 ' + (e.message ?? 'Copy failed'), 'error');
  } finally {
    btnCopy.innerHTML = origHTML;
    btnCopy.disabled  = false;
  }
});

// ─── Refresh ───────────────────────────────────────────────────────────────────

btnRefresh.addEventListener('click', async () => {
  const origHTML = btnRefresh.innerHTML;
  btnRefresh.innerHTML = '\u21BA \u2026';
  btnRefresh.disabled  = true;
  await Promise.all([loadFileList(), refreshSyncStatus(), refreshTrackingStatus()]);
  btnRefresh.innerHTML = origHTML;
  btnRefresh.disabled  = false;
});

// ─── Save Chat ─────────────────────────────────────────────────────────────────

btnSaveChat.addEventListener('click', async () => {
  if (btnSaveChat.disabled) return;

  const project  = projectInput.value.trim();
  const filename = toFilename(project);

  btnSaveChat.disabled = true;
  btnSaveChatLabel.textContent = '\u27F3 Capturing\u2026';

  try {
    await chrome.storage.sync.set({ defaultProject: project });
    if (!currentTabId) throw new Error('No active tab');

    const capture = await chrome.tabs.sendMessage(currentTabId, { type: 'CAPTURE_CHAT' });
    if (!capture?.ok) throw new Error(capture?.error ?? 'Capture failed');

    const { platform, capturedAt, url, userMessages, totalTurns, bufferedTurns } = capture.data;
    if (!userMessages?.length && !bufferedTurns?.length) {
      showFeedback(`No messages found on this ${platform} page`, 'error');
      return;
    }

    const msgCount = (userMessages?.length ?? 0) + (bufferedTurns?.length ?? 0);
    btnSaveChatLabel.textContent = `\u27F3 Saving ${msgCount} item${msgCount !== 1 ? 's' : ''}\u2026`;

    const result = await chrome.runtime.sendMessage({
      type: 'SAVE_CHAT_CONTEXT',
      filename,
      captureData: { platform, capturedAt, url, userMessages, totalTurns, bufferedTurns },
    });

    if (!result?.ok) throw new Error(result?.error ?? 'Save failed');

    showFeedback(
      `\u2713 Saved ${msgCount} item${msgCount !== 1 ? 's' : ''} from ${platform} \u2192 ${filename}`,
      'ok',
    );
    syncTime.textContent = 'just now';
    await loadFileList();

  } catch (e) {
    const msg = e.message ?? '';
    if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
      showFeedback('Page is still loading \u2014 wait a moment and try again', 'error');
    } else {
      showFeedback('\u2717 ' + msg, 'error');
    }
  } finally {
    updateSaveChatButton();
  }
});

// ─── AI Update ─────────────────────────────────────────────────────────────────

btnAiUpdate.addEventListener('click', async () => {
  if (btnAiUpdate.disabled || !currentTabId || !currentPlatform) return;

  btnAiUpdate.disabled = true;
  btnAiUpdateLabel.textContent = '\u27F3 Requesting\u2026';

  try {
    const result = await chrome.tabs.sendMessage(currentTabId, {
      type: 'REQUEST_AI_UPDATE',
      mode: aiUpdateMode,
    });

    if (!result?.ok) throw new Error(result?.error ?? 'Failed');

    if (aiUpdateMode === 'suggest') {
      showFeedback(`\u2713 Update prompt injected \u2014 review and send it to ${currentPlatform}`, 'ok');
    } else if (aiUpdateMode === 'auto') {
      showFeedback(`\u2713 AI is generating context update\u2026`, 'ok');
    } else {
      showFeedback(`\u2713 Watching for context in next AI response\u2026`, 'ok');
    }
  } catch (e) {
    const msg = e.message ?? '';
    if (msg.includes('Receiving end does not exist') || msg.includes('Could not establish connection')) {
      showFeedback('Page is still loading \u2014 wait a moment and try again', 'error');
    } else {
      showFeedback('\u2717 ' + msg, 'error');
    }
  } finally {
    updateAiUpdateButton();
  }
});

// ─── Settings ─────────────────────────────────────────────────────────────────

optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
optionsLink.addEventListener('click', () => chrome.runtime.openOptionsPage());

// ─── Project input ───────────────────────────────────────────────────────────

projectInput.addEventListener('input', () => {
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

// Dual-file naming: technical + preferences per project
function toTechFilename(project) {
  const base = project?.trim()?.toLowerCase()?.replace(/\s+/g, '-') || 'ai';
  return `${base}.technical.ai.md`;
}

function toPrefFilename(project) {
  const base = project?.trim()?.toLowerCase()?.replace(/\s+/g, '-') || 'ai';
  return `${base}.preferences.ai.md`;
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
