/**
 * smartAnalysis.ts — AI-powered context enrichment
 *
 * When ANTHROPIC_API_KEY or OPENAI_API_KEY is set in the environment,
 * analyzes the captured project state and auto-generates:
 *   - A specific "Current Task" description inferred from git evidence
 *   - 3 key context points the next AI session needs to know
 *   - 3 suggested next steps based on commit patterns
 *
 * Fails silently — always returns the original ctx unchanged on any error.
 * Zero dependencies beyond Node.js built-ins.
 */

import * as https from 'https';
import { AIMdContext } from './aimdFormat';

// ─── Public API ───────────────────────────────────────────────────────────────

export interface SmartAnalysisOptions {
  /** Explicit API key override. Falls back to ANTHROPIC_API_KEY, then OPENAI_API_KEY. */
  apiKey?: string;
  provider?: 'anthropic' | 'openai';
  timeoutMs?: number;
  /** Suppress all console.error output on failure */
  silent?: boolean;
}

/**
 * Enrich a captured context object with AI-inferred task, context points,
 * and next steps. Returns the original ctx unchanged on any failure.
 */
export async function enrichWithAI(
  ctx: AIMdContext,
  opts: SmartAnalysisOptions = {},
): Promise<AIMdContext> {

  // ── Detect provider ────────────────────────────────────────────────────────
  const anthropicKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
  const openaiKey    = process.env.OPENAI_API_KEY ?? '';

  const key      = anthropicKey || openaiKey;
  const provider = (opts.provider ?? (anthropicKey ? 'anthropic' : openaiKey ? 'openai' : null));
  if (!key || !provider) return ctx;

  // ── Build prompt ───────────────────────────────────────────────────────────
  const prompt = buildPrompt(ctx);

  try {
    const raw = provider === 'anthropic'
      ? await callAnthropic(key, prompt, opts.timeoutMs ?? 8000)
      : await callOpenAI(key, prompt, opts.timeoutMs ?? 8000);

    const parsed = parseAIResponse(raw);
    if (!parsed) return ctx;

    const model = provider === 'anthropic' ? 'claude-3-haiku-20240307' : 'gpt-3.5-turbo';
    return {
      ...ctx,
      aiGeneratedTask:      parsed.task,
      aiContextPoints:      parsed.contextPoints,
      aiNextSteps:          parsed.nextSteps,
      aiAnalysisModel:      model,
      aiAnalysisTimestamp:  new Date().toISOString(),
    };
  } catch (err) {
    if (!opts.silent) {
      process.stderr.write(`[AI.md] Smart analysis failed: ${(err as Error).message}\n`);
    }
    return ctx;
  }
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

function buildPrompt(ctx: AIMdContext): string {
  const lines: string[] = [
    'You are analyzing a developer\'s project context. Generate a precise technical summary.',
    '',
  ];

  if (ctx.projectDescription) lines.push(`Project description: ${ctx.projectDescription}`);
  if (ctx.techStack?.length)  lines.push(`Tech stack: ${ctx.techStack.join(', ')}`);
  if (ctx.gitBranch)          lines.push(`Current branch: ${ctx.gitBranch}`);
  if (ctx.gitStatusSummary)   lines.push(`Uncommitted changes: ${ctx.gitStatusSummary}`);

  if (ctx.gitCommits?.length) {
    lines.push('', 'Recent commits (newest first):');
    ctx.gitCommits.slice(0, 10).forEach(c => lines.push(`  • ${c}`));
  }

  if (ctx.recentFiles?.length) {
    lines.push('', 'Files changed in the last 7 days:');
    ctx.recentFiles.slice(0, 15).forEach(f => lines.push(`  ${f}`));
  }

  if (ctx.openFiles?.length) {
    lines.push('', 'Currently active/open files:');
    ctx.openFiles.slice(0, 10).forEach(f => lines.push(`  ${f}`));
  }

  lines.push(
    '',
    'Based on this evidence, respond with ONLY a JSON object:',
    '{',
    '  "task": "1-2 sentence description of what the developer is actively working on right now",',
    '  "contextPoints": ["specific technical fact 1", "specific fact 2", "specific fact 3"],',
    '  "nextSteps": ["concrete next action 1", "action 2", "action 3"]',
    '}',
    '',
    'Rules:',
    '- Be specific and technical, not generic ("building auth feature" not "working on the project")',
    '- Infer from git commit messages and file names — what problem is being solved?',
    '- Context points should be things a NEW AI assistant would need to know to help immediately',
    '- Next steps should follow naturally from the commit trajectory',
    '- Reply with ONLY the JSON object, no explanation or markdown',
  );

  return lines.join('\n');
}

// ─── Anthropic API (claude-3-haiku) ──────────────────────────────────────────

function callAnthropic(apiKey: string, prompt: string, timeoutMs: number): Promise<string> {
  return httpsPost(
    'api.anthropic.com',
    '/v1/messages',
    {
      'x-api-key':          apiKey,
      'anthropic-version':  '2023-06-01',
      'content-type':       'application/json',
    },
    JSON.stringify({
      model:      'claude-3-haiku-20240307',
      max_tokens: 450,
      messages:   [{ role: 'user', content: prompt }],
    }),
    timeoutMs,
    (body) => {
      const j = JSON.parse(body);
      return j.content?.[0]?.text ?? '';
    },
  );
}

// ─── OpenAI API (gpt-3.5-turbo) ──────────────────────────────────────────────

function callOpenAI(apiKey: string, prompt: string, timeoutMs: number): Promise<string> {
  return httpsPost(
    'api.openai.com',
    '/v1/chat/completions',
    {
      'Authorization': `Bearer ${apiKey}`,
      'content-type':  'application/json',
    },
    JSON.stringify({
      model:      'gpt-3.5-turbo',
      max_tokens: 450,
      messages:   [{ role: 'user', content: prompt }],
    }),
    timeoutMs,
    (body) => {
      const j = JSON.parse(body);
      return j.choices?.[0]?.message?.content ?? '';
    },
  );
}

// ─── Generic HTTPS POST ───────────────────────────────────────────────────────

function httpsPost(
  hostname:  string,
  path:      string,
  headers:   Record<string, string>,
  body:      string,
  timeoutMs: number,
  extract:   (body: string) => string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname, path, method: 'POST',
        headers: { ...headers, 'content-length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: string) => data += chunk);
        res.on('end', () => {
          if ((res.statusCode ?? 0) >= 400) {
            reject(new Error(`HTTP ${res.statusCode}: ${data.slice(0, 120)}`));
            return;
          }
          try { resolve(extract(data)); }
          catch (e) { reject(e); }
        });
      },
    );

    req.setTimeout(timeoutMs, () => { req.destroy(new Error('Request timed out')); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Response parser ──────────────────────────────────────────────────────────

function parseAIResponse(text: string): {
  task: string;
  contextPoints: string[];
  nextSteps: string[];
} | null {
  try {
    // Strip markdown code fences if present
    const stripped = text.replace(/^```(?:json)?\s*/m, '').replace(/\s*```$/m, '').trim();
    const j = JSON.parse(stripped);

    if (typeof j.task !== 'string'          ) return null;
    if (!Array.isArray(j.contextPoints))      return null;
    if (!Array.isArray(j.nextSteps))          return null;

    return {
      task:          j.task.trim(),
      contextPoints: j.contextPoints.slice(0, 3).map(String).map((s: string) => s.trim()),
      nextSteps:     j.nextSteps.slice(0, 3).map(String).map((s: string) => s.trim()),
    };
  } catch {
    return null;
  }
}
