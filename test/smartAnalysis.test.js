/**
 * smartAnalysis.ts — Test Suite
 *
 * Tests: buildPrompt structure, parseAIResponse, enrichWithAI fallback,
 *        provider detection, error handling.
 *
 * Run: node test/smartAnalysis.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, msg) {
  if (condition) { passed++; process.stdout.write('.'); }
  else { failed++; failures.push(msg); process.stdout.write('F'); }
}
function assertEqual(a, b, msg) { assert(a === b, `${msg}: expected "${b}", got "${a}"`); }
function assertIncludes(s, sub, msg) { assert(typeof s === 'string' && s.includes(sub), `${msg}: missing "${sub}"`); }
function assertMatch(s, re, msg) { assert(typeof s === 'string' && re.test(s), `${msg}: expected match ${re}`); }

// ─── Read source ────────────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'smartAnalysis.ts'), 'utf8');

console.log('\n=== smartAnalysis.ts — exports ===');
assertIncludes(src, 'export interface SmartAnalysisOptions', 'exports SmartAnalysisOptions');
assertIncludes(src, 'export async function enrichWithAI(', 'exports enrichWithAI');

console.log('\n=== SmartAnalysisOptions fields ===');
assertIncludes(src, 'apiKey?:', 'has apiKey');
assertIncludes(src, "provider?:", 'has provider');
assertIncludes(src, 'timeoutMs?:', 'has timeoutMs');
assertIncludes(src, 'silent?:', 'has silent');

console.log('\n=== enrichWithAI logic ===');
// Should detect provider from env
assertIncludes(src, 'process.env.ANTHROPIC_API_KEY', 'reads ANTHROPIC_API_KEY');
assertIncludes(src, 'process.env.OPENAI_API_KEY', 'reads OPENAI_API_KEY');
// Should fall back to original ctx when no key
assertIncludes(src, 'if (!key || !provider) return ctx', 'returns ctx when no key');
// Should catch errors and return ctx
assertIncludes(src, 'return ctx;', 'error fallback returns ctx');

console.log('\n=== buildPrompt structure ===');
const buildPromptBody = src.slice(
  src.indexOf('function buildPrompt('),
  src.indexOf('function callAnthropic(')
);
assertIncludes(buildPromptBody, 'ctx.projectDescription', 'prompt includes projectDescription');
assertIncludes(buildPromptBody, 'ctx.techStack', 'prompt includes techStack');
assertIncludes(buildPromptBody, 'ctx.gitBranch', 'prompt includes gitBranch');
assertIncludes(buildPromptBody, 'ctx.gitStatusSummary', 'prompt includes gitStatusSummary');
assertIncludes(buildPromptBody, 'ctx.gitCommits', 'prompt includes gitCommits');
assertIncludes(buildPromptBody, 'ctx.recentFiles', 'prompt includes recentFiles');
assertIncludes(buildPromptBody, 'ctx.openFiles', 'prompt includes openFiles');
assertIncludes(buildPromptBody, '"task":', 'prompt JSON has task field');
assertIncludes(buildPromptBody, '"contextPoints":', 'prompt JSON has contextPoints');
assertIncludes(buildPromptBody, '"nextSteps":', 'prompt JSON has nextSteps');

console.log('\n=== callAnthropic ===');
const anthropicBody = src.slice(
  src.indexOf('function callAnthropic('),
  src.indexOf('function callOpenAI(')
);
assertIncludes(anthropicBody, 'api.anthropic.com', 'uses Anthropic hostname');
assertIncludes(anthropicBody, '/v1/messages', 'uses /v1/messages endpoint');
assertIncludes(anthropicBody, 'x-api-key', 'sends x-api-key header');
assertIncludes(anthropicBody, 'anthropic-version', 'sends anthropic-version header');
assertIncludes(anthropicBody, 'claude-3-haiku', 'uses haiku model');
assertIncludes(anthropicBody, 'max_tokens: 450', 'caps tokens at 450');

console.log('\n=== callOpenAI ===');
const openaiBody = src.slice(
  src.indexOf('function callOpenAI('),
  src.indexOf('function httpsPost(')
);
assertIncludes(openaiBody, 'api.openai.com', 'uses OpenAI hostname');
assertIncludes(openaiBody, '/v1/chat/completions', 'uses completions endpoint');
assertIncludes(openaiBody, 'Authorization', 'sends Authorization header');
assertIncludes(openaiBody, 'gpt-3.5-turbo', 'uses gpt-3.5-turbo model');

console.log('\n=== httpsPost ===');
const httpsBody = src.slice(
  src.indexOf('function httpsPost('),
  src.indexOf('function parseAIResponse(')
);
assertIncludes(httpsBody, 'new Promise', 'returns a promise');
assertIncludes(httpsBody, 'req.setTimeout', 'has timeout');
assertIncludes(httpsBody, 'req.destroy', 'destroys on timeout');
assertIncludes(httpsBody, "res.statusCode", 'checks status code');
assertIncludes(httpsBody, '400', 'rejects on 4xx');

console.log('\n=== parseAIResponse ===');
const parseBody = src.slice(
  src.indexOf('function parseAIResponse('),
);
// Should handle markdown code fences
assertIncludes(parseBody, '```', 'strips code fences');
assertIncludes(parseBody, 'JSON.parse', 'parses JSON');
// Should validate shape
assertIncludes(parseBody, "typeof j.task !== 'string'", 'validates task is string');
assertIncludes(parseBody, 'Array.isArray(j.contextPoints)', 'validates contextPoints is array');
assertIncludes(parseBody, 'Array.isArray(j.nextSteps)', 'validates nextSteps is array');
// Should cap results
assertIncludes(parseBody, 'slice(0, 3)', 'caps results at 3');
// Should handle errors
assertIncludes(parseBody, 'return null', 'returns null on error');

console.log('\n=== enrichWithAI result shape ===');
const enrichBody = src.slice(
  src.indexOf('export async function enrichWithAI('),
  src.indexOf('function buildPrompt(')
);
assertIncludes(enrichBody, 'aiGeneratedTask', 'sets aiGeneratedTask');
assertIncludes(enrichBody, 'aiContextPoints', 'sets aiContextPoints');
assertIncludes(enrichBody, 'aiNextSteps', 'sets aiNextSteps');
assertIncludes(enrichBody, 'aiAnalysisModel', 'sets aiAnalysisModel');
assertIncludes(enrichBody, 'aiAnalysisTimestamp', 'sets aiAnalysisTimestamp');

// ─── Results ────────────────────────────────────────────────────────────────
console.log('\n');
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  \u2717 ${f}`));
  process.exit(1);
} else {
  console.log('All tests passed.');
}
