/** Test helpers: read REAL repository artifacts, and serve them through the real allowlist. */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { resolveDataRequest } from '../../vite/dataAllowlist.ts'

/**
 * Tests run with the frontend/ directory as the working directory (npm test),
 * so the repository root is its parent. (import.meta.url is not a file: URL
 * under the jsdom test environment, so it is not used here.)
 */
export const FRONTEND_DIR = process.cwd()
if (!existsSync(join(FRONTEND_DIR, 'package.json')) || !existsSync(join(FRONTEND_DIR, '..', 'experiments'))) {
  throw new Error(`Run the tests from the frontend/ directory of the repository (cwd: ${FRONTEND_DIR})`)
}
export const REPO_ROOT = resolve(FRONTEND_DIR, '..')

export function readRepoText(relativePath: string): string {
  return readFileSync(join(REPO_ROOT, relativePath), 'utf-8')
}

export function readRepoJson(relativePath: string): unknown {
  return JSON.parse(readRepoText(relativePath))
}

/** Ids of every real presentation bundle, discovered through the allowlist itself. */
export function realBundleIds(): string[] {
  const index = JSON.parse(resolveDataRequest(REPO_ROOT, 'index.json').body) as { trials: { id: string }[] }
  return index.trials.map((trial) => trial.id)
}

export function readRealBundle(id: string): unknown {
  return readRepoJson(`experiments/${id}/path_bundle.json`)
}

/** A fetch that answers `.../data/<path>` exactly as the dev server / built site would. */
export function fetchFromAllowlist(): typeof fetch {
  return (input: string | URL | Request) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    const marker = '/data/'
    const at = url.pathname.indexOf(marker)
    const relative = at === -1 ? '' : url.pathname.slice(at + marker.length)
    const result = resolveDataRequest(REPO_ROOT, relative)
    return Promise.resolve(
      new Response(result.body, { status: result.status, headers: { 'Content-Type': result.contentType } }),
    )
  }
}

export const EXPECTED_REAL_BUNDLES = [
  'demo-run-01',
  'p4-held-01-clean1',
  'p4-held-04-latency-hop2-moderate',
  'p4-held-12-unknown-plus-impair',
] as const
