/**
 * cli.ts — Test Suite
 *
 * Tests: source structure, command routing, auto-detect project name,
 *        context capture, git helpers, file tree builder, dual-file save/load,
 *        preferences command, habits integration, clipboard fallback.
 *
 * Run: node test/cli.test.js
 */

'use strict';

const fs = require('fs');
const path = require('path');

let passed = 0;
let failed = 0;
const failures = [];

function assert(cond, msg) {
  if (cond) { passed++; process.stdout.write('.'); }
  else { failed++; failures.push(msg); process.stdout.write('F'); }
}
function assertEqual(a, b, msg) { assert(a === b, `${msg}: expected "${b}", got "${a}"`); }
function assertIncludes(s, sub, msg) { assert(typeof s === 'string' && s.includes(sub), `${msg}: missing "${sub}"`); }
function assertMatch(s, re, msg) { assert(typeof s === 'string' && re.test(s), `${msg}: expected match ${re}`); }
function assertNotIncludes(s, sub, msg) { assert(typeof s === 'string' && !s.includes(sub), `${msg}: should NOT include "${sub}"`); }

// ─── Read source ────────────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'cli.ts'), 'utf8');

// ─── Imports ────────────────────────────────────────────────────────────────
console.log('\n=== cli.ts imports ===');
assertIncludes(src, "from './syncProviders'", 'imports syncProviders');
assertIncludes(src, "from './aimdFormat'", 'imports aimdFormat');
assertIncludes(src, "from './habitsTracker'", 'imports habitsTracker');
assertIncludes(src, "from './smartAnalysis'", 'imports smartAnalysis');
assertIncludes(src, "from './oauthProviders'", 'imports oauthProviders');
assertIncludes(src, 'projectFilenames', 'imports projectFilenames');
assertIncludes(src, 'legacyFilename', 'imports legacyFilename');
assertIncludes(src, 'AIMdPreferences', 'imports AIMdPreferences');
assertIncludes(src, 'serializePreferences', 'imports serializePreferences');
assertIncludes(src, 'parsePreferences', 'imports parsePreferences');
assertIncludes(src, 'defaultPreferences', 'imports defaultPreferences');

// ─── Config management ──────────────────────────────────────────────────────
console.log('\n=== Config management ===');
assertIncludes(src, "const CONFIG_DIR = path.join(os.homedir(), '.aimd')", 'config dir is ~/.aimd');
assertIncludes(src, "CONFIG_FILE = path.join(CONFIG_DIR, 'config.json')", 'config is config.json');
assertIncludes(src, 'function loadConfig()', 'has loadConfig');
assertIncludes(src, 'function saveConfig(', 'has saveConfig');
assertIncludes(src, 'function isConfigured(', 'has isConfigured');
// isConfigured should check all providers
assertIncludes(src, "cfg.provider === 'github-gist'", 'checks gist config');
assertIncludes(src, "cfg.provider === 'google-drive'", 'checks gdrive config');
assertIncludes(src, "cfg.provider === 'onedrive'", 'checks onedrive config');

// ─── Auto-detect project name ────────────────────────────────────────────────
console.log('\n=== autoDetectProjectName ===');
const autoDetectBody = src.slice(
  src.indexOf('function autoDetectProjectName()'),
  src.indexOf('async function cmdLoad(')
);
assertIncludes(autoDetectBody, 'package.json', 'checks package.json');
assertIncludes(autoDetectBody, 'Cargo.toml', 'checks Cargo.toml');
assertIncludes(autoDetectBody, 'pyproject.toml', 'checks pyproject.toml');
assertIncludes(autoDetectBody, 'go.mod', 'checks go.mod');
assertIncludes(autoDetectBody, 'git remote get-url origin', 'checks git remote');
assertIncludes(autoDetectBody, 'git rev-parse --show-toplevel', 'checks git root');
assertIncludes(autoDetectBody, 'path.basename(cwd)', 'falls back to dirname');

// ─── Context capture ─────────────────────────────────────────────────────────
console.log('\n=== captureCliContext ===');
const captureBody = src.slice(
  src.indexOf('function captureCliContext('),
  src.indexOf('function readJsonSafe(')
);
assertIncludes(captureBody, 'readProjectMeta(cwd)', 'reads project metadata');
assertIncludes(captureBody, 'readProjectDescription(cwd)', 'reads project description');
assertIncludes(captureBody, 'git rev-parse --abbrev-ref HEAD', 'gets git branch');
assertIncludes(captureBody, 'git remote get-url origin', 'gets git remote');
assertIncludes(captureBody, 'git log --pretty=format:', 'gets git log');
assertIncludes(captureBody, 'git status --short', 'gets git status');
assertIncludes(captureBody, 'git log --since="7 days ago"', 'gets recent files');
assertIncludes(captureBody, 'git diff --name-only HEAD', 'gets uncommitted changes');
assertIncludes(captureBody, 'git diff --cached --name-only', 'gets staged changes');
assertIncludes(captureBody, 'buildCliFileTree(cwd', 'builds file tree');
assertIncludes(captureBody, 'AIMD_VERSION', 'includes version');
assertIncludes(captureBody, 'deviceName()', 'includes device name');
assertIncludes(captureBody, 'newSessionId()', 'includes session id');

// ─── Project metadata helpers ────────────────────────────────────────────────
console.log('\n=== readProjectMeta ===');
const metaBody = src.slice(
  src.indexOf('function readProjectMeta('),
  src.indexOf('function readProjectDescription(')
);
// Node.js detection
assertIncludes(metaBody, 'package.json', 'reads package.json');
assertIncludes(metaBody, 'TypeScript', 'detects TypeScript');
assertIncludes(metaBody, 'React', 'detects React');
assertIncludes(metaBody, 'Next.js', 'detects Next.js');
assertIncludes(metaBody, 'Vue', 'detects Vue');
assertIncludes(metaBody, 'Angular', 'detects Angular');
assertIncludes(metaBody, 'Electron', 'detects Electron');
assertIncludes(metaBody, 'VS Code Extension', 'detects VS Code Extension');
assertIncludes(metaBody, 'Tailwind CSS', 'detects Tailwind');
assertIncludes(metaBody, 'Prisma', 'detects Prisma');
// Python
assertIncludes(metaBody, 'Python', 'detects Python');
assertIncludes(metaBody, 'pyproject.toml', 'reads pyproject.toml');
assertIncludes(metaBody, 'requirements.txt', 'checks requirements.txt');
// Rust
assertIncludes(metaBody, 'Rust', 'detects Rust');
assertIncludes(metaBody, 'Cargo.toml', 'reads Cargo.toml');
// Go
assertIncludes(metaBody, 'Go', 'detects Go');
assertIncludes(metaBody, 'go.mod', 'reads go.mod');
// Docker
assertIncludes(metaBody, 'Docker', 'detects Docker');
assertIncludes(metaBody, 'Dockerfile', 'checks Dockerfile');
assertIncludes(metaBody, 'docker-compose.yml', 'checks docker-compose.yml');

// ─── Git status summary ──────────────────────────────────────────────────────
console.log('\n=== summariseGitStatus ===');
const statusBody = src.slice(
  src.indexOf('function summariseGitStatus('),
  src.indexOf('const TREE_IGNORE')
);
assertIncludes(statusBody, 'modified', 'reports modified');
assertIncludes(statusBody, 'added', 'reports added');
assertIncludes(statusBody, 'deleted', 'reports deleted');
assertIncludes(statusBody, 'untracked', 'reports untracked');

// ─── File tree builder ───────────────────────────────────────────────────────
console.log('\n=== buildCliFileTree ===');
const treeBody = src.slice(
  src.indexOf('function buildCliFileTree('),
  src.indexOf('function detectAiCli(')
);
assertIncludes(treeBody, 'maxDepth', 'respects maxDepth');
assertIncludes(treeBody, 'TREE_IGNORE', 'uses ignore list');

// TREE_IGNORE should have common noise directories
const treeIgnoreBody = src.slice(
  src.indexOf('const TREE_IGNORE'),
  src.indexOf('function buildCliFileTree(')
);
assertIncludes(treeIgnoreBody, 'node_modules', 'ignores node_modules');
assertIncludes(treeIgnoreBody, '.git', 'ignores .git');
assertIncludes(treeIgnoreBody, 'dist', 'ignores dist');
assertIncludes(treeIgnoreBody, '__pycache__', 'ignores __pycache__');
assertIncludes(treeIgnoreBody, '.venv', 'ignores .venv');
assertIncludes(treeIgnoreBody, 'target', 'ignores target');

// ─── cmdSave dual-file ──────────────────────────────────────────────────────
console.log('\n=== cmdSave (dual-file) ===');
const saveBody = src.slice(
  src.indexOf('async function cmdSave('),
  src.indexOf('function autoDetectProjectName(')
);
assertIncludes(saveBody, 'projectFilenames(ctx.project)', 'uses projectFilenames');
assertIncludes(saveBody, 'serialize(ctx)', 'serializes technical');
assertIncludes(saveBody, 'provider.upload(techFile', 'uploads technical file');
assertIncludes(saveBody, 'provider.download(prefFile)', 'checks existing prefs');
assertIncludes(saveBody, 'defaultPreferences(ctx.project)', 'creates default prefs');
assertIncludes(saveBody, 'serializePreferences(prefs)', 'serializes prefs');
assertIncludes(saveBody, 'legacyFilename(ctx.project)', 'writes legacy file');
assertIncludes(saveBody, 'enrichWithAI(ctx)', 'tries AI enrichment');

// ─── cmdLoad dual-file ──────────────────────────────────────────────────────
console.log('\n=== cmdLoad (dual-file) ===');
const loadBody = src.slice(
  src.indexOf('async function cmdLoad('),
  src.indexOf('async function cmdPrompt(')
);
assertIncludes(loadBody, 'projectFilenames(resolvedName)', 'uses projectFilenames');
assertIncludes(loadBody, 'legacyFilename(resolvedName)', 'has legacy fallback');
assertIncludes(loadBody, 'provider.download(techFile)', 'downloads tech file');
assertIncludes(loadBody, 'provider.download(prefFile)', 'downloads pref file');
assertIncludes(loadBody, 'parsePreferences(prefContent)', 'parses preferences');
assertIncludes(loadBody, 'generateResumePrompt(combined)', 'generates combined prompt');

// ─── cmdAtAiMd dual-file ────────────────────────────────────────────────────
console.log('\n=== cmdAtAiMd (dual-file) ===');
const atBody = src.slice(
  src.indexOf('async function cmdAtAiMd('),
  src.indexOf('async function cmdSave(')
);
assertIncludes(atBody, 'projectFilenames(resolvedName)', 'uses projectFilenames');
assertIncludes(atBody, 'legacyFilename(resolvedName)', 'has legacy fallback');
assertIncludes(atBody, "combined += '\\n\\n---\\n\\n'", 'merges tech + prefs');
assertIncludes(atBody, 'generateResumePrompt(combined)', 'generates combined prompt');
assertIncludes(atBody, 'injectIntoAi(resumePrompt', 'injects into AI');

// ─── cmdPrefs ────────────────────────────────────────────────────────────────
console.log('\n=== cmdPrefs ===');
const prefsBody = src.slice(
  src.indexOf('async function cmdPrefs('),
  src.indexOf('async function cmdHabits(')
);
assertIncludes(prefsBody, 'parsePreferences(existing)', 'loads existing prefs');
assertIncludes(prefsBody, 'defaultPreferences(resolvedName)', 'creates defaults');
assertIncludes(prefsBody, 'Response style', 'asks about style');
assertIncludes(prefsBody, 'Preferred tone', 'asks about tone');
assertIncludes(prefsBody, 'Code style', 'asks about code style');
assertIncludes(prefsBody, 'Explanation depth', 'asks about depth');
assertIncludes(prefsBody, 'Experience level', 'asks about level');
assertIncludes(prefsBody, 'Custom rules', 'handles custom rules');
assertIncludes(prefsBody, 'serializePreferences(prefs)', 'serializes prefs');
assertIncludes(prefsBody, 'provider.upload(prefFile', 'uploads prefs');

// ─── cmdList (grouped display) ──────────────────────────────────────────────
console.log('\n=== cmdList (grouped) ===');
const listBody = src.slice(
  src.indexOf('async function cmdList('),
  src.indexOf('async function cmdPrefs(')
);
assertIncludes(listBody, '.technical.ai.md', 'recognizes technical files');
assertIncludes(listBody, '.preferences.ai.md', 'recognizes preferences files');
assertIncludes(listBody, 'projects.has(proj)', 'groups by project');
assertIncludes(listBody, 'tech', 'shows tech badge');
assertIncludes(listBody, 'prefs', 'shows prefs badge');
assertIncludes(listBody, 'legacy', 'shows legacy badge');

// ─── AI CLI injection ────────────────────────────────────────────────────────
console.log('\n=== detectAiCli ===');
const detectBody = src.slice(
  src.indexOf('function detectAiCli()'),
  src.indexOf('async function injectIntoAi(')
);
assertIncludes(detectBody, 'Claude CLI', 'detects Claude');
assertIncludes(detectBody, 'aider', 'detects aider');
assertIncludes(detectBody, 'sgpt', 'detects sgpt');
assertIncludes(detectBody, 'llm', 'detects llm');

// ─── injectIntoAi ───────────────────────────────────────────────────────────
console.log('\n=== injectIntoAi ===');
const injectBody = src.slice(
  src.indexOf('async function injectIntoAi('),
  src.indexOf('async function runSetup(')
);
assertIncludes(injectBody, 'cp.spawn', 'spawns AI CLI');
assertIncludes(injectBody, 'copyToClipboard', 'falls back to clipboard');
assertIncludes(injectBody, 'claude.ai', 'offers to open Claude');

// ─── Main routing ────────────────────────────────────────────────────────────
console.log('\n=== main() command routing ===');
const mainBody = src.slice(src.indexOf('async function main()'));
assertIncludes(mainBody, "'setup'", 'routes setup');
assertIncludes(mainBody, "'@ai.md'", 'routes @ai.md');
assertIncludes(mainBody, "'save'", 'routes save');
assertIncludes(mainBody, "'load'", 'routes load');
assertIncludes(mainBody, "'prompt'", 'routes prompt');
assertIncludes(mainBody, "'list'", 'routes list');
assertIncludes(mainBody, "'prefs'", 'routes prefs');
assertIncludes(mainBody, "'preferences'", 'routes preferences alias');
assertIncludes(mainBody, "'habits'", 'routes habits');
assertIncludes(mainBody, "'config'", 'routes config');
assertIncludes(mainBody, "'logout'", 'routes logout');
assertIncludes(mainBody, "'help'", 'routes help');
assertIncludes(mainBody, "'--help'", 'routes --help');
assertIncludes(mainBody, "'at'", 'routes at alias');
assertIncludes(mainBody, '--inject', 'supports --inject flag');

// ─── Setup (all providers) ──────────────────────────────────────────────────
console.log('\n=== runSetup ===');
const setupBody = src.slice(
  src.indexOf('async function runSetup('),
  src.indexOf('async function cmdAtAiMd(')
);
assertIncludes(setupBody, 'Google Drive', 'offers Google Drive');
assertIncludes(setupBody, 'OneDrive', 'offers OneDrive');
assertIncludes(setupBody, 'GitHub Gist', 'offers GitHub Gist');
assertIncludes(setupBody, 'Local Folder', 'offers Local Folder');
assertIncludes(setupBody, 'GITHUB_TOKEN', 'checks env for GITHUB_TOKEN');
assertIncludes(setupBody, 'GH_TOKEN', 'checks env for GH_TOKEN');

// ─── Help text ──────────────────────────────────────────────────────────────
console.log('\n=== printHelp ===');
const helpBody = src.slice(
  src.indexOf('function printHelp()'),
  src.indexOf('async function main()')
);
assertIncludes(helpBody, 'aimd <command>', 'shows usage');
assertIncludes(helpBody, '@ai.md', 'documents @ai.md');
assertIncludes(helpBody, 'save', 'documents save');
assertIncludes(helpBody, 'load', 'documents load');
assertIncludes(helpBody, 'prefs', 'documents prefs');
assertIncludes(helpBody, 'habits', 'documents habits');
assertIncludes(helpBody, '--inject', 'documents --inject');

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
