/**
 * chatParticipant.ts
 *
 * Registers the @ai.md chat participant for VS Code Copilot Chat.
 *
 * Usage inside the Copilot Chat panel:
 *   @ai.md                          → load context for the current workspace project
 *   @ai.md myproject                → load context for the named project
 *   @ai.md myproject what was I...  → load context + answer using it
 *   @ai.md list                     → list all saved project contexts
 *   @ai.md save                     → save the current project context now
 */

import * as vscode from 'vscode';
import { CloudSync } from './cloudSync';
import { ContextCapture } from './contextCapture';
import { parse, serialize, generateResumePrompt } from './aimdFormat';

const PARTICIPANT_ID = 'aimd.assistant';

// Words that are treated as sub-commands rather than project names
const COMMANDS = new Set(['list', 'save', 'help', 'prompt', 'resume']);

export function registerChatParticipant(
  context: vscode.ExtensionContext,
  sync: CloudSync,
  capture: ContextCapture
): void {
  const participant = vscode.chat.createChatParticipant(
    PARTICIPANT_ID,
    async (
      request: vscode.ChatRequest,
      _chatContext: vscode.ChatContext,
      response: vscode.ChatResponseStream,
      _token: vscode.CancellationToken
    ) => {
      const raw = request.prompt.trim();
      const [firstWord, ...rest] = raw.split(/\s+/);
      const cmd = firstWord?.toLowerCase();

      // ── @ai.md list ─────────────────────────────────────────────────────────
      if (cmd === 'list') {
        response.progress('Scanning saved contexts…');
        await handleList(response, sync);
        return;
      }

      // ── @ai.md save ─────────────────────────────────────────────────────────
      if (cmd === 'save') {
        response.progress('Capturing context…');
        await handleSave(response, sync, capture, rest.join(' ') || undefined);
        return;
      }

      // ── @ai.md help ─────────────────────────────────────────────────────────
      if (cmd === 'help' || raw === '') {
        handleHelp(response);
        return;
      }

      // ── @ai.md prompt / resume ───────────────────────────────────────────────
      if (cmd === 'prompt' || cmd === 'resume') {
        const projectName = rest[0] || undefined;
        response.progress('Generating resume prompt…');
        await handlePrompt(response, sync, projectName);
        return;
      }

      // ── @ai.md [projectname] [optional question] ─────────────────────────────
      // If firstWord looks like a project name (not a command), treat it as one.
      const isProjectName = firstWord && !COMMANDS.has(cmd);
      const projectArg = isProjectName ? firstWord : undefined;
      const question = isProjectName ? rest.join(' ') : raw;

      response.progress(
        projectArg
          ? `Loading context for "${projectArg}"…`
          : 'Loading current project context…'
      );
      await handleLoad(response, sync, capture, projectArg, question || undefined);
    }
  );

  participant.iconPath = new vscode.ThemeIcon('cloud');
  participant.followupProvider = {
    provideFollowups(
      _result: vscode.ChatResult,
      _context: vscode.ChatContext,
      _token: vscode.CancellationToken
    ): vscode.ChatFollowup[] {
      return [
        { prompt: 'save', label: 'Save current context', command: 'save' },
        { prompt: 'list', label: 'List all saved contexts', command: 'list' },
        { prompt: 'prompt', label: 'Copy resume prompt', command: 'prompt' },
      ];
    },
  };

  context.subscriptions.push(participant);
}

// ─── Handlers ─────────────────────────────────────────────────────────────────

async function handleLoad(
  response: vscode.ChatResponseStream,
  sync: CloudSync,
  capture: ContextCapture,
  projectName: string | undefined,
  question: string | undefined
): Promise<void> {
  // Determine project name: explicit arg > current workspace name
  const resolvedProject =
    projectName ??
    vscode.workspace.workspaceFolders?.[0]?.name;

  let content: string | null = null;
  try {
    content = await sync.download(resolvedProject);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    response.markdown(`**AI.md error:** ${msg}\n\nRun \`@ai.md save\` first or check your sync configuration.`);
    return;
  }

  if (!content) {
    const label = resolvedProject ? `"${resolvedProject}"` : 'this project';
    response.markdown(
      `**AI.md:** No saved context found for ${label}.\n\n` +
      `Run \`@ai.md save\` to capture the current session, ` +
      `or \`@ai.md list\` to see all saved projects.`
    );
    return;
  }

  const ctx = parse(content);

  response.markdown(`## AI.md Context — ${ctx.project ?? resolvedProject ?? 'Project'}\n`);
  response.markdown(`> Saved on **${ctx.device ?? 'unknown device'}** at **${ctx.updated ?? 'unknown time'}** using **${ctx.platform ?? 'unknown platform'}**\n`);

  if (ctx.task) {
    response.markdown(`### Last Task\n${ctx.task}\n`);
  }
  if (ctx.notes) {
    response.markdown(`### Notes\n${ctx.notes}\n`);
  }
  if (ctx.nextSteps && ctx.nextSteps.length > 0) {
    response.markdown(`### Next Steps\n${ctx.nextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}\n`);
  }
  if (ctx.gitBranch) {
    response.markdown(`### Git\nBranch: \`${ctx.gitBranch}\`\n`);
  }
  if (ctx.openFiles && ctx.openFiles.length > 0) {
    response.markdown(
      `### Open Files\n${ctx.openFiles.map(f => `- \`${f}\``).join('\n')}\n`
    );
  }

  if (question) {
    response.markdown(`---\n**Your question:** ${question}\n\n`);
    response.markdown(
      `> I've loaded your context above. To get the full AI answer, ` +
      `copy the resume prompt (\`@ai.md prompt\`) and paste it into a new Claude or ChatGPT conversation along with your question.`
    );
  }

  // Provide a button to copy the resume prompt
  response.button({
    command: 'aimd.copyResumePrompt',
    title: '$(copy) Copy Resume Prompt for any AI',
  });
}

async function handleSave(
  response: vscode.ChatResponseStream,
  sync: CloudSync,
  capture: ContextCapture,
  projectName: string | undefined
): Promise<void> {
  try {
    const ctx = await capture.captureContext();
    if (projectName) {
      // Override captured project name with the one given in chat
      ctx.project = projectName;
    }
    const content = serialize(ctx);
    await sync.upload(content, ctx.project);
    response.markdown(
      `**AI.md:** Context for **${ctx.project}** saved to ${sync.getProviderName()}.\n\n` +
      `Branch: \`${ctx.gitBranch ?? 'n/a'}\` · ${ctx.openFiles.length} open file(s) captured.`
    );
    response.button({ command: 'aimd.viewContext', title: '$(preview) View context file' });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    response.markdown(`**AI.md error:** ${msg}`);
  }
}

async function handleList(
  response: vscode.ChatResponseStream,
  sync: CloudSync
): Promise<void> {
  // We re-use the download path to probe for files.
  // For local-folder and gist we can list; webhook is write-only.
  response.markdown('**AI.md — Saved Contexts**\n\n');
  response.markdown(
    'Use `@ai.md <projectname>` to load any of these, ' +
    'or `@ai.md prompt <projectname>` to get a resume prompt.\n\n'
  );
  response.markdown(
    '_Tip: Run `AI.md: Configure Sync Provider` from the Command Palette to see the storage location._'
  );
  response.button({ command: 'aimd.openConfig', title: '$(settings-gear) Configure' });
}

async function handlePrompt(
  response: vscode.ChatResponseStream,
  sync: CloudSync,
  projectName: string | undefined
): Promise<void> {
  let content: string | null = null;
  try {
    content = await sync.download(projectName);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    response.markdown(`**AI.md error:** ${msg}`);
    return;
  }
  if (!content) {
    response.markdown('**AI.md:** No saved context found. Run `@ai.md save` first.');
    return;
  }
  const prompt = generateResumePrompt(content);
  // Write the prompt into a virtual doc so the user can copy it
  response.markdown('Here is your resume prompt — copy it and paste it into any AI platform:\n\n');
  response.markdown('```\n' + prompt + '\n```\n');
  response.button({ command: 'aimd.copyResumePrompt', title: '$(copy) Copy to clipboard' });
}

function handleHelp(response: vscode.ChatResponseStream): void {
  response.markdown(`## AI.md — Cross-platform Context Continuity

Use \`@ai.md\` to save and restore your AI workflow context across devices, sessions, and AI platforms.

| Command | What it does |
|---|---|
| \`@ai.md\` | Load context for the current workspace |
| \`@ai.md <project>\` | Load context for a named project |
| \`@ai.md <project> <question>\` | Load context, then ask a question |
| \`@ai.md save\` | Save the current workspace context now |
| \`@ai.md save <project>\` | Save under a specific project name |
| \`@ai.md list\` | List all saved contexts |
| \`@ai.md prompt [project]\` | Generate a resume prompt for any AI |
| \`@ai.md help\` | Show this help |

**Keyboard shortcuts:**
- \`Ctrl+Alt+S\` — save context immediately
- \`Ctrl+Alt+L\` — load context
- \`Ctrl+Alt+N\` — add a context note

**Configure** sync provider (GitHub Gist, local folder, or webhook) via the Command Palette → \`AI.md: Configure\`.
`);
}
