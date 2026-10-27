import { describe, expect, it } from 'vitest'
import { bundleSchema, hopRangeSchema, manifestSchema } from './schema.ts'
import { EXPECTED_REAL_BUNDLES, readRealBundle, realBundleIds } from '../test/repo.ts'

describe('real presentation bundles', () => {
  it('are discovered through the allowlist', () => {
    for (const id of EXPECTED_REAL_BUNDLES) expect(realBundleIds()).toContain(id)
  })

  it.each(EXPECTED_REAL_BUNDLES)('%s validates against the bundle schema', (id) => {
    const parsed = bundleSchema.safeParse(readRealBundle(id))
    if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 5)))
    expect(parsed.data.trial_id).toBe(id)
    expect(parsed.data.hops).toHaveLength(5)
    expect(parsed.data.hops.map((hop) => hop.ttl)).toEqual([1, 2, 3, 4, 5])
  })

  it('covers the three result states that exist in real data (no real not_localized bundle exists)', () => {
    const states = new Set(
      EXPECTED_REAL_BUNDLES.map((id) => bundleSchema.parse(readRealBundle(id)).plain_language.result_state),
    )
    expect(states).toEqual(new Set(['localized', 'partially_localized', 'no_degradation']))
    expect(states.has('not_localized' as never)).toBe(false)
  })

  it('keeps fields it does not know about (loose objects)', () => {
    const raw = readRealBundle('p4-held-04-latency-hop2-moderate') as Record<string, unknown>
    const parsed = bundleSchema.parse({ ...raw, a_future_field: 42 }) as Record<string, unknown>
    expect(parsed['a_future_field']).toBe(42)
  })

  it('accepts historical bundles that lack evaluation.evidence_status', () => {
    const parsed = bundleSchema.parse(readRealBundle('p4-held-12-unknown-plus-impair'))
    expect(parsed.evaluation).toBeDefined()
    expect(parsed.evaluation?.evidence_status).toBeUndefined()
  })
})

describe('schema rejects malformed bundles', () => {
  const good = () => structuredClone(readRealBundle('p4-held-04-latency-hop2-moderate')) as Record<string, unknown>

  it('rejects a bundle with the wrong number of hops', () => {
    const bundle = good()
    bundle['hops'] = (bundle['hops'] as unknown[]).slice(0, 4)
    expect(bundleSchema.safeParse(bundle).success).toBe(false)
  })

  it('rejects an unknown result state', () => {
    const bundle = good()
    bundle['plain_language'] = { result_state: 'definitely_the_router', summary: 'x' }
    expect(bundleSchema.safeParse(bundle).success).toBe(false)
  })

  it('rejects an unknown hop status', () => {
    const bundle = good()
    const hops = bundle['hops'] as Record<string, unknown>[]
    bundle['hops'] = hops.map((hop, i) => (i === 0 ? { ...hop, status: 'broken' } : hop))
    expect(bundleSchema.safeParse(bundle).success).toBe(false)
  })

  it('rejects a missing required field and names the path', () => {
    const bundle = good()
    delete bundle['confidence']
    const result = bundleSchema.safeParse(bundle)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues.map((i) => i.path.join('.'))).toContain('confidence')
  })

  it('rejects an inverted hop range', () => {
    expect(hopRangeSchema.safeParse({ min: 4, max: 2 }).success).toBe(false)
    expect(hopRangeSchema.safeParse({ min: 3, max: 5 }).success).toBe(true)
  })

  it('rejects a manifest with the wrong schema version', () => {
    expect(manifestSchema.safeParse({ schema: 2, trials: [] }).success).toBe(false)
  })
})
