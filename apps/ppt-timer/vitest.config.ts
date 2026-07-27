import { defineConfig } from 'vitest/config'

// Default environment is Node (main-process modules). Renderer view tests set
// `// @vitest-environment happy-dom` at the top of the file to exercise DOM
// rendering against the installed happy-dom version.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
})
