/**
 * cloudSync.ts — VS Code wrapper around syncProviders.ts.
 *
 * For GitHub Gist: tries VS Code's built-in GitHub authentication first
 * (which works silently if the user already has GitHub Copilot or GitHub Pull
 * Requests extension installed), then falls back to the manually configured token.
 *
 * For Google Drive / OneDrive: uses the OAuth flows in oauthProviders.ts.
 */

import * as vscode from 'vscode';
import { SyncConfig, createProvider, providerName, projectFilename, AnyProvider } from './syncProviders';

export class CloudSync {
  private readonly context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  private async buildConfig(): Promise<SyncConfig> {
    const cfg = vscode.workspace.getConfiguration('aimd');
    const providerType = cfg.get<SyncConfig['provider']>('syncProvider', 'local-folder');

    // For GitHub Gist — try VS Code's built-in GitHub auth first
    let githubToken = cfg.get<string>('githubToken', '').trim() ||
                      this.context.globalState.get<string>('aimd.githubToken', '');

    if (providerType === 'github-gist' && !githubToken) {
      githubToken = await this.getVsCodeGitHubToken();
      if (githubToken) {
        // Persist so subsequent calls are instant
        await this.context.globalState.update('aimd.githubToken', githubToken);
      }
    }

    return {
      provider: providerType,
      localFolderPath: cfg.get<string>('localFolderPath', ''),
      githubToken,
      gistId:
        cfg.get<string>('gistId', '') ||
        this.context.globalState.get<string>('aimd.gistId', ''),
      webhookUrl: cfg.get<string>('webhookUrl', ''),
    };
  }

  /**
   * Use VS Code's built-in GitHub authentication session to get a gist-scoped
   * token. This works automatically for users who already have GitHub Copilot,
   * the GitHub Pull Requests extension, or any other GitHub-authenticated extension.
   */
  private async getVsCodeGitHubToken(): Promise<string> {
    try {
      // createIfNone: false → don't show a prompt just for token refresh
      // If the user has no GitHub session at all we'll ask once explicitly
      let session = await vscode.authentication.getSession('github', ['gist'], {
        createIfNone: false,
        silent: true,
      });

      if (!session) {
        // Explicitly ask — one-time browser popup via VS Code's standard GitHub flow
        session = await vscode.authentication.getSession('github', ['gist'], {
          createIfNone: true,
        });
      }

      return session?.accessToken ?? '';
    } catch {
      return '';
    }
  }

  private async getProvider(): Promise<AnyProvider> {
    const cfg = await this.buildConfig();
    return createProvider(cfg, {
      onGistCreated: async (newId: string) => {
        await this.context.globalState.update('aimd.gistId', newId);
        await vscode.workspace
          .getConfiguration('aimd')
          .update('gistId', newId, vscode.ConfigurationTarget.Global);
      },
      onStatus: (msg: string) => {
        const clean = msg.trim();
        if (clean) vscode.window.showInformationMessage(`AI.md: ${clean}`);
      },
    });
  }

  getProviderName(): string {
    const cfg = vscode.workspace.getConfiguration('aimd');
    const p = cfg.get<SyncConfig['provider']>('syncProvider', 'local-folder');
    return p === 'github-gist' ? 'GitHub Gist'
         : p === 'google-drive' ? 'Google Drive'
         : p === 'onedrive' ? 'OneDrive'
         : p === 'webhook' ? 'Webhook'
         : `Local Folder`;
  }

  async upload(content: string, project?: string): Promise<void> {
    await (await this.getProvider()).upload(projectFilename(project), content);
  }

  async download(project?: string): Promise<string | null> {
    return (await this.getProvider()).download(projectFilename(project));
  }

  async uploadRaw(filename: string, content: string): Promise<void> {
    await (await this.getProvider()).upload(filename, content);
  }

  async downloadRaw(filename: string): Promise<string | null> {
    return (await this.getProvider()).download(filename);
  }

  async listFiles(): Promise<string[]> {
    return (await (await this.getProvider()).listFiles?.()) ?? [];
  }
}
