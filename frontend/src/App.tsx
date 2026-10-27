import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { MotionConfig, motion } from 'motion/react'
import { loadBundle, loadEvaluation, loadManifest } from './data/loader.ts'
import type { Bundle } from './data/schema.ts'
import { boundaryHop, defaultSelectedHop } from './data/select.ts'
import { useLoad } from './hooks/useLoad.ts'
import { usePrefersReducedMotion } from './hooks/usePrefersReducedMotion.ts'
import { AppShell } from './components/AppShell.tsx'
import { ApplicationTelemetryPanel } from './components/ApplicationTelemetryPanel.tsx'
import { ConfidencePanel } from './components/ConfidencePanel.tsx'
import { DegradationSummary } from './components/DegradationSummary.tsx'
import { EvaluationStatusPanel } from './components/EvaluationStatusPanel.tsx'
import { GuidedExplanation } from './components/GuidedExplanation.tsx'
import { EvidencePanel } from './components/EvidencePanel.tsx'
import { EvidenceStatusBanner } from './components/EvidenceStatusBanner.tsx'
import { HopInspector } from './components/HopInspector.tsx'
import { LimitationsPanel } from './components/LimitationsPanel.tsx'
import { NetworkPath } from './components/NetworkPath.tsx'
import type { ChartMarker } from './components/RttChart.tsx'
import { Reveal } from './components/Reveal.tsx'
import { ScrollProgress } from './components/ScrollProgress.tsx'
import { Pill } from './components/primitives/Pill.tsx'
import { ErrorPanel, LoadingPanel } from './components/StatePanels.tsx'
import { TechnicalDetails } from './components/TechnicalDetails.tsx'
import { TrialPicker } from './components/TrialPicker.tsx'

function initialTrialFromUrl(): string | null {
  return new URLSearchParams(window.location.search).get('trial')
}

function rememberTrialInUrl(id: string): void {
  const url = new URL(window.location.href)
  url.searchParams.set('trial', id)
  window.history.replaceState(null, '', url)
}

/** Hop onsets that the stored result treats as corroborated, for the chart's markers. */
function hopMarkers(bundle: Bundle): ChartMarker[] {
  return bundle.hops.flatMap((hop) =>
    hop.status === 'degraded' && hop.onset_ns !== null
      ? [{ label: `Hop ${hop.ttl} onset`, ns: hop.onset_ns, tone: 'hop' as const }]
      : [],
  )
}

function SectionHeading({ id, title, children }: { id: string; title: string; children?: ReactNode }) {
  return (
    <div className="mb-8 max-w-3xl">
      <h2 id={id} className="font-display text-3xl leading-tight font-bold md:text-5xl">
        {title}
      </h2>
      {children ? <p className="mt-3 text-lg">{children}</p> : null}
    </div>
  )
}

function TrialView({
  bundle,
  loaded,
  guided,
}: {
  bundle: Bundle
  loaded: Parameters<typeof TechnicalDetails>[0]['loaded']
  guided: boolean
}) {
  const [chosenTtl, setChosenTtl] = useState<number | null>(null)
  const selectedTtl = chosenTtl ?? defaultSelectedHop(bundle)
  const boundary = boundaryHop(bundle)

  return (
    <div className="space-y-24">
      <section id="summary" aria-labelledby="summary-heading" className="scroll-mt-6">
        <h2 id="summary-heading" className="sr-only">
          Result for this trial
        </h2>
        <DegradationSummary bundle={bundle} />
      </section>

      {guided ? <GuidedExplanation bundle={bundle} /> : null}

      <Reveal>
        <section id="symptoms" aria-labelledby="symptoms-heading" className="scroll-mt-6">
          <SectionHeading
            id="symptoms-heading"
            title={bundle.app.onset_ns !== null ? 'First, the symptom' : 'First, what the application measured'}
          >
            {bundle.app.onset_ns !== null
              ? 'The application noticed something. Here is exactly what it measured.'
              : 'No change was detected in the application’s own round-trip time. Here is exactly what it measured.'}
          </SectionHeading>
          <ApplicationTelemetryPanel bundle={bundle} markers={hopMarkers(bundle)} />
        </section>
      </Reveal>

      <section id="path" aria-labelledby="path-heading" className="scroll-mt-6">
        <SectionHeading id="path-heading" title="Then, the path">
          Select a hop to see what was measured there. Statuses come from the stored result; the browser computes
          nothing.
        </SectionHeading>
        <NetworkPath bundle={bundle} selectedTtl={selectedTtl} onSelect={setChosenTtl} />
        <div className="mt-10">
          <HopInspector bundle={bundle} ttl={selectedTtl} />
        </div>
      </section>

      <Reveal>
        <section id="boundary" aria-labelledby="boundary-heading" className="scroll-mt-6">
          <SectionHeading id="boundary-heading" title="Where it appears to begin" />
          <p data-testid="boundary-statement" className="max-w-3xl font-display text-2xl leading-snug font-semibold md:text-4xl">
            {boundary !== null
              ? `Degradation appears to begin at or after Hop ${boundary}.`
              : 'The stored result does not name a hop where degradation appears to begin.'}
          </p>
          <p className="mt-4 max-w-3xl">
            {boundary !== null
              ? 'This is the earliest hop whose onset is corroborated in the stored data. It is a statement about when changes were observed, not a finding about the reason for them.'
              : 'The hop statuses above show what each hop’s own data recorded. Statuses describe when changes were observed, not the reason for them.'}
          </p>
        </section>
      </Reveal>

      <Reveal>
        <section id="evidence" aria-labelledby="evidence-heading" className="scroll-mt-6">
          <SectionHeading id="evidence-heading" title="The evidence, kept apart by kind">
            Measurement, inference, correlation and what is unknown are shown separately on purpose.
          </SectionHeading>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <EvidencePanel bundle={bundle} />
            <ConfidencePanel bundle={bundle} />
          </div>
          <div className="mt-8">
            <TechnicalDetails loaded={loaded} />
          </div>
        </section>
      </Reveal>
    </div>
  )
}

export default function App() {
  // Reduced motion: render the final state immediately, no entrance animation.
  const reduceMotion = usePrefersReducedMotion()
  const [reloadToken, setReloadToken] = useState(0)
  const retry = useCallback(() => setReloadToken((value) => value + 1), [])

  const loadManifestFn = useCallback((signal: AbortSignal) => loadManifest({ signal }), [])
  const loadEvaluationFn = useCallback((signal: AbortSignal) => loadEvaluation({ signal }), [])
  const manifest = useLoad(loadManifestFn, reloadToken)
  const evaluation = useLoad(loadEvaluationFn, reloadToken)

  const ids = useMemo(() => (manifest.status === 'ready' ? manifest.value.trials.map((t) => t.id) : []), [manifest])
  const [guided, setGuided] = useState(false)
  const [chosenId, setChosenId] = useState<string | null>(initialTrialFromUrl)
  const selectedId = chosenId !== null && ids.includes(chosenId) ? chosenId : (ids[0] ?? null)

  useEffect(() => {
    if (selectedId !== null) rememberTrialInUrl(selectedId)
  }, [selectedId])

  const loadBundleFn = useMemo(
    () => (selectedId === null ? null : (signal: AbortSignal) => loadBundle(selectedId, { signal })),
    [selectedId],
  )
  const bundle = useLoad(loadBundleFn, reloadToken)

  return (
    <MotionConfig reducedMotion="user">
      <ScrollProgress />
      <AppShell>
        <EvidenceStatusBanner evaluation={evaluation} />

        <motion.section
          aria-labelledby="hero-heading"
          className="grid items-end gap-10 py-14 md:py-24 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]"
          initial={reduceMotion ? false : { opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <div>
            <h1
              id="hero-heading"
              className="font-display text-4xl leading-[1.02] font-extrabold tracking-tight sm:text-6xl lg:text-7xl"
            >
              Don&apos;t just detect lag. Find where the degradation begins.
            </h1>
            <p className="mt-6 max-w-xl text-lg md:text-xl">
              HOPTRACE estimates where along an observed network path an application&apos;s degradation appears to
              begin. It reports evidence and its limits, not causes.
            </p>
          </div>
          <div id="trial" className="scroll-mt-6 lg:pb-3">
            <h2 id="trial-heading" className="font-display text-xl font-bold">
              Pick a recorded trial
            </h2>
            <p className="mt-2 text-sm text-ink-soft">
              Each button loads one stored presentation bundle from the project&apos;s own experiments.
            </p>
            <div className="mt-4">
              {manifest.status === 'loading' ? <LoadingPanel label="Loading the list of trials…" /> : null}
              {manifest.status === 'error' ? <ErrorPanel error={manifest.error} onRetry={retry} /> : null}
              {manifest.status === 'ready' ? (
                <TrialPicker ids={ids} selectedId={selectedId} onSelect={setChosenId} />
              ) : null}
            </div>
            <div className="mt-5">
              <Pill pressed={guided} onClick={() => setGuided((value) => !value)}>
                Guided explanation{' '}
                <span aria-hidden="true" className="font-mono text-sm">
                  {guided ? 'On' : 'Off'}
                </span>
              </Pill>
            </div>
          </div>
        </motion.section>

        <div aria-live="polite" className="min-h-24">
          {bundle.status === 'loading' ? <LoadingPanel label="Loading the trial…" /> : null}
          {bundle.status === 'error' ? <ErrorPanel error={bundle.error} onRetry={retry} /> : null}
          {bundle.status === 'ready' ? (
            <TrialView key={bundle.value.bundle.trial_id} bundle={bundle.value.bundle} loaded={bundle.value} guided={guided} />
          ) : null}
        </div>

        <section id="evaluation" aria-labelledby="evaluation-heading" className="mt-24 scroll-mt-6">
          <SectionHeading id="evaluation-heading" title="What the stored evaluation shows">
            Read unchanged from the project&apos;s frozen configuration and result files. Neither result is an
            independent validation of the current detector.
          </SectionHeading>
          {evaluation.status === 'loading' ? <LoadingPanel label="Loading the stored evaluation…" /> : null}
          {evaluation.status === 'error' ? <ErrorPanel error={evaluation.error} onRetry={retry} /> : null}
          {evaluation.status === 'ready' ? <EvaluationStatusPanel evaluation={evaluation.value} /> : null}
        </section>

        <section id="limitations" aria-labelledby="limitations-heading" className="mt-24 scroll-mt-6">
          <SectionHeading id="limitations-heading" title="What this system cannot yet do" />
          <LimitationsPanel />
        </section>
      </AppShell>
    </MotionConfig>
  )
}
