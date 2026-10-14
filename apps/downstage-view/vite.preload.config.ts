import { resolve } from 'node:path'

/**
 * A sandboxed preload cannot `require` sibling files, only `electron` and a
 * few built-ins. Bundle the preload (and its tiny shared helpers) into one
 * CommonJS file so the packaged app does not fail at preload time.
 */
export const preloadBuildConfig = {
  logLevel: 'warn' as const,
  build: {
    target: 'node20',
    emptyOutDir: false,
    outDir: resolve(__dirname, 'dist/preload'),
    minify: false,
    lib: { entry: resolve(__dirname, 'src/preload/preload.ts'), formats: ['cjs'] as ['cjs'], fileName: () => 'preload.js' },
    rollupOptions: { external: ['electron'] },
  },
}

export default preloadBuildConfig
