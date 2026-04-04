const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');
const cliOnly = process.argv.includes('--cli');
const all = process.argv.includes('--all');

// ── VS Code Extension bundle ──────────────────────────────────────────────────
const extensionBundle = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  external: ['vscode'],          // VS Code API is provided by the host
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: 'dist/extension.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

// ── CLI bundle ────────────────────────────────────────────────────────────────
// The CLI is a standalone Node.js binary — no VS Code dependency.
// esbuild automatically hoists the #!/usr/bin/env node shebang from the
// entry point source file to the top of the output.
const cliBundle = {
  entryPoints: ['src/cli.ts'],
  bundle: true,
  external: [],                  // Fully self-contained — no node_modules needed at runtime
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  outfile: 'dist/cli.js',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

async function build() {
  const targets = [];
  if (!cliOnly) targets.push(extensionBundle);
  if (cliOnly || all || production) targets.push(cliBundle);

  if (watch && targets.length > 0) {
    const contexts = await Promise.all(targets.map(t => esbuild.context(t)));
    await Promise.all(contexts.map(c => c.watch()));
    console.log('Watching for changes…');
  } else {
    await Promise.all(targets.map(t => esbuild.build(t)));
    // Make CLI executable on Unix systems
    if ((cliOnly || all || production) && process.platform !== 'win32') {
      const fs = require('fs');
      try { fs.chmodSync('dist/cli.js', '755'); } catch {}
    }
  }
}

build().catch(() => process.exit(1));
