import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import { AIMdContext, AIMD_VERSION, newSessionId, deviceName } from './aimdFormat';

// ─── ContextCapture ────────────────────────────────────────────────────────────
//
// Collects rich, actionable project context from the live VS Code workspace.
// Everything is auto-collected — no user action required beyond pressing save.

export class ContextCapture {
  private readonly context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async captureContext(): Promise<AIMdContext> {
    const cfg      = vscode.workspace.getConfiguration('aimd');
    const now      = new Date().toISOString();
    const folders  = vscode.workspace.workspaceFolders;
    const rootUri  = folders?.[0]?.uri;
    const rootPath = rootUri?.fsPath;
    const project  = folders?.[0]?.name ?? path.basename(rootPath ?? 'Untitled');

    // Persisted user state
    const notes      = this.context.workspaceState.get<string>('aimd.notes', '');
    const task       = this.context.workspaceState.get<string>('aimd.task', '');
    const nextSteps  = this.context.workspaceState.get<string[]>('aimd.nextSteps', []);
    const created    = this.context.workspaceState.get<string>('aimd.created', now);
    let   sessionId  = this.context.workspaceState.get<string>('aimd.sessionId');
    if (!sessionId) {
      sessionId = newSessionId();
      await this.context.workspaceState.update('aimd.sessionId', sessionId);
      await this.context.workspaceState.update('aimd.created', now);
    }

    // ── Auto-collected ───────────────────────────────────────────────────────
    const [
      projectDescription,
      techStack,
      openFiles,
      recentFiles,
      gitBranch,
      gitCommits,
      gitStatusSummary,
      gitRemote,
      fileTree,
    ] = await Promise.all([
      this.readProjectDescription(rootUri),
      this.detectTechStack(rootUri),
      Promise.resolve(this.captureOpenFiles(rootPath)),
      cfg.get<boolean>('includeGitInfo', true) && rootPath
        ? Promise.resolve(this.recentlyChangedFiles(rootPath))
        : Promise.resolve(undefined),
      rootPath ? Promise.resolve(this.gitBranch(rootPath)) : Promise.resolve(undefined),
      cfg.get<boolean>('includeGitInfo', true) && rootPath
        ? Promise.resolve(this.gitLog(rootPath))
        : Promise.resolve(undefined),
      cfg.get<boolean>('includeGitInfo', true) && rootPath
        ? Promise.resolve(this.gitStatusSummary(rootPath))
        : Promise.resolve(undefined),
      rootPath ? Promise.resolve(this.gitRemote(rootPath)) : Promise.resolve(undefined),
      cfg.get<boolean>('includeFileTree', true) && rootUri
        ? this.buildFileTree(rootUri, cfg.get<number>('fileTreeDepth', 3))
        : Promise.resolve(undefined),
    ]);

    return {
      version: AIMD_VERSION,
      created,
      updated: now,
      sessionId,
      project,
      platform: cfg.get<string>('platform', 'Claude'),
      device: deviceName(),
      workspacePath: rootPath,
      projectDescription: projectDescription ?? undefined,
      techStack: techStack.length ? techStack : undefined,
      gitRemote,
      task,
      notes,
      nextSteps,
      openFiles,
      recentFiles: recentFiles?.length ? recentFiles : undefined,
      gitBranch,
      gitCommits: gitCommits?.length ? gitCommits : undefined,
      gitStatusSummary,
      fileTree,
    };
  }

  // ─── Project description ─────────────────────────────────────────────────────
  //
  // Priority: README.md first paragraph → package.json description → pyproject
  // description → Cargo.toml description → go.mod module name

  private async readProjectDescription(rootUri: vscode.Uri | undefined): Promise<string | null> {
    if (!rootUri) return null;

    // Try README.md
    for (const name of ['README.md', 'README.txt', 'README', 'readme.md']) {
      try {
        const uri = vscode.Uri.joinPath(rootUri, name);
        const bytes = await vscode.workspace.fs.readFile(uri);
        const text = Buffer.from(bytes).toString('utf8');
        const firstPara = extractFirstParagraph(text);
        if (firstPara && firstPara.length > 10) return firstPara;
      } catch { /* file not found */ }
    }

    // Try package.json description
    try {
      const uri = vscode.Uri.joinPath(rootUri, 'package.json');
      const bytes = await vscode.workspace.fs.readFile(uri);
      const pkg = JSON.parse(Buffer.from(bytes).toString('utf8')) as Record<string, unknown>;
      if (typeof pkg.description === 'string' && pkg.description.trim()) {
        return pkg.description.trim();
      }
    } catch { /* ignore */ }

    // Try pyproject.toml
    try {
      const uri = vscode.Uri.joinPath(rootUri, 'pyproject.toml');
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString('utf8');
      const m = text.match(/^description\s*=\s*["'](.+?)["']/m);
      if (m) return m[1];
    } catch { /* ignore */ }

    // Try Cargo.toml
    try {
      const uri = vscode.Uri.joinPath(rootUri, 'Cargo.toml');
      const bytes = await vscode.workspace.fs.readFile(uri);
      const text = Buffer.from(bytes).toString('utf8');
      const m = text.match(/^description\s*=\s*["'](.+?)["']/m);
      if (m) return m[1];
    } catch { /* ignore */ }

    return null;
  }

  // ─── Tech stack detection ────────────────────────────────────────────────────

  private async detectTechStack(rootUri: vscode.Uri | undefined): Promise<string[]> {
    if (!rootUri) return [];
    const stack: string[] = [];

    const check = async (file: string, ...labels: string[]) => {
      try {
        await vscode.workspace.fs.stat(vscode.Uri.joinPath(rootUri, file));
        stack.push(...labels);
        return true;
      } catch { return false; }
    };

    const pkgExists = await check('package.json');
    if (pkgExists) {
      try {
        const bytes = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(rootUri, 'package.json'));
        const pkg = JSON.parse(Buffer.from(bytes).toString('utf8')) as {
          dependencies?: Record<string, string>;
          devDependencies?: Record<string, string>;
        };
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        const d = (name: string) => name in deps;

        if (d('typescript') || d('@types/node')) stack.push('TypeScript');
        else stack.push('JavaScript / Node.js');

        if (d('react') || d('react-dom'))      stack.push('React');
        if (d('next'))                          stack.push('Next.js');
        if (d('vue'))                           stack.push('Vue');
        if (d('svelte'))                        stack.push('Svelte');
        if (d('@angular/core'))                 stack.push('Angular');
        if (d('express') || d('fastify') || d('koa')) stack.push('Node HTTP');
        if (d('@nestjs/core'))                  stack.push('NestJS');
        if (d('electron'))                      stack.push('Electron');
        if (d('@vscode/vsce') || d('@types/vscode')) stack.push('VS Code Extension');
        if (d('tailwindcss'))                   stack.push('Tailwind CSS');
        if (d('prisma') || d('@prisma/client')) stack.push('Prisma');
        if (d('drizzle-orm'))                   stack.push('Drizzle ORM');
      } catch { /* ignore */ }
    }

    await check('pyproject.toml',   'Python');
    await check('requirements.txt', 'Python');
    await check('Cargo.toml',       'Rust');
    await check('go.mod',           'Go');
    await check('pom.xml',          'Java / Maven');
    await check('build.gradle',     'Java / Gradle');
    await check('*.csproj',         '.NET');
    await check('Gemfile',          'Ruby');
    await check('composer.json',    'PHP');
    await check('CMakeLists.txt',   'C/C++');
    await check('docker-compose.yml', 'Docker');
    await check('Dockerfile',       'Docker');

    return [...new Set(stack)]; // deduplicate
  }

  // ─── Open editor files ────────────────────────────────────────────────────────

  private captureOpenFiles(rootPath: string | undefined): string[] {
    const files: string[] = [];
    const seen = new Set<string>();

    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof vscode.TabInputText) {
          const uri = tab.input.uri;
          if (uri.scheme !== 'file') continue;
          const display = rootPath
            ? path.relative(rootPath, uri.fsPath).replace(/\\/g, '/')
            : uri.fsPath;
          if (!seen.has(display)) { seen.add(display); files.push(display); }
        }
      }
    }

    // If no tabs open, fall back to recently saved files (last focused)
    if (files.length === 0 && vscode.window.activeTextEditor) {
      const uri = vscode.window.activeTextEditor.document.uri;
      if (uri.scheme === 'file') {
        const display = rootPath
          ? path.relative(rootPath, uri.fsPath).replace(/\\/g, '/')
          : uri.fsPath;
        files.push(display);
      }
    }

    return files;
  }

  // ─── Git helpers ──────────────────────────────────────────────────────────────

  private exec(cmd: string, cwd: string): string {
    try {
      return cp.execSync(cmd, { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 })
               .toString().trim();
    } catch { return ''; }
  }

  private gitBranch(cwd: string): string | undefined {
    return this.exec('git rev-parse --abbrev-ref HEAD', cwd) || undefined;
  }

  private gitRemote(cwd: string): string | undefined {
    return this.exec('git remote get-url origin', cwd) || undefined;
  }

  private gitLog(cwd: string, n = 10): string[] {
    // Format: short hash · message (date)
    const raw = this.exec(
      `git log --oneline --pretty=format:"%h · %s (%cr)" -${n}`,
      cwd
    );
    return raw ? raw.split('\n').filter(Boolean) : [];
  }

  private gitStatusSummary(cwd: string): string | undefined {
    const raw = this.exec('git status --short', cwd);
    if (!raw) return undefined;
    const lines = raw.split('\n').filter(Boolean);
    const M = lines.filter(l => l.startsWith(' M') || l.startsWith('M ')).length;
    const A = lines.filter(l => l.startsWith('A ')).length;
    const D = lines.filter(l => l.startsWith(' D') || l.startsWith('D ')).length;
    const Q = lines.filter(l => l.startsWith('??')).length;
    const parts: string[] = [];
    if (M) parts.push(`${M} modified`);
    if (A) parts.push(`${A} staged`);
    if (D) parts.push(`${D} deleted`);
    if (Q) parts.push(`${Q} untracked`);
    return parts.length ? parts.join(', ') : 'clean';
  }

  private recentlyChangedFiles(cwd: string): string[] {
    // Files changed in last 7 days (from git history)
    const raw = this.exec(
      'git log --since="7 days ago" --name-only --pretty=format:"" | sort -u',
      cwd
    );
    if (raw) return raw.split('\n').filter(Boolean).slice(0, 30);

    // Fallback: files modified on disk in last 7 days
    return [];
  }

  // ─── File tree ────────────────────────────────────────────────────────────────

  private async buildFileTree(rootUri: vscode.Uri, maxDepth: number): Promise<string> {
    const IGNORE = new Set([
      'node_modules', '.git', 'dist', 'build', 'out', '.next', '__pycache__',
      '.mypy_cache', 'venv', '.venv', 'env', 'target', '.idea', '.vscode',
      'coverage', '.nyc_output', 'vendor', '.turbo', '.cache', 'tmp',
    ]);

    const allUris = await vscode.workspace.findFiles(
      new vscode.RelativePattern(rootUri, '**/*'), undefined, 800
    );

    interface TreeNode {
      name: string; children: Map<string, TreeNode>; isFile: boolean;
    }
    const root: TreeNode = { name: '', children: new Map(), isFile: false };
    const rootPath = rootUri.fsPath;

    for (const uri of allUris) {
      const rel   = path.relative(rootPath, uri.fsPath).replace(/\\/g, '/');
      const parts = rel.split('/');
      if (parts.some(p => IGNORE.has(p))) continue;
      if (parts.length - 1 >= maxDepth) continue;

      let node = root;
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i];
        if (!node.children.has(part)) {
          node.children.set(part, { name: part, children: new Map(), isFile: i === parts.length - 1 });
        }
        node = node.children.get(part)!;
      }
    }

    const lines: string[] = [path.basename(rootPath) + '/'];
    const render = (node: TreeNode, prefix: string) => {
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
    return lines.join('\n');
  }

  // ─── Note / task helpers ──────────────────────────────────────────────────────

  async promptAddNote(): Promise<void> {
    const note = await vscode.window.showInputBox({
      prompt: 'Add a context note (included in next save)',
      placeHolder: 'e.g. Login endpoint broken on Safari — see issue #42',
    });
    if (note) {
      const existing = this.context.workspaceState.get<string>('aimd.notes', '');
      const ts = new Date().toLocaleTimeString();
      await this.context.workspaceState.update(
        'aimd.notes',
        existing ? `${existing}\n- [${ts}] ${note}` : `- [${ts}] ${note}`
      );
      vscode.window.showInformationMessage('AI.md: Note saved — included in next sync.');
    }
  }

  clearNotes(): void {
    this.context.workspaceState.update('aimd.notes', '');
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractFirstParagraph(markdown: string): string {
  // Strip heading lines and code blocks, return first substantive paragraph
  const lines = markdown.split('\n');
  let inCode = false;
  const paras: string[] = [];
  let current: string[] = [];

  for (const line of lines) {
    if (line.startsWith('```')) { inCode = !inCode; continue; }
    if (inCode) continue;
    if (line.startsWith('#')) continue; // skip headings

    if (line.trim() === '') {
      if (current.length > 0) {
        paras.push(current.join(' ').trim());
        current = [];
      }
    } else {
      // Strip markdown formatting for cleaner description
      const clean = line
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/\*(.+?)\*/g, '$1')
        .replace(/`(.+?)`/g, '$1')
        .replace(/\[(.+?)\]\(.+?\)/g, '$1')
        .trim();
      if (clean) current.push(clean);
    }
    if (paras.length > 0) break; // first paragraph found
  }
  if (current.length) paras.push(current.join(' ').trim());

  const result = paras[0] ?? '';
  // Truncate to 400 chars
  return result.length > 400 ? result.slice(0, 400) + '…' : result;
}
