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
} from './aimdFormat';
import {
  updateHabits, parseHabits, serializeHabits, HABITS_FILENAME,
} from './habitsTracker';
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
  print(cyan(bold('  ╔═══════════════════════════════╗')));
  print(cyan(bold('  ║   AI.md  ·  Context Continuity ║')));
  print(cyan(bold('  ╚═══════════════════════════════╝')));
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
    cfg = { provider: 'google-drive' };
    print('');
    print(dim('A browser window will open for Google sign-in.'));
    print(dim('AI.md only accesses its own private app folder — not your regular Drive files.\n'));
    // Trigger auth eagerly
    const provider = new GoogleDriveProvider({ onStatus: s => process.stdout.write(s) });
    await provider.download('_auth_check.ai.md').catch(() => null); // triggers auth flow
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

  const filename = projectFilename(projectName);
  print(dim(`Retrieving "${filename}" from ${providerName(cfg)}…`));

  const provider = createProvider(cfg, { onStatus: s => process.stdout.write(s) });
  const content = await provider.download(filename);

  if (!content) {
    print(yellow(`No context found for "${filename}".`));
    print(dim('Save context with `aimd save` or `Ctrl+Alt+S` in VS Code.\n'));
    return;
  }

  const ctx = parse(content);
  print(green(`✔ Context loaded: ${ctx.project ?? projectName} (${ctx.updated ?? 'unknown time'})`));
  print('');

  const resumePrompt = generateResumePrompt(content);
  await injectIntoAi(resumePrompt, inject);
}

async function cmdSave(projectName?: string): Promise<void> {
  let cfg = loadConfig();
  if (!isConfigured(cfg)) { print(yellow('Not configured.\n')); cfg = await runSetup(false); }

  print(dim(`Capturing context for ${projectName ?? path.basename(process.cwd())}…`));
  const ctx = captureCliContext(projectName);

  const taskInput = await ask(`What are you working on? (press Enter to skip)\n> `);
  if (taskInput.trim()) ctx.task = taskInput.trim();

  const content = serialize(ctx);
  const filename = projectFilename(ctx.project);

  print(dim(`Saving to ${providerName(cfg)} as "${filename}"…`));
  const provider = createProvider(cfg, {
    onGistCreated: (id) => { cfg.gistId = id; saveConfig(cfg); },
    onStatus: s => process.stdout.write(s),
  });
  await provider.upload(filename, content);

  // Update habits (best-effort)
  updateAndSaveHabits(cfg, ctx).catch(() => {});

  print(green(`✔ Saved: ${filename}`));
  print('');
}

async function cmdLoad(projectName?: string): Promise<void> {
  let cfg = loadConfig();
  if (!isConfigured(cfg)) { print(yellow('Not configured.\n')); cfg = await runSetup(false); }

  const filename = projectFilename(projectName);
  print(dim(`Loading "${filename}"…`));
  const provider = createProvider(cfg, { onStatus: s => process.stdout.write(s) });
  const content = await provider.download(filename);

  if (!content) {
    print(yellow(`No context found for "${filename}".\n`));
    return;
  }

  const ctx = parse(content);
  print('');
  print(bold(`═══ ${ctx.project ?? projectName ?? 'Project'} ═══`));
  print(`Platform: ${ctx.platform}  |  Device: ${ctx.device}  |  Updated: ${ctx.updated}`);
  if (ctx.task)       { print(''); print(bold('Task:')); print('  ' + ctx.task); }
  if (ctx.notes)      { print(''); print(bold('Notes:')); print('  ' + ctx.notes); }
  if (ctx.nextSteps?.length) {
    print(''); print(bold('Next steps:'));
    ctx.nextSteps.forEach((s, i) => print(`  ${i + 1}. ${s}`));
  }
  if (ctx.gitBranch)  { print(''); print(`Branch: ${ctx.gitBranch}`); }
  print('');

  const ans = await ask('Inject into AI? (y/N) ');
  if (ans.toLowerCase() === 'y') {
    const resumePrompt = generateResumePrompt(content);
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
  files.forEach(f => {
    const name = f.replace('.ai.md', '').replace(/^ai$/, '(default)');
    print(`  ${green('●')} ${bold(name)}  ${dim(f)}`);
  });
  print('');
  print(dim('Run `aimd @ai.md <project>` to load and inject context into your AI session.'));
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
