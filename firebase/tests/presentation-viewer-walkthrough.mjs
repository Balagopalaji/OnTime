#!/usr/bin/env node
/**
 * ISSUE-002 S5b user-testing walkthrough (run inside `firebase emulators:exec`
 * via `npm run user-test:presentation-viewer`). A scripted owner/publisher
 * drives the real frontend (Vite dev server, emulator-backed) while headless
 * Google Chrome is controlled over the DevTools protocol: each user workflow
 * is exercised, screenshotted, and checked for console errors, failed
 * requests, token leakage, and room-data access.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { signOut } = require('firebase/auth')
const { createPresentationHarness, pkcePair, requestId, callbackCode, devicePublicKey } = require('./presentation-harness')

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '../..')
const outDir = path.join(repo, 'docs/user-testing/assets/issue-002-s5b')
const CHROME = process.env.CHROME_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = []
let eventCursor = () => 0
const record = (step, result, detail = '') => {
  log.push({ step, result, detail, eventIndex: eventCursor() })
  console.log(`${result === 'PASS' ? 'PASS' : 'FAIL'} ${step}${detail ? ` — ${detail}` : ''}`)
}

async function waitForHttp(url, timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      if ((await fetch(url)).ok) return
    } catch {}
    await sleep(500)
  }
  throw new Error(`timeout waiting for ${url}`)
}

/** Minimal DevTools-protocol client over Node's built-in WebSocket. */
async function connectChrome(port) {
  const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
  const page = targets.find((t) => t.type === 'page')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
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
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Log.enable')
  await send('Network.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 520, height: 300, deviceScaleFactor: 1, mobile: false })
  return {
    version,
    events,
    send,
    close: () => ws.close(),
    async eval(expression) {
      const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ' ' + JSON.stringify(result.exceptionDetails.exception?.description))
      return result.result.value
    },
    async waitFor(expression, timeoutMs = 20_000) {
      const until = Date.now() + timeoutMs
      while (Date.now() < until) {
        try {
          if (await this.eval(expression)) return true
        } catch {}
        await sleep(200)
      }
      return false
    },
    async shot(name) {
      const { data } = await send('Page.captureScreenshot', { format: 'png' })
      writeFileSync(path.join(outDir, `${name}.png`), Buffer.from(data, 'base64'))
      return `assets/issue-002-s5b/${name}.png`
    },
    async navigate(url) {
      await send('Page.navigate', { url })
    },
  }
}

const faceText = `(() => ({ badge: document.querySelector('#badge')?.textContent ?? null, message: document.querySelector('#message')?.textContent ?? null, time: document.querySelector('#time')?.textContent ?? null, connection: document.querySelector('.status')?.dataset.connection ?? null }))()`
const labelIs = (text) => `(() => { const f = ${faceText}; return (f.badge ?? f.message) === ${JSON.stringify(text)} })()`

async function main() {
  mkdirSync(outDir, { recursive: true })
  const projectId = process.env.GCLOUD_PROJECT
  const vite = spawn('npx', ['vite', '--port', '5173', '--strictPort', '--host', 'localhost'], {
    cwd: path.join(repo, 'frontend'),
    env: {
      ...process.env,
      VITE_USE_FIREBASE_EMULATOR: 'true',
      VITE_FIREBASE_API_KEY: 'demo-key',
      VITE_FIREBASE_AUTH_DOMAIN: 'localhost',
      VITE_FIREBASE_PROJECT_ID: projectId,
      VITE_FIREBASE_APP_ID: 'demo-app',
    },
    stdio: 'ignore',
  })
  const chrome = spawn(CHROME, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--remote-debugging-port=9333', `--user-data-dir=/tmp/issue-002-chrome-${Date.now()}`, 'about:blank'], { stdio: 'ignore' })
  const h = await createPresentationHarness('walkthrough')
  let browser
  try {
    await waitForHttp('http://localhost:5173/')
    await waitForHttp('http://127.0.0.1:9333/json/version')
    browser = await connectChrome(9333)
    eventCursor = () => browser.events.length
    record('environment', 'PASS', `Chrome ${browser.version.Browser}; Vite dev server on :5173; emulators project ${projectId}`)

    // Publisher setup (the PPT Timer sidecar's calls, scripted).
    const owner = h.newAccount('owner')
    const device = await h.approveDevice(owner)
    await h.signInAsDevice(device)
    const session = await h.call('createPresentationSession', { clientRequestId: requestId() })
    const token = new URL(session.viewerUrl).hash.replace('#token=', '')
    let epoch = 1
    let sequence = 0
    const rows = (overrides = {}) => [
      { ordinal: 0, label: 'Walk-in loop', status: 'playing', durationMs: 120_000, elapsedMsAtObservation: 30_000, remainingMsAtObservation: 90_000, isFocus: true, ...overrides },
      { ordinal: 1, label: 'Sermon bumper', status: 'ready', durationMs: 45_000, elapsedMsAtObservation: null, remainingMsAtObservation: null, isFocus: false },
    ]
    const publish = async (availability, payload) => {
      sequence += 1
      await h.callAs(device.customToken, 'publishPresentationSnapshot', {
        schemaMajor: 1, sourceKind: 'powerpoint', sourceMajor: 1, sessionId: session.sessionId, epoch, sequence,
        observedAtMs: Date.now(), observationAgeMs: 0, sentAtEstimatedServerMs: null, availability, payload,
      })
    }
    const presentation = (presentationState, videos, slideNumber = 3) => ({
      reason: 'presentation', presentationState, slideNumber, slideCount: 12, displayTitle: 'Sunday Service',
      headline: { focusedOrdinal: 0, mode: 'longest-remaining', timingMode: 'remaining' }, videos,
    })

    // W1: open the shared link.
    await browser.navigate(session.viewerUrl)
    const connecting = await browser.waitFor(labelIs('Connecting'), 15_000)
    record('W1 open link → connecting face', connecting ? 'PASS' : 'FAIL', `screenshot ${await browser.shot('01-connecting')}`)
    const href = await browser.eval('location.href')
    record('W1 token scrubbed from address bar', href.includes('token=') ? 'FAIL' : 'PASS', href)

    // W2: host publishes a playing observation → compact face, then it counts down.
    await publish('active', presentation('playing', rows()))
    const live = await browser.waitFor(labelIs('Playing'))
    const t1 = (await browser.eval(faceText)).time
    const titleHidden = await browser.eval(`!document.querySelector('.session-viewer-face').innerText.includes('Walk-in loop')`)
    const caretVisible = await browser.eval(`(() => { const r = document.querySelector('button[aria-label="Show video list"]').getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth && r.height > 0 })()`)
    record('W2 live compact face (Playing above time, no title)', live && titleHidden ? 'PASS' : 'FAIL', `time ${t1}; screenshot ${await browser.shot('02-live-playing')}`)
    record('W2 disclosure caret visible inside the viewport', caretVisible ? 'PASS' : 'FAIL')
    await sleep(3_000)
    const t2 = (await browser.eval(faceText)).time
    record('W2 countdown advances between publishes', t2 < t1 ? 'PASS' : 'FAIL', `${t1} → ${t2}; screenshot ${await browser.shot('03-counting-down')}`)

    // W3: disclosure reveals titles and statuses.
    await browser.eval(`document.querySelector('button[aria-label="Show video list"]').click()`)
    const rowsShown = await browser.waitFor(`document.querySelectorAll('.video-row').length === 2 && document.body.innerText.includes('Walk-in loop') && document.body.innerText.includes('Sermon bumper')`, 5_000)
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 520, height: 420, deviceScaleFactor: 1, mobile: false })
    const hideVisible = await browser.eval(`(() => { const r = document.querySelector('button[aria-label="Hide video list"]').getBoundingClientRect(); return r.bottom <= innerHeight && r.height > 0 })()`)
    record('W3 disclosure shows video titles/status/time', rowsShown && hideVisible ? 'PASS' : 'FAIL', `screenshot ${await browser.shot('04-disclosure-open')}`)
    await browser.eval(`document.querySelector('button[aria-label="Hide video list"]').click()`)
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 520, height: 300, deviceScaleFactor: 1, mobile: false })

    // W4: paused stops the countdown.
    await publish('active', presentation('paused', rows({ status: 'paused' })))
    await browser.waitFor(labelIs('Paused'))
    const p1 = (await browser.eval(faceText)).time
    await sleep(2_000)
    const p2 = (await browser.eval(faceText)).time
    record('W4 paused shows Paused and does not advance', p1 === p2 ? 'PASS' : 'FAIL', `${p1} → ${p2}; screenshot ${await browser.shot('05-paused')}`)

    // W5: host loses PowerPoint helper → explicit unavailable, no timing (RPV-008).
    await publish('source-unavailable', { reason: 'helper-unavailable' })
    const unavailable = await browser.waitFor(`${labelIs('Retrying')} && document.querySelector('#time').textContent === '--:--'`)
    record('W5 helper unavailable → Retrying with --:--', unavailable ? 'PASS' : 'FAIL', `screenshot ${await browser.shot('06-source-unavailable')}`)

    // W6: publisher goes silent → stale at 25 s (frozen, dimmed), disconnected at 60 s.
    await publish('active', presentation('playing', rows()))
    await browser.waitFor(labelIs('Playing'))
    const stale = await browser.waitFor(labelIs('Reconnecting'), 32_000)
    const s1 = (await browser.eval(faceText))
    await sleep(2_000)
    const s2 = (await browser.eval(faceText))
    record('W6 no heartbeat → Reconnecting, frozen, dimmed', stale && s1.time === s2.time && s1.connection === 'stale' ? 'PASS' : 'FAIL', `${JSON.stringify(s2)}; screenshot ${await browser.shot('07-stale')}`)
    const disconnected = await browser.waitFor(`${labelIs('Disconnected')} && document.querySelector('#time').textContent === '--:--'`, 40_000)
    record('W6 60 s without contact → Disconnected with --:--', disconnected ? 'PASS' : 'FAIL', `screenshot ${await browser.shot('08-disconnected')}`)

    // W7: host restart → resume (new epoch) → viewer starts from the fresh snapshot (RPV-007).
    const resumed = await h.callAs(device.customToken, 'resumePresentationSession', { sessionId: session.sessionId, clientRequestId: requestId() })
    epoch = resumed.epoch
    sequence = 0
    await publish('active', presentation('playing', rows({ remainingMsAtObservation: 60_000, elapsedMsAtObservation: 60_000 }), 4))
    const back = await browser.waitFor(`${labelIs('Playing')} && document.querySelector('#time').textContent.startsWith('00:5')`, 20_000)
    record('W7 resume (epoch 2) → live again from the new snapshot', back ? 'PASS' : 'FAIL', `epoch ${epoch}; screenshot ${await browser.shot('09-resumed-new-epoch')}`)

    // W8: reload the tab mid-show → still works without the token in the URL.
    await browser.send('Page.reload')
    const reloaded = await browser.waitFor(labelIs('Playing'), 20_000)
    const reloadHref = await browser.eval('location.href')
    record('W8 reload keeps the viewer live (tab-scoped token)', reloaded && !reloadHref.includes('token=') ? 'PASS' : 'FAIL', `screenshot ${await browser.shot('10-reloaded')}`)

    // W9: owner revokes the link → access ended (RPV-010 read-only principal loses access).
    await h.signInWithAccount(owner)
    await h.call('revokePresentationViewerLink', { sessionId: session.sessionId, clientRequestId: requestId() })
    const revoked = await browser.waitFor(labelIs('Access ended'), 15_000)
    record('W9 owner revokes link → Access ended', revoked ? 'PASS' : 'FAIL', `screenshot ${await browser.shot('11-access-ended')}`)

    // W10: a newly issued link works; ending the session shows Session ended.
    const issued = await h.callAs(device.customToken, 'issuePresentationViewerLink', { sessionId: session.sessionId, clientRequestId: requestId() })
    await browser.navigate(issued.viewerUrl)
    await publish('active', presentation('playing', rows()))
    const relinked = await browser.waitFor(labelIs('Playing'), 20_000)
    record('W10 new link after revoke → live', relinked ? 'PASS' : 'FAIL', `screenshot ${await browser.shot('12-new-link-live')}`)
    await h.call('endPresentationSession', { sessionId: session.sessionId, clientRequestId: requestId() })
    const ended = await browser.waitFor(labelIs('Session ended'), 15_000)
    record('W10 owner ends the session → Session ended', ended ? 'PASS' : 'FAIL', `screenshot ${await browser.shot('13-session-ended')}`)

    // W11: a bad link fails visibly and safely.
    await browser.navigate(`http://localhost:5173/session/${session.sessionId}/view#token=${'A'.repeat(43)}`)
    const badLink = await browser.waitFor(labelIs('Access ended'), 15_000)
    record('W11 wrong token → Access ended', badLink ? 'PASS' : 'FAIL', `screenshot ${await browser.shot('14-bad-link')}`)

    // W12: owner approves a new PPT Timer device in the web app (operator app, not the viewer).
    record('W12 operator app phase begins', 'PASS', 'errors after this point come from the operator app')
    await signOut(h.auth)
    const pkce = pkcePair()
    const begun = await h.call('beginPresentationPublisherAuth', { clientRequestId: requestId(), codeChallenge: pkce.challenge, callbackScheme: 'downstage-ppt-timer' })
    await browser.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 520, deviceScaleFactor: 1, mobile: false })
    await browser.navigate('http://localhost:5173/')
    await browser.waitFor(`!!window.firebase?.auth`, 20_000)
    // The app offers Google sign-in; for the emulator the harness signs the same owner in with
    // email/password through the app's own firebase/auth module instance.
    await browser.eval(`(async () => {
      const url = performance.getEntriesByType('resource').map((e) => e.name).find((n) => n.includes('firebase_auth'))
      const mod = await import(url)
      await mod.signInWithEmailAndPassword(window.firebase.auth, ${JSON.stringify(owner.email)}, ${JSON.stringify(owner.password)})
      return true
    })()`)
    await browser.navigate(`http://localhost:5173/publisher/device/approve?challenge=${begun.challengeId}`)
    const prompt = await browser.waitFor(`document.body.innerText.includes('Link PPT Timer to your account?') && !!Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Approve')`, 20_000)
    record('W12 approval page explains and offers Approve/Deny', prompt ? 'PASS' : 'FAIL', `screenshot ${await browser.shot('15-approval-prompt')}`)
    await browser.eval(`Array.from(document.querySelectorAll('button')).find((b) => b.textContent === 'Approve').click()`)
    const approvedShown = await browser.waitFor(`document.body.innerText.includes('Approved. Returning to PPT Timer')`, 15_000)
    const callbackUrl = await browser.eval(`document.querySelector('a[href^="downstage-ppt-timer://"]')?.getAttribute('href') ?? null`)
    record('W12 approve → hands off to the app callback', approvedShown && callbackUrl ? 'PASS' : 'FAIL', `screenshot ${await browser.shot('16-approval-done')}`)
    const completed = await h.call('completePresentationPublisherAuth', {
      clientRequestId: requestId(), challengeId: begun.challengeId, authorizationCode: callbackCode(callbackUrl, begun.challengeId), codeVerifier: pkce.verifier, devicePublicKey,
    })
    record('W12 app completes approval with the callback code', completed.deviceUid?.startsWith('ppd_') ? 'PASS' : 'FAIL', completed.deviceUid)

    // Runtime checks across the whole run.
    // Attribute every console error to the step during which it happened, and allow only the
    // documented, expected ones. Chrome logs refused requests as console errors:
    //  - after revoke/end/bad link (W9–W11): resolvePresentationViewerLink 403 (how the viewer learns
    //    "session ended" vs "access ended") and the Firestore Listen channel 400 when a denied or
    //    disposed stream is torn down;
    //  - W8 (page reload mid-stream): a Firestore Listen channel 400 as the WebChannel session of
    //    the unloaded page is reset (the SDK reconnects; W8 itself asserts the viewer stays live);
    //  - W12 (operator app, not the viewer): its Companion probe (no Companion running) and the
    //    headless browser's inability to launch the downstage-ppt-timer:// callback.
    const stepAt = (index) => [...log].reverse().find((entry) => entry.eventIndex <= index)?.step ?? 'setup'
    const expected = (step, text) =>
      (/^W(9|10|11)/.test(step) && /status of 403 .*resolvePresentationViewerLink/.test(text)) ||
      (/^W(8|9|10|11)/.test(step) && /status of 400 .*Firestore\/Listen\/channel/.test(text)) ||
      (/^W12/.test(step) && (/socket\.io/.test(text) || /Failed to launch 'downstage-ppt-timer:/.test(text)))
    const errors = browser.events
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => e.method === 'Runtime.exceptionThrown' || (e.method === 'Runtime.consoleAPICalled' && e.params.type === 'error') || (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'))
      .map(({ e, index }) => ({ step: stepAt(index), text: JSON.stringify(e.params) }))
    const unexpected = errors.filter((err) => !expected(err.step, err.text))
    const failed = browser.events.filter((e) => e.method === 'Network.loadingFailed' && !/net::ERR_ABORTED/.test(e.params.errorText))
    const urls = browser.events.filter((e) => e.method === 'Network.requestWillBeSent').map((e) => e.params.request.url)
    writeFileSync(path.join(outDir, 'console-errors.json'), JSON.stringify(errors.map((err) => ({ ...err, expected: expected(err.step, err.text), text: err.text.slice(0, 300) })), null, 2))
    const resolves = browser.events
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => e.method === 'Network.requestWillBeSent' && e.params.request.url.includes('resolvePresentationViewerLink') && e.params.request.method === 'POST')
      .map(({ e, index }) => ({ step: stepAt(index), body: (e.params.request.postData ?? '').slice(0, 120) }))
    writeFileSync(path.join(outDir, 'resolve-calls.json'), JSON.stringify(resolves, null, 2))
    record('runtime: no unexpected console errors', unexpected.length === 0 ? 'PASS' : 'FAIL', `${errors.length} total (${errors.length - unexpected.length} expected); unexpected: ${unexpected.map((u) => `${u.step}: ${u.text.slice(0, 200)}`).join(' | ') || 'none'}`)
    record('runtime: failed network requests', failed.length === 0 ? 'PASS' : 'FAIL', failed.map((e) => e.params.errorText).join(', ') || 'none')
    record('runtime: token never in a request URL', urls.some((u) => u.includes(token)) ? 'FAIL' : 'PASS', `${urls.length} requests checked`)
    record('runtime: viewer never reads room data', urls.some((u) => /documents\/rooms/.test(u) || /rooms%2F/.test(u)) ? 'FAIL' : 'PASS')
  } finally {
    writeFileSync(path.join(outDir, 'walkthrough-log.json'), JSON.stringify(log, null, 2))
    browser?.close()
    chrome.kill()
    vite.kill()
    await h.cleanup().catch(() => {})
  }
  const failures = log.filter((entry) => entry.result !== 'PASS')
  console.log(`${log.length - failures.length}/${log.length} checks passed`)
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
