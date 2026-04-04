import * as vscode from 'vscode';
import * as crypto from 'crypto';

// ─── ConfigPanel ──────────────────────────────────────────────────────────────
//
// A VS Code webview panel that provides a friendly UI for configuring AI.md.
// Reads current settings on open, writes them back on form submit.
// Uses a per-render nonce for CSP compliance.

export class ConfigPanel {
  private static current: ConfigPanel | undefined;
  private readonly panel: vscode.WebviewPanel;
  private readonly context: vscode.ExtensionContext;
  private disposables: vscode.Disposable[] = [];

  static createOrShow(context: vscode.ExtensionContext): void {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ConfigPanel.current) {
      ConfigPanel.current.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'aimdConfig',
      'AI.md — Configure Sync',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
      }
    );

    ConfigPanel.current = new ConfigPanel(panel, context);
  }

  private constructor(panel: vscode.WebviewPanel, context: vscode.ExtensionContext) {
    this.panel = panel;
    this.context = context;

    this.render();

    this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

    // Handle messages from the webview
    this.panel.webview.onDidReceiveMessage(
      async (msg: { command: string; data: Record<string, string> }) => {
        switch (msg.command) {
          case 'save':
            await this.applySettings(msg.data);
            break;
          case 'testSave':
            await vscode.commands.executeCommand('aimd.saveContext');
            break;
          case 'testLoad':
            await vscode.commands.executeCommand('aimd.loadContext');
            break;
          case 'openGitHub':
            vscode.env.openExternal(vscode.Uri.parse('https://github.com/settings/tokens/new?scopes=gist'));
            break;
          case 'openGCP':
            vscode.env.openExternal(vscode.Uri.parse('https://console.cloud.google.com/apis/credentials'));
            break;
          case 'openAzure':
            vscode.env.openExternal(vscode.Uri.parse('https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade'));
            break;
        }
      },
      null,
      this.disposables
    );
  }

  private render(): void {
    const cfg = vscode.workspace.getConfiguration('aimd');
    const nonce = crypto.randomBytes(16).toString('hex');

    const vals = {
      syncProvider: cfg.get<string>('syncProvider', 'google-drive'),
      localFolderPath: cfg.get<string>('localFolderPath', ''),
      githubToken: cfg.get<string>('githubToken', ''),
      gistId: cfg.get<string>('gistId', ''),
      webhookUrl: cfg.get<string>('webhookUrl', ''),
      platform: cfg.get<string>('platform', 'Claude'),
      autoSave: cfg.get<boolean>('autoSave', true),
      autoSaveInterval: cfg.get<number>('autoSaveInterval', 15),
      saveOnFileSave: cfg.get<boolean>('saveOnFileSave', false),
      includeGitInfo: cfg.get<boolean>('includeGitInfo', true),
      includeFileTree: cfg.get<boolean>('includeFileTree', true),
      fileTreeDepth: cfg.get<number>('fileTreeDepth', 3),
    };

    this.panel.webview.html = this.buildHtml(nonce, vals);
  }

  private async applySettings(data: Record<string, string>): Promise<void> {
    const t = vscode.ConfigurationTarget.Global;
    const cfg = vscode.workspace.getConfiguration('aimd');
    await cfg.update('syncProvider', data.syncProvider, t);
    await cfg.update('localFolderPath', data.localFolderPath, t);
    await cfg.update('githubToken', data.githubToken, t);
    await cfg.update('gistId', data.gistId, t);
    await cfg.update('webhookUrl', data.webhookUrl, t);
    await cfg.update('platform', data.platform, t);
    await cfg.update('autoSave', data.autoSave === 'true', t);
    await cfg.update('autoSaveInterval', parseInt(data.autoSaveInterval, 10), t);
    await cfg.update('saveOnFileSave', data.saveOnFileSave === 'true', t);
    await cfg.update('includeGitInfo', data.includeGitInfo === 'true', t);
    await cfg.update('includeFileTree', data.includeFileTree === 'true', t);
    await cfg.update('fileTreeDepth', parseInt(data.fileTreeDepth, 10), t);

    vscode.window.showInformationMessage('AI.md: Settings saved!');
    this.render(); // Refresh panel with new values
  }

  private buildHtml(nonce: string, v: Record<string, string | boolean | number>): string {
    const esc = (s: string | boolean | number) =>
      String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

    const sel = (key: string, value: string) =>
      String(v[key]) === value ? 'selected' : '';
    const chk = (key: string) => (v[key] ? 'checked' : '');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}';">
<title>AI.md Configuration</title>
<style nonce="${nonce}">
  :root {
    --radius: 6px;
    --gap: 16px;
  }
  *, *::before, *::after { box-sizing: border-box; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size);
    color: var(--vscode-foreground);
    background: var(--vscode-editor-background);
    padding: 24px 32px;
    max-width: 720px;
  }
  h1 { font-size: 1.4em; margin: 0 0 4px; }
  .subtitle { color: var(--vscode-descriptionForeground); margin: 0 0 24px; font-size: 0.9em; }
  section { margin-bottom: 32px; }
  h2 {
    font-size: 0.85em;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--vscode-descriptionForeground);
    margin: 0 0 12px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--vscode-panel-border);
  }
  .field { margin-bottom: 14px; }
  label {
    display: block;
    font-weight: 600;
    margin-bottom: 4px;
    font-size: 0.9em;
  }
  .hint {
    font-size: 0.8em;
    color: var(--vscode-descriptionForeground);
    margin-top: 3px;
  }
  input[type="text"], input[type="password"], input[type="number"], select {
    width: 100%;
    background: var(--vscode-input-background);
    color: var(--vscode-input-foreground);
    border: 1px solid var(--vscode-input-border, #555);
    border-radius: var(--radius);
    padding: 6px 10px;
    font-size: inherit;
    font-family: inherit;
    outline: none;
  }
  input:focus, select:focus {
    border-color: var(--vscode-focusBorder);
    outline: 1px solid var(--vscode-focusBorder);
  }
  .checkbox-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .checkbox-row input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--vscode-button-background); }
  .checkbox-row label { margin: 0; font-weight: normal; cursor: pointer; }
  .provider-section { display: none; }
  .provider-section.active { display: block; }
  .callout {
    background: var(--vscode-textBlockQuote-background);
    border-left: 3px solid var(--vscode-textBlockQuote-border);
    border-radius: 0 var(--radius) var(--radius) 0;
    padding: 10px 14px;
    font-size: 0.85em;
    margin: 10px 0;
  }
  .callout code {
    background: var(--vscode-textCodeBlock-background);
    padding: 1px 4px;
    border-radius: 3px;
  }
  .btn-row { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 8px; }
  button {
    background: var(--vscode-button-background);
    color: var(--vscode-button-foreground);
    border: none;
    border-radius: var(--radius);
    padding: 7px 16px;
    font-size: 0.9em;
    font-family: inherit;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  button:hover { opacity: 0.85; }
  button.secondary {
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  .row2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--gap); }
  @media (max-width: 480px) { .row2 { grid-template-columns: 1fr; } }
  .kbd {
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
    background: var(--vscode-textCodeBlock-background);
    padding: 2px 6px;
    border-radius: 4px;
    border: 1px solid var(--vscode-panel-border);
  }
</style>
</head>
<body>
<h1>AI.md — Context Continuity</h1>
<p class="subtitle">Seamlessly save and restore your AI workflow across devices and platforms.</p>

<form id="form">

<!-- ── Sync Provider ─────────────────────────────── -->
<section>
  <h2>Sync Provider</h2>
  <div class="field">
    <label for="syncProvider">Where should your context be saved?</label>
    <select id="syncProvider" name="syncProvider" onchange="showProvider(this.value)">
      <option value="google-drive" ${sel('syncProvider', 'google-drive')}>Google Drive (OAuth — opens browser once, then automatic)</option>
      <option value="onedrive"     ${sel('syncProvider', 'onedrive')}>Microsoft OneDrive (device code — one-time auth, then automatic)</option>
      <option value="github-gist"  ${sel('syncProvider', 'github-gist')}>GitHub Gist (token — private, any device)</option>
      <option value="local-folder" ${sel('syncProvider', 'local-folder')}>Local Folder (point at Dropbox / iCloud / OneDrive Desktop)</option>
      <option value="webhook"      ${sel('syncProvider', 'webhook')}>Webhook (POST to custom URL)</option>
    </select>
  </div>

  <!-- Google Drive -->
  <div id="provider-google-drive" class="provider-section ${String(v.syncProvider) === 'google-drive' ? 'active' : ''}">
    <div class="callout">
      AI.md will open a browser window for Google sign-in. It only accesses a <strong>private hidden app folder</strong>
      in your Drive — your regular files are never touched.<br><br>
      You need to register an OAuth app at <a href="#" onclick="openGCP()">console.cloud.google.com</a> (Desktop App type, Drive API, <code>drive.appdata</code> scope).
      Then set <code>AIMD_GOOGLE_CLIENT_ID</code> and <code>AIMD_GOOGLE_CLIENT_SECRET</code> environment variables, or contact us for the pre-registered credentials.
    </div>
  </div>

  <!-- OneDrive -->
  <div id="provider-onedrive" class="provider-section ${String(v.syncProvider) === 'onedrive' ? 'active' : ''}">
    <div class="callout">
      AI.md uses the <strong>Microsoft device code flow</strong> — you'll see a short code and URL.
      Visit the URL on any device, enter the code, and you're authorized. No redirect URI needed.<br><br>
      Register an app at <a href="#" onclick="openAzure()">portal.azure.com</a> (Mobile/Desktop platform, <code>files.readwrite.appfolder</code> scope).
      Then set <code>AIMD_MS_CLIENT_ID</code>, or contact us for the pre-registered client ID.
    </div>
  </div>

  <!-- Local Folder -->
  <div id="provider-local-folder" class="provider-section ${String(v.syncProvider) === 'local-folder' ? 'active' : ''}">
    <div class="field">
      <label for="localFolderPath">Folder path</label>
      <input type="text" id="localFolderPath" name="localFolderPath"
        value="${esc(String(v.localFolderPath))}"
        placeholder="e.g. C:\\Users\\You\\Dropbox\\AI or /Users/you/Library/Mobile Documents/...">
      <p class="hint">Point this at a Dropbox, OneDrive, Google Drive Desktop, or iCloud Drive folder
        and your context automatically syncs to all your devices — no OAuth required.</p>
    </div>
  </div>

  <!-- GitHub Gist -->
  <div id="provider-github-gist" class="provider-section ${String(v.syncProvider) === 'github-gist' ? 'active' : ''}">
    <div class="callout">
      A private GitHub Gist stores your <code>ai.md</code> securely in your GitHub account.
      You need a Personal Access Token with the <strong>gist</strong> scope.
      <br><br>
      <button type="button" class="secondary" onclick="openGitHub()">Generate token on GitHub →</button>
    </div>
    <div class="row2">
      <div class="field">
        <label for="githubToken">GitHub Personal Access Token</label>
        <input type="password" id="githubToken" name="githubToken"
          value="${esc(String(v.githubToken))}" placeholder="ghp_xxxxxxxxxxxxxxxxxxxx">
        <p class="hint">Stored in VS Code settings (user scope). Never committed to source control.</p>
      </div>
      <div class="field">
        <label for="gistId">Gist ID (optional)</label>
        <input type="text" id="gistId" name="gistId"
          value="${esc(String(v.gistId))}" placeholder="Auto-created on first save">
        <p class="hint">Leave blank — AI.md will create a new private Gist automatically.</p>
      </div>
    </div>
  </div>

  <!-- Webhook -->
  <div id="provider-webhook" class="provider-section ${String(v.syncProvider) === 'webhook' ? 'active' : ''}">
    <div class="field">
      <label for="webhookUrl">Webhook URL</label>
      <input type="text" id="webhookUrl" name="webhookUrl"
        value="${esc(String(v.webhookUrl))}" placeholder="https://your-backend.com/aimd">
      <p class="hint">AI.md will <code>POST { filename, content, timestamp }</code> as JSON.
        Useful for Notion, custom backends, or cloud functions. Download is not supported for webhooks.</p>
    </div>
  </div>
</section>

<!-- ── Identity ──────────────────────────────────── -->
<section>
  <h2>Identity</h2>
  <div class="field" style="max-width: 280px;">
    <label for="platform">Current AI Platform</label>
    <input type="text" id="platform" name="platform"
      value="${esc(String(v.platform))}" placeholder="Claude">
    <p class="hint">Recorded in the context file so you can see which platform generated the snapshot.
      Change this when you switch AI tools.</p>
  </div>
</section>

<!-- ── Auto-save ─────────────────────────────────── -->
<section>
  <h2>Auto-save</h2>
  <div class="checkbox-row">
    <input type="checkbox" id="autoSave" name="autoSave" value="true" ${chk('autoSave')}>
    <label for="autoSave">Enable periodic auto-save</label>
  </div>
  <div class="field" style="max-width: 200px;">
    <label for="autoSaveInterval">Interval (minutes)</label>
    <input type="number" id="autoSaveInterval" name="autoSaveInterval"
      value="${esc(v.autoSaveInterval)}" min="1" max="120">
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="saveOnFileSave" name="saveOnFileSave" value="true" ${chk('saveOnFileSave')}>
    <label for="saveOnFileSave">Also save context every time you save a file <em>(verbose)</em></label>
  </div>
  <p class="hint">Keyboard shortcut: <span class="kbd">Ctrl+Alt+S</span> / <span class="kbd">⌘+Alt+S</span> to save immediately.</p>
</section>

<!-- ── Context content ───────────────────────────── -->
<section>
  <h2>What to Include</h2>
  <div class="checkbox-row">
    <input type="checkbox" id="includeGitInfo" name="includeGitInfo" value="true" ${chk('includeGitInfo')}>
    <label for="includeGitInfo">Git branch and recent commits</label>
  </div>
  <div class="checkbox-row">
    <input type="checkbox" id="includeFileTree" name="includeFileTree" value="true" ${chk('includeFileTree')}>
    <label for="includeFileTree">Project file tree snapshot</label>
  </div>
  <div class="field" style="max-width: 180px;">
    <label for="fileTreeDepth">File tree depth</label>
    <input type="number" id="fileTreeDepth" name="fileTreeDepth"
      value="${esc(v.fileTreeDepth)}" min="1" max="6">
  </div>
</section>

<!-- ── Actions ───────────────────────────────────── -->
<section>
  <div class="btn-row">
    <button type="submit">Save Settings</button>
    <button type="button" class="secondary" onclick="testSave()">Test: Save Context Now</button>
    <button type="button" class="secondary" onclick="testLoad()">Test: Load Context</button>
  </div>
</section>

</form>

<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();

  function showProvider(val) {
    document.querySelectorAll('.provider-section').forEach(el => el.classList.remove('active'));
    const el = document.getElementById('provider-' + val);
    if (el) el.classList.add('active');
  }

  document.getElementById('form').addEventListener('submit', e => {
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {};
    // Collect all named inputs, defaulting checkboxes to 'false' if unchecked
    ['syncProvider','localFolderPath','githubToken','gistId','webhookUrl','platform',
     'autoSaveInterval','fileTreeDepth'].forEach(k => {
      data[k] = fd.get(k) || '';
    });
    ['autoSave','saveOnFileSave','includeGitInfo','includeFileTree'].forEach(k => {
      data[k] = fd.has(k) ? 'true' : 'false';
    });
    vscode.postMessage({ command: 'save', data });
  });

  function testSave()   { vscode.postMessage({ command: 'testSave' }); }
  function testLoad()   { vscode.postMessage({ command: 'testLoad' }); }
  function openGitHub() { vscode.postMessage({ command: 'openGitHub' }); }
  function openGCP()    { vscode.postMessage({ command: 'openGCP' }); }
  function openAzure()  { vscode.postMessage({ command: 'openAzure' }); }
</script>
</body>
</html>`;
  }

  dispose(): void {
    ConfigPanel.current = undefined;
    this.panel.dispose();
    this.disposables.forEach(d => d.dispose());
    this.disposables = [];
  }
}
