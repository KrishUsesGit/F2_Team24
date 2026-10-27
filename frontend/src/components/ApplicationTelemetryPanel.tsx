import { formatDuration, formatMs } from '../data/format.ts'
import type { Bundle } from '../data/schema.ts'
import { RttChart, type ChartMarker } from './RttChart.tsx'
import { Sticker } from './primitives/Sticker.tsx'

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-2xl border-[3px] border-ink bg-mint-50 px-4 py-3">
      <dt className="text-sm text-ink-soft">{label}</dt>
      <dd className="font-mono text-xl font-semibold">{value}</dd>
      {note ? <dd className="text-xs text-ink-soft">{note}</dd> : null}
    </div>
  )
}

/** What the application itself experienced: its own ping round-trip time. */
export function ApplicationTelemetryPanel({ bundle, markers }: { bundle: Bundle; markers: ChartMarker[] }) {
  const { app } = bundle
  const appOnset = app.onset_ns !== null
  return (
    <Sticker as="article" tone="paper" className="p-5 md:p-8" aria-labelledby="symptoms-card-title">
      <h3 id="symptoms-card-title" className="font-display text-xl font-semibold">
        What the application measured
      </h3>
      <p className="mt-2 max-w-2xl">
        {appOnset
          ? 'The application’s own ping round-trip time shifted during this trial. This is the symptom; where along the path it appears to begin is examined next.'
          : 'No onset was detected in the application’s own ping round-trip time during this trial. That is not proof that nothing was wrong.'}
      </p>
      <dl className="mt-5 grid gap-3 sm:grid-cols-3">
        <Stat label={appOnset ? 'Mean before onset' : 'Mean round-trip time'} value={formatMs(app.rtt_baseline_ms)} />
        <Stat label="Mean after onset" value={appOnset ? formatMs(app.rtt_observed_ms) : 'no onset'} />
        <Stat
          label="Ping samples"
          value={String(app.sample_count)}
          note={`over ${formatDuration(bundle.observation_window.duration_s)}`}
        />
      </dl>
      <div className="mt-6">
        <RttChart bundle={bundle} markers={markers} />
      </div>
    </Sticker>
  )
}
