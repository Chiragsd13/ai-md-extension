/**
 * AI.md Browser Extension — Background Service Worker
 *
 * Handles: GitHub Gist sync, Google Drive sync, local download,
 * storage management, message routing from content scripts and popup.
 *
 * v2: Multi-cloud storage, AI-generated context save, auto-save routing.
 */

'use strict';

const GIST_API  = 'https://api.github.com/gists';
const GDRIVE_API = 'https://www.googleapis.com/upload/drive/v3/files';
const GDRIVE_META = 'https://www.googleapis.com/drive/v3/files';

// ─── Message Router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handle = (fn) => fn(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));

  switch (msg.type) {
    case 'SAVE_CONTEXT':              handle(handleSave);                  return true;
    case 'LOAD_CONTEXT':              handle(handleLoad);                  return true;
    case 'LIST_FILES':                handle(handleList);                  return true;
    case 'GET_STATUS':                handle(getStatus);                   return true;
    case 'SAVE_CHAT_CONTEXT':         handle(handleSaveChatContext);       return true;
    case 'SAVE_AI_GENERATED_CONTEXT': handle(handleSaveAIGeneratedContext); return true;
    case 'CLOUD_SAVE':                handle(handleCloudSave);             return true;
    case 'GDRIVE_AUTH':               handle(handleGDriveAuth);            return true;
  }
});

// ─── Core Handlers ───────────────────────────────────────────────────────────

async function handleSave({ filename, content, token, gistId }) {
  const tok = token || (await getSettings()).githubToken;
  if (!tok) throw new Error('No GitHub token — configure one in Options');

  const id = gistId || (await getSettings()).gistId;
  let resultId;

  if (id) {
    await gistPatch(id, filename, content, tok);
    resultId = id;
  } else {
    const data = await gistCreate(filename, content, tok);
    resultId = data.id;
    await chrome.storage.sync.set({ gistId: resultId });
  }

  await chrome.storage.sync.set({ lastSync: new Date().toISOString() });
  return { ok: true, gistId: resultId };
}

async function handleLoad({ filename, token, gistId }) {
  const settings = await getSettings();
  const tok  = token  || settings.githubToken;
  const id   = gistId || settings.gistId;

  if (!tok) throw new Error('No GitHub token — configure one in Options');
  if (!id)  throw new Error('No Gist ID — save a context first');

  const content = await gistRead(id, filename, tok);
  return { ok: true, content };
}

async function handleList({ token, gistId }) {
  const settings = await getSettings();
  const tok = token  || settings.githubToken;
  const id  = gistId || settings.gistId;

  if (!tok || !id) return { ok: true, files: [] };

  const data = await gistGet(id, tok);
  return { ok: true, files: Object.keys(data.files ?? {}) };
}

async function getStatus() {
  const s = await getSettings();
  return {
    ok: true,
    configured: !!(s.githubToken),
    hasGist: !!(s.gistId),
    lastSync: s.lastSync ?? null,
    gistId: s.gistId ?? null,
    cloudProvider: s.cloudProvider ?? 'gist',
    gdriveConnected: !!(s.gdriveToken),
    autoSaveEnabled: s.autoSaveEnabled !== false,
    aiUpdateMode: s.aiUpdateMode ?? 'suggest',
  };
}

// ─── Chat context save (from conversation capture) ───────────────────────────

async function handleSaveChatContext({ filename, captureData, reason }) {
  const settings = await getSettings();
  const provider = settings.cloudProvider ?? 'gist';

  const { platform, capturedAt, url, userMessages, bufferedTurns } = captureData;
  if (!userMessages?.length && !bufferedTurns?.length) {
    throw new Error('No messages found on this page');
  }

  // Build the merged section from both direct capture and smart-buffered turns
  let section = '';

  if (bufferedTurns?.length) {
    section += buildSmartTurnsSection(platform, bufferedTurns);
  }

  if (userMessages?.length) {
    section += buildCapturedPromptsSection(platform, capturedAt, url, userMessages);
  }

  // Load existing, merge, save via the configured cloud provider
  const content = await mergeAndSave(settings, provider, filename, section, platform);

  await chrome.storage.sync.set({ lastSync: new Date().toISOString() });
  return { ok: true, provider, reason };
}

function buildSmartTurnsSection(platform, turns) {
  const lines = [];
  lines.push(`## Session Log (${platform} \u2014 Smart Tracked)`);
  lines.push('');
  lines.push('*Important exchanges auto-captured by AI.md:*');
  lines.push('');
  turns.forEach((t, i) => {
    const time = new Date(t.ts).toLocaleTimeString();
    lines.push(`### Exchange ${i + 1} (${time})`);
    lines.push(`**Prompt:** ${t.prompt}`);
    lines.push('');
    lines.push(`**Summary:** ${t.summary}`);
    lines.push('');
  });
  return lines.join('\n');
}

function buildCapturedPromptsSection(platform, capturedAt, url, messages) {
  const lines = [];
  const dateStr = new Date(capturedAt).toLocaleString();
  lines.push(`## Recent Prompts (${platform} \u2014 ${dateStr})`);
  lines.push('');
  if (url) lines.push(`*Captured from: ${url}*`);
  lines.push('');
  lines.push('*What was asked in the last chat session:*');
  lines.push('');
  messages.forEach((m, i) => {
    lines.push(`**[${i + 1}]** ${m}`);
    lines.push('');
  });
  return lines.join('\n');
}

// ─── AI-generated context save ───────────────────────────────────────────────
//
// The AI in the conversation (Claude/ChatGPT/Gemini) wrote a full .ai.md doc.
// Save it directly — this is the highest-quality context because the AI has
// full session understanding.

async function handleSaveAIGeneratedContext({ filename, content, platform }) {
  const settings = await getSettings();
  const provider = settings.cloudProvider ?? 'gist';

  // Add metadata footer
  const withMeta = content.trimEnd() + '\n\n---\n*Auto-generated by AI.md via ' +
    platform + ' on ' + new Date().toLocaleString() + '*\n';

  await cloudSave(settings, provider, filename, withMeta);
  await chrome.storage.sync.set({ lastSync: new Date().toISOString() });
  return { ok: true, provider };
}

// ─── Multi-cloud save router ─────────────────────────────────────────────────

async function handleCloudSave({ filename, content, provider }) {
  const settings = await getSettings();
  const p = provider ?? settings.cloudProvider ?? 'gist';
  await cloudSave(settings, p, filename, content);
  await chrome.storage.sync.set({ lastSync: new Date().toISOString() });
  return { ok: true, provider: p };
}

async function cloudSave(settings, provider, filename, content) {
  switch (provider) {
    case 'gdrive':
      return saveToGoogleDrive(settings, filename, content);
    case 'download':
      return saveToLocalDownload(filename, content);
    case 'gist':
    default:
      return saveToGist(settings, filename, content);
  }
}

async function mergeAndSave(settings, provider, filename, newSection, platform) {
  // Try to load existing
  let existing = '';
  if (provider === 'gist' && settings.gistId && settings.githubToken) {
    try { existing = await gistRead(settings.gistId, filename, settings.githubToken); }
    catch { /* no file yet */ }
  }

  let merged;
  if (existing) {
    // Replace Session Log / Recent Prompts, or append
    const re = /\n## (Session Log|Recent Prompts)[^\n]*\n[\s\S]*?(?=\n## |\n---\n|$)/;
    if (re.test(existing)) {
      merged = existing.replace(re, '\n' + newSection.trimEnd());
    } else {
      const footerIdx = existing.lastIndexOf('\n---\n');
      if (footerIdx !== -1) {
        merged = existing.slice(0, footerIdx) + '\n\n' + newSection.trimEnd() + existing.slice(footerIdx);
      } else {
        merged = existing.trimEnd() + '\n\n' + newSection;
      }
    }
  } else {
    const now = new Date().toISOString();
    merged = [
      `# AI Context \u2014 ${filename.replace(/\.ai\.md$/, '')}`,
      '',
      `> **Updated:** ${now}  |  **Platform:** ${platform}`,
      '',
      '---',
      '',
      newSection,
      '---',
      '',
      '*Generated by [AI.md](https://github.com/ai-md/vscode-extension)*',
    ].join('\n');
  }

  await cloudSave(settings, provider, filename, merged);
  return merged;
}

// ─── GitHub Gist provider ────────────────────────────────────────────────────

async function saveToGist(settings, filename, content) {
  const tok = settings.githubToken;
  if (!tok) throw new Error('No GitHub token \u2014 configure one in Options');

  if (settings.gistId) {
    await gistPatch(settings.gistId, filename, content, tok);
  } else {
    const data = await gistCreate(filename, content, tok);
    await chrome.storage.sync.set({ gistId: data.id });
  }
}

async function gistRequest(url, options, token) {
  const resp = await fetch(url, {
    ...options,
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      ...(options?.headers ?? {}),
    },
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => '');
    const hint = resp.status === 401 ? ' (invalid token?)' : resp.status === 404 ? ' (gist not found?)' : '';
    throw new Error(`GitHub API ${resp.status}${hint}: ${body.slice(0, 120)}`);
  }
  return resp.json();
}

async function gistCreate(filename, content, token) {
  return gistRequest(GIST_API, {
    method: 'POST',
    body: JSON.stringify({
      description: 'AI.md \u2014 AI context continuity files',
      public: false,
      files: { [filename]: { content } },
    }),
  }, token);
}

async function gistPatch(gistId, filename, content, token) {
  return gistRequest(`${GIST_API}/${gistId}`, {
    method: 'PATCH',
    body: JSON.stringify({ files: { [filename]: { content } } }),
  }, token);
}

async function gistGet(gistId, token) {
  return gistRequest(`${GIST_API}/${gistId}`, {}, token);
}

async function gistRead(gistId, filename, token) {
  const data = await gistGet(gistId, token);
  const file = data.files?.[filename];
  if (!file) throw new Error(`"${filename}" not found in your Gist`);
  if (file.truncated && file.raw_url) {
    const raw = await fetch(file.raw_url, {
      headers: { Authorization: `token ${token}` },
    });
    return raw.text();
  }
  return file.content ?? '';
}

// ─── Google Drive provider ───────────────────────────────────────────────────
//
// Uses chrome.identity.getAuthToken for Google OAuth.
// User must configure via Options → "Connect Google Drive".

async function handleGDriveAuth() {
  const token = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: true }, (tok) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(tok);
      }
    });
  });

  await chrome.storage.sync.set({ gdriveToken: token });
  return { ok: true, token };
}

async function getGDriveToken() {
  return new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive: false }, (tok) => {
      if (chrome.runtime.lastError || !tok) {
        reject(new Error('Google Drive not connected \u2014 go to Options to connect'));
      } else {
        resolve(tok);
      }
    });
  });
}

async function saveToGoogleDrive(settings, filename, content) {
  const token = await getGDriveToken();

  // Search for existing file by name in AI.md folder
  const searchUrl = `${GDRIVE_META}?q=name='${filename}'+and+trashed=false&fields=files(id,name)`;
  const searchResp = await fetch(searchUrl, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!searchResp.ok) throw new Error(`Google Drive search failed: ${searchResp.status}`);
  const { files } = await searchResp.json();

  if (files?.length > 0) {
    // Update existing file
    const fileId = files[0].id;
    const updateResp = await fetch(`${GDRIVE_API}/${fileId}?uploadType=media`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/markdown',
      },
      body: content,
    });
    if (!updateResp.ok) throw new Error(`Google Drive update failed: ${updateResp.status}`);
  } else {
    // Create new file
    const metadata = {
      name: filename,
      mimeType: 'text/markdown',
      description: 'AI.md context continuity file',
    };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', new Blob([content], { type: 'text/markdown' }));

    const createResp = await fetch(`${GDRIVE_API}?uploadType=multipart`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    if (!createResp.ok) throw new Error(`Google Drive create failed: ${createResp.status}`);
  }
}

// ─── Local download provider ─────────────────────────────────────────────────

async function saveToLocalDownload(filename, content) {
  const blob = new Blob([content], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);

  await chrome.downloads.download({
    url,
    filename: `ai-md/${filename}`,
    saveAs: false, // auto-save to downloads/ai-md/
    conflictAction: 'overwrite',
  });
}

// ─── Storage helpers ─────────────────────────────────────────────────────────

async function getSettings() {
  return chrome.storage.sync.get([
    'githubToken', 'gistId', 'defaultProject', 'lastSync',
    'cloudProvider', 'gdriveToken', 'autoSaveEnabled', 'aiUpdateMode',
  ]);
}
