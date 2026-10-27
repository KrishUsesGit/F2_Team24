import { describe, expect, it, vi } from 'vitest'
import { loadBundle, loadEvaluation, loadManifest } from './loader.ts'
import { describeBundle } from './provenance.ts'
import { bundleSchema } from './schema.ts'
import { EXPECTED_REAL_BUNDLES, fetchFromAllowlist, readRealBundle } from '../test/repo.ts'

const BASE = 'http://localhost:5173/'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
}

describe('loading real data through the allowlist', () => {
  const fetchFn = fetchFromAllowlist()

  it('loads the manifest', async () => {
    const result = await loadManifest({ fetchFn, baseUrl: BASE })
    expect(result.ok).toBe(true)
    if (result.ok) for (const id of EXPECTED_REAL_BUNDLES) expect(result.value.trials.map((t) => t.id)).toContain(id)
  })

  it.each(EXPECTED_REAL_BUNDLES)('loads and validates bundle %s', async (id) => {
    const result = await loadBundle(id, { fetchFn, baseUrl: BASE })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.bundle.trial_id).toBe(id)
      // The summary text is displayed verbatim: it must equal the stored text.
      const stored = bundleSchema.parse(readRealBundle(id))
      expect(result.value.bundle.plain_language.summary).toBe(stored.plain_language.summary)
    }
  })

  it('loads both evaluation projections', async () => {
    const result = await loadEvaluation({ fetchFn, baseUrl: BASE })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.phase4.algorithm).toBe('mad')
      expect(result.value.phase4b.algorithm).toBe('mad_sustained')
    }
  })
})

describe('explicit failure states', () => {
  it('reports a network failure', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const result = await loadManifest({ fetchFn, baseUrl: BASE })
    expect(result).toMatchObject({ ok: false, error: { kind: 'network' } })
  })

  it('reports a missing bundle as an http error with its status', async () => {
    const fetchFn = fetchFromAllowlist()
    const result = await loadBundle('no-such-trial', { fetchFn, baseUrl: BASE })
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 404 } })
  })

  it('reports a server error', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse({ error: 'x' }, 500))
    const result = await loadManifest({ fetchFn, baseUrl: BASE })
    expect(result).toMatchObject({ ok: false, error: { kind: 'http', status: 500 } })
  })

  it('reports invalid JSON', async () => {
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse('{not json'))
    const result = await loadManifest({ fetchFn, baseUrl: BASE })
    expect(result).toMatchObject({ ok: false, error: { kind: 'parse' } })
  })

  it('reports schema violations with field paths', async () => {
    const broken = structuredClone(readRealBundle('p4-held-01-clean1')) as Record<string, unknown>
    delete broken['hops']
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(broken))
    const result = await loadBundle('p4-held-01-clean1', { fetchFn, baseUrl: BASE })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.kind).toBe('schema')
      expect(result.error.issues?.some((line) => line.startsWith('hops'))).toBe(true)
    }
  })

  it('reports a cancelled request as aborted, not as a data error', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new DOMException('aborted', 'AbortError'))
    const result = await loadManifest({ fetchFn, baseUrl: BASE })
    expect(result).toMatchObject({ ok: false, error: { kind: 'aborted' } })
  })

  it('fails the evaluation load if either projection fails', async () => {
    const fetchFn = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(url.endsWith('phase4b.json') ? jsonResponse({ nope: true }) : fetchFromAllowlist()(url)),
    )
    const result = await loadEvaluation({ fetchFn, baseUrl: BASE })
    expect(result).toMatchObject({ ok: false, error: { kind: 'schema' } })
  })

  it('rejects an evaluation projection that carries per-trial fields (strict schema)', async () => {
    const real = await (await fetchFromAllowlist()(`${BASE}data/evaluation/phase4.json`)).json()
    const leaky = { ...(real as object), per_trial_detail: [{ trial_id: 'x', fault_type: 'latency' }] }
    const fetchFn = vi.fn().mockResolvedValue(jsonResponse(leaky))
    const result = await loadEvaluation({ fetchFn, baseUrl: BASE })
    expect(result.ok).toBe(false)
  })
})

describe('historical bundle provenance', () => {
  it.each(['p4-held-04-latency-hop2-moderate', 'p4-held-01-clean1', 'p4-held-12-unknown-plus-impair'])(
    '%s: no evidence_status field, so the exposed status is derived by an explicit frontend rule',
    (id) => {
      const provenance = describeBundle(bundleSchema.parse(readRealBundle(id)))
      expect(provenance.evaluationStatus).toBe('exposed_holdout_not_independent')
      expect(provenance.statusSource).toBe('frontend-rule')
      expect(provenance.scopeUsesHistoricalWording).toBe(true)
      expect(provenance.claimsPresent).toBe(true)
    },
  )

  it('flags the demo bundle recording an absolute source path', () => {
    const provenance = describeBundle(bundleSchema.parse(readRealBundle('demo-run-01')))
    expect(provenance.sourceFileIsAbsolutePath).toBe(true)
  })

  it('uses the bundle field when present and never invents a status otherwise', () => {
    const base = structuredClone(readRealBundle('p4-held-04-latency-hop2-moderate')) as {
      evaluation: Record<string, unknown>
    }
    const withField = bundleSchema.parse({
      ...base,
      evaluation: { ...base.evaluation, evidence_status: 'exposed_holdout_not_independent', source_file: 'x.json' },
    })
    expect(describeBundle(withField)).toMatchObject({ statusSource: 'bundle-field', evaluationStatus: 'exposed_holdout_not_independent' })

    const otherFile = bundleSchema.parse({ ...base, evaluation: { ...base.evaluation, source_file: 'some_other_results.json' } })
    expect(describeBundle(otherFile)).toMatchObject({ evaluationStatus: 'unknown', statusSource: 'none' })

    const unrecognised = bundleSchema.parse({
      ...base,
      evaluation: { ...base.evaluation, evidence_status: 'independently_validated' },
    })
    expect(describeBundle(unrecognised).evaluationStatus).toBe('unknown')

    const { evaluation: _omitted, ...withoutEvaluation } = base as Record<string, unknown>
    void _omitted
    expect(describeBundle(bundleSchema.parse(withoutEvaluation))).toMatchObject({ evaluationStatus: 'unknown', statusSource: 'none' })
  })
})
