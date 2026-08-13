#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const here = fileURLToPath(new URL('.', import.meta.url))
const appDir = join(here, '..')
const forwardedArgs = process.argv.slice(2)

if (forwardedArgs.some((argument) => argument.startsWith('--config.appx.artifactName'))) {
  throw new Error('The Store artifact name is derived from the reviewed app and Store versions')
}

const packageJson = JSON.parse(await readFile(join(appDir, 'package.json'), 'utf8'))
const storePackage = JSON.parse(await readFile(join(appDir, 'store-package.json'), 'utf8'))
const { buildStoreArtifactName } = await import(
  pathToFileURL(join(appDir, 'dist/main/store-package-version.js')).href
)
const artifactName = buildStoreArtifactName(packageJson.version, storePackage.version)
const requireFromApp = createRequire(join(appDir, 'package.json'))
const electronBuilderCli = requireFromApp.resolve('electron-builder/out/cli/cli.js')

console.log(`[store-package] artifact=${artifactName}`)
const result = spawnSync(
  process.execPath,
  [
    electronBuilderCli,
    '--win',
    'appx',
    '--x64',
    `--config.appx.artifactName=${artifactName}`,
    ...forwardedArgs,
  ],
  {
    cwd: appDir,
    env: process.env,
    stdio: 'inherit',
  },
)

if (result.error) throw result.error
process.exit(result.status ?? 1)
