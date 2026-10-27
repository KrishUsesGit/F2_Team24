import { formatDuration } from '../data/format.ts'
import type { LoadedBundle } from '../data/loader.ts'
import { Disclosure } from './primitives/Disclosure.tsx'

/** Everything else the bundle records, for reviewers; collapsed so it never crowds the story. */
export function TechnicalDetails({ loaded }: { loaded: LoadedBundle }) {
  const { bundle, provenance } = loaded
  const range = bundle.hop_range
  return (
    <Disclosure summary="Technical details of this bundle">
      <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        <dt className="font-semibold">Trial</dt>
        <dd className="font-mono break-all">{bundle.trial_id}</dd>
        <dt className="font-semibold">Hop range reported</dt>
        <dd className="font-mono">{range ? `Hop ${range.min} to Hop ${range.max}` : 'none'}</dd>
        <dt className="font-semibold">Application onset minus hop onset</dt>
        <dd className="font-mono">{bundle.alignment_delta_ms === null ? 'n/a' : `${bundle.alignment_delta_ms} ms`}</dd>
        <dt className="font-semibold">Observation window</dt>
        <dd className="font-mono">{formatDuration(bundle.observation_window.duration_s)}</dd>
        <dt className="font-semibold">Evidence claims</dt>
        <dd className="font-mono">{bundle.evidence_record_claims?.length ?? 0}</dd>
        {bundle.evaluation ? (
          <>
            <dt className="font-semibold">Evaluation block source</dt>
            <dd className="font-mono break-all">{bundle.evaluation.source_file}</dd>
            <dt className="font-semibold">Evaluation scope text in this bundle</dt>
            <dd>{bundle.evaluation.scope}</dd>
          </>
        ) : null}
      </dl>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-sm">
        {provenance.statusSource === 'frontend-rule' ? (
          <li>
            This is a historical bundle without an evidence-status field. The interface treats its evaluation numbers
            as coming from an exposed set because they were read from the Phase 4b results file.
          </li>
        ) : null}
        {provenance.scopeUsesHistoricalWording ? (
          <li>
            The bundle&apos;s own scope text still says &quot;held-out validation&quot;. That wording predates the
            exposed-set labelling and is kept unchanged as a historical record.
          </li>
        ) : null}
        {!provenance.claimsPresent ? <li>This bundle contains no evidence claims.</li> : null}
      </ul>
    </Disclosure>
  )
}
