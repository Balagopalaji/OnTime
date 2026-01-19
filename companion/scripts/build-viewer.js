const path = require('node:path');
const { spawnSync } = require('node:child_process');
const pkg = require('../package.json');

const viewerBase = `/viewer/v${pkg.version}/`;
const frontendPath = path.resolve(__dirname, '..', '..', 'frontend');

const env = {
  ...process.env,
  VITE_VIEWER_ONLY: 'true',
  VITE_APP_BASE: viewerBase,
};

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const result = spawnSync(
  npmCmd,
  ['--prefix', frontendPath, 'run', 'build:viewer'],
  { stdio: 'inherit', env }
);

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
