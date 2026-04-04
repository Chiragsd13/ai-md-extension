#!/usr/bin/env node
/**
 * cli.ts — AI.md command-line interface
 *
 * Install globally:
 *   npm install -g aimd          (from npm registry after publishing)
 *   npm install -g .             (from source)
 *
 * Core usage:
 *   aimd setup                   First-time auth (Google Drive, OneDrive, Gist, or local folder)
 *   aimd @ai.md [project]        Download context and inject into the active AI session
 *   aimd save [project]          Save current directory context
 *   aimd load [project]          Download and display context
 *   aimd prompt [project]        Generate + copy a resume prompt for any AI platform
 *   aimd list                    List all saved context files
 *   aimd habits                  Show the auto-learned habits profile
 *   aimd config                  Show / edit configuration
 *   aimd logout [google|ms]      Revoke stored OAuth tokens
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as readline from 'readline';
import * as cp from 'child_process';
import {
  SyncConfig, ProviderType,
  createProvider, providerName, projectFilename,
  GistProvider, GoogleDriveProvider, OneDriveProvider,
} from './syncProviders';
import {
  serialize, parse, generateResumePrompt,
  AIMdContext, AIMD_VERSION, newSessionId, deviceName,
  projectFilenames, legacyFilename,
  AIMdPreferences, serializePreferences, parsePreferences, defaultPreferences,
  fmt,
} from './aimdFormat';
import {
  updateHabits, parseHabits, serializeHabits, HABITS_FILENAME,
} from './habitsTracker';
import { enrichWithAI } from './smartAnalysis';
import {
  hasGoogleToken, hasMsToken, clearGoogleToken, clearMsToken,
} from './oauthProviders';

// ─── Config ───────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.aimd');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function loadConfig(): SyncConfig {
  if (!fs.existsSync(CONFIG_FILE)) return { provider: 'local-folder', localFolderPath: os.homedir() };
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as SyncConfig; }
  catch { return { provider: 'local-folder', localFolderPath: os.homedir() }; }
}

function saveConfig(cfg: SyncConfig): void {
  if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
}

function isConfigured(cfg: SyncConfig): boolean {
  if (cfg.provider === 'github-gist') return !!(cfg.githubToken?.trim());
  if (cfg.provider === 'google-drive') return hasGoogleToken();
  if (cfg.provider === 'onedrive') return hasMsToken();
  if (cfg.provider === 'webhook') return !!(cfg.webhookUrl?.trim());
  return true; // local-folder always works
}

// ─── ANSI helpers ─────────────────────────────────────────────────────────────

const C = process.stdout.isTTY;
const bold  = (s: string) => C ? `\x1b[1m${s}\x1b[0m` : s;
const dim   = (s: string) => C ? `\x1b[2m${s}\x1b[0m` : s;
const green = (s: string) => C ? `\x1b[32m${s}\x1b[0m` : s;
const yellow= (s: string) => C ? `\x1b[33m${s}\x1b[0m` : s;
const red   = (s: string) => C ? `\x1b[31m${s}\x1b[0m` : s;
const cyan  = (s: string) => C ? `\x1b[36m${s}\x1b[0m` : s;
const print = (s = '') => process.stdout.write(s + '\n');

function banner() {
  print();
  print(cyan(bold('  ╔════════════════════════════════╗')));
  print(cyan(bold('  ║  AI.md  ·  Context Continuity  ║')));
  print(cyan(bold('  ╚════════════════════════════════╝')));
  print();
}

// ─── Readline wrapper ─────────────────────────────────────────────────────────

let rl: readline.Interface | undefined;

function getRL(): readline.Interface {
  if (!rl) rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return rl;
}

function closeRL() { rl?.close(); rl = undefined; }

function ask(q: string): Promise<string> {
  return new Promise(r => getRL().question(q, r));
}

function askSecret(prompt: string): Promise<string> {
  return new Promise(resolve => {
    if (!process.stdin.isTTY) { ask(prompt).then(resolve); return; }
    process.stdout.write(prompt);
    let buf = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const onData = (ch: Buffer) => {
      const s = ch.toString();
      if (s === '\n' || s === '\r' || s === '\u0004') {
        process.stdin.removeListener('data', onData);
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdout.write('\n');
        resolve(buf);
      } else if (s === '\u0003') { process.stdout.write('\n'); process.exit(1); }
      else if (s === '\x7f' || s === '\b') buf = buf.slice(0, -1);
      else buf += s;
    };
    process.stdin.on('data', onData);
  });
}

// ─── Git helpers ──────────────────────────────────────────────────────────────

function gitExec(cmd: string, cwd: string): string {
  try { return cp.execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).toString().trim(); }
  catch { return ''; }
}

// ─── Context capture (no VS Code) ────────────────────────────────────────────
//
// Auto-collects rich project context from the filesystem and git:
//   • Project metadata from package.json / pyproject.toml / Cargo.toml / go.mod
//   • Project description from README.md
//   • Tech stack detection
//   • Git: branch, remote, rich log, uncommitted status, recently changed files
//   • Project file tree (depth-limited, noise-filtered)

function captureCliContext(projectName?: string): AIMdContext {
  const cwd  = process.cwd();
  const cfg  = loadConfig();
  const now  = new Date().toISOString();

  // ── Project metadata ───────────────────────────────────────────────────────
  const { name: pkgName, description: pkgDesc, techStack } = readProjectMeta(cwd);
  const resolvedProject = projectName ?? pkgName ?? path.basename(cwd);
  const projectDescription = readProjectDescription(cwd) ?? pkgDesc;

  // ── Git ────────────────────────────────────────────────────────────────────
  const gitBranch  = gitExec('git rev-parse --abbrev-ref HEAD', cwd) || undefined;
  const gitRemote  = gitExec('git remote get-url origin', cwd) || undefined;

  // Rich log: hash · message (relative time)
  const gitLogRaw = gitExec(
    'git log --pretty=format:"%h · %s (%cr)" -15', cwd
  );
  const gitCommits = gitLogRaw ? gitLogRaw.split('\n').filter(Boolean) : undefined;

  // Git status summary
  const statusRaw = gitExec('git status --short', cwd);
  const gitStatusSummary = summariseGitStatus(statusRaw);

  // Recently changed files (last 7 days of commits)
  const recentRaw = gitExec(
    'git log --since="7 days ago" --name-only --pretty=format:"" --diff-filter=d', cwd
  );
  const recentFiles = recentRaw
    ? [...new Set(recentRaw.split('\n').filter(Boolean))].slice(0, 25)
    : undefined;

  // ── Currently open/active files ────────────────────────────────────────────
  // Best proxy without VS Code: files with uncommitted changes + recently modified
  const uncommitted = gitExec('git diff --name-only HEAD', cwd);
  const staged      = gitExec('git diff --cached --name-only', cwd);
  const activeFromGit = [...new Set([
    ...uncommitted.split('\n'), ...staged.split('\n')
  ])].filter(Boolean);

  let openFiles: string[] = activeFromGit;
  if (openFiles.length === 0) {
    // Fallback: top-level source files (non-dot, non-binary)
    try {
      const SOURCE_EXT = new Set([
        'ts','tsx','js','jsx','py','rs','go','java','cs','cpp','c','h',
        'swift','kt','rb','php','vue','svelte','html','css','scss','md','toml','yaml','json',
      ]);
      openFiles = fs.readdirSync(cwd)
        .filter(f => {
          if (f.startsWith('.')) return false;
          const ext = f.split('.').pop()?.toLowerCase() ?? '';
          const fullPath = path.join(cwd, f);
          return SOURCE_EXT.has(ext) && fs.statSync(fullPath).isFile();
        })
        .slice(0, 20);
    } catch { /* ignore */ }
  }

  // ── File tree ──────────────────────────────────────────────────────────────
  const fileTree = buildCliFileTree(cwd, 3);

  return {
    version: AIMD_VERSION,
    created: now,
    updated: now,
    project: resolvedProject,
    platform: cfg.provider === 'google-drive' ? 'CLI/Google Drive'
            : cfg.provider === 'onedrive'     ? 'CLI/OneDrive'
            : cfg.provider === 'github-gist'  ? 'CLI/GitHub Gist'
            : 'CLI',
    device: deviceName(),
    sessionId: newSessionId(),
    task: '', notes: '',
    nextSteps: [],
    workspacePath: cwd,
    projectDescription: projectDescription ?? undefined,
    techStack: techStack.length ? techStack : undefined,
    gitRemote,
    openFiles,
    recentFiles: recentFiles?.length ? recentFiles : undefined,
    gitBranch,
    gitCommits: gitCommits?.length ? gitCommits : undefined,
    gitStatusSummary: gitStatusSummary ?? undefined,
    fileTree: fileTree ?? undefined,
  };
}

// ── Project metadata helpers ───────────────────────────────────────────────────

function readJsonSafe(filePath: string): Record<string, unknown> | null {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function readFileSafe(filePath: string): string | null {
  try { return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null; }
  catch { return null; }
}

interface ProjectMeta { name?: string; description?: string; techStack: string[] }

function readProjectMeta(cwd: string): ProjectMeta {
  const stack: string[] = [];
  let name: string | undefined;
  let description: string | undefined;

  // package.json
  const pkg = readJsonSafe(path.join(cwd, 'package.json')) as {
    name?: string; description?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  } | null;
  if (pkg) {
    name = pkg.name;
    description = pkg.description;
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const d = (n: string) => n in deps;
    if (d('typescript') || d('@types/node')) stack.push('TypeScript');
    else stack.push('JavaScript / Node.js');
    if (d('react') || d('react-dom'))     stack.push('React');
    if (d('next'))                         stack.push('Next.js');
    if (d('vue'))                          stack.push('Vue');
    if (d('svelte'))                       stack.push('Svelte');
    if (d('@angular/core'))                stack.push('Angular');
    if (d('express') || d('fastify'))      stack.push('Node HTTP');
    if (d('@nestjs/core'))                 stack.push('NestJS');
    if (d('electron'))                     stack.push('Electron');
    if (d('@types/vscode'))                stack.push('VS Code Extension');
    if (d('tailwindcss'))                  stack.push('Tailwind CSS');
    if (d('prisma') || d('@prisma/client'))stack.push('Prisma');
  }

  // pyproject.toml
  const pyproject = readFileSafe(path.join(cwd, 'pyproject.toml'));
  if (pyproject) {
    stack.push('Python');
    const m = pyproject.match(/^description\s*=\s*["'](.+?)["']/m);
    if (m && !description) description = m[1];
    const nm = pyproject.match(/^name\s*=\s*["'](.+?)["']/m);
    if (nm && !name) name = nm[1];
  } else if (fs.existsSync(path.join(cwd, 'requirements.txt'))) {
    stack.push('Python');
  }

  // Cargo.toml
  const cargo = readFileSafe(path.join(cwd, 'Cargo.toml'));
  if (cargo) {
    stack.push('Rust');
    const m = cargo.match(/^description\s*=\s*["'](.+?)["']/m);
    if (m && !description) description = m[1];
    const nm = cargo.match(/^name\s*=\s*["'](.+?)["']/m);
    if (nm && !name) name = nm[1];
  }

  // go.mod
  const gomod = readFileSafe(path.join(cwd, 'go.mod'));
  if (gomod) {
    stack.push('Go');
    const nm = gomod.match(/^module (.+)$/m);
    if (nm && !name) name = nm[1].split('/').pop();
  }

  // Docker
  if (fs.existsSync(path.join(cwd, 'Dockerfile')) ||
      fs.existsSync(path.join(cwd, 'docker-compose.yml'))) {
    stack.push('Docker');
  }

  return { name, description, techStack: [...new Set(stack)] };
}

function readProjectDescription(cwd: string): string | null {
  // Try README files
  for (const name of ['README.md', 'readme.md', 'README.txt', 'README']) {
    const text = readFileSafe(path.join(cwd, name));
    if (!text) continue;
    const para = extractFirstParagraphCli(text);
    if (para && para.length > 10) return para;
  }
  return null;
}

function extractFirstParagraphCli(markdown: string): string {
  const lines = markdown.split('\n');
  let inCode = false;
  const paras: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('```')) { inCode = !inCode; continue; }
    if (inCode || line.startsWith('#')) continue;

    if (line.trim() === '') {
      if (current.length > 0) { paras.push(current.join(' ').trim()); current = []; }
    } else {
      const clean = line
        .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\*(.+?)\*/g, '$1')
        .replace(/`(.+?)`/g, '$1').replace(/\[(.+?)\]\(.+?\)/g, '$1').trim();
      if (clean) current.push(clean);
    }
    if (paras.length > 0) break;
  }
  if (current.length) paras.push(current.join(' ').trim());
  const result = paras[0] ?? '';
  return result.length > 400 ? result.slice(0, 400) + '…' : result;
}

function summariseGitStatus(raw: string): string | null {
  if (!raw) return null;
  const lines = raw.split('\n').filter(Boolean);
  const M = lines.filter(l => l[0] === 'M' || l[1] === 'M').length;
  const A = lines.filter(l => l[0] === 'A').length;
  const D = lines.filter(l => l[0] === 'D' || l[1] === 'D').length;
  const Q = lines.filter(l => l.startsWith('??')).length;
  const parts: string[] = [];
  if (M) parts.push(`${M} modified`);
  if (A) parts.push(`${A} added`);
  if (D) parts.push(`${D} deleted`);
  if (Q) parts.push(`${Q} untracked`);
  return parts.length ? parts.join(', ') : null;
}

const TREE_IGNORE = new Set([
  'node_modules','.git','dist','build','out','.next','__pycache__',
  '.mypy_cache','venv','.venv','env','target','.idea','.vscode',
  'coverage','.nyc_output','vendor','.turbo','.cache','tmp',
  'package-lock.json','yarn.lock','pnpm-lock.yaml',
]);

function buildCliFileTree(cwd: string, maxDepth: number): string | null {
  try {
    interface TN { name: string; children: Map<string, TN>; isFile: boolean }
    const root: TN = { name: '', children: new Map(), isFile: false };

    const walk = (dir: string, depth: number) => {
      if (depth > maxDepth) return;
      let entries: string[];
      try { entries = fs.readdirSync(dir); } catch { return; }
      for (const entry of entries) {
        if (TREE_IGNORE.has(entry) || entry.startsWith('.')) continue;
        const full = path.join(dir, entry);
        const rel  = path.relative(cwd, full).replace(/\\/g, '/');
        const parts = rel.split('/');
        if (parts.some(p => TREE_IGNORE.has(p))) continue;

        let node = root;
        for (let i = 0; i < parts.length; i++) {
          const p = parts[i];
          if (!node.children.has(p)) {
            node.children.set(p, { name: p, children: new Map(), isFile: i === parts.length - 1 });
          }
          node = node.children.get(p)!;
        }

        try {
          if (fs.statSync(full).isDirectory()) {
            node.isFile = false; // correct: may have been created as isFile:true for 1-part paths
            walk(full, depth + 1);
          }
        } catch { /* ignore */ }
      }
    };
    walk(cwd, 0);

    const lines: string[] = [path.basename(cwd) + '/'];
    const render = (node: TN, prefix: string) => {
      const entries = [...node.children.values()].sort((a, b) => {
        if (a.isFile !== b.isFile) return a.isFile ? 1 : -1;
        return a.name.localeCompare(b.name);
      });
      entries.forEach((child, idx) => {
        const last = idx === entries.length - 1;
        lines.push(prefix + (last ? '└── ' : '├── ') + child.name + (child.isFile ? '' : '/'));
        if (!child.isFile) render(child, prefix + (last ? '    ' : '│   '));
      });
    };
    render(root, '');
    return lines.length > 1 ? lines.join('\n') : null;
  } catch {
    return null;
  }
}

// ─── AI CLI injection ─────────────────────────────────────────────────────────
//
// Tries to pass the resume prompt directly to a detected AI CLI.
// If none found, falls back to clipboard + browser open.

function detectAiCli(): { name: string; cmd: string } | null {
  const candidates = [
    { name: 'Claude CLI',  cmd: 'claude'  },
    { name: 'aider',       cmd: 'aider'   },
    { name: 'sgpt',        cmd: 'sgpt'    },
    { name: 'llm',         cmd: 'llm'     },
    { name: 'openai-cli',  cmd: 'openai'  },
  ];
  for (const c of candidates) {
    try {
      cp.execSync(`which ${c.cmd} 2>/dev/null || where ${c.cmd} 2>nul`, { stdio: 'ignore' });
      return c;
    } catch { /* not found */ }
  }
  return null;
}

async function injectIntoAi(resumePrompt: string, targetCli?: string): Promise<void> {
  const cli = targetCli
    ? { name: targetCli, cmd: targetCli }
    : detectAiCli();

  if (cli) {
    print(dim(`Injecting context into ${cli.name}…`));
    print(dim('(press Ctrl+C to cancel)\n'));
    try {
      // Spawn the AI CLI with the resume prompt piped as initial message
      const proc = cp.spawn(cli.cmd, [], {
        stdio: ['pipe', 'inherit', 'inherit'],
        shell: true,
      });
      proc.stdin?.write(resumePrompt + '\n');
      proc.stdin?.end();
      await new Promise<void>(r => proc.on('close', () => r()));
      return;
    } catch (e) {
      print(yellow(`Could not launch ${cli.cmd}: ${(e as Error).message}`));
    }
  }

  // Fallback: copy to clipboard + open AI web interface
  copyToClipboard(resumePrompt);
  print(green('✔ Resume prompt copied to clipboard.'));
  print(dim('Paste it into Claude.ai, ChatGPT, Gemini, or any AI to resume your session.'));
  print('');

  const openBrowser = await ask('Open Claude.ai in browser? (y/N) ');
  if (openBrowser.toLowerCase() === 'y') {
    try {
      const url = 'https://claude.ai/new';
      if (process.platform === 'win32') cp.execSync(`start "" "${url}"`, { stdio: 'ignore' });
      else if (process.platform === 'darwin') cp.execSync(`open "${url}"`, { stdio: 'ignore' });
      else cp.execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
    } catch { /* ignore */ }
  }
}

// ─── Interactive setup ────────────────────────────────────────────────────────

async function runSetup(forced = false): Promise<SyncConfig> {
  banner();

  if (!forced && fs.existsSync(CONFIG_FILE)) {
    const cfg = loadConfig();
    print(bold('AI.md is already configured:'));
    print(`  Provider: ${providerName(cfg)}`);
    print('');
    const ans = await ask('Re-configure? (y/N) ');
    if (ans.toLowerCase() !== 'y') return cfg;
  }

  print(bold('Set up AI.md — choose where to store your context:\n'));
  print(`  1. ${bold('Google Drive')}   ${dim('— automatic OAuth, private app folder, any device')}`);
  print(`  2. ${bold('OneDrive')}       ${dim('— automatic OAuth, private app folder, any device')}`);
  print(`  3. ${bold('GitHub Gist')}    ${dim('— developer-friendly, any device with your token')}`);
  print(`  4. ${bold('Local Folder')}   ${dim('— point at Dropbox / iCloud Drive / OneDrive Desktop')}`);
  print('');

  const choice = await ask('Provider [1/2/3/4]: ');
  let cfg: SyncConfig;

  if (choice === '1') {
    print('');
    // Check for existing credentials in env vars or config
    const envId = process.env.AIMD_GOOGLE_CLIENT_ID;
    const envSecret = process.env.AIMD_GOOGLE_CLIENT_SECRET;
    const existingCfg = loadConfig();

    let clientId: string;
    let clientSecret: string;

    if (envId && envSecret) {
      print(green('✔ Found Google credentials in environment variables.\n'));
      clientId = envId;
      clientSecret = envSecret;
    } else if (existingCfg.googleClientId && existingCfg.googleClientSecret) {
      print(green('✔ Found Google credentials in config.\n'));
      clientId = existingCfg.googleClientId;
      clientSecret = existingCfg.googleClientSecret;
    } else {
      print(bold('Google Drive requires OAuth credentials from Google Cloud Console:\n'));
      print(dim('  1. Go to https://console.cloud.google.com'));
      print(dim('  2. Create a project (or select existing)'));
      print(dim('  3. APIs & Services → Enable "Google Drive API"'));
      print(dim('  4. Credentials → Create Credentials → OAuth 2.0 Client ID'));
      print(dim('  5. Application type: "Desktop app" → Create'));
      print(dim('  6. Copy the Client ID and Client Secret below\n'));
      clientId = (await ask('Google Client ID: ')).trim();
      clientSecret = (await askSecret('Google Client Secret: ')).trim();
      if (!clientId || !clientSecret) {
        print(red('\nBoth Client ID and Client Secret are required.'));
        print(dim('Re-run `aimd setup` when you have them.\n'));
        return loadConfig();
      }
    }

    cfg = { provider: 'google-drive', googleClientId: clientId, googleClientSecret: clientSecret };
    saveConfig(cfg); // Save credentials before triggering OAuth

    print(dim('A browser window will open for Google sign-in.'));
    print(dim('AI.md only accesses its own private app folder — not your regular Drive files.\n'));
    const gdProvider = new GoogleDriveProvider({ onStatus: s => process.stdout.write(s) });
    await gdProvider.download('_auth_check.ai.md').catch(() => null); // triggers auth flow
    print(green('✔ Google Drive connected.\n'));

  } else if (choice === '2') {
    cfg = { provider: 'onedrive' };
    print('');
    print(dim('You will see a short code and URL to authorize Microsoft OneDrive.'));
    print(dim('AI.md only accesses its own private app folder.\n'));
    const provider = new OneDriveProvider({ onStatus: s => process.stdout.write(s) });
    await provider.download('_auth_check.ai.md').catch(() => null); // triggers device code flow
    print(green('✔ OneDrive connected.\n'));

  } else if (choice === '3') {
    print('');
    // Auto-detect GITHUB_TOKEN from environment (gh CLI, git credentials, etc.)
    const envToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
    if (envToken) {
      print(green(`✔ Found GITHUB_TOKEN in environment — using it automatically.\n`));
      cfg = { provider: 'github-gist', githubToken: envToken };
    } else {
      print(dim('Tip: if you have the GitHub CLI installed, run `gh auth login` first and'));
      print(dim('set GITHUB_TOKEN=$(gh auth token) to skip this step next time.\n'));
      print(dim('Or create a token at: https://github.com/settings/tokens (scope: gist)\n'));
      const token = await askSecret('GitHub Personal Access Token: ');
      cfg = { provider: 'github-gist', githubToken: token.trim() };
      print(green('\n✔ Token saved. A private Gist will be created on first save.\n'));
    }

  } else {
    const defaultPath = path.join(os.homedir(), 'Documents', 'AI-Context');
    const input = await ask(`Folder path [${defaultPath}]: `);
    const folderPath = input.trim() || defaultPath;
    if (!fs.existsSync(folderPath)) {
      fs.mkdirSync(folderPath, { recursive: true });
      print(green(`✔ Created: ${folderPath}\n`));
    }
    cfg = { provider: 'local-folder', localFolderPath: folderPath };
  }

  saveConfig(cfg);
  print(green('✔ Configuration saved → ' + CONFIG_FILE));
  print('');
  return cfg;
}

// ─── Commands ─────────────────────────────────────────────────────────────────

/**
 * @ai.md [project] — The primary trigger.
 * Downloads context and injects it directly into the active AI session.
 */
async function cmdAtAiMd(projectName: string | undefined, inject?: string): Promise<void> {
  let cfg = loadConfig();

  // Auto-setup if not configured
  if (!isConfigured(cfg)) {
    print(yellow('AI.md is not configured on this device.\n'));
    cfg = await runSetup(true);
  }

  const resolvedName = projectName ?? autoDetectProjectName() ?? path.basename(process.cwd());
  const { technical: techFile, preferences: prefFile } = projectFilenames(resolvedName);
  const legacy = legacyFilename(resolvedName);

  const provider = createProvider(cfg, { onStatus: s => process.stdout.write(s) });

  // Try technical file first, fall back to legacy
  print(dim(`Retrieving "${techFile}" from ${providerName(cfg)}…`));
  let techContent = await provider.download(techFile);
  if (!techContent) {
    techContent = await provider.download(legacy);
  }

  if (!techContent) {
    print(yellow(`No context found for "${resolvedName}".`));
    print(dim('Save context with `aimd save` or `Ctrl+Alt+S` in VS Code.\n'));
    return;
  }

  const ctx = parse(techContent);
  print(green(`✔ Technical context loaded: ${ctx.project ?? resolvedName} (${ctx.updated ?? 'unknown time'})`));

  // Also load preferences
  const prefContent = await provider.download(prefFile).catch(() => null);
  if (prefContent) {
    print(green(`✔ Preferences loaded`));
  }
  print('');

  // Merge both into the resume prompt
  let combined = techContent;
  if (prefContent) {
    combined += '\n\n---\n\n' + prefContent;
  }

  const resumePrompt = generateResumePrompt(combined);
  await injectIntoAi(resumePrompt, inject);
}

async function cmdSave(projectName?: string): Promise<void> {
  let cfg = loadConfig();
  if (!isConfigured(cfg)) { print(yellow('Not configured.\n')); cfg = await runSetup(false); }

  // ── Auto-extract project name from git/package.json, or ask ────────────────
  const autoName = autoDetectProjectName();
  let resolvedName = projectName;

  if (!resolvedName) {
    const suggestion = autoName ?? path.basename(process.cwd());
    const nameInput = await ask(`Project name? (Enter for ${bold(`"${suggestion}"`)}) > `);
    resolvedName = nameInput.trim() || suggestion;
  }

  print(dim(`Capturing context for ${resolvedName}…`));
  let ctx = captureCliContext(resolvedName);

  // ── Load existing context to preserve accumulated knowledge ────────────
  const { technical: techFile, preferences: prefFile } = projectFilenames(ctx.project);
  const provider = createProvider(cfg, {
    onGistCreated: (id) => { cfg.gistId = id; saveConfig(cfg); },
    onStatus: s => process.stdout.write(s),
  });

  let prev: Partial<AIMdContext> = {};
  try {
    const existingTech = await provider.download(techFile);
    if (existingTech) prev = parse(existingTech);
  } catch { /* first save */ }

  // ── Task ────────────────────────────────────────────────────────────────
  if (prev.task) print(dim(`  Previous task: "${prev.task}"`));
  const taskInput = await ask(`What are you working on?${prev.task ? ' (Enter to keep)' : ' (Enter for AI to infer)'}\n> `);
  if (taskInput.trim()) {
    ctx.task = taskInput.trim();
  } else if (prev.task) {
    ctx.task = prev.task;
  } else {
    const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY);
    if (hasKey) {
      process.stdout.write(dim('  Analyzing context with AI…'));
      ctx = await enrichWithAI(ctx);
      if (ctx.aiGeneratedTask) {
        process.stdout.write(green(' ✔\n'));
        print(dim(`  Task: "${ctx.aiGeneratedTask}"`));
      } else {
        process.stdout.write(dim(' (no key or failed, skipped)\n'));
      }
    }
  }

  // ── Context Notes ──────────────────────────────────────────────────────
  if (prev.notes) print(dim(`  Previous notes: ${prev.notes.length > 100 ? prev.notes.slice(0, 100) + '…' : prev.notes}`));
  const notesInput = await ask(`Key decisions / context notes?${prev.notes ? ' (Enter to keep)' : ' (Enter to skip)'}\n> `);
  ctx.notes = notesInput.trim() || prev.notes || '';

  // ── Next Steps ─────────────────────────────────────────────────────────
  if (prev.nextSteps?.length) {
    print(dim('  Previous next steps:'));
    prev.nextSteps.forEach((s, i) => print(dim(`    ${i + 1}. ${s}`)));
  }
  print(dim('  Next steps (one per line, empty line to finish):'));
  const steps: string[] = [];
  let stepInput = await ask('  > ');
  while (stepInput.trim()) {
    steps.push(stepInput.trim());
    stepInput = await ask('  > ');
  }
  ctx.nextSteps = steps.length > 0 ? steps : (prev.nextSteps ?? []);

  // ── Captured Prompts ───────────────────────────────────────────────────
  if (prev.capturedPrompts?.length) {
    print(dim(`  ${prev.capturedPrompts.length} prompt(s) carried from previous sessions`));
  }
  print(dim('  Key prompts / decisions to remember (one per line, empty to finish):'));
  const newPrompts: string[] = [];
  let promptInput = await ask('  > ');
  while (promptInput.trim()) {
    newPrompts.push(promptInput.trim());
    promptInput = await ask('  > ');
  }
  if (newPrompts.length || prev.capturedPrompts?.length) {
    ctx.capturedPrompts = [...(prev.capturedPrompts ?? []), ...newPrompts].slice(-15);
    ctx.conversationPlatform = 'CLI';
    ctx.conversationCapturedAt = new Date().toISOString();
  }

  // ── Preserve AI enrichment from previous save ──────────────────────────
  if (!ctx.aiContextPoints?.length && prev.aiContextPoints?.length) ctx.aiContextPoints = prev.aiContextPoints;
  if (!ctx.aiNextSteps?.length && prev.aiNextSteps?.length) ctx.aiNextSteps = prev.aiNextSteps;

  // ── Save BOTH files: technical + preferences ────────────────────────────────
  const techContent = serialize(ctx);

  // 1. Technical file — always saved
  print(dim(`Saving technical context → "${techFile}"…`));
  await provider.upload(techFile, techContent);

  // 2. Preferences file — create if missing, preserve if exists
  let existingPrefs: string | null = null;
  try { existingPrefs = await provider.download(prefFile); } catch { /* first time */ }

  if (!existingPrefs) {
    print(dim(`Creating preferences file → "${prefFile}"…`));
    const prefs = defaultPreferences(ctx.project);
    // Auto-populate from tech stack
    if (ctx.techStack?.length)  prefs.preferredLanguages = ctx.techStack;
    prefs.customRules = [
      'Never change version numbers without asking first',
    ];
    await provider.upload(prefFile, serializePreferences(prefs));
    print(dim('  (edit your preferences file to customize AI response style)'));
  } else {
    // Preferences exists — update the timestamp but don't overwrite user edits
    const parsed = parsePreferences(existingPrefs);
    if (parsed.project) {
      const updated = existingPrefs.replace(
        /> \*\*Updated:\*\*.+/,
        `> **Updated:** ${fmt(new Date().toISOString())}  |  **AI.md Version:** ${AIMD_VERSION}`
      );
      await provider.upload(prefFile, updated);
    }
  }

  // 3. Also save legacy single file for backwards compatibility
  const legacyFile = legacyFilename(ctx.project);
  await provider.upload(legacyFile, techContent);

  // Update habits (best-effort)
  updateAndSaveHabits(cfg, ctx).catch(() => {});

  print(green(`✔ Saved: ${techFile} + ${prefFile}`));
  print('');
}

// ── Auto-detect project name from multiple sources ────────────────────────────

function autoDetectProjectName(): string | null {
  const cwd = process.cwd();

  // 1. package.json name
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'));
    if (pkg.name && typeof pkg.name === 'string') return pkg.name;
  } catch { /* no package.json */ }

  // 2. Cargo.toml name
  try {
    const cargo = fs.readFileSync(path.join(cwd, 'Cargo.toml'), 'utf8');
    const m = cargo.match(/^name\s*=\s*["'](.+?)["']/m);
    if (m) return m[1];
  } catch { /* no Cargo.toml */ }

  // 3. pyproject.toml name
  try {
    const py = fs.readFileSync(path.join(cwd, 'pyproject.toml'), 'utf8');
    const m = py.match(/^name\s*=\s*["'](.+?)["']/m);
    if (m) return m[1];
  } catch { /* no pyproject.toml */ }

  // 4. go.mod module name
  try {
    const gomod = fs.readFileSync(path.join(cwd, 'go.mod'), 'utf8');
    const m = gomod.match(/^module (.+)$/m);
    if (m) return m[1].split('/').pop() ?? null;
  } catch { /* no go.mod */ }

  // 5. Git remote repo name
  const remote = gitExec('git remote get-url origin', cwd);
  if (remote) {
    const m = remote.match(/\/([^/]+?)(?:\.git)?$/);
    if (m) return m[1];
  }

  // 6. .git directory name (repo root)
  const gitRoot = gitExec('git rev-parse --show-toplevel', cwd);
  if (gitRoot) return path.basename(gitRoot);

  // 7. Fall back to directory name
  return path.basename(cwd);
}

async function cmdLoad(projectName?: string): Promise<void> {
  let cfg = loadConfig();
  if (!isConfigured(cfg)) { print(yellow('Not configured.\n')); cfg = await runSetup(false); }

  const resolvedName = projectName ?? autoDetectProjectName() ?? path.basename(process.cwd());
  const { technical: techFile, preferences: prefFile } = projectFilenames(resolvedName);
  const legacy = legacyFilename(resolvedName);

  const provider = createProvider(cfg, { onStatus: s => process.stdout.write(s) });

  // Try loading technical file first, fall back to legacy single file
  print(dim(`Loading "${techFile}"…`));
  let techContent = await provider.download(techFile);
  if (!techContent) {
    print(dim(`  Not found, trying legacy "${legacy}"…`));
    techContent = await provider.download(legacy);
  }

  if (!techContent) {
    print(yellow(`No context found for "${resolvedName}".\n`));
    return;
  }

  const ctx = parse(techContent);
  print('');
  print(bold(`═══ ${ctx.project ?? resolvedName} ═══`));
  print(`Platform: ${ctx.platform}  |  Device: ${ctx.device}  |  Updated: ${ctx.updated}`);
  if (ctx.task)       { print(''); print(bold('Task:')); print('  ' + ctx.task); }
  if (ctx.notes)      { print(''); print(bold('Notes:')); print('  ' + ctx.notes); }
  if (ctx.nextSteps?.length) {
    print(''); print(bold('Next steps:'));
    ctx.nextSteps.forEach((s, i) => print(`  ${i + 1}. ${s}`));
  }
  if (ctx.gitBranch)  { print(''); print(`Branch: ${ctx.gitBranch}`); }

  // Also load preferences
  const prefContent = await provider.download(prefFile).catch(() => null);
  if (prefContent) {
    const prefs = parsePreferences(prefContent);
    print('');
    print(bold('── Preferences ──'));
    if (prefs.responseStyle)    print(`  Style: ${prefs.responseStyle}`);
    if (prefs.preferredTone)    print(`  Tone: ${prefs.preferredTone}`);
    if (prefs.experienceLevel)  print(`  Level: ${prefs.experienceLevel}`);
    if (prefs.customRules?.length) {
      print('  Rules:');
      prefs.customRules.forEach(r => print(`    • ${r}`));
    }
  }

  print('');

  const ans = await ask('Inject into AI? (y/N) ');
  if (ans.toLowerCase() === 'y') {
    // Merge both files into the resume prompt
    let combined = techContent;
    if (prefContent) {
      combined += '\n\n---\n\n' + prefContent;
    }
    const resumePrompt = generateResumePrompt(combined);
    await injectIntoAi(resumePrompt);
  }
}

async function cmdPrompt(projectName?: string): Promise<void> {
  const cfg = loadConfig();
  const provider = createProvider(cfg, { onStatus: s => process.stdout.write(s) });
  const content = await provider.download(projectFilename(projectName));
  if (!content) { print(yellow('No context found.')); return; }
  const prompt = generateResumePrompt(content);
  copyToClipboard(prompt);
  print(green('✔ Resume prompt copied to clipboard.'));
  print(dim('Paste into Claude, ChatGPT, Gemini, or any other AI to resume seamlessly.\n'));
}

async function cmdList(): Promise<void> {
  const cfg = loadConfig();
  print(bold('Saved AI.md contexts\n'));
  print(dim(`Provider: ${providerName(cfg)}\n`));
  const provider = createProvider(cfg, { onStatus: () => {} });
  const files = await (provider.listFiles?.() ?? Promise.resolve([]));
  if (!files.length) { print(dim('No contexts saved yet.\n')); return; }

  // Group by project name
  const projects = new Map<string, string[]>();
  files.forEach(f => {
    let proj: string;
    if (f.includes('.technical.ai.md')) proj = f.replace('.technical.ai.md', '');
    else if (f.includes('.preferences.ai.md')) proj = f.replace('.preferences.ai.md', '');
    else proj = f.replace('.ai.md', '');
    if (proj === 'ai' || proj === '') proj = '(default)';

    if (!projects.has(proj)) projects.set(proj, []);
    projects.get(proj)!.push(f);
  });

  projects.forEach((fileList, proj) => {
    const isTech = fileList.some(f => f.includes('.technical.'));
    const isPref = fileList.some(f => f.includes('.preferences.'));
    const isLegacy = fileList.some(f => !f.includes('.technical.') && !f.includes('.preferences.'));

    const badges: string[] = [];
    if (isTech)   badges.push(cyan('tech'));
    if (isPref)   badges.push(yellow('prefs'));
    if (isLegacy && !isTech) badges.push(dim('legacy'));

    print(`  ${green('●')} ${bold(proj)}  ${badges.join(' + ')}  ${dim(fileList.join(', '))}`);
  });

  print('');
  print(dim('Run `aimd @ai.md <project>` to load and inject context into your AI session.'));
  print('');
}

async function cmdPrefs(projectName?: string): Promise<void> {
  let cfg = loadConfig();
  if (!isConfigured(cfg)) { print(yellow('Not configured.\n')); cfg = await runSetup(false); }

  const resolvedName = projectName ?? autoDetectProjectName() ?? path.basename(process.cwd());
  const prefFile = projectFilenames(resolvedName).preferences;
  const provider = createProvider(cfg, {
    onGistCreated: (id) => { cfg.gistId = id; saveConfig(cfg); },
    onStatus: s => process.stdout.write(s),
  });

  // Load existing or create default
  let existing = await provider.download(prefFile).catch(() => null);
  let prefs: AIMdPreferences;

  if (existing) {
    const parsed = parsePreferences(existing);
    prefs = { ...defaultPreferences(resolvedName), ...parsed } as AIMdPreferences;
    print(bold(`Editing preferences for "${resolvedName}"\n`));
  } else {
    prefs = defaultPreferences(resolvedName);
    print(bold(`Creating preferences for "${resolvedName}"\n`));
  }

  // Interactive questionnaire
  print(dim('Press Enter to keep current value.\n'));

  const styleInput = await ask(`Response style [${prefs.responseStyle}]: `);
  if (styleInput.trim()) prefs.responseStyle = styleInput.trim();

  const toneInput = await ask(`Preferred tone [${prefs.preferredTone}]: `);
  if (toneInput.trim()) prefs.preferredTone = toneInput.trim();

  const codeInput = await ask(`Code style [${prefs.codeStyle}]: `);
  if (codeInput.trim()) prefs.codeStyle = codeInput.trim();

  const depthInput = await ask(`Explanation depth [${prefs.explanationDepth}]: `);
  if (depthInput.trim()) prefs.explanationDepth = depthInput.trim();

  const levelInput = await ask(`Experience level [${prefs.experienceLevel}]: `);
  if (levelInput.trim()) prefs.experienceLevel = levelInput.trim();

  // Rules
  print('');
  print(bold('Custom rules') + dim(' (one per line, empty line to finish):'));
  if (prefs.customRules?.length) {
    print(dim(`  Current: ${prefs.customRules.join('; ')}`));
  }
  const keepRules = await ask('Keep existing rules? (Y/n) ');
  if (keepRules.toLowerCase() === 'n') prefs.customRules = [];

  let ruleInput = await ask('Add rule: ');
  while (ruleInput.trim()) {
    prefs.customRules = prefs.customRules ?? [];
    prefs.customRules.push(ruleInput.trim());
    ruleInput = await ask('Add rule: ');
  }

  prefs.updated = new Date().toISOString();

  const content = serializePreferences(prefs);
  print(dim(`\nSaving → "${prefFile}"…`));
  await provider.upload(prefFile, content);

  print(green(`✔ Preferences saved: ${prefFile}`));
  print('');
}

async function cmdHabits(): Promise<void> {
  const cfg = loadConfig();
  const provider = createProvider(cfg, { onStatus: s => process.stdout.write(s) });
  const content = await provider.download(HABITS_FILENAME);
  if (!content) { print(yellow('No habits profile yet. Save some context first.\n')); return; }
  print(content);
}

function cmdConfigShow(args: string[]): void {
  if (args[0] === 'set' && args[1] && args[2] !== undefined) {
    const cfg = loadConfig();
    (cfg as unknown as Record<string, string>)[args[1]] = args[2];
    saveConfig(cfg);
    print(green(`✔ Set ${args[1]} = ${args[2]}`));
    return;
  }
  print(bold('AI.md Configuration\n'));
  print(`Config : ${CONFIG_FILE}`);
  const cfg = loadConfig();
  print(`Provider: ${providerName(cfg)}`);
  if (cfg.githubToken) print(`Token  : ${dim(cfg.githubToken.slice(0, 8) + '…')}`);
  if (cfg.gistId)      print(`Gist   : ${cfg.gistId}`);
  if (cfg.provider === 'google-drive') print(`Google : ${hasGoogleToken() ? green('authorized') : yellow('not authorized')}`);
  if (cfg.provider === 'onedrive')     print(`MS     : ${hasMsToken() ? green('authorized') : yellow('not authorized')}`);
  print('');
}

function cmdLogout(service?: string): void {
  if (!service || service === 'google') { clearGoogleToken(); print(green('✔ Google token cleared.')); }
  if (!service || service === 'ms' || service === 'onedrive') { clearMsToken(); print(green('✔ Microsoft token cleared.')); }
  if (service && !['google', 'ms', 'onedrive'].includes(service)) {
    print(yellow(`Unknown service "${service}". Use "google" or "ms".`));
  }
}

// ─── Habits helper ────────────────────────────────────────────────────────────

async function updateAndSaveHabits(cfg: SyncConfig, ctx: AIMdContext): Promise<void> {
  const provider = createProvider(cfg, { onStatus: () => {} });
  const existing = await provider.download(HABITS_FILENAME).catch(() => null);
  const data = existing ? parseHabits(existing) : null;
  const updated = updateHabits(data, ctx);
  await provider.upload(HABITS_FILENAME, serializeHabits(updated));
}

// ─── Clipboard ────────────────────────────────────────────────────────────────

function copyToClipboard(text: string): void {
  try {
    if (process.platform === 'win32') cp.execSync('clip', { input: text });
    else if (process.platform === 'darwin') cp.execSync('pbcopy', { input: text });
    else {
      for (const cmd of ['xclip -selection clipboard', 'xsel --clipboard --input', 'wl-copy']) {
        try { cp.execSync(cmd, { input: text }); return; } catch { /* try next */ }
      }
      print(text); // Last resort: just print
    }
  } catch { print(text); }
}

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp(): void {
  banner();
  print(bold('Usage:  aimd <command> [project] [--inject <ai-cli>]\n'));
  print(bold('Commands:'));
  print(`  ${cyan('@ai.md')} [project]              Download context + inject into active AI session`);
  print(`  ${cyan('save')} [project]                Save current directory context`);
  print(`  ${cyan('load')} [project]                Download, display, then optionally inject`);
  print(`  ${cyan('prompt')} [project]              Copy resume prompt to clipboard`);
  print(`  ${cyan('list')}                          List all saved contexts`);
  print(`  ${cyan('prefs')} [project]               Edit AI response preferences`);
  print(`  ${cyan('habits')}                        Show auto-learned habits profile`);
  print(`  ${cyan('setup')}                         Configure sync provider (interactive)`);
  print(`  ${cyan('config')} [set <key> <val>]      Show / edit config`);
  print(`  ${cyan('logout')} [google|ms]            Revoke OAuth tokens`);
  print('');
  print(bold('Options:'));
  print(`  ${cyan('--inject')} <ai>               Force injection into a specific AI CLI`);
  print(`                             e.g. --inject claude, --inject aider, --inject sgpt`);
  print('');
  print(bold('Examples:'));
  print('  aimd @ai.md                     # Load current-dir context and inject into AI');
  print('  aimd @ai.md my-project          # Load "my-project" context');
  print('  aimd @ai.md my-project --inject claude   # Inject directly into Claude CLI');
  print('  aimd save                       # Save current project context');
  print('  aimd save my-project            # Save under a specific project name');
  print('  aimd list                       # List all saved projects');
  print('');
  print(dim(`Config: ${CONFIG_FILE}`));
  print('');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Extract --inject flag
  const injectIdx = args.indexOf('--inject');
  const injectCli = injectIdx !== -1 ? args[injectIdx + 1] : undefined;
  const cleanArgs = injectIdx === -1
    ? args
    : args.filter((_, i) => i !== injectIdx && i !== injectIdx + 1);

  const [cmd, ...rest] = cleanArgs;

  try {
    switch (cmd?.toLowerCase()) {
      case 'setup':
        await runSetup(true);
        break;
      case '@ai.md':
      case 'at':
        await cmdAtAiMd(rest[0], injectCli);
        break;
      case 'save':
        await cmdSave(rest[0]);
        break;
      case 'load':
        await cmdLoad(rest[0]);
        break;
      case 'prompt':
      case 'resume':
        await cmdPrompt(rest[0]);
        break;
      case 'list':
        await cmdList();
        break;
      case 'prefs':
      case 'preferences':
        await cmdPrefs(rest[0]);
        break;
      case 'habits':
        await cmdHabits();
        break;
      case 'config':
        cmdConfigShow(rest);
        break;
      case 'logout':
        cmdLogout(rest[0]);
        break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        printHelp();
        break;
      default:
        // Handle shell quoting edge cases: `aimd @ai.md project`
        if (cmd.startsWith('@')) {
          await cmdAtAiMd(rest[0] ?? cmd.slice(cmd.indexOf('.md') + 3).trim() ?? undefined, injectCli);
        } else {
          print(red(`Unknown command: ${cmd}`));
          print(dim('Run `aimd help` for usage.\n'));
          process.exitCode = 1;
        }
    }
  } catch (err: unknown) {
    print(red(`\nError: ${err instanceof Error ? err.message : String(err)}`));
    process.exitCode = 1;
  } finally {
    closeRL();
  }
}

main();
