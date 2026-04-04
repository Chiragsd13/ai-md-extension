import * as vscode from 'vscode';
import { ContextCapture } from './contextCapture';
import { CloudSync } from './cloudSync';
import { serialize, parse, generateResumePrompt } from './aimdFormat';
import { StatusBarManager } from './statusBar';
import { ConfigPanel } from './configPanel';
import { registerChatParticipant } from './chatParticipant';
import { updateHabits, parseHabits, serializeHabits, HABITS_FILENAME } from './habitsTracker';

let autoSaveTimer: NodeJS.Timeout | undefined;

// ─── activate ─────────────────────────────────────────────────────────────────

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const statusBar = new StatusBarManager(context);
  const capture = new ContextCapture(context);
  const sync = new CloudSync(context);

  // ── Core save/load ──────────────────────────────────────────────────────────

  async function doSave(silent = false, projectOverride?: string): Promise<void> {
    try {
      statusBar.setSyncing();
      const ctx = await capture.captureContext();
      if (projectOverride) ctx.project = projectOverride;

      const content = serialize(ctx);
      await sync.upload(content, ctx.project);

      // Update habits profile (best-effort, never blocks the save)
      if (vscode.workspace.getConfiguration('aimd').get<boolean>('trackHabits', true)) {
        updateHabitsProfile(sync, ctx).catch(() => {});
      }

      const saveTime = new Date();
      context.globalState.update('aimd.lastSave', saveTime.toISOString());
      statusBar.setReady(saveTime);

      if (!silent) {
        const choice = await vscode.window.showInformationMessage(
          `AI.md: Context saved to ${sync.getProviderName()}`,
          'View',
          'Copy Resume Prompt'
        );
        if (choice === 'View') await showContextDoc(content);
        else if (choice === 'Copy Resume Prompt') await copyPrompt(content);
      }
    } catch (err: unknown) {
      statusBar.setError();
      vscode.window.showErrorMessage(
        `AI.md: Save failed — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  async function doLoad(projectName?: string): Promise<void> {
    try {
      statusBar.setSyncing();
      const content = await sync.download(projectName);
      statusBar.setReady();

      if (!content) {
        vscode.window.showInformationMessage(
          `AI.md: No saved context found${projectName ? ` for "${projectName}"` : ''}. ` +
          'Press Ctrl+Alt+S to save your current session first.'
        );
        return;
      }

      const ctx = parse(content);
      const choice = await vscode.window.showInformationMessage(
        `AI.md: Loaded "${ctx.project ?? 'project'}" (${ctx.device ?? 'unknown device'}, ${ctx.updated ?? 'unknown time'})`,
        'View File',
        'Copy Resume Prompt',
        'Save to Workspace'
      );

      if (choice === 'View File') await showContextDoc(content);
      else if (choice === 'Copy Resume Prompt') await copyPrompt(content);
      else if (choice === 'Save to Workspace') await saveToWorkspace(content);
    } catch (err: unknown) {
      statusBar.setError();
      vscode.window.showErrorMessage(
        `AI.md: Load failed — ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  async function showContextDoc(content: string): Promise<void> {
    const doc = await vscode.workspace.openTextDocument({ content, language: 'markdown' });
    vscode.window.showTextDocument(doc, { preview: true });
  }

  async function copyPrompt(rawContent?: string): Promise<void> {
    const content = rawContent ?? (await sync.download().catch(() => null));
    if (!content) {
      vscode.window.showWarningMessage('AI.md: No context found. Save first with Ctrl+Alt+S.');
      return;
    }
    await vscode.env.clipboard.writeText(generateResumePrompt(content));
    vscode.window.showInformationMessage(
      'AI.md: Resume prompt copied! Paste into any AI platform to resume seamlessly.'
    );
  }

  async function saveToWorkspace(content: string): Promise<void> {
    const folders = vscode.workspace.workspaceFolders;
    if (!folders) { vscode.window.showWarningMessage('AI.md: No workspace folder open.'); return; }
    const target = vscode.Uri.joinPath(folders[0].uri, 'ai.md');
    await vscode.workspace.fs.writeFile(target, Buffer.from(content, 'utf8'));
    const doc = await vscode.workspace.openTextDocument(target);
    vscode.window.showTextDocument(doc);
  }

  // ── Commands ────────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('aimd.saveContext',      () => doSave(false)),
    vscode.commands.registerCommand('aimd.loadContext',      () => doLoad()),
    vscode.commands.registerCommand('aimd.addNote',          () => capture.promptAddNote()),
    vscode.commands.registerCommand('aimd.copyResumePrompt', () => copyPrompt()),
    vscode.commands.registerCommand('aimd.openConfig',       () => ConfigPanel.createOrShow(context)),
    vscode.commands.registerCommand('aimd.clearNotes', () => {
      capture.clearNotes();
      vscode.window.showInformationMessage('AI.md: Notes cleared.');
    }),
    vscode.commands.registerCommand('aimd.viewContext', async () => {
      const content = await sync.download().catch(() => null);
      content
        ? showContextDoc(content)
        : vscode.window.showInformationMessage('AI.md: No saved context. Use Ctrl+Alt+S to save.');
    }),
    vscode.commands.registerCommand('aimd.viewHabits', async () => {
      const content = await sync.downloadRaw(HABITS_FILENAME).catch(() => null);
      content
        ? showContextDoc(content)
        : vscode.window.showInformationMessage(
            'AI.md: No habits profile yet — it builds up after a few saves.'
          );
    })
  );

  // ── Auto-save ────────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument(() => {
      if (vscode.workspace.getConfiguration('aimd').get<boolean>('saveOnFileSave')) {
        doSave(true);
      }
    })
  );

  function resetTimer(): void {
    if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = undefined; }
    const cfg = vscode.workspace.getConfiguration('aimd');
    if (cfg.get<boolean>('autoSave', true)) {
      const mins = cfg.get<number>('autoSaveInterval', 15);
      autoSaveTimer = setInterval(() => doSave(true), mins * 60 * 1000);
    }
  }

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('aimd.autoSave') || e.affectsConfiguration('aimd.autoSaveInterval')) {
        resetTimer();
      }
    }),
    { dispose: () => { if (autoSaveTimer) clearInterval(autoSaveTimer); } }
  );

  resetTimer();

  // ── Chat participant (@ai.md in Copilot Chat) ─────────────────────────────

  // Guard: vscode.chat is only available in VS Code 1.90+ with GitHub Copilot
  if (typeof vscode.chat !== 'undefined') {
    registerChatParticipant(context, sync, capture);
  }

  // ── First-install welcome ────────────────────────────────────────────────────

  if (!context.globalState.get<boolean>('aimd.installed')) {
    context.globalState.update('aimd.installed', true);
    const choice = await vscode.window.showInformationMessage(
      'AI.md installed! Configure your sync provider to start saving context across devices.',
      'Configure',
      'Save Now (defaults)'
    );
    if (choice === 'Configure') vscode.commands.executeCommand('aimd.openConfig');
    else if (choice === 'Save Now (defaults)') doSave(false);
  }

  statusBar.show();
}

// ─── Habits update helper ─────────────────────────────────────────────────────

async function updateHabitsProfile(
  sync: CloudSync,
  ctx: import('./aimdFormat').AIMdContext
): Promise<void> {
  const existing = await sync.downloadRaw(HABITS_FILENAME).catch(() => null);
  const habitsData = existing ? parseHabits(existing) : null;
  const updated = updateHabits(habitsData, ctx);
  await sync.uploadRaw(HABITS_FILENAME, serializeHabits(updated));
}

// ─── deactivate ───────────────────────────────────────────────────────────────

export function deactivate(): void {
  if (autoSaveTimer) { clearInterval(autoSaveTimer); autoSaveTimer = undefined; }
}
