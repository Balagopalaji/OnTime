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

const appBundle = path.join('/Applications', 'OnTime Companion.app');
const helperPath = path.join(appBundle, 'Contents', 'Resources', 'bin', 'ppt-probe-mac');

if (!fs.existsSync(appBundle)) {
  console.warn(`[dev-sign] App not found at ${appBundle}.`);
  process.exit(0);
}

function sign(target, args = []) {
  execFileSync('codesign', ['--force', '--sign', identity, ...args, target], { stdio: 'inherit' });
}

try {
  if (fs.existsSync(helperPath)) {
    console.log(`[dev-sign] Signing helper: ${helperPath}`);
    sign(helperPath);
  } else {
    console.warn(`[dev-sign] Helper not found at ${helperPath}.`);
  }

  console.log(`[dev-sign] Signing installed app: ${appBundle}`);
  sign(appBundle, ['--deep']);

  console.log('[dev-sign] Done.');
} catch (error) {
  console.error(`[dev-sign] Codesign failed: ${String(error)}`);
  process.exit(1);
}
