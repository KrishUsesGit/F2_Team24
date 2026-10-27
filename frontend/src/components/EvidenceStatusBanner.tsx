import { describeEvaluation, SPEC_TARGETS } from '../data/evaluationStatus.ts'
import { formatPercent, formatRatio } from '../data/format.ts'
import type { EvaluationPair } from '../data/loader.ts'
import type { LoadState } from '../hooks/useLoad.ts'

/**
 * Always-visible statement of what the current evidence does and does not show.
 * The algorithm name and the Phase 4 figures are read from the data, so the
 * banner cannot drift from the frozen configuration.
 */
export function EvidenceStatusBanner({ evaluation }: { evaluation: LoadState<EvaluationPair> }) {
  return (
    <section
      aria-label="Evidence status"
      className="rounded-card border-[3px] border-dashed border-ink bg-unknown px-5 py-4 text-ink"
    >
      {evaluation.status === 'ready' ? <BannerText evaluation={evaluation.value} /> : null}
      {evaluation.status === 'loading' || evaluation.status === 'idle' ? (
        <p role="status">Loading the stored evaluation status…</p>
      ) : null}
      {evaluation.status === 'error' ? (
        <p role="alert">
          The stored evaluation status could not be loaded, so no validation claim is being made about the detector.
        </p>
      ) : null}
    </section>
  )
}

function BannerText({ evaluation }: { evaluation: EvaluationPair }) {
  const phase4 = describeEvaluation(evaluation.phase4)
  const phase4b = describeEvaluation(evaluation.phase4b)
  return (
    <p>
      <strong>Research prototype.</strong> The current detector, <span className="font-mono">{phase4b.algorithm}</span>{' '}
      ({phase4b.parameters}), has <strong>not been independently validated</strong>: its Phase 4b figures come from a
      held-out set that was inspected while it was designed. The independent Phase 4 run with{' '}
      <span className="font-mono">{phase4.algorithm}</span> missed the false-attribution target:{' '}
      {formatRatio(phase4.falseAttribution.numerator, phase4.falseAttribution.denominator)} ={' '}
      {formatPercent(phase4.falseAttribution.rate)} against at most {formatPercent(SPEC_TARGETS.falseAttributionMax)}.
    </p>
  )
}
