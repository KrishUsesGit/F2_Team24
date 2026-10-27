import { describeEvaluation, SPEC_TARGETS, type EvaluationView } from '../data/evaluationStatus.ts'
import { formatPercent, formatRatio } from '../data/format.ts'
import type { EvaluationPair } from '../data/loader.ts'
import type { Metric } from '../data/schema.ts'
import { Disclosure } from './primitives/Disclosure.tsx'
import { Sticker } from './primitives/Sticker.tsx'

function metricText(metric: Metric): string {
  return `${formatRatio(metric.numerator, metric.denominator)} = ${formatPercent(metric.rate)}`
}

function EvaluationCard({ view, trials }: { view: EvaluationView; trials: number }) {
  const exposed = view.evidenceClass === 'exposed'
  const titleId = `evaluation-${view.phase}-title`
  return (
    <Sticker as="article" tone="paper" className="flex h-full flex-col p-6" aria-labelledby={titleId}>
      <h3 id={titleId} className="font-display text-xl font-semibold">
        Phase {view.phase}: detector <span className="font-mono text-lg">{view.algorithm}</span>
      </h3>
      <p
        data-evidence-class={view.evidenceClass}
        className={`mt-3 inline-block self-start rounded-full border-[3px] border-ink px-4 py-1 text-sm font-bold ${
          exposed ? 'border-dashed bg-unknown' : view.falseAttributionTargetMet === false ? 'bg-degraded' : 'bg-healthy'
        }`}
      >
        {view.headline}
      </p>
      <p className="mt-3">{view.caveat}</p>

      <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
        <dt>False attribution</dt>
        <dd className="font-mono font-semibold">{metricText(view.falseAttribution)}</dd>
        <dt className="text-ink-soft">Specified target</dt>
        <dd className="font-mono text-ink-soft">at most {formatPercent(SPEC_TARGETS.falseAttributionMax)}</dd>
        <dt>Within one hop (localized trials)</dt>
        <dd className="font-mono font-semibold">{metricText(view.withinOneHop)}</dd>
        <dt>Clean-control false positives</dt>
        <dd className="font-mono font-semibold">{metricText(view.cleanControlFalsePositive)}</dd>
        <dt>Recall of injected faults</dt>
        <dd className="font-mono font-semibold">{metricText(view.recall)}</dd>
      </dl>
      <p className="mt-3 text-sm text-ink-soft">Out of {trials} trials. Small samples: treat every rate as rough.</p>

      <div className="mt-auto pt-4">
        <Disclosure summary="Configuration and limits">
          <p className="font-mono text-sm">{view.parameters}</p>
          {view.limitation ? <p className="mt-3 text-sm">{view.limitation}</p> : null}
        </Disclosure>
      </div>
    </Sticker>
  )
}

/**
 * Both stored evaluations, side by side. The algorithm names and parameters come
 * from the frozen configuration files (via the data layer), never from copy.
 */
export function EvaluationStatusPanel({ evaluation }: { evaluation: EvaluationPair }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <EvaluationCard view={describeEvaluation(evaluation.phase4)} trials={evaluation.phase4.n_trials} />
      <EvaluationCard view={describeEvaluation(evaluation.phase4b)} trials={evaluation.phase4b.n_trials} />
    </div>
  )
}
