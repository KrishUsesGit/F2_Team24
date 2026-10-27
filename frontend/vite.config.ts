import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { devSourceGuard } from './vite/devSourceGuard.ts'
import { hoptraceData } from './vite/hoptraceData.ts'

// The repository root (parent of frontend/). The data plugin reads ONLY an
// explicit allowlist of presentation JSON files beneath it; see
// vite/dataAllowlist.ts.
const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const frontendRoot = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '')

export default defineConfig({
  // Relative base: the built app works from any static-host sub-path.
  base: './',
  plugins: [devSourceGuard(), react(), tailwindcss(), hoptraceData({ repoRoot })],
  server: {
    // Loopback only: the dev server is never reachable from the network.
    host: '127.0.0.1',
    fs: {
      strict: true,
      // Only this directory may be served from disk; the rest of the repository
      // (experiments, evaluation files, ground-truth artifacts, .git) is
      // reachable solely through the explicit /data allowlist. The frontend's own
      // non-source files are refused by devSourceGuard.
      allow: [frontendRoot],
      deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**'],
    },
  },
  build: { target: 'es2022', sourcemap: false },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'vite/**/*.test.ts'],
    restoreMocks: true,
  },
})
