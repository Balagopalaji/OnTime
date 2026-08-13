// Dev launcher: starts the Vite renderer dev server, waits for it to listen,
// then launches Electron against it. Production runs the built files instead.
const { spawn } = require('node:child_process')
const http = require('node:http')
const { join, resolve } = require('node:path')

const DEV_URL = 'http://localhost:5173'

// Dev helper discovery: resolve the canonical build output
// (packages/ppt-bridge/bin/win-x64/ppt-probe.exe) so a developer who has built
// the helper on Windows gets it discovered automatically. An explicit
// PPT_PROBE_PATH always wins; on macOS the file does not exist and the app
// truthfully shows the unavailable state. helper-discovery.ts reads this env.
const repoRoot = resolve(__dirname, '../..')
const canonicalHelper = join(repoRoot, 'packages/ppt-bridge/bin/win-x64/ppt-probe.exe')
const pptProbePath = process.env.PPT_PROBE_PATH || canonicalHelper

const canConnect = () =>
  new Promise((resolve) => {
    const req = http.get(DEV_URL, (res) => {
      res.destroy()
      resolve(true)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(300, () => {
      req.destroy()
      resolve(false)
    })
  })

async function main() {
  const vite = spawn('vite', ['--config', 'vite.config.ts'], { stdio: 'inherit' })
  let electronStarted = false

  const launchElectron = () => {
    if (electronStarted) return
    electronStarted = true
    const electronPath = require('electron')
    const child = spawn(electronPath, ['.'], {
      stdio: 'inherit',
      env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL, PPT_PROBE_PATH: pptProbePath },
    })
    child.on('close', (code) => {
      vite.kill()
      process.exit(code ?? 0)
    })
  }

  for (let i = 0; i < 150; i++) {
    if (await canConnect()) {
      launchElectron()
      return
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  console.error('Vite dev server did not start; aborting.')
  vite.kill()
  process.exit(1)
}

main()
