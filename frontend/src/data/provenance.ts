/**
 * What the UI may say about how a bundle's evaluation block should be read.
 * This does not analyse measurements; it only interprets bundle metadata.
 *
 * Bundles generated before WP-1 are kept unchanged as historical artifacts:
 * they lack `evaluation.evidence_status`, carry the older "held-out
 * validation" scope text, and (for the demo run) an absolute source path.
 * For those, the status is derived by an explicit frontend rule and flagged as
 * such; anything not covered by the rule stays `unknown` (never invented).
 */
import type { Bundle } from './schema.ts'

export type EvaluationStatus = 'exposed_holdout_not_independent' | 'unknown'

export interface BundleProvenance {
  evaluationStatus: EvaluationStatus
  statusSource: 'bundle-field' | 'frontend-rule' | 'none'
  /** `evaluation.source_file` is an absolute filesystem path (historical demo bundle). */
  sourceFileIsAbsolutePath: boolean
  /** The bundle's own scope text still says "held-out validation" (pre-WP-1 wording). */
  scopeUsesHistoricalWording: boolean
  claimsPresent: boolean
}

const EXPOSED: EvaluationStatus = 'exposed_holdout_not_independent'

/** The only results file whose numbers are known (docs/EVIDENCE_LEDGER.md) to come from the exposed set. */
const EXPOSED_RESULT_FILES = new Set(['held_out_results_4b.json'])

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

export function describeBundle(bundle: Bundle): BundleProvenance {
  const claimsPresent = (bundle.evidence_record_claims?.length ?? 0) > 0
  const evaluation = bundle.evaluation
  if (!evaluation) {
    return {
      evaluationStatus: 'unknown',
      statusSource: 'none',
      sourceFileIsAbsolutePath: false,
      scopeUsesHistoricalWording: false,
      claimsPresent,
    }
  }

  const sourceFileIsAbsolutePath = /^([A-Za-z]:[\\/]|\/)/.test(evaluation.source_file)
  const scopeUsesHistoricalWording =
    evaluation.scope.includes('held-out validation') && !evaluation.scope.includes('EXPOSED')

  if (evaluation.evidence_status !== undefined) {
    return {
      evaluationStatus: evaluation.evidence_status === EXPOSED ? EXPOSED : 'unknown',
      statusSource: 'bundle-field',
      sourceFileIsAbsolutePath,
      scopeUsesHistoricalWording,
      claimsPresent,
    }
  }

  const derived = EXPOSED_RESULT_FILES.has(basename(evaluation.source_file))
  return {
    evaluationStatus: derived ? EXPOSED : 'unknown',
    statusSource: derived ? 'frontend-rule' : 'none',
    sourceFileIsAbsolutePath,
    scopeUsesHistoricalWording,
    claimsPresent,
  }
}
