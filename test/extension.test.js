/**
 * extension.ts + package.json — Test Suite
 *
 * Tests: VS Code extension activation, command registration, config schema,
 *        keybindings, chat participant, package.json integrity.
 *
 * Run: node test/extension.test.js
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

// ─── package.json ────────────────────────────────────────────────────────────
console.log('\n=== package.json structure ===');
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));

assertEqual(pkg.name, 'aimd', 'name is aimd');
assertEqual(pkg.version, '1.0.0', 'version is 1.0.0');
assert(pkg.displayName && pkg.displayName.length > 0, 'has displayName');
assert(pkg.description && pkg.description.length > 0, 'has description');
assert(pkg.publisher && pkg.publisher.length > 0, 'has publisher');
assertEqual(pkg.main, './dist/extension.js', 'main points to dist');
assertEqual(pkg.engines.vscode, '^1.90.0', 'targets VS Code 1.90+');

// Categories
assert(Array.isArray(pkg.categories), 'has categories');
assert(pkg.categories.includes('AI'), 'includes AI category');

// Keywords
assert(Array.isArray(pkg.keywords), 'has keywords');
assert(pkg.keywords.includes('ai'), 'keyword: ai');
assert(pkg.keywords.includes('claude'), 'keyword: claude');
assert(pkg.keywords.includes('chatgpt'), 'keyword: chatgpt');

// Scripts
assert(pkg.scripts['vscode:prepublish'], 'has prepublish script');
assert(pkg.scripts.compile, 'has compile script');
assert(pkg.scripts.typecheck, 'has typecheck script');
assert(pkg.scripts.package, 'has package script');

// CLI binary
assert(pkg.bin && pkg.bin.aimd, 'has CLI binary');
assertEqual(pkg.bin.aimd, './dist/cli.js', 'CLI points to dist/cli.js');

// ─── Commands ────────────────────────────────────────────────────────────────
console.log('\n=== contributes.commands ===');
const commands = pkg.contributes.commands;
assert(Array.isArray(commands), 'commands is array');

const cmdIds = commands.map(c => c.command);
assert(cmdIds.includes('aimd.saveContext'), 'has saveContext');
assert(cmdIds.includes('aimd.loadContext'), 'has loadContext');
assert(cmdIds.includes('aimd.addNote'), 'has addNote');
assert(cmdIds.includes('aimd.viewContext'), 'has viewContext');
assert(cmdIds.includes('aimd.viewHabits'), 'has viewHabits');
assert(cmdIds.includes('aimd.copyResumePrompt'), 'has copyResumePrompt');
assert(cmdIds.includes('aimd.openConfig'), 'has openConfig');
assert(cmdIds.includes('aimd.clearNotes'), 'has clearNotes');

// All commands have titles
commands.forEach(c => {
  assert(c.title && c.title.length > 0, `command ${c.command} has title`);
  assertEqual(c.category, 'AI.md', `command ${c.command} has category AI.md`);
});

// ─── Keybindings ─────────────────────────────────────────────────────────────
console.log('\n=== contributes.keybindings ===');
const keybindings = pkg.contributes.keybindings;
assert(Array.isArray(keybindings), 'keybindings is array');
assert(keybindings.length >= 3, 'at least 3 keybindings');

const kbCmds = keybindings.map(k => k.command);
assert(kbCmds.includes('aimd.saveContext'), 'save has keybinding');
assert(kbCmds.includes('aimd.loadContext'), 'load has keybinding');
assert(kbCmds.includes('aimd.addNote'), 'note has keybinding');

// Check each has key and mac
keybindings.forEach(k => {
  assert(k.key, `${k.command} has key`);
  assert(k.mac, `${k.command} has mac`);
});

// ─── Configuration properties ────────────────────────────────────────────────
console.log('\n=== contributes.configuration ===');
const props = pkg.contributes.configuration.properties;
assert(props, 'has configuration properties');

const expectedProps = [
  'aimd.syncProvider', 'aimd.localFolderPath', 'aimd.githubToken',
  'aimd.gistId', 'aimd.webhookUrl', 'aimd.autoSave',
  'aimd.autoSaveInterval', 'aimd.saveOnFileSave', 'aimd.includeGitInfo',
  'aimd.includeFileTree', 'aimd.fileTreeDepth', 'aimd.platform',
  'aimd.trackHabits',
];
expectedProps.forEach(p => {
  assert(props[p], `has config property ${p}`);
  assert(props[p].description, `${p} has description`);
});

// syncProvider enum values
const spEnum = props['aimd.syncProvider'].enum;
assert(spEnum.includes('google-drive'), 'provider: google-drive');
assert(spEnum.includes('onedrive'), 'provider: onedrive');
assert(spEnum.includes('github-gist'), 'provider: github-gist');
assert(spEnum.includes('local-folder'), 'provider: local-folder');
assert(spEnum.includes('webhook'), 'provider: webhook');

// ─── Chat participant ────────────────────────────────────────────────────────
console.log('\n=== contributes.chatParticipants ===');
const participants = pkg.contributes.chatParticipants;
assert(Array.isArray(participants), 'chatParticipants is array');
assert(participants.length > 0, 'at least one participant');

const cp0 = participants[0];
assertEqual(cp0.id, 'aimd.assistant', 'participant id');
assertEqual(cp0.name, 'ai.md', 'participant name');
assert(cp0.commands && cp0.commands.length >= 5, 'has 5+ commands');

const cpCmds = cp0.commands.map(c => c.name);
assert(cpCmds.includes('save'), 'participant cmd: save');
assert(cpCmds.includes('load'), 'participant cmd: load');
assert(cpCmds.includes('list'), 'participant cmd: list');
assert(cpCmds.includes('prompt'), 'participant cmd: prompt');
assert(cpCmds.includes('habits'), 'participant cmd: habits');

// ─── extension.ts source ────────────────────────────────────────────────────
console.log('\n=== extension.ts ===');
const extSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'extension.ts'), 'utf8');

assertIncludes(extSrc, "import * as vscode from 'vscode'", 'imports vscode');
assertIncludes(extSrc, 'ContextCapture', 'uses ContextCapture');
assertIncludes(extSrc, 'CloudSync', 'uses CloudSync');
assertIncludes(extSrc, 'serialize', 'uses serialize');
assertIncludes(extSrc, 'parse', 'uses parse');
assertIncludes(extSrc, 'generateResumePrompt', 'uses generateResumePrompt');
assertIncludes(extSrc, 'StatusBarManager', 'uses StatusBarManager');
assertIncludes(extSrc, 'ConfigPanel', 'uses ConfigPanel');
assertIncludes(extSrc, 'registerChatParticipant', 'registers chat participant');
assertIncludes(extSrc, 'updateHabits', 'uses updateHabits');
assertIncludes(extSrc, 'export async function activate(', 'exports activate');

// Command registrations
assertIncludes(extSrc, 'aimd.saveContext', 'registers saveContext');
assertIncludes(extSrc, 'aimd.loadContext', 'registers loadContext');
assertIncludes(extSrc, 'aimd.addNote', 'registers addNote');

// ─── Dist files exist ────────────────────────────────────────────────────────
console.log('\n=== dist/ artifacts ===');
const distDir = path.join(__dirname, '..', 'dist');
assert(fs.existsSync(path.join(distDir, 'extension.js')), 'dist/extension.js exists');
assert(fs.existsSync(path.join(distDir, 'cli.js')), 'dist/cli.js exists');

// extension.js should be non-trivial
const extSize = fs.statSync(path.join(distDir, 'extension.js')).size;
assert(extSize > 10000, `extension.js is ${extSize} bytes (>10KB)`);

const cliSize = fs.statSync(path.join(distDir, 'cli.js')).size;
assert(cliSize > 10000, `cli.js is ${cliSize} bytes (>10KB)`);

// ─── Source files all exist ──────────────────────────────────────────────────
console.log('\n=== source file existence ===');
const srcDir = path.join(__dirname, '..', 'src');
const requiredSources = [
  'aimdFormat.ts', 'cli.ts', 'extension.ts', 'contextCapture.ts',
  'cloudSync.ts', 'statusBar.ts', 'configPanel.ts', 'syncProviders.ts',
  'habitsTracker.ts', 'smartAnalysis.ts', 'oauthProviders.ts',
  'chatParticipant.ts',
];
requiredSources.forEach(f => {
  assert(fs.existsSync(path.join(srcDir, f)), `src/${f} exists`);
});

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
