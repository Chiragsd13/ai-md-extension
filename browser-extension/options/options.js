'use strict';

// ─── Elements ──────────────────────────────────────────────────────────────────
const githubTokenEl    = document.getElementById('githubToken');
const gistIdEl         = document.getElementById('gistId');
const defaultProjectEl = document.getElementById('defaultProject');
const tokenToggle      = document.getElementById('tokenToggle');
const btnSave          = document.getElementById('btnSave');
const btnTest          = document.getElementById('btnTest');
const btnClear         = document.getElementById('btnClear');
const feedbackBar      = document.getElementById('feedbackBar');
const sProvider        = document.getElementById('s-provider');
const sToken           = document.getElementById('s-token');
const sGist            = document.getElementById('s-gist');
const sSync            = document.getElementById('s-sync');
const sAutoSave        = document.getElementById('s-autosave');
const tokenLink        = document.getElementById('tokenLink');

const gistCard         = document.getElementById('gistCard');
const gdriveCard       = document.getElementById('gdriveCard');
const providerGroup    = document.getElementById('providerGroup');
const aiModeGroup      = document.getElementById('aiModeGroup');
const autoSaveToggle   = document.getElementById('autoSaveToggle');
const btnGdriveConnect = document.getElementById('btnGdriveConnect');

// ─── Init ──────────────────────────────────────────────────────────────────────

async function init() {
  const settings = await chrome.storage.sync.get([
    'githubToken', 'gistId', 'defaultProject', 'lastSync',
    'cloudProvider', 'gdriveToken', 'autoSaveEnabled', 'aiUpdateMode',
  ]);

  if (settings.githubToken)    githubTokenEl.value    = settings.githubToken;
  if (settings.gistId)         gistIdEl.value         = settings.gistId;
  if (settings.defaultProject) defaultProjectEl.value = settings.defaultProject;

  // Cloud provider
  const provider = settings.cloudProvider ?? 'gist';
  selectProvider(provider);

  // Auto-save toggle
  const autoOn = settings.autoSaveEnabled !== false;
  autoSaveToggle.classList.toggle('on', autoOn);

  // AI update mode
  const mode = settings.aiUpdateMode ?? 'suggest';
  selectAIMode(mode);

  // Google Drive status
  if (settings.gdriveToken) {
    btnGdriveConnect.textContent = '\u2713 Connected';
    btnGdriveConnect.classList.add('connected');
  }

  await refreshStatus(settings);
}

// ─── Cloud provider selection ────────────────────────────────────────────────

function selectProvider(value) {
  providerGroup.querySelectorAll('.option-item').forEach(item => {
    const radio = item.querySelector('input[type="radio"]');
    const isThis = radio.value === value;
    item.classList.toggle('selected', isThis);
    radio.checked = isThis;
  });

  // Show/hide provider-specific cards
  gistCard.style.display   = value === 'gist' ? '' : 'none';
  gdriveCard.style.display = value === 'gdrive' ? '' : 'none';
}

providerGroup.addEventListener('change', (e) => {
  if (e.target.name === 'cloudProvider') {
    selectProvider(e.target.value);
  }
});

// ─── AI update mode selection ────────────────────────────────────────────────

function selectAIMode(value) {
  aiModeGroup.querySelectorAll('.option-item').forEach(item => {
    const radio = item.querySelector('input[type="radio"]');
    const isThis = radio.value === value;
    item.classList.toggle('selected', isThis);
    radio.checked = isThis;
  });
}

aiModeGroup.addEventListener('change', (e) => {
  if (e.target.name === 'aiUpdateMode') {
    selectAIMode(e.target.value);
  }
});

// ─── Auto-save toggle ────────────────────────────────────────────────────────

autoSaveToggle.addEventListener('click', () => {
  const isOn = autoSaveToggle.classList.toggle('on');
  // Save immediately so content script picks it up
  chrome.storage.sync.set({ autoSaveEnabled: isOn });
});

// ─── Google Drive connect ────────────────────────────────────────────────────

btnGdriveConnect.addEventListener('click', async () => {
  btnGdriveConnect.textContent = 'Connecting\u2026';
  btnGdriveConnect.disabled = true;

  try {
    const result = await chrome.runtime.sendMessage({ type: 'GDRIVE_AUTH' });
    if (!result?.ok) throw new Error(result?.error ?? 'Auth failed');

    btnGdriveConnect.textContent = '\u2713 Connected';
    btnGdriveConnect.classList.add('connected');
    showFeedback('\u2713 Google Drive connected', 'ok');
  } catch (e) {
    showFeedback('\u2717 ' + e.message, 'error');
    btnGdriveConnect.textContent = 'Connect Google Drive';
  } finally {
    btnGdriveConnect.disabled = false;
  }
});

// ─── Status refresh ──────────────────────────────────────────────────────────

async function refreshStatus(settings) {
  const s = settings ?? await chrome.storage.sync.get([
    'githubToken', 'gistId', 'lastSync', 'cloudProvider', 'gdriveToken', 'autoSaveEnabled',
  ]);

  const provider = s.cloudProvider ?? 'gist';
  const providerNames = { gist: 'GitHub Gist', gdrive: 'Google Drive', download: 'Local Download' };
  sProvider.textContent = providerNames[provider] ?? provider;
  sProvider.className = 'status-val ok';

  if (s.githubToken) {
    sToken.textContent = '\u2713 Set (' + s.githubToken.slice(0, 6) + '\u2026)';
    sToken.className = 'status-val ok';
  } else {
    sToken.textContent = provider === 'gist' ? '\u2717 Not configured' : 'N/A (using ' + providerNames[provider] + ')';
    sToken.className = provider === 'gist' ? 'status-val error' : 'status-val';
  }

  if (s.gistId) {
    sGist.textContent = s.gistId;
    sGist.className = 'status-val ok';
  } else {
    sGist.textContent = provider === 'gist' ? 'Not created yet' : 'N/A';
    sGist.className = provider === 'gist' ? 'status-val warn' : 'status-val';
  }

  if (s.lastSync) {
    sSync.textContent = new Date(s.lastSync).toLocaleString();
    sSync.className = 'status-val';
  } else {
    sSync.textContent = 'Never';
    sSync.className = 'status-val';
  }

  const autoOn = s.autoSaveEnabled !== false;
  sAutoSave.textContent = autoOn ? 'Enabled (smart tracking + triggers)' : 'Disabled';
  sAutoSave.className = autoOn ? 'status-val ok' : 'status-val warn';
}

// ─── Token visibility toggle ────────────────────────────────────────────────

tokenToggle.addEventListener('click', () => {
  const isPassword = githubTokenEl.type === 'password';
  githubTokenEl.type = isPassword ? 'text' : 'password';
  tokenToggle.textContent = isPassword ? 'Hide' : 'Show';
});

// ─── Save ────────────────────────────────────────────────────────────────────

btnSave.addEventListener('click', async () => {
  btnSave.disabled = true;
  btnSave.textContent = 'Saving\u2026';

  try {
    const token   = githubTokenEl.value.trim();
    const gistId  = gistIdEl.value.trim();
    const project = defaultProjectEl.value.trim();

    const selectedProvider = providerGroup.querySelector('input[name="cloudProvider"]:checked')?.value ?? 'gist';
    const selectedMode     = aiModeGroup.querySelector('input[name="aiUpdateMode"]:checked')?.value ?? 'suggest';
    const autoEnabled      = autoSaveToggle.classList.contains('on');

    if (selectedProvider === 'gist' && token &&
        !token.startsWith('ghp_') && !token.startsWith('github_pat_') && !token.match(/^[a-f0-9]{40}$/i)) {
      showFeedback('Token looks wrong \u2014 GitHub tokens start with ghp_ or github_pat_', 'error');
      return;
    }

    const toSet = {};
    const toRemove = [];

    if (token)   toSet.githubToken    = token;   else toRemove.push('githubToken');
    if (project) toSet.defaultProject = project; else toRemove.push('defaultProject');
    if (gistId)  toSet.gistId         = gistId;  else toRemove.push('gistId');

    toSet.cloudProvider   = selectedProvider;
    toSet.aiUpdateMode    = selectedMode;
    toSet.autoSaveEnabled = autoEnabled;

    if (Object.keys(toSet).length) await chrome.storage.sync.set(toSet);
    if (toRemove.length)           await chrome.storage.sync.remove(toRemove);

    await refreshStatus();
    showFeedback('\u2713 Settings saved', 'ok');
  } catch (e) {
    showFeedback('\u2717 ' + e.message, 'error');
  } finally {
    btnSave.disabled = false;
    btnSave.textContent = 'Save Settings';
  }
});

// ─── Test connection ─────────────────────────────────────────────────────────

btnTest.addEventListener('click', async () => {
  btnTest.disabled = true;
  btnTest.textContent = 'Testing\u2026';
  showFeedback('Connecting to GitHub API\u2026', 'info');

  try {
    const token = githubTokenEl.value.trim();
    if (!token) throw new Error('Enter your GitHub token first');

    const resp = await fetch('https://api.github.com/user', {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });

    if (resp.status === 401) throw new Error('Token invalid or expired (401)');
    if (!resp.ok) throw new Error(`GitHub API error ${resp.status}`);

    const user = await resp.json();
    const scopes = resp.headers.get('X-OAuth-Scopes') ?? '';
    const hasGist = scopes.includes('gist') || scopes.includes('repo');

    if (!hasGist) {
      showFeedback(
        `\u26A0 Connected as @${user.login} \u2014 but missing "gist" scope. Create a new token.`,
        'error'
      );
    } else {
      showFeedback(`\u2713 Connected as @${user.login} \u2014 gist scope confirmed`, 'ok');
    }

    await refreshStatus();
  } catch (e) {
    showFeedback('\u2717 ' + e.message, 'error');
  } finally {
    btnTest.disabled = false;
    btnTest.textContent = 'Test Connection';
  }
});

// ─── Clear all data ──────────────────────────────────────────────────────────

btnClear.addEventListener('click', async () => {
  const confirmed = confirm(
    'This will remove your GitHub token, Gist ID, Google Drive connection, and all settings.\n\n' +
    'Your actual Gist/files will NOT be deleted.\n\nContinue?'
  );
  if (!confirmed) return;

  await chrome.storage.sync.clear();
  githubTokenEl.value    = '';
  gistIdEl.value         = '';
  defaultProjectEl.value = '';
  selectProvider('gist');
  selectAIMode('suggest');
  autoSaveToggle.classList.add('on');
  btnGdriveConnect.textContent = 'Connect Google Drive';
  btnGdriveConnect.classList.remove('connected');
  await refreshStatus({});
  showFeedback('All local settings cleared', 'info');
});

// ─── External link ───────────────────────────────────────────────────────────

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

// ─── Start ───────────────────────────────────────────────────────────────────
init();
