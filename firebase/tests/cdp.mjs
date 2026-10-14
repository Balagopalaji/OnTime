/**
 * Shared DevTools-protocol helpers for the ISSUE-002 user-testing walkthroughs
 * (headless Chrome pages, Electron renderer pages, and the Electron main
 * process via its Node inspector). Node's built-in WebSocket; no dependencies.
 */
import { writeFileSync } from 'node:fs'
import path from 'node:path'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function waitForHttp(url, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await sleep(500)
  }
  throw new Error(`timeout waiting for ${url}`)
}

async function openSocket(url) {
  const ws = new WebSocket(url)
  await new Promise((resolve, reject) => ((ws.onopen = resolve), (ws.onerror = reject)))
  let id = 0
  const pending = new Map()
  const events = []
  ws.onmessage = (message) => {
    const data = JSON.parse(message.data)
    if (data.id && pending.has(data.id)) {
      const { resolve, reject } = pending.get(data.id)
      pending.delete(data.id)
      data.error ? reject(new Error(JSON.stringify(data.error))) : resolve(data.result)
    } else if (data.method) events.push(data)
  }
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      id += 1
      pending.set(id, { resolve, reject })
      ws.send(JSON.stringify({ id, method, params }))
    })
  const evaluate = async (expression) => {
    const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + JSON.stringify(result.exceptionDetails.exception?.description))
    return result.result.value
  }
  return { ws, events, send, evaluate }
}

/**
 * Connect to the first page target on a DevTools port. `viewport` (default
 * 520×300) emulates a browser window; pass `null` to keep a native window's size.
 */
export async function connectCdp(port, { outDir, assetPrefix, viewport = { width: 520, height: 300 } }) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  const { ws, events, send, evaluate } = await openSocket(page.webSocketDebuggerUrl)
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Network.enable')
  if (viewport) await send('Emulation.setDeviceMetricsOverride', { ...viewport, deviceScaleFactor: 1, mobile: false })
  return {
    version,
    events,
    send,
    close: () => ws.close(),
    eval: evaluate,
    async waitFor(expression, timeoutMs = 20_000) {
      const until = Date.now() + timeoutMs
      while (Date.now() < until) {
        try {
          if (await evaluate(expression)) return true
        } catch {}
        await sleep(200)
      }
      return false
    },
    async shot(name) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'))
      return `${assetPrefix}/${name}.png`
    },
    async navigate(url) {
      await send('Page.navigate', { url })
    },
  }
}

/** Connect to a Node inspector (e.g. Electron main with `--inspect=<port>`) for test-only evaluation. */
export async function connectNodeInspector(port) {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const { ws, evaluate } = await openSocket(targets[0].webSocketDebuggerUrl)
  return { eval: evaluate, close: () => ws.close() }
}
