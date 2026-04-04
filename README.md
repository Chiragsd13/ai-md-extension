<div align="center">

# @ai.md

### Your AI's Persistent Memory

**Never lose AI context again.** Save your project state once — resume instantly on any device, in any AI.

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](https://marketplace.visualstudio.com/items?itemName=aimd.aimd)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.90%2B-007ACC.svg)](https://code.visualstudio.com/)
[![CLI](https://img.shields.io/badge/CLI-npm%20install%20--g%20aimd-cb3837.svg)](https://www.npmjs.com/package/aimd)
[![Chrome](https://img.shields.io/badge/Chrome-MV3%20Extension-4285F4.svg)](https://chrome.google.com/webstore)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0-brightgreen.svg)](#architecture)

</div>

---

## Why AI.md Exists

Every AI conversation starts from zero. You spend 20 minutes explaining your codebase, your architecture, the bug you're chasing, what you've already tried — and then one of these happens:

- **Usage limit hit** — "You've reached your limit, try again in 3 hours"
- **Switch devices** — Started on your laptop, now you're on your desktop
- **Switch AIs** — Claude hit a wall, let's try ChatGPT or Gemini
- **New session** — The context window rolled, time to explain everything again
- **Token limit** — Long conversation, AI starts forgetting the beginning

**The result:** You repeat yourself. Every. Single. Time.

AI.md captures everything an AI needs to know about your current work and syncs it to your private cloud. When you open a new session — on any device, in any AI — one command restores full context instantly. No copy-pasting, no re-explaining.

---

## What AI.md Does

AI.md creates **two portable Markdown files** per project that travel with you:

| File | Purpose | Contains |
|---|---|---|
| `project.technical.ai.md` | **What you're working on** | Git state, open files, commits, tech stack, file tree, task, notes |
| `project.preferences.ai.md` | **How you want the AI to respond** | Tone, style, code format, rules, constraints, experience level |

Both files are plain Markdown — readable by humans and AIs alike. They sync to your chosen private cloud (GitHub Gist, Google Drive, OneDrive, or a local folder).

### What Gets Captured Automatically

| Data | Source | Example |
|---|---|---|
| Project name | `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod`, git remote, directory name | `my-api-server` |
| Project description | First paragraph of README.md | "A REST API for managing team tasks" |
| Tech stack | Dependency analysis across package managers | TypeScript, React, Prisma, Tailwind CSS |
| Git branch | `git rev-parse --abbrev-ref HEAD` | `feat/auth-flow` |
| Recent commits | `git log` (last 15, formatted) | `a1b2c3 - fix: null session in middleware (2h ago)` |
| Uncommitted changes | `git status --short` | "3 modified, 1 untracked" |
| Recently changed files | `git log --since="7 days ago"` | Files touched in the last week |
| Active/open files | Staged + unstaged from git, or VS Code open tabs | `lib/auth.ts`, `middleware.ts` |
| Project structure | Depth-limited file tree, noise-filtered | Full tree excluding `node_modules`, `.git`, etc. |
| Device name | OS hostname | `MacBook-Pro`, `DESKTOP-ABC123` |
| Your task & notes | You type once, persists across sessions | "Fix OAuth redirect loop on Safari" |

### What Gets Tracked Over Time

AI.md also maintains a **`habits.ai.md`** learning profile that builds automatically:

- Which projects you work on most
- Your primary languages and file types
- When you typically code (morning/afternoon/evening/night)
- Which AI platforms you use
- Recent session history with task summaries

This profile helps new AI sessions understand your working patterns without you explaining them.

---

## Three Ways to Use AI.md

<table>
<tr>
<td width="33%" valign="top">

### VS Code Extension

Best for: **Daily development workflow**

Save context with a keyboard shortcut, auto-save on intervals, use `@ai.md` in Copilot Chat.

</td>
<td width="33%" valign="top">

### CLI (`aimd`)

Best for: **Terminal workflows, CI/CD, scripting**

Works in any terminal on any OS. Auto-detects project from git/package files.

</td>
<td width="33%" valign="top">

### Browser Extension

Best for: **Injecting context into AI web apps**

One-click inject into Claude, ChatGPT, Gemini, AI Studio. Smart auto-tracking of conversations.

</td>
</tr>
</table>

---

## 1. VS Code Extension

### Installation

**From VSIX (local):**
```bash
code --install-extension aimd-1.0.0.vsix
```

Or: Extensions panel > `...` menu > **Install from VSIX** > pick `aimd-1.0.0.vsix`

### Keyboard Shortcuts

| Action | Windows / Linux | macOS |
|---|---|---|
| Save context | `Ctrl + Alt + S` | `Cmd + Alt + S` |
| Load context | `Ctrl + Alt + L` | `Cmd + Alt + L` |
| Add a note | `Ctrl + Alt + N` | `Cmd + Alt + N` |

### Command Palette

Open with `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac), then type `AI.md`:

| Command | What it does |
|---|---|
| `AI.md: Save Context Now` | Capture current workspace state and upload |
| `AI.md: Load Context` | Download saved context and display |
| `AI.md: Add Context Note` | Attach a note (persists across saves) |
| `AI.md: View Saved Context` | Open the `.ai.md` file in a new editor tab |
| `AI.md: View Habits Profile` | Show your auto-learned workflow profile |
| `AI.md: Copy Resume Prompt` | Copy a ready-to-paste prompt for any AI |
| `AI.md: Configure Sync Provider` | Open settings panel to choose storage |
| `AI.md: Clear Context Notes` | Remove all attached notes |

### Copilot Chat Integration

If you have GitHub Copilot installed, you can use `@ai.md` directly in VS Code chat:

```
@ai.md                     Load context for the current workspace
@ai.md my-project          Load context for a specific project
@ai.md save                Save the current workspace context
@ai.md list                List all saved project contexts
@ai.md prompt              Generate and copy a resume prompt
@ai.md habits              Show your workflow habits profile
@ai.md help                Show usage guide
```

### Settings

Configure via **File > Preferences > Settings > AI.md**, or edit `settings.json`:

```jsonc
{
  // Where to sync — "github-gist", "google-drive", "onedrive", "local-folder", "webhook"
  "aimd.syncProvider": "local-folder",

  // For local-folder: absolute path (use a cloud-synced folder for cross-device)
  "aimd.localFolderPath": "C:\\Users\\You\\Dropbox\\AI-Context",

  // For github-gist: your Personal Access Token (scope: gist)
  "aimd.githubToken": "",

  // Auto-save context every N minutes
  "aimd.autoSave": true,
  "aimd.autoSaveInterval": 15,

  // Save context every time you save a file (Ctrl+S)
  "aimd.saveOnFileSave": false,

  // Include git branch, commits, status
  "aimd.includeGitInfo": true,

  // Include project file tree
  "aimd.includeFileTree": true,
  "aimd.fileTreeDepth": 3,

  // Track habits profile (updated on every save)
  "aimd.trackHabits": true,

  // Label for the platform field in the context file
  "aimd.platform": "Claude"
}
```

### Status Bar

The AI.md status bar item shows sync status at the bottom of VS Code:

| Icon | Meaning |
|---|---|
| `@ai.md` | Ready — click to save |
| `@ai.md (syncing...)` | Upload/download in progress |
| `@ai.md (2:45 PM)` | Last save time |
| `@ai.md (error)` | Last sync failed — click for details |

---

## 2. CLI (`aimd`)

### Installation

```bash
npm install -g aimd
```

Or run directly from the project:
```bash
node dist/cli.js <command>
```

### First-Time Setup

```bash
aimd setup
```

Interactive wizard that lets you choose your storage provider:

```
  ╔════════════════════════════════╗
  ║  AI.md  ·  Context Continuity  ║
  ╚════════════════════════════════╝

Set up AI.md — choose where to store your context:

  1. Google Drive   — automatic OAuth, private app folder, any device
  2. OneDrive       — automatic OAuth, private app folder, any device
  3. GitHub Gist    — developer-friendly, any device with your token
  4. Local Folder   — point at Dropbox / iCloud Drive / OneDrive Desktop

Provider [1/2/3/4]:
```

### Commands Reference

#### `aimd save [project]` — Save context

Captures your current directory's project state and uploads it.

```bash
cd ~/my-project
aimd save                    # Auto-detects project name from package.json/git
aimd save my-custom-name     # Override the project name
```

What happens:
1. Auto-detects project name from `package.json` > `Cargo.toml` > `pyproject.toml` > `go.mod` > git remote > directory name
2. Asks you to confirm or type a different name
3. Captures git state, open files, tech stack, file tree
4. Optionally asks what you're working on (or uses AI to infer it)
5. Saves **3 files**: `project.technical.ai.md` + `project.preferences.ai.md` + legacy `project.ai.md`
6. Updates your habits profile

```
$ aimd save

Project name? (Enter for "my-api") >
Capturing context for my-api...
What are you working on? (press Enter for AI to infer)
> Fix the OAuth redirect loop on Safari

Saving technical context -> "my-api.technical.ai.md"...
Creating preferences file -> "my-api.preferences.ai.md"...
  (edit your preferences file to customize AI response style)
Saved: my-api.technical.ai.md + my-api.preferences.ai.md
```

#### `aimd @ai.md [project]` — Load + inject into AI

Downloads your context and pipes it directly into an AI CLI, or copies it to your clipboard and optionally opens Claude.ai.

```bash
aimd @ai.md                  # Load current project context
aimd @ai.md my-api           # Load a specific project
aimd @ai.md my-api --inject claude   # Pipe directly into Claude CLI
aimd @ai.md my-api --inject aider    # Pipe into aider
```

Auto-detects installed AI CLIs: `claude`, `aider`, `sgpt`, `llm`, `openai`. If none found, copies to clipboard.

#### `aimd load [project]` — View saved context

Downloads and displays your context in the terminal, then optionally injects it.

```bash
aimd load                    # Load current project
aimd load my-api             # Load specific project
```

```
$ aimd load my-api

═══ my-api ═══
Platform: CLI/GitHub Gist  |  Device: MacBook-Pro  |  Updated: 4/4/2026 05:23 AM

Task:
  Fix the OAuth redirect loop on Safari

Next steps:
  1. Check sameSite cookie attribute
  2. Test with third-party cookie blocking

Branch: feat/auth

── Preferences ──
  Style: concise
  Tone: professional
  Level: intermediate
  Rules:
    - Never change version numbers without asking first

Inject into AI? (y/N)
```

#### `aimd list` — List all projects

```bash
aimd list
```

```
Saved AI.md contexts

Provider: GitHub Gist

  ● my-api           tech + prefs   my-api.technical.ai.md, my-api.preferences.ai.md
  ● frontend-app     tech + prefs   frontend-app.technical.ai.md, frontend-app.preferences.ai.md
  ● old-project      legacy         old-project.ai.md
```

#### `aimd prefs [project]` — Edit preferences

Interactive questionnaire for customizing how AI assistants respond to you.

```bash
aimd prefs                   # Edit current project preferences
aimd prefs my-api            # Edit specific project
```

```
$ aimd prefs my-api

Editing preferences for "my-api"

Press Enter to keep current value.

Response style [concise]:
Preferred tone [professional]:
Code style [commented]: clean
Explanation depth [thorough]:
Experience level [intermediate]: senior

Custom rules (one per line, empty line to finish):
  Current: Never change version numbers without asking first
Keep existing rules? (Y/n)
Add rule: Always use TypeScript strict mode
Add rule:

Saving -> "my-api.preferences.ai.md"...
Preferences saved.
```

#### Other commands

```bash
aimd prompt [project]        # Copy resume prompt to clipboard
aimd habits                  # Show auto-learned habits profile
aimd config                  # Show current configuration
aimd config set <key> <val>  # Change a config value
aimd logout [google|ms]      # Revoke OAuth tokens
aimd help                    # Show full usage guide
```

### Quick Start: GitHub Gist (fastest setup)

```bash
# If you have GitHub CLI installed:
export GITHUB_TOKEN=$(gh auth token)

# Or use a Personal Access Token:
export GITHUB_TOKEN=ghp_your_token_here

# That's it — save and load from anywhere:
aimd save                    # Creates a private Gist automatically
aimd @ai.md                  # Loads it back on any machine
```

### Smart AI Analysis

If you have `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` set in your environment, AI.md can auto-infer:
- What task you're currently working on (from git commits and changed files)
- 3 key context points a new AI session needs to know
- 3 suggested next steps based on your commit patterns

This runs automatically when you press Enter on the task prompt without typing anything.

---

## 3. Browser Extension (Chrome / Edge / Firefox)

### Installation

**Chrome / Edge:**
1. Go to `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `browser-extension/` folder from this project

**Firefox:**
1. Go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on**
3. Select `browser-extension/manifest.json`

### Supported AI Platforms

| Platform | URL | Status |
|---|---|---|
| Claude | `claude.ai` | Fully supported (ProseMirror injection) |
| ChatGPT | `chatgpt.com` | Fully supported (React contenteditable) |
| Gemini | `gemini.google.com` | Fully supported (Quill editor) |
| AI Studio | `aistudio.google.com` | Fully supported (textarea) |

### Setting Up

1. Click the AI.md icon in your browser toolbar
2. Click **Settings** (gear icon)
3. Choose your storage provider:
   - **GitHub Gist** — paste your Personal Access Token ([create one here](https://github.com/settings/tokens/new?scopes=gist))
   - **Google Drive** — click "Connect Google Drive" for OAuth
   - **Local Download** — saves `.ai.md` files to your Downloads folder
4. Set your project name

### How It Works

Once configured, the browser extension provides:

#### Toolbar Popup
Click the AI.md icon on any AI platform page to:
- **Inject Context** — loads your saved `.ai.md` files and pastes them into the chat input
- **Update via AI** — asks the current AI to generate an updated context file
- **Save Chat** — captures important conversation turns
- See smart tracking status (turns tracked, last save time)

#### Smart Turn Monitoring
The extension automatically watches your AI conversations:
- Detects when the AI finishes generating a response
- Scores each turn for importance (code blocks, file references, action words, length)
- Buffers important turns and auto-saves every 5 significant exchanges
- Auto-saves on: page close, tab switch, battery low, periodic interval

#### In-Context AI Update
Instead of calling a separate API, the extension can ask the **same AI you're chatting with** to generate your updated `.ai.md` file. Three modes:

| Mode | How it works |
|---|---|
| **Suggest** | Injects the update prompt into the chat — you decide when to send |
| **Auto** | Injects + clicks Send + captures the AI's response automatically |
| **Watch** | Passively listens for context-shaped responses and saves them |

#### Auto-Save Triggers
Context is saved automatically when:
- You close the tab (`beforeunload`)
- You switch to another tab (`visibilitychange`)
- Battery drops below 15% (Battery API)
- Every 8 minutes during active conversation
- Every 5 significant conversation turns
- Token limit warning appears in the AI's UI

### Settings Page

Click **Settings** in the popup to configure:

| Setting | Options |
|---|---|
| Cloud Provider | GitHub Gist / Google Drive / Local Download |
| GitHub Token | Your PAT with `gist` scope |
| Smart Auto-Save | Enable/disable automatic tracking |
| AI Update Mode | Suggest / Auto / Watch |

---

## Sync Providers

| Provider | Setup | Cross-device | Privacy | Best for |
|---|---|---|---|---|
| **GitHub Gist** | PAT with `gist` scope | Any device with token | Private Gist | Developers who use GitHub |
| **Google Drive** | OAuth (browser opens once) | Any device | Private app folder | Non-technical users |
| **OneDrive** | Device code flow | Any device | Private app folder | Microsoft ecosystem |
| **Local Folder** | Point at any folder | Via Dropbox/iCloud/OneDrive Desktop | Your machine | Simplest possible setup |
| **Webhook** | Any URL | Via your backend | Your choice | Custom infrastructure |

### Recommended Setup

**Solo developer:** GitHub Gist (1 token, works everywhere, `export GITHUB_TOKEN=...`)

**Team/non-dev:** Local Folder pointed at a Dropbox or iCloud Drive folder

**Privacy-first:** Local Folder with no cloud sync

---

## The Dual-File System

AI.md v1.2 saves **two files** per project, separating *what* you're working on from *how* you want help:

### Technical File (`project.technical.ai.md`)

Contains everything about your current work state:

```markdown
# AI Context -- my-api

> **Updated:** 4/4/2026 05:23 AM  |  **Platform:** CLI  |  **Device:** MacBook-Pro

## Project Overview

| Field | Value |
|---|---|
| Project | `my-api` |
| Branch | `feat/auth` |
| Tech Stack | TypeScript, Next.js, Prisma, Tailwind CSS |

## Current Task

Fix the OAuth login redirect loop on Safari.

## Key Context

- Using NextAuth.js v4 with Google + GitHub providers
- Safari blocks third-party cookies by default since 16.4
- Middleware checks session on every request

## Recent Git Activity

**Branch:** `feat/auth`
**Uncommitted:** 3 modified, 1 untracked

- `a1b2c3` - fix: handle null session in middleware (2 hours ago)
- `d4e5f6` - feat: add Google OAuth provider (yesterday)

## Open / Active Files

- `lib/auth.ts`
- `pages/api/auth/[...nextauth].ts`
- `middleware.ts`

## Project Structure

  my-api/
  |-- src/
  |   |-- lib/
  |   |-- pages/
  |   |-- components/
  |-- prisma/
  |-- package.json
  |-- tsconfig.json
```

### Preferences File (`project.preferences.ai.md`)

Contains your personal AI interaction preferences:

```markdown
# AI Preferences -- my-api

## Response Style

| Setting | Value |
|---|---|
| Style | concise |
| Tone | professional |
| Code Style | commented |
| Explanation Depth | thorough |
| Experience Level | senior |

## Format Preferences

- Markdown formatting
- Code in fenced blocks
- Bullet points over paragraphs
- Numbered steps for procedures
- Direct answers (skip preamble)
- No apologies -- just do it

## Rules & Constraints

- Never change version numbers without asking first
- Always use TypeScript strict mode
- Prefer functional components over class components

## Domain Knowledge

**Languages:** TypeScript, Python
**Topics:** OAuth, REST APIs, database design
```

### Why Two Files?

- **Technical context changes constantly** — every save, every git commit
- **Preferences rarely change** — you set them once and they persist
- **Different audiences** — technical file is for the AI; preferences file is for you to edit
- **Backwards compatible** — legacy single-file format is still written and can still be loaded

---

## How It All Connects

```
                YOUR DEVELOPMENT ENVIRONMENT
     ┌──────────────────────────────────────────────┐
     │                                              │
     │   VS Code          Terminal        Browser   │
     │   Ctrl+Alt+S       aimd save       Auto-     │
     │   @ai.md chat      aimd @ai.md     track     │
     │                                              │
     └──────────┬─────────────┬──────────────┬──────┘
                │             │              │
                └─────────────┼──────────────┘
                              │
                              ▼
                ┌──────────────────────────┐
                │   YOUR PRIVATE CLOUD     │
                │                          │
                │   project.technical.ai.md│
                │   project.preferences.   │
                │   ai.md                  │
                │   habits.ai.md           │
                │                          │
                │   (Gist / GDrive /       │
                │    OneDrive / Local)     │
                └──────────────┬───────────┘
                               │
                ┌──────────────┼──────────────┐
                │              │              │
                ▼              ▼              ▼
          ┌──────────┐  ┌──────────┐  ┌──────────┐
          │  Claude  │  │ ChatGPT  │  │  Gemini  │
          │          │  │          │  │          │
          │ Context  │  │ Context  │  │ Context  │
          │ restored │  │ restored │  │ restored │
          │ in 1 sec │  │ in 1 sec │  │ in 1 sec │
          └──────────┘  └──────────┘  └──────────┘
```

---

## Architecture

```
ai-md-extension/
├── src/                          TypeScript source
│   ├── extension.ts              VS Code entry — commands, auto-save, lifecycle
│   ├── aimdFormat.ts             Core format: serialize, parse, preferences, resume prompt
│   ├── contextCapture.ts         Workspace data: git, files, tech stack (VS Code API)
│   ├── cloudSync.ts              VS Code wrapper for sync providers
│   ├── syncProviders.ts          Pure Node.js: Gist, Google Drive, OneDrive, local, webhook
│   ├── oauthProviders.ts         Google OAuth2 loopback + Microsoft device code flow
│   ├── habitsTracker.ts          Auto-learn workflow patterns (updated every save)
│   ├── smartAnalysis.ts          AI-powered task inference (Anthropic / OpenAI)
│   ├── chatParticipant.ts        @ai.md in VS Code Copilot Chat
│   ├── cli.ts                    Full CLI — 12 commands, interactive setup
│   ├── statusBar.ts              VS Code status bar widget
│   └── configPanel.ts            Webview settings UI
│
├── browser-extension/            Chrome MV3 extension
│   ├── manifest.json             Targets Claude, ChatGPT, Gemini, AI Studio
│   ├── background.js             Service worker — cloud storage, message routing
│   ├── content.js                Smart turn tracking, importance scoring, AI update
│   ├── popup/                    Toolbar popup — inject, AI update, tracking status
│   └── options/                  Settings — provider, auto-save, AI update mode
│
├── jetbrains-plugin/             IntelliJ/WebStorm plugin (Kotlin skeleton)
│   ├── build.gradle.kts
│   └── src/main/kotlin/com/aimd/
│
├── dist/                         esbuild output
│   ├── extension.js              VS Code bundle (55 KB minified)
│   └── cli.js                    CLI bundle (49 KB minified)
│
├── test/                         Test suites (488 assertions)
│   ├── aimdFormat.test.js        Format module — 101 tests
│   ├── cli.test.js               CLI commands — 141 tests
│   ├── smartAnalysis.test.js     AI enrichment — 47 tests
│   ├── browserExtension.test.js  Browser ext — 72 tests
│   └── extension.test.js         VS Code ext — 127 tests
│
├── scripts/
│   ├── check-dist.js             Pre-package gate: tsc + file checks + size limits
│   ├── generate-icons.js         PNG icon generator (zero dependencies)
│   └── generate-vscode-icon.js   VS Code marketplace icon
│
├── esbuild.js                    Dual-bundle build system
└── package.json                  Extension manifest + CLI binary
```

**Zero runtime dependencies.** Both bundles use only Node.js built-ins. Everything is bundled by esbuild.

---

## Development

```bash
# Install dev tools
npm install

# Build both bundles (extension + CLI)
npm run compile:all

# Watch mode — rebuilds on every .ts change
npm run watch:all

# Type-check without building
npm run typecheck

# Run all tests
node test/aimdFormat.test.js
node test/cli.test.js
node test/smartAnalysis.test.js
node test/browserExtension.test.js
node test/extension.test.js

# Build production + pre-package checks + create .vsix
npm run package
```

---

## Registering OAuth Apps (optional)

Only needed for Google Drive and OneDrive. GitHub Gist and local folder work with no registration.

### Google Drive
1. Go to [console.cloud.google.com](https://console.cloud.google.com) > New Project > Enable Drive API
2. Credentials > Create OAuth 2.0 Client > Desktop App
3. Set `AIMD_GOOGLE_CLIENT_ID` + `AIMD_GOOGLE_CLIENT_SECRET` environment variables
4. For the browser extension: replace the placeholder in `browser-extension/manifest.json` under `oauth2.client_id`

### Microsoft OneDrive
1. Go to [portal.azure.com](https://portal.azure.com) > App Registrations > New
2. Platform: Mobile and desktop > Reply URL: `https://login.microsoftonline.com/common/oauth2/nativeclient`
3. API permissions: `files.readwrite.appfolder offline_access`
4. Set `AIMD_MS_CLIENT_ID` environment variable

---

## FAQ

**Q: Is my code or context sent to any third-party server?**
No. AI.md stores files only in your chosen provider (Gist, Google Drive, OneDrive, or local folder). The optional smart analysis feature calls Anthropic or OpenAI APIs only if you explicitly set an API key in your environment.

**Q: What if I switch sync providers?**
Your `.ai.md` files are portable Markdown. Export from one provider, import to another, or just point AI.md at a different storage location.

**Q: Does the browser extension read my conversations?**
Only when smart tracking is enabled. It monitors AI response completion to score turn importance and buffer significant exchanges. No data leaves your browser except to your chosen cloud provider.

**Q: Can I use AI.md with AI tools other than Claude/ChatGPT/Gemini?**
Yes. The CLI works with any AI that accepts text input. The `aimd @ai.md` command auto-detects `claude`, `aider`, `sgpt`, `llm`, and `openai` CLIs. For any other tool, it copies the resume prompt to your clipboard.

**Q: What languages and frameworks does AI.md detect?**
TypeScript, JavaScript, React, Next.js, Vue, Svelte, Angular, NestJS, Electron, Tailwind CSS, Prisma (from package.json), Python (pyproject.toml/requirements.txt), Rust (Cargo.toml), Go (go.mod), Docker (Dockerfile/docker-compose.yml), and VS Code Extensions.

---

<div align="center">

**AI.md** — your AI's persistent memory across every session, device, and platform.

</div>
