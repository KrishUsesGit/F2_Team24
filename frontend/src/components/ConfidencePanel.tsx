import { formatScore } from '../data/format.ts'
import type { Bundle } from '../data/schema.ts'
import { Sticker } from './primitives/Sticker.tsx'

/**
 * The stored confidence, with its limits stated beside it. The meter draws the
 * stored score; it does not turn it into a probability.
 */
export function ConfidencePanel({ bundle }: { bundle: Bundle }) {
  const { confidence } = bundle
  const factors = confidence.factors
  const percent = Math.max(0, Math.min(1, confidence.score)) * 100
  return (
    <Sticker as="article" tone="mint" className="h-full p-5 md:p-6" aria-labelledby="confidence-title">
      <h3 id="confidence-title" className="font-display text-xl font-semibold">
        Confidence and its limits
      </h3>
      <p className="mt-3 text-lg">
        Level: <strong data-testid="confidence-level">{confidence.level}</strong>
      </p>
      <div
        role="img"
        aria-label={`Stored heuristic score ${formatScore(confidence.score)} on a scale from 0 to 1`}
        className="mt-3 h-6 w-full overflow-hidden rounded-full border-[3px] border-ink bg-paper"
      >
        <div className="h-full border-r-[3px] border-ink bg-signal" style={{ width: `${percent}%` }} />
      </div>
      <p className="mt-1 font-mono text-sm">
        score {formatScore(confidence.score)} (heuristic, 0 to 1)
      </p>
      <p className="mt-4 font-semibold">
        This is a fixed heuristic based on how many hops were unknown. It is not a probability, it has not been
        calibrated, and it does not measure how strong the signal was.
      </p>
      <dl className="mt-4 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
        {factors.corroborating_hops ? (
          <>
            <dt>Corroborating hops</dt>
            <dd className="font-mono">{factors.corroborating_hops.join(', ') || 'none'}</dd>
          </>
        ) : null}
        {factors.unknown_hops ? (
          <>
            <dt>Unknown hops</dt>
            <dd className="font-mono">{factors.unknown_hops.join(', ') || 'none'}</dd>
          </>
        ) : null}
        {factors.completeness_fraction !== undefined ? (
          <>
            <dt>Completeness fraction</dt>
            <dd className="font-mono">{factors.completeness_fraction}</dd>
          </>
        ) : null}
      </dl>
      {factors.note ?? factors.reason ? <p className="mt-3 text-sm text-ink-soft">{factors.note ?? factors.reason}</p> : null}
    </Sticker>
  )
}
