import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Launcher-only renderer build. The viewer itself is the hosted cloud viewer
// route, so this bundle contains no timer, face, or contract code.
export default defineConfig({
  root: resolve(here, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(here, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome110',
  },
})
