/**
 * AI.md Browser Extension — Background Service Worker
 *
 * Handles: GitHub Gist sync, storage management, message routing from
 * content scripts and popup.
 */

'use strict';

const GIST_API = 'https://api.github.com/gists';

// ─── Message Router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  switch (msg.type) {

    case 'SAVE_CONTEXT':
      handleSave(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'LOAD_CONTEXT':
      handleLoad(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'LIST_FILES':
      handleList(msg).then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;

    case 'GET_STATUS':
      getStatus().then(sendResponse).catch(e => sendResponse({ ok: false, error: e.message }));
      return true;
  }
});

// ─── Handlers ─────────────────────────────────────────────────────────────────

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
  const { githubToken, gistId, lastSync } = await getSettings();
  return {
    ok: true,
    configured: !!(githubToken),
    hasGist: !!(gistId),
    lastSync: lastSync ?? null,
    gistId: gistId ?? null,
  };
}

// ─── GitHub Gist API ──────────────────────────────────────────────────────────

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
      description: 'AI.md — AI context continuity files',
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

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function getSettings() {
  return chrome.storage.sync.get([
    'githubToken', 'gistId', 'defaultProject', 'lastSync',
  ]);
}
