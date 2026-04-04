import * as vscode from 'vscode';

// ─── StatusBarManager ─────────────────────────────────────────────────────────
//
// Manages the AI.md entry in VS Code's bottom status bar.
// States: ready (idle + last-save time), syncing (spinner), error.
// Clicking the item triggers the save command.

type State = 'ready' | 'syncing' | 'error';

export class StatusBarManager {
  private readonly item: vscode.StatusBarItem;
  private state: State = 'ready';
  private syncingTimer: NodeJS.Timeout | undefined;

  constructor(context: vscode.ExtensionContext) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      // Priority — sits near the far right, visible but unobtrusive
      50
    );
    this.item.command = 'aimd.saveContext';
    this.item.tooltip = 'AI.md — Click to save context now  (Ctrl+Alt+S)';
    context.subscriptions.push(this.item);
  }

  // ─── Public API ──────────────────────────────────────────────────────────

  show(): void {
    this.setReady();
    this.item.show();
  }

  hide(): void {
    this.item.hide();
  }

  setReady(lastSave?: Date): void {
    this.clearSyncingTimer();
    this.state = 'ready';

    if (lastSave) {
      const timeStr = lastSave.toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
      });
      this.item.text = `$(check) AI.md ${timeStr}`;
      this.item.tooltip = `AI.md — Last saved at ${timeStr}. Click to save again.`;
    } else {
      this.item.text = '$(cloud) AI.md';
      this.item.tooltip = 'AI.md — Click to save context now  (Ctrl+Alt+S)';
    }
    this.item.backgroundColor = undefined;
    this.item.color = undefined;
  }

  setSyncing(): void {
    this.clearSyncingTimer();
    this.state = 'syncing';

    // Animate through spin frames
    const frames = ['$(sync~spin) AI.md'];
    let i = 0;
    this.item.text = frames[0];
    this.item.tooltip = 'AI.md — Syncing context…';
    this.item.backgroundColor = undefined;
    this.item.color = new vscode.ThemeColor('statusBarItem.prominentForeground');

    // VS Code auto-animates $(sync~spin) — single assignment is enough
    this.item.text = '$(sync~spin) AI.md';
  }

  setError(): void {
    this.clearSyncingTimer();
    this.state = 'error';
    this.item.text = '$(warning) AI.md';
    this.item.tooltip = 'AI.md — Sync failed. Click to retry.';
    this.item.backgroundColor = new vscode.ThemeColor(
      'statusBarItem.errorBackground'
    );
    this.item.color = undefined;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  private clearSyncingTimer(): void {
    if (this.syncingTimer) {
      clearInterval(this.syncingTimer);
      this.syncingTimer = undefined;
    }
  }
}
