/**
 * Plain-language explanation of ONE stored bundle, assembled from its own
 * fields. Nothing is detected, scored or aligned here: every number and every
 * hop named below is read from the bundle, and the wording stays
 * evidence-bounded (association, not cause; unknown, not healthy).
 */
import { formatDuration, formatMs, formatScore } from '../data/format.ts'
import type { Bundle } from '../data/schema.ts'
import { boundaryHop, claimsByTag, secondsIntoWindow } from '../data/select.ts'

export interface ExplanationStep {
  id: 'symptom' | 'hops' | 'inference' | 'confidence' | 'limits'
  title: string
  /** Page section the step refers to. */
  target: string
  paragraphs: string[]
}

const secs = (value: number | null) => (value === null ? 'n/a' : `+${value.toFixed(1)} s`)

function hopList(ttls: number[]): string {
  const names = ttls.map((ttl) => `Hop ${ttl}`)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`
}

export function buildExplanation(bundle: Bundle): ExplanationStep[] {
  const { app, hops } = bundle
  const appSeconds = secondsIntoWindow(app.onset_ns, bundle)
  const claims = claimsByTag(bundle)

  const symptom =
    app.onset_ns !== null
      ? [
          `The application's own ping round-trip time changed at ${secs(appSeconds)} into a ${formatDuration(bundle.observation_window.duration_s)} observation window. The mean was ${formatMs(app.rtt_baseline_ms)} before that point and ${formatMs(app.rtt_observed_ms)} after it, over ${app.sample_count} pings.`,
          'This is the symptom the application experienced. It does not say where on the path the change starts.',
        ]
      : [
          `No onset was detected in the application's own round-trip time (mean ${formatMs(app.rtt_baseline_ms)} over ${app.sample_count} pings).`,
          'That is not proof that nothing was wrong: a fault that covers most of the window, or too little data, can also produce no onset.',
        ]

  const corroborated = hops.filter((hop) => hop.status === 'degraded')
  const unknown = hops.filter((hop) => hop.status === 'unknown')
  const quiet = hops.filter((hop) => hop.status === 'healthy')
  const isolated = quiet.filter((hop) => hop.onset_ns !== null)
  const hopParagraphs: string[] = []
  if (corroborated.length > 0) {
    hopParagraphs.push(
      `${hopList(corroborated.map((h) => h.ttl))} carry an onset in their own probe data that was corroborated against the application's onset: ${corroborated
        .map((h) => `Hop ${h.ttl} at ${secs(secondsIntoWindow(h.onset_ns, bundle))}`)
        .join(', ')}. This is a statement about when changes were observed, not a finding about the reason for them.`,
    )
  } else {
    hopParagraphs.push('No hop carries a corroborated onset in this trial.')
  }
  if (quiet.length > 0) {
    hopParagraphs.push(`${hopList(quiet.map((h) => h.ttl))} show no corroborated onset. That is not proof that they were healthy.`)
  }
  if (isolated.length > 0) {
    hopParagraphs.push(
      `${hopList(isolated.map((h) => h.ttl))} recorded an onset on its own that nothing else corroborated, so it is not treated as where degradation begins.`,
    )
  }
  if (unknown.length > 0) {
    hopParagraphs.push(
      `${hopList(unknown.map((h) => h.ttl))} did not respond to enough probes to evaluate. They are reported as unknown, not as healthy.`,
    )
  }

  const boundary = boundaryHop(bundle)
  const inference = [`Stored result: "${bundle.plain_language.summary}"`]
  for (const claim of claims.inference) inference.push(claim.text)
  if (boundary === null && bundle.hop_range) {
    inference.push(
      `The stored hop range is Hop ${bundle.hop_range.min} to Hop ${bundle.hop_range.max}, but the result is reported as uncertain, so no single hop is named.`,
    )
  }
  for (const claim of claims.correlation) {
    inference.push(
      `${claim.text}${claim.lag_ms !== null ? ` Application onset minus hop onset: ${claim.lag_ms} ms (onsets have 500 ms resolution).` : ''}`,
    )
  }

  const { confidence } = bundle
  const confidenceText = [
    `Stored confidence: ${confidence.level} (score ${formatScore(confidence.score)} on a 0 to 1 scale).`,
    `This is a fixed, uncalibrated heuristic based on how many hops were unknown (${bundle.unknown_hops.length === 0 ? 'none in this trial' : hopList(bundle.unknown_hops) + ' in this trial'}). It is not a probability and does not measure how strong the signal was.`,
  ]

  const limits = [
    'Correlation is not causation: a hop whose onset lines up in time with the application’s is evidence about timing only.',
    'Missing or unresponsive hops are unknown, not healthy, and "no onset" is not proof of health.',
    'The current detector has not been independently validated. See the evidence status banner and the stored evaluation below.',
  ]

  return [
    {
      id: 'symptom',
      title: app.onset_ns !== null ? 'The symptom the application saw' : 'What the application measured',
      target: '#symptoms',
      paragraphs: symptom,
    },
    { id: 'hops', title: 'What each hop shows', target: '#path', paragraphs: hopParagraphs },
    { id: 'inference', title: 'What the stored result infers', target: '#boundary', paragraphs: inference },
    { id: 'confidence', title: 'How far to trust it', target: '#evidence', paragraphs: confidenceText },
    { id: 'limits', title: 'What this does not show', target: '#evaluation', paragraphs: limits },
  ]
}
