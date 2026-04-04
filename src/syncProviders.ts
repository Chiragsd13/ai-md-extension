/**
 * syncProviders.ts
 *
 * Pure Node.js sync implementations — zero VS Code dependency.
 * Used by both the VS Code extension (cloudSync.ts) and the CLI (cli.ts).
 *
 * Providers:
 *   github-gist    — private GitHub Gist (token auth)
 *   local-folder   — local filesystem (use a cloud-synced folder for cross-device)
 *   google-drive   — Google Drive appDataFolder (OAuth2 loopback)
 *   onedrive       — Microsoft OneDrive approot (device code OAuth2)
 *   webhook        — POST to custom URL (write-only)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as http from 'http';
import * as os from 'os';
import {
  googleUpload, googleDownload, googleListFiles,
  msUpload, msDownload, msListFiles,
} from './oauthProviders';

// ─── Config ───────────────────────────────────────────────────────────────────

export type ProviderType = 'github-gist' | 'local-folder' | 'google-drive' | 'onedrive' | 'webhook';

export interface SyncConfig {
  provider: ProviderType;
  // Local folder
  localFolderPath?: string;
  // GitHub Gist
  githubToken?: string;
  gistId?: string;
  // Webhook
  webhookUrl?: string;
  // Google / OneDrive tokens are stored separately in ~/.aimd/tokens.json
}

export function defaultConfig(): SyncConfig {
  return { provider: 'local-folder', localFolderPath: os.homedir() };
}

/** Slug-safe filename for a project: "My Project" → "my-project.ai.md" */
export function projectFilename(project?: string): string {
  if (!project) return 'ai.md';
  const slug = project.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? `${slug}.ai.md` : 'ai.md';
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

interface HttpResult { status: number; body: string }

function httpRequest(
  method: string, url: string, headers: Record<string, string>, body?: string
): Promise<HttpResult> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const lib: typeof https | typeof http = parsed.protocol === 'https:' ? https : http;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method,
      headers: { ...headers, ...(body ? { 'Content-Length': String(Buffer.byteLength(body)) } : {}) },
    };
    const req = lib.request(opts, res => {
      let data = '';
      res.on('data', (c: string) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// ─── Provider interface ───────────────────────────────────────────────────────

export interface AnyProvider {
  upload(filename: string, content: string): Promise<void>;
  download(filename: string): Promise<string | null>;
  listFiles?(): Promise<string[]>;
}

// ─── GitHub Gist ──────────────────────────────────────────────────────────────

export interface GistProviderOptions {
  token: string;
  gistId?: string;
  onGistCreated?: (id: string) => void;
}

export class GistProvider implements AnyProvider {
  constructor(private opts: GistProviderOptions) {}

  private req(method: string, urlPath: string, body?: object) {
    const payload = body ? JSON.stringify(body) : undefined;
    return httpRequest(method, `https://api.github.com${urlPath}`, {
      'User-Agent': 'aimd/1.0',
      Authorization: `token ${this.opts.token}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    }, payload);
  }

  async upload(filename: string, content: string): Promise<void> {
    const body = { description: 'AI.md context', public: false, files: { [filename]: { content } } };
    if (this.opts.gistId) {
      const r = await this.req('PATCH', `/gists/${this.opts.gistId}`, body);
      if (r.status < 200 || r.status >= 300) throw new Error(`Gist update failed (HTTP ${r.status}): ${r.body}`);
    } else {
      const r = await this.req('POST', '/gists', body);
      if (r.status !== 201) throw new Error(`Gist create failed (HTTP ${r.status}): ${r.body}`);
      const id = (JSON.parse(r.body) as { id: string }).id;
      this.opts.gistId = id;
      this.opts.onGistCreated?.(id);
    }
  }

  async download(filename: string): Promise<string | null> {
    if (!this.opts.gistId) return null;
    const r = await this.req('GET', `/gists/${this.opts.gistId}`);
    if (r.status === 404) return null;
    if (r.status < 200 || r.status >= 300) throw new Error(`Gist fetch failed (HTTP ${r.status})`);
    const parsed = JSON.parse(r.body) as { files: Record<string, { content: string }> };
    return parsed.files[filename]?.content ?? null;
  }

  async listFiles(): Promise<string[]> {
    if (!this.opts.gistId) return [];
    const r = await this.req('GET', `/gists/${this.opts.gistId}`);
    if (r.status !== 200) return [];
    const parsed = JSON.parse(r.body) as { files: Record<string, unknown> };
    return Object.keys(parsed.files).filter(f => f.endsWith('.ai.md') || f === 'ai.md');
  }
}

// ─── Local folder ─────────────────────────────────────────────────────────────

export class LocalFolderProvider implements AnyProvider {
  constructor(private folderPath: string) {}

  private dir() { return this.folderPath || os.homedir(); }

  async upload(filename: string, content: string): Promise<void> {
    const d = this.dir();
    if (!fs.existsSync(d)) throw new Error(`Folder not found: "${d}". Update localFolderPath.`);
    fs.writeFileSync(path.join(d, filename), content, 'utf8');
  }

  async download(filename: string): Promise<string | null> {
    const p = path.join(this.dir(), filename);
    return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null;
  }

  async listFiles(): Promise<string[]> {
    const d = this.dir();
    if (!fs.existsSync(d)) return [];
    return fs.readdirSync(d).filter(f => f.endsWith('.ai.md') || f === 'ai.md');
  }
}

// ─── Google Drive ─────────────────────────────────────────────────────────────

export class GoogleDriveProvider implements AnyProvider {
  private onStatus?: (msg: string) => void;
  constructor(opts?: { onStatus?: (msg: string) => void }) {
    this.onStatus = opts?.onStatus;
  }
  async upload(filename: string, content: string): Promise<void> {
    await googleUpload(filename, content, this.onStatus);
  }
  async download(filename: string): Promise<string | null> {
    return googleDownload(filename, this.onStatus);
  }
  async listFiles(): Promise<string[]> {
    return googleListFiles(this.onStatus);
  }
}

// ─── OneDrive ─────────────────────────────────────────────────────────────────

export class OneDriveProvider implements AnyProvider {
  private onStatus?: (msg: string) => void;
  constructor(opts?: { onStatus?: (msg: string) => void }) {
    this.onStatus = opts?.onStatus;
  }
  async upload(filename: string, content: string): Promise<void> {
    await msUpload(filename, content, this.onStatus);
  }
  async download(filename: string): Promise<string | null> {
    return msDownload(filename, this.onStatus);
  }
  async listFiles(): Promise<string[]> {
    return msListFiles(this.onStatus);
  }
}

// ─── Webhook ──────────────────────────────────────────────────────────────────

export class WebhookProvider implements AnyProvider {
  constructor(private url: string) {}

  async upload(filename: string, content: string): Promise<void> {
    const body = JSON.stringify({ filename, content, timestamp: new Date().toISOString() });
    const r = await httpRequest('POST', this.url, { 'Content-Type': 'application/json', 'User-Agent': 'aimd/1.0' }, body);
    if (r.status < 200 || r.status >= 300) throw new Error(`Webhook failed (HTTP ${r.status}): ${r.body}`);
  }

  async download(_filename: string): Promise<string | null> {
    throw new Error('Webhook provider is write-only. Use another provider to load context.');
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

export function createProvider(
  cfg: SyncConfig,
  opts?: { onGistCreated?: (id: string) => void; onStatus?: (msg: string) => void }
): AnyProvider {
  switch (cfg.provider) {
    case 'github-gist': {
      const token = cfg.githubToken?.trim();
      if (!token) throw new Error('GitHub token not set. Run `aimd setup`.');
      return new GistProvider({ token, gistId: cfg.gistId?.trim() || undefined, onGistCreated: opts?.onGistCreated });
    }
    case 'google-drive':
      return new GoogleDriveProvider({ onStatus: opts?.onStatus });
    case 'onedrive':
      return new OneDriveProvider({ onStatus: opts?.onStatus });
    case 'webhook': {
      const url = cfg.webhookUrl?.trim();
      if (!url) throw new Error('Webhook URL not set. Run `aimd setup`.');
      return new WebhookProvider(url);
    }
    case 'local-folder':
    default:
      return new LocalFolderProvider(cfg.localFolderPath?.trim() || os.homedir());
  }
}

export function providerName(cfg: SyncConfig): string {
  switch (cfg.provider) {
    case 'github-gist': return 'GitHub Gist';
    case 'google-drive': return 'Google Drive';
    case 'onedrive': return 'OneDrive';
    case 'webhook': return 'Webhook';
    default: return `Local Folder (${cfg.localFolderPath || os.homedir()})`;
  }
}

