'use strict';

// ─── Elements ──────────────────────────────────────────────────────────────────
const githubTokenEl   = document.getElementById('githubToken');
const gistIdEl        = document.getElementById('gistId');
const defaultProjectEl = document.getElementById('defaultProject');
const tokenToggle     = document.getElementById('tokenToggle');
const btnSave         = document.getElementById('btnSave');
const btnTest         = document.getElementById('btnTest');
const btnClear        = document.getElementById('btnClear');
const feedbackBar     = document.getElementById('feedbackBar');
const sToken          = document.getElementById('s-token');
const sGist           = document.getElementById('s-gist');
const sSync           = document.getElementById('s-sync');
const tokenLink       = document.getElementById('tokenLink');

// ─── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const settings = await chrome.storage.sync.get([
    'githubToken', 'gistId', 'defaultProject', 'lastSync',
  ]);

  if (settings.githubToken)    githubTokenEl.value    = settings.githubToken;
  if (settings.gistId)         gistIdEl.value         = settings.gistId;
  if (settings.defaultProject) defaultProjectEl.value = settings.defaultProject;

  await refreshStatus(settings);
}

async function refreshStatus(settings) {
  const s = settings ?? await chrome.storage.sync.get(['githubToken', 'gistId', 'lastSync']);

  if (s.githubToken) {
    sToken.textContent = '✓ Set (' + s.githubToken.slice(0, 6) + '…)';
    sToken.className = 'status-val ok';
  } else {
    sToken.textContent = '✗ Not configured';
    sToken.className = 'status-val error';
  }

  if (s.gistId) {
    sGist.textContent = s.gistId;
    sGist.className = 'status-val ok';
  } else {
    sGist.textContent = 'Not created yet';
    sGist.className = 'status-val warn';
  }

  if (s.lastSync) {
    const d = new Date(s.lastSync);
    sSync.textContent = d.toLocaleString();
    sSync.className = 'status-val';
  } else {
    sSync.textContent = 'Never';
    sSync.className = 'status-val';
  }
}

// ─── Token visibility toggle ───────────────────────────────────────────────────

tokenToggle.addEventListener('click', () => {
  const isPassword = githubTokenEl.type === 'password';
  githubTokenEl.type = isPassword ? 'text' : 'password';
  tokenToggle.textContent = isPassword ? 'Hide' : 'Show';
});

// ─── Save ──────────────────────────────────────────────────────────────────────

btnSave.addEventListener('click', async () => {
  btnSave.disabled = true;
  btnSave.textContent = 'Saving…';

  try {
    const token   = githubTokenEl.value.trim();
    const gistId  = gistIdEl.value.trim();
    const project = defaultProjectEl.value.trim();

    if (token && !token.startsWith('ghp_') && !token.startsWith('github_pat_') && !token.match(/^[a-f0-9]{40}$/i)) {
      showFeedback('Token looks wrong — GitHub tokens start with ghp_ or github_pat_', 'error');
      return;
    }

    // Set values that are present; explicitly remove keys that were cleared
    const toSet = {};
    const toRemove = [];

    if (token)   toSet.githubToken    = token;   else toRemove.push('githubToken');
    if (project) toSet.defaultProject = project; else toRemove.push('defaultProject');

    if (gistId) {
      toSet.gistId = gistId;
    } else {
      toRemove.push('gistId'); // explicit remove so popup doesn't use stale Gist ID
    }

    if (Object.keys(toSet).length)   await chrome.storage.sync.set(toSet);
    if (toRemove.length)             await chrome.storage.sync.remove(toRemove);

    await refreshStatus();
    showFeedback('✓ Settings saved', 'ok');
  } catch (e) {
    showFeedback('✗ ' + e.message, 'error');
  } finally {
    btnSave.disabled = false;
    btnSave.textContent = 'Save Settings';
  }
});

// ─── Test connection ───────────────────────────────────────────────────────────

btnTest.addEventListener('click', async () => {
  btnTest.disabled = true;
  btnTest.textContent = 'Testing…';
  showFeedback('Connecting to GitHub API…', 'info');

  try {
    const token = githubTokenEl.value.trim();
    if (!token) throw new Error('Enter your GitHub token first');

    // Verify token via GitHub user API
    const resp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (resp.status === 401) throw new Error('Token invalid or expired (401)');
    if (!resp.ok)            throw new Error(`GitHub API error ${resp.status}`);

    const user = await resp.json();

    // Check gist scope (look at X-OAuth-Scopes header)
    const scopes = resp.headers.get('X-OAuth-Scopes') ?? '';
    const hasGist = scopes.includes('gist') || scopes.includes('repo');

    if (!hasGist) {
      showFeedback(
        `⚠ Connected as @${user.login} — but the token is missing the "gist" scope. ` +
        'Create a new token with gist scope enabled.',
        'error'
      );
    } else {
      showFeedback(`✓ Connected as @${user.login} — gist scope confirmed`, 'ok');
    }

    await refreshStatus();
  } catch (e) {
    showFeedback('✗ ' + e.message, 'error');
  } finally {
    btnTest.disabled = false;
    btnTest.textContent = 'Test Connection';
  }
});

// ─── Clear all data ────────────────────────────────────────────────────────────

btnClear.addEventListener('click', async () => {
  const confirmed = confirm(
    'This will remove your GitHub token, Gist ID, and all settings from this browser.\n\n' +
    'Your actual Gist on GitHub will NOT be deleted.\n\nContinue?'
  );
  if (!confirmed) return;

  await chrome.storage.sync.clear();
  githubTokenEl.value    = '';
  gistIdEl.value         = '';
  defaultProjectEl.value = '';
  await refreshStatus({});
  showFeedback('All local settings cleared', 'info');
});

// ─── External link ────────────────────────────────────────────────────────────

tokenLink.addEventListener('click', () => {
  chrome.tabs.create({ url: 'https://github.com/settings/tokens/new?scopes=gist&description=AI.md+browser+extension' });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function showFeedback(msg, type) {
  feedbackBar.textContent = msg;
  feedbackBar.className = 'feedback-bar show ' + type;
  if (type === 'ok') {
    setTimeout(() => { feedbackBar.className = 'feedback-bar'; }, 5000);
  }
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
