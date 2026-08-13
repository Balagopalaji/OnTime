import { defineConfig } from 'vite'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

// Renderer-only build. The renderer imports local modules and the pure
// @ontime/presentation-core PowerPoint domain contract. It never depends on
// Node or Electron (projection happens in the main process).
export default defineConfig({
  root: resolve(here, 'src/renderer'),
  base: './',
  build: {
    outDir: resolve(here, 'dist/renderer'),
    emptyOutDir: true,
    target: 'chrome110',
  },
})
