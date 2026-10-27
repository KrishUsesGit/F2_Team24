// @vitest-environment node
/**
 * Boots the REAL dev server (this project's vite.config.ts) on a loopback
 * ephemeral port and probes it over HTTP: only the app's own sources and the
 * /data allowlist may be served; research data and unrelated repository files
 * may not.
 */
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import { createServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FRONTEND_DIR, REPO_ROOT } from '../src/test/repo.ts'

let server: ViteDevServer
let base = ''

beforeAll(async () => {
  server = await createServer({
    root: FRONTEND_DIR,
    configFile: join(FRONTEND_DIR, 'vite.config.ts'),
    logLevel: 'silent',
    server: { port: 0, strictPort: false, hmr: false, ws: false },
    optimizeDeps: { noDiscovery: true, include: [] },
  })
  await server.listen()
  const address = server.httpServer?.address() as AddressInfo
  base = `http://127.0.0.1:${address.port}`
}, 60_000)

afterAll(async () => {
  await server.close()
})

async function probe(path: string, accept = 'application/json') {
  const res = await fetch(base + path, { headers: { Accept: accept }, redirect: 'manual' })
  return { status: res.status, body: await res.text() }
}

const fsPath = (relative: string) => `/@fs/${REPO_ROOT.replace(/\\/g, '/')}/${relative}`

describe('dev server binds to loopback only', () => {
  it('listens on 127.0.0.1', () => {
    expect((server.httpServer?.address() as AddressInfo).address).toBe('127.0.0.1')
  })
})

describe('allowed', () => {
  it.each(['/data/index.json', '/data/evaluation/phase4.json', '/data/evaluation/phase4b.json'])('serves %s', async (path) => {
    expect((await probe(path)).status).toBe(200)
  })

  it('serves a bundle with no local filesystem path in it', async () => {
    const res = await probe('/data/bundles/demo-run-01.json')
    expect(res.status).toBe(200)
    expect(res.body).not.toMatch(/\/mnt\/|Users[\\/]|OneDrive/i)
  })

  it('serves the application page', async () => {
    const res = await probe('/', 'text/html')
    expect(res.status).toBe(200)
    expect(res.body).toContain('<div id="root">')
  })
})

describe('refused: research data and unrelated repository files', () => {
  const refused = [
    // raw traces and evidence, by every route the dev server offers
    fsPath('experiments/p4-held-01-clean1/hop.jsonl'),
    fsPath('experiments/p4-held-01-clean1/app.jsonl'),
    fsPath('experiments/p4-held-01-clean1/path_bundle.json'),
    fsPath('experiments/demo-run-01/trial_meta.json'),
    fsPath('evaluate/held_out_results.json'),
    fsPath('evaluate/held_out_results_4b.json'),
    fsPath('evaluate/frozen_config_4b.json'),
    // unrelated repository files
    fsPath('.git/config'),
    fsPath('README.md'),
    fsPath('AUDIT_REPORT.md'),
    fsPath('faultctl/groundtruth.py'),
    fsPath('ui/index.html'),
    '/experiments/p4-held-01-clean1/hop.jsonl',
    '/../experiments/p4-held-01-clean1/hop.jsonl',
    '/%2e%2e/experiments/p4-held-01-clean1/hop.jsonl',
    '/src/%2e%2e/%2e%2e/experiments/p4-held-01-clean1/hop.jsonl',
    '/evaluate/held_out_results.json',
    '/.git/config',
    '/%2e%2e/.git/config',
    // the frontend's own non-source files
    '/package.json',
    '/package-lock.json',
    '/vite.config.ts',
    '/vite/dataAllowlist.ts',
    '/scripts/verify-dist.mjs',
    '/tsconfig.json',
    '/README.md',
    '/src/%2e%2e/package.json',
    '/.env',
    '/.env.local',
    // the data allowlist's own refusals
    '/data/bundles/p4-held-01-clean1.jsonl',
    '/data/evaluation/held_out_results.json',
    '/data/bundles/..%2f..%2fevaluate%2fheld_out_results.json',
  ]

  it.each(refused)('refuses %s', async (path) => {
    const res = await probe(path)
    expect([403, 404]).toContain(res.status)
  })

  it('never answers a refused path with the real file content, even when HTML is accepted', async () => {
    const markers: [string, string][] = [
      ['/package.json', 'hoptrace-frontend'],
      ['/vite.config.ts', 'hoptraceData'],
      [fsPath('experiments/p4-held-01-clean1/hop.jsonl'), 'round_id'],
      [fsPath('evaluate/held_out_results.json'), 'per_trial_detail'],
      [fsPath('.git/config'), '[remote'],
    ]
    for (const [path, marker] of markers) {
      const res = await probe(path, '*/*')
      expect(res.body).not.toContain(marker)
    }
  })

  it('rejects write methods on /data', async () => {
    const res = await fetch(`${base}/data/index.json`, { method: 'POST' })
    expect(res.status).toBe(405)
  })
})
