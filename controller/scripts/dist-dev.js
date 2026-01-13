const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..');
const pkg = require(path.join(rootDir, 'package.json'));
const distDir = path.join(rootDir, 'dist_out');
const statePath = path.join(rootDir, '.dev-version.json');
const isWin = process.platform === 'win32';
const npmCmd = isWin ? 'npm' : 'npm';
const npxCmd = isWin ? 'npx' : 'npx';

function run(command, args) {
  const resolvedArgs = isWin ? ['/c', command, ...args] : args;
  const cmdExe = isWin ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe') : command;
  const result = spawnSync(cmdExe, resolvedArgs, {
    stdio: 'inherit',
  });
  if (result.error) {
    console.error('[dist:dev] command failed to start', {
      command,
      args,
      error: result.error.message,
    });
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

fs.mkdirSync(distDir, { recursive: true });

let counter = 0;
if (fs.existsSync(statePath)) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    if (typeof state.counter === 'number') {
      counter = state.counter;
    }
  } catch {
    counter = 0;
  }
}

counter += 1;
const version = `${pkg.version}-dev.${counter}`;
fs.writeFileSync(statePath, JSON.stringify({ counter, version }, null, 2));

console.log(`[dist:dev] building version ${version}`);
run(npmCmd, ['run', 'build:frontend']);
run(npmCmd, ['run', 'build']);
run(npxCmd, ['electron-builder', '--win', `--config.extraMetadata.version=${version}`]);
