// rebuild-target: app-internal (local-companion)
//
// PowerPoint debug logging (debug-flag file discovery, ppt.log / startup-log
// appenders, AppleScript dump), carved verbatim out of companion/src/main.ts
// (Stage 1b Lane B slice B-5a). DI edit: initializePptDebugLogging takes a
// `getCompanionMode` getter instead of reading main.ts's mutable
// `currentCompanionMode`. The mutable debug flags stay module-private and are
// exposed read-only via isPptDebugEnabled() / isPptDebugVerboseEnabled().

import { app } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const PPT_LOG_FILENAME = 'ppt.log';
const PPT_STARTUP_LOG_FILENAME = 'ppt.startup.log';
const PPT_DEBUG_FILENAME = 'ppt.debug';
const PPT_DEBUG_VERBOSE_FILENAME = 'ppt.debug.verbose';
const PPT_DEBUG_FALLBACK_DIRS = [
  path.join(os.homedir(), 'Library', 'Application Support', 'ontime-companion'),
  path.join(os.homedir(), 'Library', 'Application Support', 'OnTime Companion'),
  path.join(os.homedir(), 'Library', 'Application Support', 'OnTime'),
];
let pptDebugDirs: string[] = [];
let pptDebugEnabled = false;
let pptDebugVerboseEnabled = false;

function resolvePptDebugDirs(): string[] {
  const dirs = [...PPT_DEBUG_FALLBACK_DIRS];
  if (app.isReady()) {
    dirs.unshift(app.getPath('userData'));
  }
  return Array.from(new Set(dirs));
}

function computePptDebugEnabled(dirs: string[]): boolean {
  if (process.env.COMPANION_DEBUG_PPT === 'true') return true;
  return dirs.some((dir) => fsSync.existsSync(path.join(dir, PPT_DEBUG_FILENAME)));
}

function computePptDebugVerboseEnabled(dirs: string[]): boolean {
  if (process.env.COMPANION_DEBUG_PPT_VERBOSE === 'true') return true;
  return dirs.some((dir) => fsSync.existsSync(path.join(dir, PPT_DEBUG_VERBOSE_FILENAME)));
}

export async function initializePptDebugLogging(deps: { getCompanionMode: () => string }): Promise<void> {
  pptDebugDirs = resolvePptDebugDirs();
  pptDebugEnabled = computePptDebugEnabled(pptDebugDirs);
  pptDebugVerboseEnabled = computePptDebugVerboseEnabled(pptDebugDirs);
  if (pptDebugVerboseEnabled) {
    pptDebugEnabled = true;
  }
  if (!pptDebugEnabled) return;
  const startupLine = `[ppt] startup ${new Date().toISOString()} mode=${deps.getCompanionMode()} userData=${app.isReady() ? app.getPath('userData') : 'n/a'}`;
  for (const dir of pptDebugDirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(path.join(dir, PPT_STARTUP_LOG_FILENAME), `${startupLine}\n`, 'utf8');
      break;
    } catch {
      // try next directory
    }
  }
}

export function logPptInfo(message: string, meta?: unknown): void {
  if (!pptDebugEnabled) return;
  if (meta === undefined) {
    console.info(message);
  } else {
    console.info(message, meta);
  }
}

export function logPptVerbose(message: string, meta?: unknown): void {
  if (!pptDebugVerboseEnabled) return;
  if (meta === undefined) {
    console.info(message);
  } else {
    console.info(message, meta);
  }
}

export async function appendPptLog(line: string): Promise<void> {
  const debugEnabled =
    pptDebugEnabled || computePptDebugEnabled(pptDebugDirs.length ? pptDebugDirs : resolvePptDebugDirs());
  if (!debugEnabled) return;
  const dirs = pptDebugDirs.length ? pptDebugDirs : resolvePptDebugDirs();
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.appendFile(path.join(dir, PPT_LOG_FILENAME), `${line}\n`, 'utf8');
      return;
    } catch {
      // try next directory
    }
  }
}

export async function writePptScript(script: string): Promise<void> {
  const debugEnabled =
    pptDebugEnabled || computePptDebugEnabled(pptDebugDirs.length ? pptDebugDirs : resolvePptDebugDirs());
  if (!debugEnabled) return;
  const dirs = pptDebugDirs.length ? pptDebugDirs : resolvePptDebugDirs();
  for (const dir of dirs) {
    try {
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(path.join(dir, 'ppt.script.applescript'), script, 'utf8');
      return;
    } catch {
      // try next directory
    }
  }
}

export function isPptDebugEnabled(): boolean {
  return pptDebugEnabled;
}

export function isPptDebugVerboseEnabled(): boolean {
  return pptDebugVerboseEnabled;
}
