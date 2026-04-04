/**
 * oauthProviders.ts
 *
 * OAuth2 flows for Google Drive and Microsoft OneDrive.
 *
 * Google Drive — loopback redirect (starts a temporary local HTTP server,
 *   opens the browser at Google's consent screen, receives the code).
 *
 * OneDrive — Microsoft device code flow (CLI-friendly: no local server,
 *   user visits a URL on any device and enters a short code).
 *
 * Tokens are stored in ~/.aimd/tokens.json with file mode 600 (Unix).
 * Refresh tokens are used automatically; re-auth is only prompted when
 * the refresh token itself is revoked.
 */

import * as https from 'https';
import * as http from 'http';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

// ─── Token store ──────────────────────────────────────────────────────────────

const TOKEN_FILE = path.join(os.homedir(), '.aimd', 'tokens.json');

interface TokenRecord {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number; // Unix ms
}

interface TokenStore {
  google?: TokenRecord;
  microsoft?: TokenRecord;
}

function loadTokens(): TokenStore {
  try {
    if (fs.existsSync(TOKEN_FILE)) return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
  } catch { /* ignore */ }
  return {};
}

function saveTokens(store: TokenStore): void {
  const dir = path.dirname(TOKEN_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
}

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function post(
  url: string,
  body: string,
  contentType = 'application/x-www-form-urlencoded'
): Promise<{ status: number; data: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const opts: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'aimd/1.0',
      },
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', (c: string) => (raw += c));
      res.on('end', () => {
        try { resolve({ status: res.statusCode ?? 0, data: JSON.parse(raw) }); }
        catch { resolve({ status: res.statusCode ?? 0, data: { raw } }); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function apiRequest(
  method: string,
  url: string,
  token: string,
  bodyBuf?: Buffer,
  extraHeaders?: Record<string, string>
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      'User-Agent': 'aimd/1.0',
      ...extraHeaders,
      ...(bodyBuf ? { 'Content-Length': String(bodyBuf.length) } : {}),
    };
    const opts: https.RequestOptions = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method,
      headers,
    };
    const req = https.request(opts, res => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    if (bodyBuf) req.write(bodyBuf);
    req.end();
  });
}

// ─── Browser opener ───────────────────────────────────────────────────────────

function openBrowser(url: string): void {
  try {
    if (process.platform === 'win32') execSync(`start "" "${url}"`, { stdio: 'ignore' });
    else if (process.platform === 'darwin') execSync(`open "${url}"`, { stdio: 'ignore' });
    else execSync(`xdg-open "${url}"`, { stdio: 'ignore' });
  } catch { /* if browser can't open, user must copy the URL manually */ }
}

// ─── Free local port ──────────────────────────────────────────────────────────

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as net.AddressInfo;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// GOOGLE DRIVE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Uses the "appDataFolder" scope — files are hidden in a private app area,
// not visible in the user's regular Drive.
//
// OAuth client: "installed application" type.
// To register your own: https://console.cloud.google.com
//   → New Project → Enable Drive API → Credentials → Desktop App
//   → copy the client_id and client_secret here.

function googleCreds(): { id: string; secret: string } {
  const envId = process.env.AIMD_GOOGLE_CLIENT_ID;
  const envSecret = process.env.AIMD_GOOGLE_CLIENT_SECRET;
  if (envId && envSecret) return { id: envId, secret: envSecret };
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.aimd', 'config.json'), 'utf8'));
    if (cfg.googleClientId && cfg.googleClientSecret) {
      return { id: cfg.googleClientId, secret: cfg.googleClientSecret };
    }
  } catch { /* ignore */ }
  throw new Error(
    'Google Drive credentials not configured.\n' +
    'Run `aimd setup` and choose Google Drive to configure credentials.'
  );
}
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

async function googleRefreshToken(record: TokenRecord): Promise<TokenRecord> {
  if (Date.now() < record.expiresAt - 60_000) return record;
  if (!record.refreshToken) throw new Error('Google refresh token expired. Re-run `aimd setup`.');
  const body = new URLSearchParams({
    client_id: googleCreds().id,
    client_secret: googleCreds().secret,
    refresh_token: record.refreshToken,
    grant_type: 'refresh_token',
  }).toString();
  const res = await post('https://oauth2.googleapis.com/token', body);
  if (res.status !== 200) throw new Error(`Google token refresh failed: ${JSON.stringify(res.data)}`);
  return {
    accessToken: res.data.access_token as string,
    refreshToken: record.refreshToken,
    expiresAt: Date.now() + (Number(res.data.expires_in) - 30) * 1000,
  };
}

async function getGoogleToken(
  onStatus?: (msg: string) => void
): Promise<string> {
  const store = loadTokens();
  if (store.google) {
    const refreshed = await googleRefreshToken(store.google);
    if (refreshed !== store.google) { store.google = refreshed; saveTokens(store); }
    return refreshed.accessToken;
  }

  // First-time auth — loopback redirect
  const port = await getFreePort();
  const redirectUri = `http://localhost:${port}`;
  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    new URLSearchParams({
      client_id: googleCreds().id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: GOOGLE_SCOPE,
      access_type: 'offline',
      prompt: 'consent',
    }).toString();

  onStatus?.(`\nOpening browser for Google sign-in…\nIf it doesn't open automatically, visit:\n${authUrl}\n`);
  openBrowser(authUrl);

  // Temporary local server to catch the redirect
  const code = await new Promise<string>((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost`);
      const c = url.searchParams.get('code');
      const err = url.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/html' });
      if (c) {
        res.end('<html><body style="font-family:sans-serif;text-align:center;margin-top:80px"><h2>✔ AI.md: Google Drive authorized!</h2><p>You can close this tab.</p></body></html>');
        srv.close();
        resolve(c);
      } else {
        res.end(`<html><body><h2>Authorization failed: ${err}</h2></body></html>`);
        srv.close();
        reject(new Error(`Google OAuth error: ${err}`));
      }
    });
    srv.listen(port);
    srv.on('error', reject);
  });

  const body = new URLSearchParams({
    code,
    client_id: googleCreds().id,
    client_secret: googleCreds().secret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  }).toString();
  const res = await post('https://oauth2.googleapis.com/token', body);
  if (res.status !== 200) throw new Error(`Google token exchange failed: ${JSON.stringify(res.data)}`);

  const record: TokenRecord = {
    accessToken: res.data.access_token as string,
    refreshToken: res.data.refresh_token as string | undefined,
    expiresAt: Date.now() + (Number(res.data.expires_in) - 30) * 1000,
  };
  store.google = record;
  saveTokens(store);
  onStatus?.('Google Drive authorized and token saved.\n');
  return record.accessToken;
}

// ─── Google Drive file ops ────────────────────────────────────────────────────

async function googleFindFileId(token: string, name: string): Promise<string | null> {
  const url =
    `https://www.googleapis.com/drive/v3/files?` +
    new URLSearchParams({
      spaces: 'appDataFolder',
      q: `name = '${name}'`,
      fields: 'files(id)',
    }).toString();
  const res = await apiRequest('GET', url, token);
  if (res.status !== 200) return null;
  const data = JSON.parse(res.body.toString()) as { files: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

export async function googleUpload(
  filename: string,
  content: string,
  onStatus?: (msg: string) => void
): Promise<void> {
  const token = await getGoogleToken(onStatus);
  const existingId = await googleFindFileId(token, filename);
  const bodyBuf = Buffer.from(content, 'utf8');

  if (existingId) {
    // Update existing file
    const res = await apiRequest(
      'PATCH',
      `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=media`,
      token,
      bodyBuf,
      { 'Content-Type': 'text/plain' }
    );
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Google Drive update failed (HTTP ${res.status})`);
    }
  } else {
    // Create new file in appDataFolder
    const boundary = '-------aimd_boundary';
    const meta = JSON.stringify({ name: filename, parents: ['appDataFolder'] });
    const multipart = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: text/plain\r\n\r\n${content}\r\n`,
      `--${boundary}--`,
    ].join('');
    const res = await apiRequest(
      'POST',
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart',
      token,
      Buffer.from(multipart),
      { 'Content-Type': `multipart/related; boundary="${boundary}"` }
    );
    if (res.status < 200 || res.status >= 300) {
      throw new Error(`Google Drive create failed (HTTP ${res.status})`);
    }
  }
}

export async function googleDownload(
  filename: string,
  onStatus?: (msg: string) => void
): Promise<string | null> {
  const token = await getGoogleToken(onStatus);
  const fileId = await googleFindFileId(token, filename);
  if (!fileId) return null;
  const res = await apiRequest(
    'GET',
    `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`,
    token
  );
  if (res.status === 404) return null;
  if (res.status < 200 || res.status >= 300) throw new Error(`Google Drive read failed (HTTP ${res.status})`);
  return res.body.toString('utf8');
}

export async function googleListFiles(onStatus?: (msg: string) => void): Promise<string[]> {
  const token = await getGoogleToken(onStatus);
  const url =
    `https://www.googleapis.com/drive/v3/files?` +
    new URLSearchParams({ spaces: 'appDataFolder', fields: 'files(name)', pageSize: '100' }).toString();
  const res = await apiRequest('GET', url, token);
  if (res.status !== 200) return [];
  const data = JSON.parse(res.body.toString()) as { files: { name: string }[] };
  return (data.files ?? []).map(f => f.name).filter(n => n.endsWith('.ai.md') || n === 'ai.md');
}

// ═══════════════════════════════════════════════════════════════════════════════
// MICROSOFT ONEDRIVE
// ═══════════════════════════════════════════════════════════════════════════════
//
// Uses the Special App Folder ("approot") — a dedicated folder for this app
// in the user's OneDrive, not visible in their regular file browser.
//
// Auth: Device Authorization Grant (no redirect URI needed — ideal for CLIs).
//
// To register: https://portal.azure.com → App Registrations → New
//   → platform: Mobile and desktop → reply URL: https://login.microsoftonline.com/common/oauth2/nativeclient

const MS_CLIENT_ID = process.env.AIMD_MS_CLIENT_ID ?? 'YOUR_AZURE_APP_CLIENT_ID';
const MS_SCOPE = 'files.readwrite.appfolder offline_access';
const MS_TENANT = 'common';

async function msRefreshToken(record: TokenRecord): Promise<TokenRecord> {
  if (Date.now() < record.expiresAt - 60_000) return record;
  if (!record.refreshToken) throw new Error('OneDrive refresh token expired. Re-run `aimd setup`.');
  const body = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    refresh_token: record.refreshToken,
    grant_type: 'refresh_token',
    scope: MS_SCOPE,
  }).toString();
  const res = await post(
    `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, body
  );
  if (res.status !== 200) throw new Error(`OneDrive token refresh failed: ${JSON.stringify(res.data)}`);
  return {
    accessToken: res.data.access_token as string,
    refreshToken: (res.data.refresh_token as string) ?? record.refreshToken,
    expiresAt: Date.now() + (Number(res.data.expires_in) - 30) * 1000,
  };
}

export async function getMsToken(
  onStatus?: (msg: string) => void
): Promise<string> {
  const store = loadTokens();
  if (store.microsoft) {
    const refreshed = await msRefreshToken(store.microsoft);
    if (refreshed !== store.microsoft) { store.microsoft = refreshed; saveTokens(store); }
    return refreshed.accessToken;
  }

  // Device code flow
  const dcBody = new URLSearchParams({
    client_id: MS_CLIENT_ID,
    scope: MS_SCOPE,
  }).toString();
  const dcRes = await post(
    `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/devicecode`, dcBody
  );
  if (dcRes.status !== 200) throw new Error(`OneDrive device code request failed: ${JSON.stringify(dcRes.data)}`);

  const { device_code, user_code, verification_uri, expires_in, interval } = dcRes.data as {
    device_code: string; user_code: string; verification_uri: string;
    expires_in: number; interval: number;
  };

  onStatus?.(`\nTo authorize OneDrive:\n  1. Open: ${verification_uri}\n  2. Enter code: ${user_code}\n\nWaiting for authorization…`);

  // Poll for token
  const deadline = Date.now() + expires_in * 1000;
  const pollInterval = (interval + 1) * 1000;

  const token = await new Promise<TokenRecord>((resolve, reject) => {
    const poll = async () => {
      if (Date.now() > deadline) { reject(new Error('OneDrive authorization timed out.')); return; }
      const tokenBody = new URLSearchParams({
        client_id: MS_CLIENT_ID,
        device_code,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
      }).toString();
      const res = await post(
        `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0/token`, tokenBody
      );
      if (res.status === 200) {
        resolve({
          accessToken: res.data.access_token as string,
          refreshToken: res.data.refresh_token as string | undefined,
          expiresAt: Date.now() + (Number(res.data.expires_in) - 30) * 1000,
        });
      } else if ((res.data.error as string) === 'authorization_pending') {
        setTimeout(poll, pollInterval);
      } else {
        reject(new Error(`OneDrive auth failed: ${res.data.error_description ?? res.data.error}`));
      }
    };
    setTimeout(poll, pollInterval);
  });

  store.microsoft = token;
  saveTokens(store);
  onStatus?.('\nOneDrive authorized and token saved.\n');
  return token.accessToken;
}

// ─── OneDrive file ops ────────────────────────────────────────────────────────

function msFileUrl(filename: string): string {
  return `https://graph.microsoft.com/v1.0/me/drive/special/approot:/${encodeURIComponent(filename)}:/content`;
}

export async function msUpload(
  filename: string,
  content: string,
  onStatus?: (msg: string) => void
): Promise<void> {
  const token = await getMsToken(onStatus);
  const bodyBuf = Buffer.from(content, 'utf8');
  const res = await apiRequest('PUT', msFileUrl(filename), token, bodyBuf, { 'Content-Type': 'text/plain' });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`OneDrive upload failed (HTTP ${res.status}): ${res.body.toString()}`);
  }
}

export async function msDownload(
  filename: string,
  onStatus?: (msg: string) => void
): Promise<string | null> {
  const token = await getMsToken(onStatus);
  const res = await apiRequest('GET', msFileUrl(filename), token);
  if (res.status === 404) return null;
  if (res.status === 401) throw new Error('OneDrive: unauthorized. Re-run `aimd setup`.');
  if (res.status < 200 || res.status >= 300) throw new Error(`OneDrive download failed (HTTP ${res.status})`);
  return res.body.toString('utf8');
}

export async function msListFiles(onStatus?: (msg: string) => void): Promise<string[]> {
  const token = await getMsToken(onStatus);
  const url = 'https://graph.microsoft.com/v1.0/me/drive/special/approot/children?$select=name';
  const res = await apiRequest('GET', url, token);
  if (res.status !== 200) return [];
  const data = JSON.parse(res.body.toString()) as { value: { name: string }[] };
  return (data.value ?? []).map(f => f.name).filter(n => n.endsWith('.ai.md') || n === 'ai.md');
}

// ─── Clear tokens (re-auth) ──────────────────────────────────────────────────

export function clearGoogleToken(): void {
  const store = loadTokens();
  delete store.google;
  saveTokens(store);
}

export function clearMsToken(): void {
  const store = loadTokens();
  delete store.microsoft;
  saveTokens(store);
}

export function hasGoogleToken(): boolean { return !!loadTokens().google; }
export function hasMsToken(): boolean { return !!loadTokens().microsoft; }
