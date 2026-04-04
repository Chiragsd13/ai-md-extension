# @ai.md — AI Context Continuity

> **Never lose AI context again.** Save your project state once — resume instantly on any device, in any AI.

AI.md is a cross-platform context continuity layer for AI workflows. When you hit a usage cap, switch devices, or move from Claude to ChatGPT, your full project context — git state, open files, tech stack, task notes, decisions made — travels with you as a portable `.ai.md` file stored in your own private cloud.

---

## The Problem

Every AI conversation starts fresh. You've spent an hour getting Claude up to speed on your codebase, explaining the architecture, the bug you're chasing, what you've already tried. Then:

- You hit the usage limit
- You switch to a different device
- You want to try ChatGPT or Gemini instead
- A new conversation starts and you have to explain everything again

AI.md solves this by capturing everything the AI needs to know about your current work session and syncing it to your private storage. On any new session, one click restores full context instantly.

---

## What Gets Captured Automatically

| What | How |
|---|---|
| Project description | README.md first paragraph |
| Tech stack | package.json, pyproject.toml, Cargo.toml, go.mod |
| Git branch + recent commits | `git log --pretty="%h · %s (%cr)"` |
| Uncommitted changes | `git status --short` → "3 modified, 1 untracked" |
| Recently changed files | Files touched in last 7 days |
| Active files | Staged/unstaged changes, or fallback to top-level source files |
| Project structure | Depth-3 file tree (noise-filtered) |
| Your task & notes | You type these once, they persist across sessions |

---

## Three Ways to Install

### VS Code Extension

```bash
code --install-extension aimd-1.0.0.vsix
```

Or: Extensions panel → `···` → Install from VSIX → pick `aimd-1.0.0.vsix`

**Shortcuts:**
| Action | Windows/Linux | macOS |
|---|---|---|
| Save context | `Ctrl+Alt+S` | `Cmd+Alt+S` |
| Load context | `Ctrl+Alt+L` | `Cmd+Alt+L` |
| Add a note | `Ctrl+Alt+N` | `Cmd+Alt+N` |

**VS Code Copilot Chat** (requires GitHub Copilot):
```
@ai.md                    → load current workspace context
@ai.md my-project         → load named project
@ai.md save               → save from chat
@ai.md list               → list all saved projects
@ai.md prompt             → copy resume prompt to clipboard
```

---

### CLI

```bash
npm install -g aimd

aimd setup                  # First-time: choose your sync provider
aimd save                   # Save current directory context
aimd save my-project        # Save under a specific name
aimd @ai.md                 # Load + inject into active AI session
aimd @ai.md my-project      # Load named project
aimd load                   # Download and display
aimd prompt my-project      # Copy resume prompt to clipboard
aimd list                   # List all saved projects
aimd habits                 # Show your workflow habits profile
aimd config                 # Show configuration
```

**Quick start with GitHub Gist (no OAuth needed):**
```bash
export GITHUB_TOKEN=ghp_yourtoken   # or: gh auth token
aimd save                           # creates a private Gist automatically
aimd @ai.md                         # loads it back anywhere
```

---

### Browser Extension (Chrome / Firefox / Edge)

1. **Chrome/Edge:** `chrome://extensions` → Developer mode → Load unpacked → select `browser-extension/`
2. **Firefox:** `about:debugging` → Load Temporary Add-on → select `browser-extension/manifest.json`
3. Click the toolbar icon → **⚙ Settings** → paste a [GitHub token](https://github.com/settings/tokens/new?scopes=gist) (scope: `gist`)

Once installed, a floating **`@ AI.md`** button appears on Claude, ChatGPT, Gemini, and AI Studio. Click it to inject your saved project context directly into the chat input.

---

## Sync Providers

| Provider | Auth | Cross-device | Notes |
|---|---|---|---|
| **GitHub Gist** | Personal Access Token | ✅ | Recommended for developers |
| **Google Drive** | OAuth (browser opens once) | ✅ | Private app folder — not in your Drive |
| **OneDrive** | Device code (paste short code) | ✅ | Private app folder |
| **Local Folder** | None | With Dropbox/iCloud/OneDrive Desktop | Simplest — point at any synced folder |
| **Webhook** | Your choice | ✅ | POST to any URL |

---

## How It Works

```
┌─────────────┐   aimd save / Ctrl+Alt+S   ┌──────────────────────┐
│  Your code  │ ──────────────────────────▶ │   your-project.ai.md │
│  Git state  │                             │   (GitHub Gist /     │
│  Open files │                             │    Google Drive /    │
│  Tech stack │                             │    Local folder)     │
└─────────────┘                             └──────────┬───────────┘
                                                        │
                   Any device, any AI                   │ aimd @ai.md
                                                        ▼
                                           ┌────────────────────────┐
                                           │  Claude / ChatGPT /    │
                                           │  Gemini / any AI       │
                                           │                        │
                                           │  Here's my context:    │
                                           │  Project: my-app       │
                                           │  Branch: feat/auth     │
                                           │  Task: fix login bug   │
                                           │  ...                   │
                                           └────────────────────────┘
```

---

## The `.ai.md` Format

Context files are plain Markdown — readable by humans and AIs alike:

```markdown
# AI Context — my-project

> **Updated:** 4/4/2026  |  **Platform:** CLI/GitHub Gist  |  **Device:** MacBook-Pro

## Project Overview

A next.js app for managing team tasks. Uses Prisma + PostgreSQL.

| Field      | Value               |
|------------|---------------------|
| Branch     | `feat/auth`         |
| Tech Stack | TypeScript, Next.js, Prisma, Tailwind CSS |

## Current Task

Fix the OAuth login redirect loop on Safari — only happens when cookies are blocked.

## Next Steps

1. Check if `sameSite: 'lax'` fixes the issue on Safari
2. Test with third-party cookie restrictions enabled
3. Add fallback to email magic-link if OAuth fails

## Recent Git Activity

- `a1b2c3` · fix: handle null session in middleware (2 hours ago)
- `d4e5f6` · feat: add Google OAuth provider (yesterday)

## Open / Active Files

- `lib/auth.ts`
- `pages/api/auth/[...nextauth].ts`
- `middleware.ts`
```

---

## Habits Profile

Every save updates a `habits.ai.md` file that builds a personal profile of your workflow patterns:

```markdown
## Projects (4 sessions)
  my-project  ██████████  10
  api-service ████        4

## Languages
  TypeScript  ██████████
  Python      ████

## Active Hours
  09  ████████
  14  ██████████
  22  ██████
```

This profile helps AI assistants understand your working style and preferred patterns without you having to explain them.

---

## Architecture

```
ai-md-extension/
├── src/
│   ├── extension.ts        VS Code entry — commands, auto-save, lifecycle
│   ├── aimdFormat.ts       Serialize/parse .ai.md + resume-prompt generator
│   ├── contextCapture.ts   Collect workspace, git, open files (VS Code)
│   ├── cloudSync.ts        VS Code wrapper for sync providers
│   ├── syncProviders.ts    Pure Node.js: Gist, local, Google Drive, OneDrive, webhook
│   ├── oauthProviders.ts   Google OAuth2 loopback + Microsoft device code flow
│   ├── habitsTracker.ts    Auto-learn habits profile (updated every save)
│   ├── chatParticipant.ts  @ai.md in VS Code Copilot Chat
│   ├── cli.ts              CLI — aimd save, load, @ai.md, inject
│   ├── statusBar.ts        VS Code status bar integration
│   └── configPanel.ts      Webview settings UI
│
├── browser-extension/
│   ├── manifest.json       Chrome MV3 + Firefox — targets Claude/ChatGPT/Gemini
│   ├── background.js       Service worker — GitHub Gist API, message routing
│   ├── content.js          Floating @ AI.md button, platform-specific insertion
│   ├── popup/              Toolbar popup — platform badge, inject, copy
│   └── options/            Settings — GitHub token, project, test connection
│
├── dist/                   esbuild output (extension.js + cli.js)
├── scripts/
│   └── check-dist.js       Pre-package gate: tsc + size checks
├── .github/workflows/
│   └── ci.yml              CI: type-check, build, size gate, VSIX artifact
├── esbuild.js              Dual-bundle build (--all, --cli, --watch, --production)
└── package.json
```

**Zero runtime dependencies.** Both bundles use only Node.js built-ins (`fs`, `https`, `http`, `child_process`, `readline`, `os`, `path`). Everything is bundled by esbuild — no `node_modules` needed at runtime.

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

# Build production + run pre-package checks + create .vsix
npm run package
```

**Claude Code hook** (auto-configured in `.claude/settings.json`):
After every file edit, the project automatically rebuilds — no manual `npm run compile:all` needed during active development.

---

## Publishing (when ready)

```bash
# 1. Bump version in package.json (only when ready — do NOT change version without intent)
# 2. Run full check
npm run package

# 3. Publish VS Code extension
npx vsce login <your-publisher>
npx vsce publish

# 4. Publish CLI to npm
npm publish

# CI also publishes automatically when a tag like v1.0.1 is pushed to main
git tag v1.0.1 && git push origin v1.0.1
```

**Required secrets** (GitHub → Settings → Secrets):
- `VSCE_PAT` — Azure DevOps PAT with Marketplace Manage scope
- `NPM_TOKEN` — npm access token with publish rights

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `aimd.syncProvider` | `local-folder` | Where to sync: gist / google-drive / onedrive / local-folder / webhook |
| `aimd.autoSave` | `true` | Auto-save every N minutes |
| `aimd.autoSaveInterval` | `15` | Minutes between auto-saves |
| `aimd.saveOnFileSave` | `false` | Save context on every Ctrl+S |
| `aimd.includeGitInfo` | `true` | Include git commits and status |
| `aimd.includeFileTree` | `true` | Include file tree snapshot |
| `aimd.fileTreeDepth` | `3` | Max tree depth |
| `aimd.trackHabits` | `true` | Maintain habits.ai.md profile |

---

## Registering OAuth Apps (optional)

Only needed for Google Drive and OneDrive providers. GitHub Gist and local folder work with no registration.

### Google Drive
1. [console.cloud.google.com](https://console.cloud.google.com) → New Project → Enable Drive API
2. Credentials → Create OAuth 2.0 Client → Desktop App
3. Set `AIMD_GOOGLE_CLIENT_ID` + `AIMD_GOOGLE_CLIENT_SECRET` env vars

### Microsoft OneDrive
1. [portal.azure.com](https://portal.azure.com) → App Registrations → New
2. Platform: Mobile and desktop → Reply URL: `https://login.microsoftonline.com/common/oauth2/nativeclient`
3. API permissions: `files.readwrite.appfolder offline_access`
4. Set `AIMD_MS_CLIENT_ID` env var

---

*AI.md — your AI's persistent memory across every session, device, and platform.*
