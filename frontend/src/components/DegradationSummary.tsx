import type { Bundle, ResultState } from '../data/schema.ts'
import { Sticker, type Tone } from './primitives/Sticker.tsx'

const STATE_LABELS: Record<ResultState, { label: string; tone: Tone }> = {
  localized: { label: 'Localized with adequate evidence', tone: 'signal' },
  partially_localized: { label: 'Partially localized', tone: 'unknown' },
  not_localized: { label: 'Degradation detected, not reliably localized', tone: 'unknown' },
  no_degradation: { label: 'No significant degradation detected', tone: 'paper' },
}

/** Fixed cautions, owned by the interface: they limit what a state may be taken to mean. */
const STATE_CAUTIONS: Partial<Record<ResultState, string>> = {
  no_degradation: 'No onset detected does not prove that the network is healthy.',
  not_localized: 'The available evidence is insufficient to localize the degradation reliably.',
}

/** The plain-language interpretation, verbatim from the stored result. */
export function DegradationSummary({ bundle }: { bundle: Bundle }) {
  const state = STATE_LABELS[bundle.plain_language.result_state]
  const caution = STATE_CAUTIONS[bundle.plain_language.result_state]
  return (
    <Sticker as="article" tone="paper" className="relative p-6 md:p-10" aria-labelledby="result-heading">
      <h3 id="result-heading" className="sr-only">
        Result for trial {bundle.trial_id}
      </h3>
      <p
        data-testid="result-state"
        className={`inline-block rounded-full border-[3px] border-ink px-4 py-1 text-sm font-bold ${
          state.tone === 'signal' ? 'bg-signal' : state.tone === 'unknown' ? 'bg-unknown' : 'bg-mint-100'
        }`}
      >
        {state.label}
      </p>
      <p data-testid="plain-language" className="mt-5 max-w-4xl font-display text-2xl leading-tight font-semibold md:text-5xl">
        {bundle.plain_language.summary}
      </p>
      {caution ? <p className="mt-5 max-w-3xl text-lg font-semibold">{caution}</p> : null}
      {bundle.unknown_hops.length > 0 ? (
        <p className="mt-4 max-w-3xl text-ink-soft">
          Unknown hops (too few responses to evaluate; not assumed healthy):{' '}
          <strong className="text-ink">{bundle.unknown_hops.map((ttl) => `Hop ${ttl}`).join(', ')}</strong>.
        </p>
      ) : null}
    </Sticker>
  )
}
