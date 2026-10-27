/**
 * How each stored evaluation result may be presented. The numbers come
 * verbatim from the files; the evidence classification mirrors
 * docs/EVIDENCE_LEDGER.md and is keyed by phase:
 *
 *   Phase 4   the original held-out run: independent at the time, gate NOT met.
 *   Phase 4b  the revised detector scored on the same set after its traces had
 *             been inspected during design: EXPOSED, not independent validation.
 */
import type { EvaluationProjection, Metric } from './schema.ts'

/** Locked-specification gate thresholds (hoptrace-phase-0-5-spec.html, section 10; provisional there). */
export const SPEC_TARGETS = { falseAttributionMax: 0.1, withinOneHopMin: 0.8 } as const

export type EvidenceClass = 'independent' | 'exposed'

export interface EvaluationView {
  phase: '4' | '4b'
  algorithm: string
  parameters: string
  evidenceClass: EvidenceClass
  falseAttribution: Metric
  withinOneHop: Metric
  cleanControlFalsePositive: Metric
  recall: Metric
  falseAttributionTargetMet: boolean | null
  headline: string
  caveat: string
  limitation: string | null
}

function formatParameters(params: Record<string, number>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${value}`)
    .join(', ')
}

export function describeEvaluation(projection: EvaluationProjection): EvaluationView {
  const evidenceClass: EvidenceClass = projection.phase === '4' ? 'independent' : 'exposed'
  const fa = projection.metrics.false_attribution_rate

  let targetMet: boolean | null
  if (projection.gate_check) {
    targetMet = projection.gate_check.false_attribution_rate_pass
  } else {
    targetMet = fa.rate === null ? null : fa.rate <= SPEC_TARGETS.falseAttributionMax
  }

  let headline: string
  let caveat: string
  if (evidenceClass === 'independent') {
    headline = targetMet === false ? 'False-attribution target not met' : 'False-attribution target met'
    caveat = 'Independent held-out run, scored before any retuning.'
  } else {
    headline =
      targetMet === false
        ? 'Numeric thresholds not met on an exposed set'
        : 'Numeric thresholds met on an exposed set'
    caveat =
      'Scored on the same trials after their traces had been inspected while the detector variants were designed. A historical record, not independent validation.'
  }

  return {
    phase: projection.phase,
    algorithm: projection.algorithm,
    parameters: formatParameters(projection.algorithm_params),
    evidenceClass,
    falseAttribution: fa,
    withinOneHop: projection.metrics.within_1_hop_accuracy,
    cleanControlFalsePositive: projection.metrics.clean_control_false_positive_rate,
    recall: projection.metrics.detection_recall,
    falseAttributionTargetMet: targetMet,
    headline,
    caveat,
    limitation: projection.known_unresolved_limitation ?? null,
  }
}
