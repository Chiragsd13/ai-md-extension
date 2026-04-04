import * as os from 'os';

export const AIMD_VERSION = '1.2';

// ─── File types ──────────────────────────────────────────────────────────────
// Each project stores two files:
//   {project}.technical.ai.md  — code state, git, files, tech stack, errors
//   {project}.preferences.ai.md — response style, tone, format, constraints

export type AIMdFileType = 'technical' | 'preferences';

export function projectFilenames(project: string): { technical: string; preferences: string } {
  const base = project || 'ai';
  return {
    technical:   `${base}.technical.ai.md`,
    preferences: `${base}.preferences.ai.md`,
  };
}

// The legacy single-file name — still supported for backwards compat
export function legacyFilename(project: string): string {
  const base = project || 'ai';
  return base.endsWith('.ai.md') ? base : `${base}.ai.md`;
}

// ─── Preferences context (the "general" file) ────────────────────────────────

export interface AIMdPreferences {
  version: string;
  project: string;
  updated: string;

  // Response style
  responseStyle?: string;          // "concise" | "detailed" | "step-by-step" | custom
  preferredTone?: string;          // "professional" | "casual" | "technical" | custom
  codeStyle?: string;              // "commented" | "minimal" | "documented" | custom
  explanationDepth?: string;       // "brief" | "thorough" | "ELI5" | custom

  // Format preferences
  preferMarkdown?: boolean;        // prefers markdown formatting
  preferCodeBlocks?: boolean;      // prefers code blocks vs inline
  preferBulletPoints?: boolean;    // prefers lists vs paragraphs
  preferNumberedSteps?: boolean;   // prefers numbered steps for procedures

  // Communication style
  askBeforeActing?: boolean;       // prefers AI asks vs acts
  showReasoningFirst?: boolean;    // prefers seeing reasoning before answer
  avoidApologies?: boolean;        // "don't apologize, just do it"
  directAnswers?: boolean;         // "skip the preamble"

  // Domain knowledge level
  experienceLevel?: string;        // "beginner" | "intermediate" | "expert"
  domainExpertise?: string[];      // areas of expertise

  // Constraints / rules
  customRules?: string[];          // "never change version numbers", "always use TypeScript", etc.
  avoidPatterns?: string[];        // "don't use classes", "avoid ternaries", etc.
  preferPatterns?: string[];       // "use functional style", "prefer const", etc.

  // Learned over time (auto-populated from habits tracker)
  commonTopics?: string[];         // what user frequently asks about
  preferredLanguages?: string[];   // programming languages used most
  typicalProjectTypes?: string[];  // "web app", "CLI tool", "library", etc.

  // Free-form notes
  notes?: string;
}

export function serializePreferences(prefs: AIMdPreferences): string {
  const lines: string[] = [];

  lines.push(`# AI Preferences — ${prefs.project}`);
  lines.push('');
  lines.push(`> **Updated:** ${fmt(prefs.updated)}  |  **AI.md Version:** ${prefs.version}`);
  lines.push('');
  lines.push('*This file tells AI assistants HOW you want them to respond. The companion*');
  lines.push('*technical file tells them WHAT you\'re working on.*');
  lines.push('');
  lines.push('---');
  lines.push('');

  // Response Style
  lines.push('## Response Style');
  lines.push('');
  const styleRows: [string, string][] = [];
  if (prefs.responseStyle)     styleRows.push(['Style', prefs.responseStyle]);
  if (prefs.preferredTone)     styleRows.push(['Tone', prefs.preferredTone]);
  if (prefs.codeStyle)         styleRows.push(['Code Style', prefs.codeStyle]);
  if (prefs.explanationDepth)  styleRows.push(['Explanation Depth', prefs.explanationDepth]);
  if (prefs.experienceLevel)   styleRows.push(['Experience Level', prefs.experienceLevel]);

  if (styleRows.length) {
    lines.push('| Setting | Value |');
    lines.push('|---|---|');
    styleRows.forEach(([k, v]) => lines.push(`| ${k} | ${v} |`));
    lines.push('');
  }

  // Format Preferences
  const formatPrefs: string[] = [];
  if (prefs.preferMarkdown)       formatPrefs.push('Markdown formatting');
  if (prefs.preferCodeBlocks)     formatPrefs.push('Code in fenced blocks');
  if (prefs.preferBulletPoints)   formatPrefs.push('Bullet points over paragraphs');
  if (prefs.preferNumberedSteps)  formatPrefs.push('Numbered steps for procedures');
  if (prefs.directAnswers)        formatPrefs.push('Direct answers (skip preamble)');
  if (prefs.showReasoningFirst)   formatPrefs.push('Show reasoning before answer');
  if (prefs.askBeforeActing)      formatPrefs.push('Ask before making changes');
  if (prefs.avoidApologies)       formatPrefs.push('No apologies — just do it');

  if (formatPrefs.length) {
    lines.push('## Format Preferences');
    lines.push('');
    formatPrefs.forEach(p => lines.push(`- ${p}`));
    lines.push('');
  }

  // Custom Rules
  if (prefs.customRules?.length) {
    lines.push('## Rules & Constraints');
    lines.push('');
    lines.push('*Always follow these:*');
    lines.push('');
    prefs.customRules.forEach(r => lines.push(`- ${r}`));
    lines.push('');
  }

  // Preferred Patterns
  if (prefs.preferPatterns?.length) {
    lines.push('## Preferred Patterns');
    lines.push('');
    prefs.preferPatterns.forEach(p => lines.push(`- ${p}`));
    lines.push('');
  }

  // Avoid Patterns
  if (prefs.avoidPatterns?.length) {
    lines.push('## Patterns to Avoid');
    lines.push('');
    prefs.avoidPatterns.forEach(p => lines.push(`- ${p}`));
    lines.push('');
  }

  // Domain Expertise
  if (prefs.domainExpertise?.length || prefs.preferredLanguages?.length || prefs.typicalProjectTypes?.length) {
    lines.push('## Domain Knowledge');
    lines.push('');
    if (prefs.domainExpertise?.length)     lines.push(`**Expertise:** ${prefs.domainExpertise.join(', ')}`);
    if (prefs.preferredLanguages?.length)   lines.push(`**Languages:** ${prefs.preferredLanguages.join(', ')}`);
    if (prefs.typicalProjectTypes?.length)  lines.push(`**Project Types:** ${prefs.typicalProjectTypes.join(', ')}`);
    if (prefs.commonTopics?.length)         lines.push(`**Common Topics:** ${prefs.commonTopics.join(', ')}`);
    lines.push('');
  }

  // Notes
  if (prefs.notes) {
    lines.push('## Notes');
    lines.push('');
    lines.push(prefs.notes);
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*Generated by [AI.md](https://github.com/ai-md/vscode-extension) — Cross-platform AI context continuity*');

  return lines.join('\n');
}

export function parsePreferences(content: string): Partial<AIMdPreferences> {
  const prefs: Partial<AIMdPreferences> = {};

  const grab = (pattern: RegExp) => {
    const m = content.match(pattern);
    return m ? m[1].trim() : undefined;
  };

  const listSection = (heading: string): string[] | undefined => {
    const re = new RegExp(`## ${heading}\\n\\n(?:\\*[^*]+\\*\\n\\n)?([\\s\\S]+?)(?=\\n## |\\n---\\n|$)`);
    const m = content.match(re);
    if (!m) return undefined;
    return m[1].split('\n')
      .filter(l => l.startsWith('- '))
      .map(l => l.replace(/^- /, '').trim())
      .filter(Boolean);
  };

  prefs.project        = grab(/^# AI Preferences[—\-–]+\s*(.+)$/m);
  prefs.responseStyle  = grab(/\| Style \| ([^|]+) \|/);
  prefs.preferredTone  = grab(/\| Tone \| ([^|]+) \|/);
  prefs.codeStyle      = grab(/\| Code Style \| ([^|]+) \|/);
  prefs.explanationDepth = grab(/\| Explanation Depth \| ([^|]+) \|/);
  prefs.experienceLevel  = grab(/\| Experience Level \| ([^|]+) \|/);

  prefs.customRules    = listSection('Rules & Constraints');
  prefs.preferPatterns = listSection('Preferred Patterns');
  prefs.avoidPatterns  = listSection('Patterns to Avoid');

  return prefs;
}

export function defaultPreferences(project: string): AIMdPreferences {
  return {
    version:            AIMD_VERSION,
    project,
    updated:            new Date().toISOString(),
    responseStyle:      'concise',
    preferredTone:      'professional',
    codeStyle:          'commented',
    explanationDepth:   'thorough',
    preferMarkdown:     true,
    preferCodeBlocks:   true,
    preferBulletPoints: true,
    preferNumberedSteps: true,
    directAnswers:      true,
    askBeforeActing:    false,
    avoidApologies:     true,
    experienceLevel:    'intermediate',
    customRules:        [],
    preferPatterns:     [],
    avoidPatterns:      [],
    notes:              '',
  };
}

export interface AIMdContext {
  // ── Identity ────────────────────────────────────────────────────────────────
  version: string;
  created: string;
  updated: string;
  sessionId: string;
  project: string;
  platform: string;
  device: string;
  workspacePath?: string;

  // ── Project metadata (auto-collected) ───────────────────────────────────────
  projectDescription?: string;  // from README / package.json / pyproject.toml etc.
  techStack?: string[];          // detected languages/frameworks
  gitRemote?: string;            // repo URL

  // ── Task (user-set or AI-inferred) ──────────────────────────────────────────
  task: string;
  notes: string;
  nextSteps: string[];

  // ── AI-generated enrichment (optional — requires API key) ────────────────────
  aiGeneratedTask?:      string;    // 1-2 sentence task inferred from git evidence
  aiContextPoints?:      string[];  // 3 key facts the next AI session needs immediately
  aiNextSteps?:          string[];  // 3 suggested next steps from commit trajectory
  aiAnalysisModel?:      string;    // e.g. "claude-3-haiku-20240307"
  aiAnalysisTimestamp?:  string;    // ISO timestamp — tells you how fresh the analysis is

  // ── Captured conversation (from browser extension "Save Chat") ───────────────
  capturedPrompts?:       string[];  // last N user messages from the AI chat
  conversationPlatform?:  string;    // "Claude" | "ChatGPT" | "Gemini" etc.
  conversationUrl?:       string;    // URL of the chat session
  conversationCapturedAt?: string;  // ISO timestamp

  // ── Live state (auto-collected) ──────────────────────────────────────────────
  openFiles: string[];           // open editor tabs (VS Code) or recently changed (CLI)
  recentFiles?: string[];        // files changed in last 7 days
  gitBranch?: string;
  gitCommits?: string[];         // recent commit one-liners with date
  gitStatusSummary?: string;     // M/A/D/? counts for uncommitted changes
  fileTree?: string;
}

// ─── Serialize ────────────────────────────────────────────────────────────────

export function serialize(ctx: AIMdContext): string {
  const lines: string[] = [];

  // Title
  lines.push(`# AI Context — ${ctx.project}`);
  lines.push('');
  lines.push(`> **Updated:** ${fmt(ctx.updated)}  |  **Platform:** ${ctx.platform}  |  **Device:** ${ctx.device}`);
  lines.push('');
  lines.push('---');
  lines.push('');

  // ── Project Overview ─────────────────────────────────────────────────────────
  lines.push('## Project Overview');
  lines.push('');

  if (ctx.projectDescription) {
    lines.push(ctx.projectDescription);
    lines.push('');
  }

  const overviewRows: [string, string][] = [
    ['Project', `\`${ctx.project}\``],
    ['Platform', ctx.platform],
    ['Device', ctx.device],
    ['Session ID', `\`${ctx.sessionId}\``],
    ['Created', fmt(ctx.created)],
    ['Updated', fmt(ctx.updated)],
    ['AI.md Version', ctx.version],
  ];
  if (ctx.workspacePath) overviewRows.push(['Workspace', `\`${ctx.workspacePath}\``]);
  if (ctx.gitRemote)    overviewRows.push(['Repository', ctx.gitRemote]);
  if (ctx.gitBranch)    overviewRows.push(['Branch', `\`${ctx.gitBranch}\``]);
  if (ctx.techStack?.length) overviewRows.push(['Tech Stack', ctx.techStack.join(', ')]);

  lines.push('| Field | Value |');
  lines.push('|---|---|');
  overviewRows.forEach(([k, v]) => lines.push(`| ${k} | ${v} |`));
  lines.push('');

  // ── Current Task ─────────────────────────────────────────────────────────────
  const taskText = ctx.task || ctx.aiGeneratedTask;
  if (taskText) {
    lines.push('## Current Task');
    lines.push('');
    lines.push(taskText);
    if (!ctx.task && ctx.aiGeneratedTask) {
      lines.push('');
      lines.push(`*Auto-inferred by ${ctx.aiAnalysisModel ?? 'AI'} — edit above if inaccurate*`);
    }
    lines.push('');
  }

  // ── AI Context Points ────────────────────────────────────────────────────────
  if (ctx.aiContextPoints?.length) {
    lines.push('## Key Context');
    lines.push('');
    lines.push('*AI-extracted — things the next session needs to know immediately:*');
    lines.push('');
    ctx.aiContextPoints.forEach(p => lines.push(`- ${p}`));
    lines.push('');
  }

  // ── Context Notes ────────────────────────────────────────────────────────────
  if (ctx.notes) {
    lines.push('## Context Notes');
    lines.push('');
    lines.push(ctx.notes);
    lines.push('');
  }

  // ── Captured Prompts (from browser extension) ────────────────────────────────
  if (ctx.capturedPrompts?.length) {
    const platform = ctx.conversationPlatform ?? 'AI Chat';
    const when     = ctx.conversationCapturedAt ? ` — ${fmt(ctx.conversationCapturedAt)}` : '';
    lines.push(`## Recent Prompts (${platform}${when})`);
    lines.push('');
    lines.push('*What was asked in the last chat session:*');
    lines.push('');
    ctx.capturedPrompts.forEach((p, i) => {
      lines.push(`**[${i + 1}]** ${p}`);
      lines.push('');
    });
  }

  // ── Next Steps ───────────────────────────────────────────────────────────────
  const allNextSteps = [
    ...ctx.nextSteps,
    ...(ctx.nextSteps.length === 0 && ctx.aiNextSteps ? ctx.aiNextSteps : []),
  ];
  if (allNextSteps.length > 0) {
    lines.push('## Next Steps');
    lines.push('');
    allNextSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    if (ctx.nextSteps.length === 0 && ctx.aiNextSteps?.length) {
      lines.push('');
      lines.push(`*Suggested by ${ctx.aiAnalysisModel ?? 'AI'} based on commit history*`);
    }
    lines.push('');
  }

  // ── Recent Git Activity ──────────────────────────────────────────────────────
  if (ctx.gitCommits?.length) {
    lines.push('## Recent Git Activity');
    lines.push('');
    if (ctx.gitBranch) lines.push(`**Branch:** \`${ctx.gitBranch}\``);
    if (ctx.gitStatusSummary) lines.push(`**Uncommitted:** ${ctx.gitStatusSummary}`);
    lines.push('');
    ctx.gitCommits.forEach(c => lines.push(`- ${c}`));
    lines.push('');
  }

  // ── Open / Active Files ──────────────────────────────────────────────────────
  if (ctx.openFiles.length > 0) {
    lines.push('## Open / Active Files');
    lines.push('');
    ctx.openFiles.forEach(f => lines.push(`- \`${f}\``));
    lines.push('');
  }

  // ── Recently Changed Files ───────────────────────────────────────────────────
  if (ctx.recentFiles?.length) {
    lines.push('## Recently Changed Files (last 7 days)');
    lines.push('');
    ctx.recentFiles.forEach(f => lines.push(`- \`${f}\``));
    lines.push('');
  }

  // ── File Tree ────────────────────────────────────────────────────────────────
  if (ctx.fileTree) {
    lines.push('## Project Structure');
    lines.push('');
    lines.push('```');
    lines.push(ctx.fileTree);
    lines.push('```');
    lines.push('');
  }

  lines.push('---');
  lines.push('');
  lines.push('*Generated by [AI.md](https://github.com/ai-md/vscode-extension) — Cross-platform AI context continuity*');

  return lines.join('\n');
}

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parse(content: string): Partial<AIMdContext> {
  const ctx: Partial<AIMdContext> = {};

  const grab = (pattern: RegExp) => {
    const m = content.match(pattern);
    return m ? m[1].trim() : undefined;
  };

  const section = (heading: string) => {
    const re = new RegExp(`## ${heading}\\n\\n([\\s\\S]+?)(?=\\n## |\\n---\\n|\\n*$)`);
    const m = content.match(re);
    return m ? m[1].trim() : undefined;
  };

  ctx.project = grab(/^# AI Context[—\-–]+\s*(.+)$/m);
  ctx.task    = section('Current Task');
  ctx.notes   = section('Context Notes');
  ctx.platform = grab(/\| Platform \| ([^|]+) \|/);
  ctx.device   = grab(/\| Device \| ([^|]+) \|/);
  ctx.updated  = grab(/\| Updated \| ([^|]+) \|/);
  ctx.created  = grab(/\| Created \| ([^|]+) \|/);
  ctx.sessionId = grab(/\| Session ID \| `?([^`|]+)`? \|/);
  ctx.gitBranch = grab(/\*\*Branch:\*\* `([^`]+)`/) ?? grab(/\| Branch \| `([^`]+)` \|/);
  ctx.gitRemote = grab(/\| Repository \| ([^|]+) \|/);

  const wp = grab(/\| Workspace \| `?([^`|]+)`? \|/);
  if (wp) ctx.workspacePath = wp;

  const nextRaw = section('Next Steps');
  if (nextRaw) {
    ctx.nextSteps = nextRaw
      .split('\n').filter(l => /^\d+\./.test(l))
      .map(l => l.replace(/^\d+\.\s*/, ''));
  }

  const openRaw = section('Open / Active Files') ?? section('Open Files');
  if (openRaw) {
    ctx.openFiles = openRaw.split('\n')
      .filter(l => l.startsWith('- ')).map(l => l.replace(/^- `?/, '').replace(/`?$/, ''));
  }

  // Parse AI context points
  const keyCtxRaw = section('Key Context');
  if (keyCtxRaw) {
    ctx.aiContextPoints = keyCtxRaw
      .split('\n')
      .filter(l => l.startsWith('- '))
      .map(l => l.replace(/^- /, '').trim())
      .filter(Boolean);
  }

  // Parse captured prompts (heading has dynamic platform/timestamp suffix)
  const promptsMatch = content.match(/## Recent Prompts[^\n]*\n\n(?:\*[^*]+\*\n\n)?([\s\S]+?)(?=\n## |\n---\n|\n*$)/);
  if (promptsMatch) {
    ctx.capturedPrompts = promptsMatch[1]
      .split('\n')
      .filter(l => l.startsWith('**['))
      .map(l => l.replace(/^\*\*\[\d+\]\*\*\s*/, '').trim())
      .filter(Boolean);
    const platMatch = content.match(/## Recent Prompts \(([^)—–-]+)/);
    if (platMatch) ctx.conversationPlatform = platMatch[1].trim();
  }

  return ctx;
}

// ─── Resume Prompt ────────────────────────────────────────────────────────────

export function generateResumePrompt(aimdContent: string): string {
  const ctx = parse(aimdContent);
  const project = ctx.project ? `the **${ctx.project}** project` : 'my project';
  const platform = ctx.platform ?? 'an AI assistant';

  const taskLine = ctx.task
    ? `My current task: **${ctx.task}**`
    : 'My current task is described in the context file below.';

  const stepsLine = ctx.nextSteps?.length
    ? `\n\nMy planned next steps:\n${ctx.nextSteps.map((s, i) => `${i + 1}. ${s}`).join('\n')}`
    : '';

  return `I'm resuming work on ${project}. I was previously working with ${platform} and need to continue here.

Below is my AI.md context file capturing everything about this work:

---
${aimdContent}
---

${taskLine}${stepsLine}

Please review this context and help me continue seamlessly from where I left off. Ask any clarifying questions before we begin.`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function fmt(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  } catch {
    return iso;
  }
}

export function newSessionId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function deviceName(): string {
  return os.hostname();
}
