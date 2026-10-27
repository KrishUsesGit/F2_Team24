import { formatMs } from '../data/format.ts'
import type { Bundle } from '../data/schema.ts'
import { factsForHop, secondsIntoWindow, TESTBED_ROLES, unknownClaim } from '../data/select.ts'
import { Disclosure } from './primitives/Disclosure.tsx'
import { Sticker } from './primitives/Sticker.tsx'
import { StatusBadge } from './primitives/StatusBadge.tsx'

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="font-mono text-sm font-semibold">{children}</dd>
    </>
  )
}

/** The evidence the bundle holds for ONE hop, separated by kind. */
export function HopInspector({ bundle, ttl }: { bundle: Bundle; ttl: number }) {
  const hop = bundle.hops.find((candidate) => candidate.ttl === ttl)
  if (!hop) return null

  const hopOnset = secondsIntoWindow(hop.onset_ns, bundle)
  const appOnset = secondsIntoWindow(bundle.app.onset_ns, bundle)
  const facts = factsForHop(bundle, ttl)
  const unknown = hop.status === 'unknown' ? unknownClaim(bundle) : undefined
  const role = TESTBED_ROLES[ttl]

  return (
    <Sticker as="aside" tone="paper" className="p-5 md:p-6" aria-labelledby="inspector-title">
      <p className="sr-only" role="status" aria-live="polite">
        Showing evidence for Hop {ttl}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="inspector-title" className="font-display text-2xl font-bold">
          Hop {ttl}
        </h3>
        <StatusBadge status={hop.status} />
      </div>
      <p className="mt-1 font-mono text-sm break-all">
        {hop.all_ips.length > 0 ? hop.all_ips.join(', ') : 'No response observed'}
        {role ? <span className="font-sans text-ink-soft"> ({role} in this testbed)</span> : null}
      </p>

      <div className="mt-5 grid gap-x-10 gap-y-5 lg:grid-cols-3">
      <section aria-labelledby="inspector-measured">
        <h4 id="inspector-measured" className="font-display text-sm font-semibold">
          Measured
        </h4>
        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
          <Row label={hop.rtt_observed_ms === null ? 'Mean round-trip time' : 'Mean before this hop’s onset'}>
            {formatMs(hop.rtt_baseline_ms)}
          </Row>
          {hop.rtt_observed_ms !== null ? (
            <Row label="Mean after this hop’s onset">{formatMs(hop.rtt_observed_ms)}</Row>
          ) : null}
          <Row label="Probe samples">{hop.sample_count}</Row>
          <Row label="Onset in this hop’s series">
            {hopOnset === null ? 'none recorded' : `+${hopOnset.toFixed(1)} s`}
          </Row>
          <Row label="Application onset">{appOnset === null ? 'none recorded' : `+${appOnset.toFixed(1)} s`}</Row>
        </dl>
        <p className="mt-2 text-xs text-ink-soft">Times are seconds into the observation window, from stored timestamps.</p>
      </section>

      <section aria-labelledby="inspector-says">
        <h4 id="inspector-says" className="font-display text-sm font-semibold">
          What the stored evidence says
        </h4>
        <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
          {hop.why_highlighted.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {hop.status === 'healthy' && hop.onset_ns !== null ? (
          <p className="mt-2 text-sm">
            An onset was recorded in this hop&apos;s own series, but it was not corroborated by the application
            onset and downstream hops, so it is not treated as the start of the degradation.
          </p>
        ) : null}
        {unknown ? <p className="mt-2 text-sm">{unknown.text}</p> : null}
      </section>

      {facts.length > 0 ? (
        <section aria-labelledby="inspector-facts">
          <h4 id="inspector-facts" className="font-display text-sm font-semibold">
            Measured facts recorded for this hop
          </h4>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {facts.map((claim) => (
              <li key={claim.text}>{claim.text}</li>
            ))}
          </ul>
        </section>
      ) : null}
      </div>

      <div className="mt-5">
        <Disclosure summary="Stored hop record">
          <pre
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- scrollable region must be keyboard reachable
            tabIndex={0}
            role="region"
            aria-label="Stored hop record (JSON)"
            className="overflow-x-auto rounded-xl border-[3px] border-ink bg-mint-50 p-3 font-mono text-xs">
            {JSON.stringify(hop, null, 2)}
          </pre>
        </Disclosure>
      </div>
    </Sticker>
  )
}
