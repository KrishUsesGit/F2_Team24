import { describe, expect, it } from 'vitest'
import { describeEvaluation, SPEC_TARGETS } from './evaluationStatus.ts'
import { evaluationProjectionSchema } from './schema.ts'
import { buildEvaluationProjection } from '../../vite/dataAllowlist.ts'
import { REPO_ROOT } from '../test/repo.ts'

const project = (phase: '4' | '4b') => evaluationProjectionSchema.parse(buildEvaluationProjection(REPO_ROOT, phase))

describe('Phase 4 (mad): independent run that missed its target', () => {
  const view = describeEvaluation(project('4'))
  it('shows the stored false-attribution figure and the unmet target', () => {
    expect(view.algorithm).toBe('mad')
    expect(view.evidenceClass).toBe('independent')
    expect(view.falseAttribution).toMatchObject({ numerator: 3, denominator: 12, rate: 0.25 })
    expect(SPEC_TARGETS.falseAttributionMax).toBe(0.1)
    expect(view.falseAttributionTargetMet).toBe(false)
    expect(view.headline).toMatch(/not met/i)
  })
})

describe('Phase 4b (mad_sustained): exposed set, not independent validation', () => {
  const view = describeEvaluation(project('4b'))
  it('is labelled exposed and never as independent or validated', () => {
    expect(view.algorithm).toBe('mad_sustained')
    expect(view.parameters).toBe('k_mad=5, min_run=3')
    expect(view.evidenceClass).toBe('exposed')
    expect(view.headline).toMatch(/exposed set/i)
    expect(view.caveat).toMatch(/not independent validation/i)
    expect(`${view.headline} ${view.caveat}`).not.toMatch(/\bpassed\b|\bvalidated\b/i)
  })
  it('carries the disclosed unresolved loss/bandwidth limitation from the frozen configuration', () => {
    expect(view.limitation).toMatch(/loss and bandwidth/i)
  })
})
