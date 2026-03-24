/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const appBase = process.env.VITE_APP_BASE ?? '/'

export default defineConfig({
  base: appBase,
  plugins: [react()],
  test: {
    environment: 'happy-dom',
    setupFiles: './src/setupTests.ts',
  },
  server: {
    headers: {},
  },
  preview: {
    headers: {},
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('firebase')) {
              return 'firebase';
            }
            if (id.includes('react') || id.includes('react-dom') || id.includes('react-router-dom')) {
              return 'react-vendor';
            }
            if (id.includes('lucide-react')) {
              return 'ui-vendor';
            }
          }
        },
      },
    },
  },
})
