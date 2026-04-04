/**
 * habitsTracker.ts
 *
 * Maintains a "habits.ai.md" file that learns the user's workflow patterns
 * over time.  It is read from and written to cloud on every context save,
 * completely autonomously — the user never has to touch it.
 *
 * The habits file captures:
 *   • Which projects the user works on and how often
 *   • Primary languages / frameworks (inferred from open files)
 *   • AI platforms used across sessions
 *   • Active times (hour-of-day buckets)
 *   • Common "task" keywords (e.g. refactor, debug, feature)
 *   • Recent session history (last 20 entries)
 */

import { AIMdContext } from './aimdFormat';

export interface HabitsData {
  version: string;
  user: string;
  firstSeen: string;
  lastUpdated: string;
  totalSessions: number;
  /** project name → session count */
  projects: Record<string, number>;
  /** language/extension → file count (cumulative) */
  languages: Record<string, number>;
  /** AI platform → usage count */
  platforms: Record<string, number>;
  /** hour (0-23) → save count */
  activeHours: Record<number, number>;
  /** lowercased keyword → frequency */
  taskKeywords: Record<string, number>;
  /** last N sessions, newest first */
  recentSessions: SessionEntry[];
}

interface SessionEntry {
  ts: string;
  project: string;
  platform: string;
  branch?: string;
  taskSummary: string;
}

const MAX_RECENT = 20;
const HABITS_FILENAME = 'habits.ai.md';

// ─── Update ───────────────────────────────────────────────────────────────────

/**
 * Merge a new context save into the habits data and return the updated object.
 * Call this every time a context is saved.
 */
export function updateHabits(existing: HabitsData | null, ctx: AIMdContext): HabitsData {
  const now = new Date().toISOString();
  const hour = new Date().getHours();

  const habits: HabitsData = existing ?? {
    version: '1.0',
    user: ctx.device,
    firstSeen: now,
    lastUpdated: now,
    totalSessions: 0,
    projects: {},
    languages: {},
    platforms: {},
    activeHours: {},
    taskKeywords: {},
    recentSessions: [],
  };

  habits.lastUpdated = now;
  habits.totalSessions += 1;

  // Projects
  habits.projects[ctx.project] = (habits.projects[ctx.project] ?? 0) + 1;

  // Languages from open file extensions
  for (const file of ctx.openFiles) {
    const ext = file.includes('.') ? file.split('.').pop()!.toLowerCase() : 'other';
    habits.languages[ext] = (habits.languages[ext] ?? 0) + 1;
  }

  // AI platform
  if (ctx.platform) {
    habits.platforms[ctx.platform] = (habits.platforms[ctx.platform] ?? 0) + 1;
  }

  // Active hour
  habits.activeHours[hour] = (habits.activeHours[hour] ?? 0) + 1;

  // Task keywords (extract nouns/verbs from task description)
  if (ctx.task) {
    extractKeywords(ctx.task).forEach(kw => {
      habits.taskKeywords[kw] = (habits.taskKeywords[kw] ?? 0) + 1;
    });
  }

  // Recent sessions — prepend and cap
  const entry: SessionEntry = {
    ts: now,
    project: ctx.project,
    platform: ctx.platform,
    branch: ctx.gitBranch,
    taskSummary: ctx.task ? ctx.task.slice(0, 120) : '(no task set)',
  };
  habits.recentSessions = [entry, ...habits.recentSessions].slice(0, MAX_RECENT);

  return habits;
}

// ─── Parse ────────────────────────────────────────────────────────────────────

export function parseHabits(content: string): HabitsData | null {
  try {
    const jsonMatch = content.match(/```json\n([\s\S]+?)\n```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1]) as HabitsData;
  } catch {
    /* ignore parse errors — treat as no data */
  }
  return null;
}

// ─── Serialize ────────────────────────────────────────────────────────────────

export function serializeHabits(h: HabitsData): string {
  const lines: string[] = [];
  const topN = <T extends string | number>(rec: Record<T, number>, n = 5): [T, number][] =>
    (Object.entries(rec) as [T, number][])
      .sort((a, b) => b[1] - a[1])
      .slice(0, n);

  lines.push('# AI.md — Habits & Learning Profile');
  lines.push('');
  lines.push(`> **Auto-generated** by AI.md · Last updated: ${h.lastUpdated} · Total sessions: ${h.totalSessions}`);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('## Overview');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push('|---|---|');
  lines.push(`| User/Device | ${h.user} |`);
  lines.push(`| First seen | ${h.firstSeen} |`);
  lines.push(`| Sessions | ${h.totalSessions} |`);
  lines.push(`| Projects tracked | ${Object.keys(h.projects).length} |`);
  lines.push('');

  // Top projects
  const topProjects = topN(h.projects);
  if (topProjects.length > 0) {
    lines.push('## Most Active Projects');
    lines.push('');
    topProjects.forEach(([name, count]) => {
      const bar = '█'.repeat(Math.min(count, 20));
      lines.push(`- **${name}** — ${count} session${count !== 1 ? 's' : ''} ${bar}`);
    });
    lines.push('');
  }

  // Top languages
  const topLangs = topN(h.languages);
  if (topLangs.length > 0) {
    lines.push('## Primary Languages / File Types');
    lines.push('');
    const total = Object.values(h.languages).reduce((a, b) => a + b, 0);
    topLangs.forEach(([lang, count]) => {
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      lines.push(`- \`.${lang}\` — ${pct}%`);
    });
    lines.push('');
  }

  // AI platform preferences
  const topPlatforms = topN(h.platforms);
  if (topPlatforms.length > 0) {
    lines.push('## AI Platform Usage');
    lines.push('');
    const total = Object.values(h.platforms).reduce((a, b) => a + b, 0);
    topPlatforms.forEach(([name, count]) => {
      const pct = total > 0 ? Math.round((count / total) * 100) : 0;
      lines.push(`- **${name}** — ${pct}% (${count} session${count !== 1 ? 's' : ''})`);
    });
    lines.push('');
  }

  // Active hours heatmap
  const hourEntries = Object.entries(h.activeHours) as [string, number][];
  if (hourEntries.length > 0) {
    lines.push('## When You Code');
    lines.push('');
    const max = Math.max(...hourEntries.map(([, v]) => v));
    // Group into Morning / Afternoon / Evening / Night
    const buckets: Record<string, number> = {
      'Night (0–5)': 0,
      'Morning (6–11)': 0,
      'Afternoon (12–17)': 0,
      'Evening (18–23)': 0,
    };
    hourEntries.forEach(([hour, count]) => {
      const h = parseInt(hour, 10);
      if (h < 6) buckets['Night (0–5)'] += count;
      else if (h < 12) buckets['Morning (6–11)'] += count;
      else if (h < 18) buckets['Afternoon (12–17)'] += count;
      else buckets['Evening (18–23)'] += count;
    });
    const bucketTotal = Object.values(buckets).reduce((a, b) => a + b, 0);
    Object.entries(buckets).forEach(([label, count]) => {
      const pct = bucketTotal > 0 ? Math.round((count / bucketTotal) * 100) : 0;
      const bar = '▓'.repeat(Math.round(pct / 5));
      lines.push(`- ${label}: ${pct}% ${bar}`);
    });
    void max; // used above
    lines.push('');
  }

  // Common task types
  const topKW = topN(h.taskKeywords, 8);
  if (topKW.length > 0) {
    lines.push('## Common Task Patterns');
    lines.push('');
    topKW.forEach(([kw, count]) => {
      lines.push(`- \`${kw}\` × ${count}`);
    });
    lines.push('');
  }

  // Recent sessions
  if (h.recentSessions.length > 0) {
    lines.push('## Recent Sessions');
    lines.push('');
    h.recentSessions.slice(0, 10).forEach(s => {
      const date = s.ts.split('T')[0];
      const time = s.ts.split('T')[1]?.slice(0, 5) ?? '';
      const branch = s.branch ? ` · \`${s.branch}\`` : '';
      lines.push(`### ${date} ${time} — ${s.project} (${s.platform})${branch}`);
      lines.push(`> ${s.taskSummary}`);
      lines.push('');
    });
  }

  // Embed raw JSON for lossless round-trip parsing
  lines.push('---');
  lines.push('');
  lines.push('<!-- Raw data for AI.md parsing — do not edit manually -->');
  lines.push('```json');
  lines.push(JSON.stringify(h, null, 2));
  lines.push('```');

  return lines.join('\n');
}

// ─── Keyword extractor ────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'a','an','the','and','or','but','in','on','at','to','for','of','with',
  'by','from','is','it','as','be','this','that','we','i','my','your','the',
  'need','want','work','working','on','fix','fixing','add','adding','update',
  'updating','create','creating','implement','implementing','the','was','has',
]);

function extractKeywords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\W+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w))
    .slice(0, 10);
}

export { HABITS_FILENAME };
