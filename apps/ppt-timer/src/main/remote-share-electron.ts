/**
 * Electron glue for ISSUE-002 remote share (effectful only; policy lives in
 * `remote-share.ts`): the utility-process spawner with the non-secret cloud
 * target, the safeStorage credential broker under userData, and the app
 * callback URI (`open-url` on macOS, second-instance argv on Windows; the
 * installer registers the scheme).
 */
import { app, clipboard, safeStorage, shell } from 'electron'
import { readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CLOUD_CONFIG_ARG } from './publisher-sidecar/cloud-client.js'
import { createCredentialBroker } from './publisher-sidecar/credential-store.js'
import { electronSidecarSpawner } from './publisher-sidecar/electron-spawn.js'
import { createSidecarLauncher } from './publisher-sidecar/launcher.js'
import { createRemoteShare, readRemoteShareConfig, type RemoteShare } from './remote-share.js'

export function installRemoteShare(onChange: () => void): RemoteShare {
  const config = readRemoteShareConfig(process.env)
  const broker = createCredentialBroker({
    safeStorage,
    fs: { readFile: (path) => readFile(path), writeFile: (path, data) => writeFile(path, data, { mode: 0o600 }), rename, rm: (path) => rm(path) },
    filePath: join(app.getPath('userData'), 'publisher-credential.bin'),
  })
  const args = config ? [`${CLOUD_CONFIG_ARG}${JSON.stringify(config.cloud)}`] : []
  const share = createRemoteShare({
    config,
    launcher: createSidecarLauncher({ spawn: electronSidecarSpawner(join(__dirname, 'publisher-sidecar/worker.js'), args), broker }),
    openExternal: (url) => shell.openExternal(url),
    copyToClipboard: async (text) => clipboard.writeText(text),
    onChange,
  })
  // The installer registers the callback scheme (electron-builder `protocols`); the app never
  // writes the OS registry itself, so dev and unpacked runs leave it untouched.
  app.on('open-url', (event, url) => {
    if (share.handleCallbackUrl(url)) event.preventDefault()
  })
  app.on('second-instance', (_event, argv) => argv.forEach((arg) => share.handleCallbackUrl(arg)))
  return share
}
