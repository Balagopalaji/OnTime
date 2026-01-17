#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const identity = process.env.SIGN_IDENTITY;

if (process.platform !== 'darwin') {
  process.exit(0);
}

if (!identity) {
  console.log('[dev-sign] SIGN_IDENTITY not set; skipping codesign.');
  process.exit(0);
}

const distRoot = path.join(__dirname, '..', 'dist_out');
if (!fs.existsSync(distRoot)) {
  console.warn(`[dev-sign] dist_out not found at ${distRoot}.`);
  process.exit(0);
}

function findAppBundle(rootDir) {
  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const maybeApp = path.join(rootDir, entry.name, 'OnTime Companion.app');
    if (fs.existsSync(maybeApp)) return maybeApp;
  }
  return null;
}

const appBundle = findAppBundle(distRoot);
if (!appBundle) {
  console.warn('[dev-sign] Could not find OnTime Companion.app under dist_out.');
  process.exit(0);
}

const helperPath = path.join(appBundle, 'Contents', 'Resources', 'bin', 'ppt-probe-mac');

function sign(target) {
  execFileSync('codesign', ['--force', '--sign', identity, target], { stdio: 'inherit' });
}

try {
  if (fs.existsSync(helperPath)) {
    console.log(`[dev-sign] Signing helper: ${helperPath}`);
    sign(helperPath);
  } else {
    console.warn(`[dev-sign] Helper not found at ${helperPath}.`);
  }

  console.log(`[dev-sign] Signing app bundle: ${appBundle}`);
  execFileSync(
    'codesign',
    ['--force', '--sign', identity, '--deep', appBundle],
    { stdio: 'inherit' }
  );

  console.log('[dev-sign] Done.');
} catch (error) {
  console.error(`[dev-sign] Codesign failed: ${String(error)}`);
  process.exit(1);
}
