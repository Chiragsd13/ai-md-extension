# AI.md — Build, Install & Manual Test Guide

## What's built

| File | Description |
|---|---|
| `dist/extension.js` | VS Code extension (sideloadable + marketplace) |
| `dist/cli.js` | Standalone CLI — `npm install -g aimd` |
| `aimd-1.0.0.vsix` | Installable VS Code package |

---

## 1. Install the VS Code extension (sideload)

```bash
# From the project root — no build step needed, VSIX is already compiled
code --install-extension aimd-1.0.0.vsix
```

Or in VS Code: **Extensions panel** → `···` menu → **Install from VSIX…** → pick `aimd-1.0.0.vsix`.

Restart VS Code if prompted.

---

## 2. Install the CLI globally

```bash
# From the project directory
npm install -g .

# Verify
aimd help
```

Or without global install:
```bash
node C:/ai-md-extension/dist/cli.js help
```

---

## 3. Manual test plan

Work through these in order. Each test is independent — you can stop at any point.

### Test A — First run: configure sync provider

```bash
aimd setup
```

Expected:
- Banner appears
- Menu offers: Google Drive / OneDrive / GitHub Gist / Local Folder
- Choose **4 (Local Folder)** for offline testing
- Path defaults to `~/Documents/AI-Context` (created if missing)
- Config saved to `~/.aimd/config.json`

Verify:
```bash
aimd config
# Should show: Provider: Local Folder (/path/you/chose)
```

---

### Test B — Save context from a project directory

```bash
cd C:/ai-md-extension          # or any git project
aimd save
```

Expected:
- Asks "What are you working on?" — type something and press Enter
- Saves `ai.md` to your configured folder
- Saves `habits.ai.md` to the same folder (auto-generated)

Verify:
```bash
aimd list
# Should show: ● (default)  ai.md

# Inspect the file
aimd show
# Should print a formatted markdown context file

# Check habits
aimd habits
# Should show: language breakdown, project counts, time-of-day heatmap
```

---

### Test C — Save a named project

```bash
aimd save my-project
```

Verify:
```bash
aimd list
# Should now show both: ai.md  AND  my-project.ai.md
```

---

### Test D — Load context and inject into AI

```bash
aimd @ai.md my-project
```

Expected:
- Loads context for `my-project`
- Shows project summary in terminal
- Asks "Inject into AI? (y/N)"
- If you type `y`: tries detected AI CLIs (claude, aider, sgpt, llm…), then falls back to clipboard
- If Claude CLI is installed: opens a Claude session with your full context pre-loaded
- If not: copies resume prompt to clipboard + optionally opens Claude.ai in browser

---

### Test E — Copy resume prompt (paste into any AI)

```bash
aimd prompt my-project
```

Expected:
- Copies a ready-to-paste prompt to clipboard
- The prompt says: *"I'm resuming work on my-project… here's my context…"*
- Paste into Claude, ChatGPT, Gemini, or any web AI to resume seamlessly

---

### Test F — Switch AI mid-project (the portability test)

1. Save context: `aimd save my-project`
2. Close current AI session (or hit your usage limit)
3. On the **same or a different device**: `aimd @ai.md my-project`
4. Paste the resume prompt into a **different AI** (e.g. ChatGPT if you were on Claude)
5. The new AI has full context and continues seamlessly

---

### Test G — Test cross-device with cloud storage

1. Run `aimd setup` and choose **Google Drive** or **OneDrive**
2. Authorize with your account (browser opens for Google; terminal shows code for OneDrive)
3. Save context: `aimd save my-project`
4. On a second device: install the CLI (`npm install -g aimd`)
5. Run `aimd setup` — choose the same provider, sign in again
6. Run `aimd @ai.md my-project` — context downloads from cloud automatically

---

### Test H — VS Code extension

1. Open any project in VS Code (after installing the `.vsix`)
2. Check the status bar bottom-right: should show `☁ AI.md`
3. Press `Ctrl+Alt+S` → context saved, status bar shows last save time
4. Press `Ctrl+Alt+N` → add a note (e.g. "Bug: login fails on Safari")
5. Press `Ctrl+Alt+S` again → note included in the save
6. Open Command Palette (`Ctrl+Shift+P`), type `AI.md:` → all commands visible
7. Run `AI.md: Copy Resume Prompt` → paste into any AI

### Test I — `@ai.md` in VS Code Copilot Chat

(Requires GitHub Copilot subscription)

1. Open Copilot Chat panel
2. Type: `@ai.md` and press Enter → loads current workspace context
3. Type: `@ai.md my-project` → loads named project
4. Type: `@ai.md save` → saves context from within chat
5. Type: `@ai.md list` → lists all saved projects
6. Type: `@ai.md prompt` → shows resume prompt in chat

---

## 4. Build from source

```bash
cd C:/ai-md-extension
npm install
node esbuild.js --all        # build extension + CLI
npx vsce package             # create aimd-1.0.0.vsix
```

---

## 5. Publish to VS Code Marketplace

1. Create publisher at https://marketplace.visualstudio.com/manage
2. Update `"publisher"` in `package.json` to your publisher ID
3. Create a PAT at https://dev.azure.com → User Settings → Personal Access Tokens (scope: Marketplace Manage)
4. ```bash
   npx vsce login <your-publisher>
   npx vsce publish
   ```
5. Publish CLI to npm: `npm publish` (requires `npm login` first)

After publish, users install with:
- VS Code: `code --install-extension <publisher>.aimd`
- CLI: `npm install -g aimd`

---

## 6. Register OAuth apps (for Google Drive / OneDrive)

### Google Drive
1. https://console.cloud.google.com → New Project → Enable Drive API
2. Credentials → Create → Desktop App → Download client secret
3. Set env vars: `AIMD_GOOGLE_CLIENT_ID` and `AIMD_GOOGLE_CLIENT_SECRET`
4. Or update the constants in `src/oauthProviders.ts` before building

### OneDrive
1. https://portal.azure.com → App Registrations → New
2. Platform: Mobile and desktop → Reply URL: `https://login.microsoftonline.com/common/oauth2/nativeclient`
3. API permissions: `files.readwrite.appfolder offline_access`
4. Set `AIMD_MS_CLIENT_ID` env var or update the constant in `src/oauthProviders.ts`

---

## 3b. Install the browser extension

The browser extension is in `browser-extension/` — load it as an unpacked extension.

### Chrome / Edge

1. Open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `C:/ai-md-extension/browser-extension/` folder
5. The AI.md icon appears in your toolbar

### Firefox

1. Open `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Navigate to `C:/ai-md-extension/browser-extension/manifest.json`

### First-time setup (browser extension)

1. Click the AI.md toolbar icon → click **⚙ Options**
2. Create a GitHub Personal Access Token:
   - Go to **github.com → Settings → Developer Settings → Tokens (classic)**
   - Create token with the `gist` scope
3. Paste the token in **Options** and click **Save Settings**
4. Click **Test Connection** to verify

### Usage

- Open **Claude**, **ChatGPT**, or **Gemini** in any tab
- A floating **`@ AI.md`** button appears bottom-right
- Click it to inject your saved project context directly into the chat input
- Or click the toolbar icon → **Copy to clipboard** and paste manually

> **Cross-device sync:** the same GitHub Gist is shared across all devices where you install the extension — context saved on your laptop appears instantly on any other device.

---

### Generate PNG icons (optional — for publishing)

Chrome requires PNG icons for the extension listing. Open `browser-extension/icons/generate-icons.html` in any browser, then click **Download All** to save `icon16.png`, `icon32.png`, `icon48.png`, and `icon128.png` into the `icons/` folder.

---

## 7. Project structure

```
ai-md-extension/
├── src/
│   ├── extension.ts        VS Code entry — commands, auto-save, lifecycle
│   ├── aimdFormat.ts       Serialize/parse ai.md + resume-prompt generator
│   ├── contextCapture.ts   Collect workspace, git, open files, user notes
│   ├── cloudSync.ts        VS Code wrapper for sync providers
│   ├── syncProviders.ts    Pure Node.js: Gist, local, Google Drive, OneDrive, webhook
│   ├── oauthProviders.ts   Google OAuth2 loopback + Microsoft device code flow
│   ├── habitsTracker.ts    Auto-learn habits, writes habits.ai.md on every save
│   ├── chatParticipant.ts  @ai.md in VS Code Copilot Chat
│   ├── cli.ts              Terminal CLI — aimd @ai.md, save, load, inject
│   ├── statusBar.ts        VS Code status bar integration
│   └── configPanel.ts      Webview configuration UI
├── browser-extension/      Chrome / Firefox / Edge extension
│   ├── manifest.json       MV3 manifest — permissions, content scripts, popup
│   ├── background.js       Service worker — GitHub Gist API, message routing
│   ├── content.js          Injected into Claude/ChatGPT/Gemini — "@AI.md" button
│   ├── popup/              Toolbar popup UI (save/load/status)
│   ├── options/            Settings page (GitHub token, project name)
│   └── icons/              SVG source + PNG generator (generate-icons.html)
├── dist/                   Compiled output (esbuild)
├── aimd-1.0.0.vsix         Installable VS Code package
├── package.json
├── esbuild.js
└── tsconfig.json
```
