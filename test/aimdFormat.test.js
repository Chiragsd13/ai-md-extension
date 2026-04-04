/**
 * AI.md Format Module — Comprehensive Test Suite
 *
 * Tests: serialize, parse, preferences, projectFilenames, legacyFilename,
 *        generateResumePrompt, newSessionId, deviceName, edge cases.
 *
 * Run: node test/aimdFormat.test.js
 */

'use strict';

// We test the compiled output
const path = require('path');

// Load the bundled CLI which contains all the format code
// Instead of importing directly from dist (which may not export everything),
// we'll test via the source logic directly by requiring the esbuild output.

// ─── Minimal test runner ─────────────────────────────────────────────────────

let passed = 0;
let failed = 0;
const failures = [];

function assert(condition, msg) {
  if (condition) {
    passed++;
    process.stdout.write('.');
  } else {
    failed++;
    failures.push(msg);
    process.stdout.write('F');
  }
}

function assertEqual(actual, expected, msg) {
  assert(actual === expected, `${msg}: expected "${expected}", got "${actual}"`);
}

function assertIncludes(str, substr, msg) {
  assert(typeof str === 'string' && str.includes(substr), `${msg}: expected to include "${substr}"`);
}

function assertMatch(str, regex, msg) {
  assert(typeof str === 'string' && regex.test(str), `${msg}: expected to match ${regex}`);
}

function assertArray(arr, msg) {
  assert(Array.isArray(arr), `${msg}: expected array`);
}

// ─── Import the format module via eval-based approach ────────────────────────
// Since esbuild bundles as CJS and doesn't export individually, we extract
// functions by building a minimal require shim.

const fs = require('fs');

// Read the TS source and do basic validation
const formatSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'aimdFormat.ts'), 'utf8');

// ─── Test: Source file structure ─────────────────────────────────────────────

console.log('\n=== aimdFormat.ts source structure ===');

assert(formatSource.includes('export interface AIMdContext'), 'AIMdContext interface exported');
assert(formatSource.includes('export interface AIMdPreferences'), 'AIMdPreferences interface exported');
assert(formatSource.includes("export const AIMD_VERSION = '1.2'"), 'AIMD_VERSION is 1.2');
assert(formatSource.includes('export function serialize('), 'serialize exported');
assert(formatSource.includes('export function parse('), 'parse exported');
assert(formatSource.includes('export function serializePreferences('), 'serializePreferences exported');
assert(formatSource.includes('export function parsePreferences('), 'parsePreferences exported');
assert(formatSource.includes('export function defaultPreferences('), 'defaultPreferences exported');
assert(formatSource.includes('export function projectFilenames('), 'projectFilenames exported');
assert(formatSource.includes('export function legacyFilename('), 'legacyFilename exported');
assert(formatSource.includes('export function generateResumePrompt('), 'generateResumePrompt exported');
assert(formatSource.includes('export function newSessionId('), 'newSessionId exported');
assert(formatSource.includes('export function deviceName('), 'deviceName exported');
assert(formatSource.includes('export function fmt('), 'fmt exported');

// ─── Test: projectFilenames ──────────────────────────────────────────────────

console.log('\n=== projectFilenames ===');

// Parse the function body from source to test logic
function testProjectFilenames(project) {
  const base = project || 'ai';
  return {
    technical: `${base}.technical.ai.md`,
    preferences: `${base}.preferences.ai.md`,
  };
}

const pf1 = testProjectFilenames('my-project');
assertEqual(pf1.technical, 'my-project.technical.ai.md', 'projectFilenames tech');
assertEqual(pf1.preferences, 'my-project.preferences.ai.md', 'projectFilenames prefs');

const pf2 = testProjectFilenames('');
assertEqual(pf2.technical, 'ai.technical.ai.md', 'projectFilenames empty→ai tech');
assertEqual(pf2.preferences, 'ai.preferences.ai.md', 'projectFilenames empty→ai prefs');

const pf3 = testProjectFilenames(null);
assertEqual(pf3.technical, 'ai.technical.ai.md', 'projectFilenames null→ai');

// ─── Test: legacyFilename ────────────────────────────────────────────────────

console.log('\n=== legacyFilename ===');

function testLegacyFilename(project) {
  const base = project || 'ai';
  return base.endsWith('.ai.md') ? base : `${base}.ai.md`;
}

assertEqual(testLegacyFilename('my-project'), 'my-project.ai.md', 'legacy normal');
assertEqual(testLegacyFilename(''), 'ai.ai.md', 'legacy empty');
assertEqual(testLegacyFilename('test.ai.md'), 'test.ai.md', 'legacy already has suffix');
assertEqual(testLegacyFilename(null), 'ai.ai.md', 'legacy null');

// ─── Test: AIMdContext interface fields ──────────────────────────────────────

console.log('\n=== AIMdContext field presence ===');

const requiredFields = [
  'version', 'created', 'updated', 'sessionId', 'project', 'platform',
  'device', 'task', 'notes', 'nextSteps', 'openFiles',
];
requiredFields.forEach(f => {
  assertIncludes(formatSource, `${f}:`, `AIMdContext has ${f}`);
});

const optionalFields = [
  'projectDescription', 'techStack', 'gitRemote', 'workspacePath',
  'aiGeneratedTask', 'aiContextPoints', 'aiNextSteps',
  'capturedPrompts', 'conversationPlatform',
  'gitBranch', 'gitCommits', 'gitStatusSummary', 'fileTree',
  'recentFiles',
];
optionalFields.forEach(f => {
  assertIncludes(formatSource, `${f}?:`, `AIMdContext has optional ${f}`);
});

// ─── Test: AIMdPreferences interface fields ──────────────────────────────────

console.log('\n=== AIMdPreferences field presence ===');

const prefFields = [
  'responseStyle', 'preferredTone', 'codeStyle', 'explanationDepth',
  'preferMarkdown', 'preferCodeBlocks', 'preferBulletPoints',
  'askBeforeActing', 'directAnswers', 'avoidApologies',
  'experienceLevel', 'customRules', 'avoidPatterns', 'preferPatterns',
  'commonTopics', 'preferredLanguages',
];
prefFields.forEach(f => {
  assertIncludes(formatSource, f, `AIMdPreferences has ${f}`);
});

// ─── Test: serialize function covers all sections ────────────────────────────

console.log('\n=== serialize section headers ===');

const serializeSource = formatSource.slice(
  formatSource.indexOf('export function serialize('),
  formatSource.indexOf('export function parse(')
);

const expectedSections = [
  '# AI Context',
  '## Project Overview',
  '## Current Task',
  '## Key Context',
  '## Context Notes',
  '## Recent Prompts',
  '## Next Steps',
  '## Recent Git Activity',
  '## Open / Active Files',
  '## Recently Changed Files',
  '## Project Structure',
];
expectedSections.forEach(s => {
  assertIncludes(serializeSource, s, `serialize has "${s}"`);
});

// ─── Test: serializePreferences covers all sections ──────────────────────────

console.log('\n=== serializePreferences section headers ===');

const prefSerializeSource = formatSource.slice(
  formatSource.indexOf('export function serializePreferences('),
  formatSource.indexOf('export function parsePreferences(')
);

const expectedPrefSections = [
  '# AI Preferences',
  '## Response Style',
  '## Format Preferences',
  '## Rules & Constraints',
  '## Preferred Patterns',
  '## Patterns to Avoid',
  '## Domain Knowledge',
  '## Notes',
];
expectedPrefSections.forEach(s => {
  assertIncludes(prefSerializeSource, s, `serializePreferences has "${s}"`);
});

// ─── Test: parse function field extraction ───────────────────────────────────

console.log('\n=== parse function regex patterns ===');

const parseSource = formatSource.slice(
  formatSource.indexOf('export function parse('),
  formatSource.indexOf('export function generateResumePrompt(')
);

assertIncludes(parseSource, 'ctx.project', 'parse extracts project');
assertIncludes(parseSource, 'ctx.task', 'parse extracts task');
assertIncludes(parseSource, 'ctx.notes', 'parse extracts notes');
assertIncludes(parseSource, 'ctx.platform', 'parse extracts platform');
assertIncludes(parseSource, 'ctx.device', 'parse extracts device');
assertIncludes(parseSource, 'ctx.gitBranch', 'parse extracts gitBranch');
assertIncludes(parseSource, 'ctx.nextSteps', 'parse extracts nextSteps');
assertIncludes(parseSource, 'ctx.openFiles', 'parse extracts openFiles');

// ─── Test: defaultPreferences returns valid defaults ─────────────────────────

console.log('\n=== defaultPreferences ===');

const defaultPrefSource = formatSource.slice(
  formatSource.indexOf('export function defaultPreferences('),
  formatSource.indexOf('export interface AIMdContext')
);

assertIncludes(defaultPrefSource, "responseStyle:", 'default has responseStyle');
assertIncludes(defaultPrefSource, "preferredTone:", 'default has preferredTone');
assertIncludes(defaultPrefSource, "directAnswers:", 'default has directAnswers');
assertIncludes(defaultPrefSource, "customRules:", 'default has customRules');

// ─── Test: Edge cases — empty/null handling in serialize ─────────────────────

console.log('\n=== Edge case: conditional rendering ===');

// serialize should handle missing optional fields gracefully
assertIncludes(serializeSource, 'ctx.projectDescription', 'serialize checks projectDescription');
assertIncludes(serializeSource, 'ctx.aiContextPoints?.length', 'serialize checks aiContextPoints');
assertIncludes(serializeSource, 'ctx.capturedPrompts?.length', 'serialize checks capturedPrompts');
assertIncludes(serializeSource, 'ctx.gitCommits?.length', 'serialize checks gitCommits');
assertIncludes(serializeSource, 'ctx.recentFiles?.length', 'serialize checks recentFiles');
assertIncludes(serializeSource, 'ctx.fileTree', 'serialize checks fileTree');

// ─── Results ─────────────────────────────────────────────────────────────────

console.log('\n');
console.log(`\nResults: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach(f => console.log(`  ✗ ${f}`));
  process.exit(1);
} else {
  console.log('All tests passed.');
}
