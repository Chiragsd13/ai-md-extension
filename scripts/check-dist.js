#!/usr/bin/env node
/**
 * Pre-package gate — runs automatically via "prepackage" npm hook.
 *
 * Checks:
 *   1. TypeScript type-check (tsc --noEmit)
 *   2. Required dist files exist
 *   3. Bundle size limits (guard against accidentally bundling large deps)
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
let failed = false;

function ok(msg)   { console.log(`  ✔  ${msg}`); }
function fail(msg) { console.error(`  ✘  ${msg}`); failed = true; }

// ── 1. TypeScript type-check ──────────────────────────────────────────────────

console.log('\n── TypeScript ───────────────────────────────────────');
const tscBin = path.join(
  ROOT, 'node_modules', '.bin',
  process.platform === 'win32' ? 'tsc.cmd' : 'tsc'
);
try {
  execSync(`"${tscBin}" --noEmit`, { stdio: 'inherit', cwd: ROOT });
  ok('tsc --noEmit passed');
} catch {
  fail('Type errors found — fix them before packaging');
}

// ── 2. Required files ────────────────────────────────────────────────────────

console.log('\n── Required files ───────────────────────────────────');
const required = [
  'dist/extension.js',
  'dist/cli.js',
  'browser-extension/manifest.json',
  'browser-extension/background.js',
  'browser-extension/content.js',
  'browser-extension/popup/popup.html',
  'browser-extension/popup/popup.js',
  'browser-extension/options/options.html',
  'browser-extension/options/options.js',
];
for (const rel of required) {
  const full = path.join(ROOT, rel);
  if (fs.existsSync(full)) ok(rel);
  else fail(`Missing: ${rel}`);
}

// ── 3. Bundle size gates ──────────────────────────────────────────────────────
// Limits have generous headroom over current production sizes:
//   extension.js ~55 KB → gate 300 KB
//   cli.js       ~37 KB → gate 250 KB

console.log('\n── Bundle sizes ─────────────────────────────────────');
const LIMITS = {
  'dist/extension.js': 300 * 1024,
  'dist/cli.js':       250 * 1024,
};
for (const [rel, limit] of Object.entries(LIMITS)) {
  const full = path.join(ROOT, rel);
  if (!fs.existsSync(full)) { fail(`Missing: ${rel}`); continue; }
  const bytes = fs.statSync(full).size;
  const kb    = (bytes / 1024).toFixed(1);
  const cap   = (limit / 1024).toFixed(0);
  if (bytes > limit) fail(`${rel}: ${kb} KB exceeds ${cap} KB limit`);
  else               ok(`${rel}: ${kb} KB  (limit ${cap} KB)`);
}

// ── Result ────────────────────────────────────────────────────────────────────

console.log('');
if (failed) {
  console.error('Pre-package check FAILED — fix the issues above.\n');
  process.exit(1);
}
console.log('Pre-package check PASSED — ready to package.\n');
