// @vitest-environment node
/**
 * Production-preview integration test.
 *
 * Builds the site with this project's real vite.config.ts into a temporary
 * directory, then serves that build with Vite's real preview server over HTTP
 * (the same server `npm run preview` starts). The four recorded trials are then
 * fetched exactly as the browser fetches them, so a bundle that is not emitted,
 * is requested at the wrong path, or comes back as an HTML fallback fails here,
 * where the dev-server tests and the mocked-fetch component tests cannot see it.
 */
import { mkdtempSync, readdirSync } from 'node:fs'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { build, preview, type PreviewServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { bundleSchema, evaluationProjectionSchema, manifestSchema } from '../src/data/schema.ts'
import { EXPECTED_REAL_BUNDLES, FRONTEND_DIR, readRealBundle } from '../src/test/repo.ts'
import { findLocalPaths } from './dataAllowlist.ts'

let outDir = ''
let server: PreviewServer
let base = ''

beforeAll(async () => {
  outDir = join(mkdtempSync(join(tmpdir(), 'hoptrace-preview-')), 'dist')
  const configFile = join(FRONTEND_DIR, 'vite.config.ts')
  await build({ root: FRONTEND_DIR, configFile, logLevel: 'silent', build: { outDir, emptyOutDir: true } })
  server = await preview({
    root: FRONTEND_DIR,
    configFile,
    logLevel: 'silent',
    build: { outDir },
    preview: { host: '127.0.0.1', port: 0, strictPort: false },
  })
  const address = server.httpServer.address() as AddressInfo
  base = `http://127.0.0.1:${address.port}`
}, 120_000)

afterAll(async () => {
  await server?.close()
})

async function get(path: string) {
  const res = await fetch(base + path, { redirect: 'manual' })
  return { status: res.status, type: res.headers.get('content-type') ?? '', text: await res.text() }
}

function withoutSourceFile(bundle: unknown): unknown {
  const copy = JSON.parse(JSON.stringify(bundle)) as { evaluation?: { source_file?: string } }
  if (copy.evaluation) delete copy.evaluation.source_file
  return copy
}

describe('the production build emits the data files the app requests', () => {
  it('has one file per recorded bundle at data/bundles/<id>.json', () => {
    const emitted = readdirSync(join(outDir, 'data', 'bundles')).sort()
    expect(emitted).toEqual(EXPECTED_REAL_BUNDLES.map((id) => `${id}.json`).sort())
  })

  it('binds the preview server to loopback only', () => {
    expect((server.httpServer.address() as AddressInfo).address).toBe('127.0.0.1')
  })
})

describe('the preview server serves the manifest and evaluation projections', () => {
  it('serves index.json listing exactly the four recorded trials', async () => {
    const res = await get('/data/index.json')
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/^application\/json/)
    const manifest = manifestSchema.parse(JSON.parse(res.text))
    expect(manifest.trials.map((trial) => trial.id).sort()).toEqual([...EXPECTED_REAL_BUNDLES].sort())
  })

  it.each(['phase4', 'phase4b'])('serves a schema-valid evaluation projection for %s', async (phase) => {
    const res = await get(`/data/evaluation/${phase}.json`)
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/^application\/json/)
    expect(evaluationProjectionSchema.safeParse(JSON.parse(res.text)).success).toBe(true)
  })
})

describe.each(EXPECTED_REAL_BUNDLES)('bundle %s over HTTP from the production preview', (id) => {
  it('returns 200 with a JSON content type and a JSON body (not the HTML fallback)', async () => {
    const res = await get(`/data/bundles/${id}.json`)
    expect(res.status).toBe(200)
    expect(res.type).toMatch(/^application\/json/)
    expect(res.text.trimStart().startsWith('<')).toBe(false)
    expect(() => JSON.parse(res.text)).not.toThrow()
  })

  it('passes the same schema validation the application applies', async () => {
    const parsed = bundleSchema.safeParse(JSON.parse((await get(`/data/bundles/${id}.json`)).text))
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true)
    if (parsed.success) expect(parsed.data.trial_id).toBe(id)
  })

  it('is the stored bundle, changed only by removing the local path', async () => {
    const served = JSON.parse((await get(`/data/bundles/${id}.json`)).text)
    expect(withoutSourceFile(served)).toEqual(withoutSourceFile(readRealBundle(id)))
    expect(findLocalPaths(served)).toEqual([])
  })
})

describe('local-path sanitisation holds in the production build', () => {
  it('keeps only the base name of the demo bundle source file', async () => {
    const onDisk = readRealBundle('demo-run-01') as { evaluation: { source_file: string } }
    expect(findLocalPaths(onDisk).length).toBeGreaterThan(0) // the historical file is preserved
    const served = JSON.parse((await get('/data/bundles/demo-run-01.json')).text) as {
      evaluation: { source_file: string }
    }
    expect(served.evaluation.source_file).toBe('held_out_results_4b.json')
  })

  it.each([...EXPECTED_REAL_BUNDLES, 'index', 'evaluation/phase4', 'evaluation/phase4b'])(
    'has no machine-local path in the emitted %s',
    async (name) => {
      const path = name.includes('/') || name === 'index' ? `/data/${name}.json` : `/data/bundles/${name}.json`
      expect((await get(path)).text).not.toMatch(/\/mnt\/[a-z]\/|[A-Za-z]:[\\/]+Users|\/home\/|\/Users\/|OneDrive/)
    },
  )
})

describe('prohibited URLs stay inaccessible in the production preview', () => {
  /** The preview server answers unknown paths with the application page; what matters is no research data. */
  const FORBIDDEN = [
    '/data/bundles/not-a-recorded-trial.json',
    '/data/bundles/../../experiments/demo-run-01/path_bundle.json',
    '/data/bundles/%2e%2e%2f%2e%2e%2fexperiments%2fdemo-run-01%2fpath_bundle.json',
    '/data/bundles/demo-run-01.jsonl',
    '/data/evaluation/held_out_results.json',
    '/data/evaluation/held_out_results_4b.json',
    '/data/ground_truth.db',
    '/experiments/demo-run-01/path_bundle.json',
    '/evaluate/held_out_results_4b.json',
    '/package.json',
    '/vite.config.ts',
    '/../package.json',
  ]

  it.each(FORBIDDEN)('does not serve research or repository content for %s', async (path) => {
    const res = await get(path)
    expect(res.text).not.toContain('"trial_id"')
    expect(res.text).not.toContain('expected_hop')
    expect(res.text).not.toContain('"fault_type"')
    expect(res.text).not.toContain('"scripts"')
    expect(res.text).not.toContain('defineConfig')
    expect(res.type).not.toMatch(/^application\/json/)
  })

  it('emits no raw trace, database or label file anywhere in the build', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)],
      )
    const files = walk(outDir)
    expect(files.filter((file) => /\.(jsonl|db|sqlite|env|pem)$/i.test(file) || /held_out_results|ground_truth/i.test(file))).toEqual([])
  })
})
