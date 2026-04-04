/**
 * Browser Extension — Test Suite
 *
 * Tests: content.js, background.js, popup.js, options.js source structure,
 *        platform detection, message handling, auto-save, cloud storage.
 *
 * Run: node test/browserExtension.test.js
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

const extDir = path.join(__dirname, '..', 'browser-extension');

// ─── Manifest ────────────────────────────────────────────────────────────────
console.log('\n=== manifest.json ===');
const manifest = JSON.parse(fs.readFileSync(path.join(extDir, 'manifest.json'), 'utf8'));

assertEqual(manifest.manifest_version, 3, 'MV3');
assert(manifest.name && manifest.name.length > 0, 'has name');
assert(manifest.version && manifest.version.length > 0, 'has version');
assert(manifest.description && manifest.description.length > 0, 'has description');

// Permissions
assert(Array.isArray(manifest.permissions), 'has permissions array');
assertIncludes(manifest.permissions.join(','), 'storage', 'has storage perm');
assertIncludes(manifest.permissions.join(','), 'identity', 'has identity perm');

// Content scripts
assert(Array.isArray(manifest.content_scripts), 'has content_scripts');
assert(manifest.content_scripts.length > 0, 'at least one content script');
const cs = manifest.content_scripts[0];
assert(Array.isArray(cs.matches), 'content script has matches');
assert(cs.matches.length >= 3, 'matches 3+ AI platforms');

// Check for key AI platforms
const allMatches = manifest.content_scripts.flatMap(c => c.matches).join(',');
assertIncludes(allMatches, 'claude.ai', 'targets claude.ai');
assertIncludes(allMatches, 'chatgpt.com', 'targets chatgpt.com');
assertIncludes(allMatches, 'gemini.google.com', 'targets gemini.google.com');

// Service worker
assert(manifest.background && manifest.background.service_worker, 'has service_worker');

// Action (popup)
assert(manifest.action && manifest.action.default_popup, 'has popup');

// OAuth2
assert(manifest.oauth2, 'has oauth2 config');
assert(manifest.oauth2.scopes && manifest.oauth2.scopes.length > 0, 'has oauth scopes');

// ─── content.js ──────────────────────────────────────────────────────────────
console.log('\n=== content.js ===');
const content = fs.readFileSync(path.join(extDir, 'content.js'), 'utf8');

// Platform detection
assertIncludes(content, 'PLATFORMS', 'has PLATFORMS map');
assertIncludes(content, 'claude.ai', 'content detects claude');
assertIncludes(content, 'chatgpt.com', 'content detects chatgpt');
assertIncludes(content, 'gemini.google.com', 'content detects gemini');
assertIncludes(content, 'aistudio.google.com', 'content detects ai studio');

// Message handlers
assertIncludes(content, 'AIMD_INJECT_RAW', 'handles AIMD_INJECT_RAW');
assertIncludes(content, 'CAPTURE_CHAT', 'handles CAPTURE_CHAT');
assertIncludes(content, 'REQUEST_AI_UPDATE', 'handles REQUEST_AI_UPDATE');
assertIncludes(content, 'GET_TURN_STATS', 'handles GET_TURN_STATS');

// Smart turn monitoring
assertIncludes(content, 'startTurnMonitor', 'has startTurnMonitor');
assertIncludes(content, 'onTurnCompleted', 'has onTurnCompleted');
assertIncludes(content, 'isImportantTurn', 'has isImportantTurn');
assertIncludes(content, 'turnState', 'has turnState');

// Importance scoring
assertIncludes(content, 'score', 'has scoring logic');

// Auto-save triggers
assertIncludes(content, 'triggerAutoSave', 'has triggerAutoSave');
assertIncludes(content, 'setupAutoSaveTriggers', 'has setupAutoSaveTriggers');
assertIncludes(content, 'beforeunload', 'handles beforeunload');
assertIncludes(content, 'visibilitychange', 'handles visibilitychange');

// Battery API
assertIncludes(content, 'getBattery', 'uses Battery API');

// In-context AI update
assertIncludes(content, 'buildUpdatePrompt', 'has buildUpdatePrompt');
assertIncludes(content, 'requestAIContextUpdate', 'has requestAIContextUpdate');
assertIncludes(content, 'waitForAIResponse', 'has waitForAIResponse');
assertIncludes(content, 'looksLikeContextDoc', 'has looksLikeContextDoc');
assertIncludes(content, 'saveAIGeneratedContext', 'has saveAIGeneratedContext');

// Text injection (ProseMirror for Claude)
assertIncludes(content, 'ProseMirror', 'handles ProseMirror');

// ─── background.js ───────────────────────────────────────────────────────────
console.log('\n=== background.js ===');
const bg = fs.readFileSync(path.join(extDir, 'background.js'), 'utf8');

// Message routing
assertIncludes(bg, 'SAVE_CHAT_CONTEXT', 'handles SAVE_CHAT_CONTEXT');
assertIncludes(bg, 'SAVE_AI_GENERATED_CONTEXT', 'handles SAVE_AI_GENERATED_CONTEXT');
assertIncludes(bg, 'CLOUD_SAVE', 'handles CLOUD_SAVE');
assertIncludes(bg, 'GDRIVE_AUTH', 'handles GDRIVE_AUTH');

// Cloud storage providers
assertIncludes(bg, 'saveToGist', 'has saveToGist');
assertIncludes(bg, 'saveToGoogleDrive', 'has saveToGoogleDrive');
assertIncludes(bg, 'saveToLocalDownload', 'has saveToLocalDownload');

// Smart turns integration
assertIncludes(bg, 'bufferedTurns', 'handles bufferedTurns');

// Google Drive auth
assertIncludes(bg, 'chrome.identity', 'uses chrome.identity');

// ─── popup/popup.html ────────────────────────────────────────────────────────
console.log('\n=== popup/popup.html ===');
const popupHtml = fs.readFileSync(path.join(extDir, 'popup', 'popup.html'), 'utf8');

assertIncludes(popupHtml, 'popup.js', 'loads popup.js');
assertIncludes(popupHtml, 'AI.md', 'shows AI.md branding');
assertIncludes(popupHtml, 'btn-ai-update', 'has AI update button');
assertIncludes(popupHtml, 'tracking-bar', 'has tracking bar');

// ─── popup/popup.js ──────────────────────────────────────────────────────────
console.log('\n=== popup/popup.js ===');
const popupJs = fs.readFileSync(path.join(extDir, 'popup', 'popup.js'), 'utf8');

assertIncludes(popupJs, 'btnAiUpdate', 'has AI update button ref');
assertIncludes(popupJs, 'REQUEST_AI_UPDATE', 'sends REQUEST_AI_UPDATE');
assertIncludes(popupJs, 'GET_TURN_STATS', 'sends GET_TURN_STATS');
assertIncludes(popupJs, 'AIMD_INJECT_RAW', 'sends AIMD_INJECT_RAW');

// Dual-file support in popup
assertIncludes(popupJs, 'technical', 'handles technical filenames');
assertIncludes(popupJs, 'preferences', 'handles preferences filenames');

// ─── options/options.html ────────────────────────────────────────────────────
console.log('\n=== options/options.html ===');
const optHtml = fs.readFileSync(path.join(extDir, 'options', 'options.html'), 'utf8');

assertIncludes(optHtml, 'options.js', 'loads options.js');
assertIncludes(optHtml, 'GitHub Gist', 'shows GitHub Gist option');
assertIncludes(optHtml, 'Google Drive', 'shows Google Drive option');
assertIncludes(optHtml, 'Local Download', 'shows Local Download option');
assertIncludes(optHtml, 'Auto-Save', 'has auto-save toggle');

// ─── options/options.js ──────────────────────────────────────────────────────
console.log('\n=== options/options.js ===');
const optJs = fs.readFileSync(path.join(extDir, 'options', 'options.js'), 'utf8');

assertIncludes(optJs, 'chrome.storage', 'uses chrome.storage');
assertIncludes(optJs, 'cloudProvider', 'persists cloudProvider');
assertIncludes(optJs, 'aiUpdateMode', 'persists aiUpdateMode');
assertIncludes(optJs, 'autoSaveEnabled', 'persists autoSaveEnabled');
assertIncludes(optJs, 'GDRIVE_AUTH', 'triggers Google Drive auth');

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
