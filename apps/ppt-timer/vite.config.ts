import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Renderer-only build. The renderer imports ONLY local modules and erased
// @ontime/presentation-core types; it never depends on Node, Electron, or any
// runtime @ontime code (projection happens in the main process).
export default defineConfig({
  root: resolve(here, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(here, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome110',
  },
})
