import { describe, expect, it } from 'vitest'
import { isBlockedDevPath } from './devSourceGuard.ts'

describe('isBlockedDevPath', () => {
  it.each([
    '/package.json',
    '/package-lock.json',
    '/README.md',
    '/tsconfig.json',
    '/tsconfig.app.json',
    '/eslint.config.js',
    '/vite.config.ts',
    '/vite/dataAllowlist.ts',
    '/vite/hoptraceData.ts',
    '/scripts/verify-dist.mjs',
    '/dist/index.html',
    '/%70ackage.json', // percent-encoded name
    '/src/%2e%2e/package.json',
    '/src/../vite/dataAllowlist.ts',
    '/@fs/C:/dev/HOPTRACE/frontend/package.json',
    '/@fs/C:/dev/HOPTRACE/frontend/vite/dataAllowlist.ts',
    '\\package.json',
    '/%', // malformed escape: refuse
  ])('blocks %s', (path) => {
    expect(isBlockedDevPath(path)).toBe(true)
  })

  it.each([
    '/',
    '/index.html',
    '/src/main.tsx',
    '/src/App.tsx',
    '/src/styles/index.css',
    '/data/index.json',
    '/data/bundles/p4-held-01-clean1.json',
    '/@vite/client',
    '/@react-refresh',
    '/node_modules/.vite/deps/react.js',
    '/node_modules/react/package.json',
  ])('allows %s', (path) => {
    expect(isBlockedDevPath(path)).toBe(false)
  })
})
