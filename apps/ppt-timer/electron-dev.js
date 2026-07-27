// Dev launcher: starts the Vite renderer dev server, waits for it to listen,
// then launches Electron against it. Production runs the built files instead.
const { spawn } = require('node:child_process')
const http = require('node:http')

const DEV_URL = 'http://localhost:5173'

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
      env: { ...process.env, VITE_DEV_SERVER_URL: DEV_URL },
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
