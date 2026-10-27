import { formatMs } from '../data/format.ts'
import type { Bundle } from '../data/schema.ts'
import { claimsByTag } from '../data/select.ts'
import { Disclosure } from './primitives/Disclosure.tsx'
import { Sticker, type Tone } from './primitives/Sticker.tsx'

function Group({
  id,
  tone,
  title,
  lead,
  children,
}: {
  id: string
  tone: Tone
  title: string
  lead: string
  children: React.ReactNode
}) {
  return (
    <Sticker as="article" tone={tone} className="h-full p-5" aria-labelledby={id}>
      <h3 id={id} className="font-display text-base font-bold">
        {title}
      </h3>
      <p className="mt-1 text-sm text-ink-soft">{lead}</p>
      <div className="mt-3">{children}</div>
    </Sticker>
  )
}

/**
 * The stored evidence record, kept apart by kind so measurement, inference,
 * association and ignorance are never blurred together.
 */
export function EvidencePanel({ bundle }: { bundle: Bundle }) {
  const grouped = claimsByTag(bundle)
  const hasClaims = (bundle.evidence_record_claims?.length ?? 0) > 0
  if (!hasClaims) {
    return <p className="font-semibold">This bundle contains no evidence claims.</p>
  }
  return (
    <div className="grid gap-5 md:grid-cols-2">
      <Group id="ev-facts" tone="paper" title="Measured facts" lead="Observations recorded from the data. No interpretation.">
        <Disclosure summary={`Show ${grouped.fact.length} recorded facts`}>
          <ul className="list-disc space-y-1 pl-5 text-sm">
            {grouped.fact.map((claim) => (
              <li key={claim.text}>{claim.text}</li>
            ))}
          </ul>
        </Disclosure>
      </Group>

      <Group id="ev-inference" tone="paper" title="Inference" lead="What the evidence is consistent with. Not a measurement.">
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {grouped.inference.map((claim) => (
            <li key={claim.text}>{claim.text}</li>
          ))}
        </ul>
      </Group>

      <Group
        id="ev-correlation"
        tone="paper"
        title="Temporal correlation"
        lead="How the timing of the application and path changes relate. An association, never a cause."
      >
        <ul className="space-y-2 text-sm">
          {grouped.correlation.map((claim) => (
            <li key={claim.text}>
              {claim.text}
              {claim.lag_ms !== null ? (
                <span className="mt-1 block font-mono">
                  Application onset minus hop onset: {claim.lag_ms} ms (onsets have 500 ms resolution)
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </Group>

      <Group
        id="ev-unknown"
        tone="unknown"
        title="Unknown"
        lead="Observations that are missing. They are reported as unknown, not assumed healthy."
      >
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {grouped.unknown.map((claim) => (
            <li key={claim.text}>{claim.text}</li>
          ))}
        </ul>
        <p className="mt-2 text-xs">
          Application ping baseline for reference: {formatMs(bundle.app.rtt_baseline_ms)}.
        </p>
      </Group>
    </div>
  )
}
