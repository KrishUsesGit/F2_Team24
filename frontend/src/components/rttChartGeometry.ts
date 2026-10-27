import type { Bundle } from '../data/schema.ts'

export interface ChartMarker {
  label: string
  ns: number
  tone: 'application' | 'hop'
}

export const CHART = { width: 760, plotHeight: 216, left: 62, right: 14, bottom: 40 } as const

export interface PlottedSample {
  seq: number
  seconds: number
  /** The stored value, untouched. */
  rtt_ms: number
  x: number
  y: number
}

export interface MarkerGroup {
  key: string
  label: string
  tone: ChartMarker['tone']
  seconds: number
  x: number
  labelY: number
  anchor: 'start' | 'end'
}

const LABEL_ROW = 18
/** Extra log-axis room above the highest value, as a share of the data's own log span. */
const HEADROOM_SHARE = 0.2
const MIN_HEADROOM_DECADES = 0.15

/** "Hop 3 onset" + "Hop 4 onset" at one instant become one label, "Hops 3, 4 onset". */
function joinLabels(labels: string[]): string {
  const hops = labels.map((label) => /^Hop (\d+) onset$/.exec(label)?.[1])
  if (labels.length > 1 && hops.every((hop) => hop !== undefined)) return `Hops ${hops.join(', ')} onset`
  return labels.join(', ')
}

/**
 * Pure geometry for the application RTT chart. Every value shown comes from the
 * bundle; the stored samples are only mapped to coordinates, never changed,
 * capped or filtered other than for what a logarithmic axis cannot show.
 */
export function buildRttChart(bundle: Bundle, markers: ChartMarker[]) {
  const samples = bundle.app.timeline
  const start = bundle.observation_window.t_start_ns ?? samples[0]?.t_send_mono_ns ?? 0
  const secondsOf = (ns: number) => (ns - start) / 1e9
  const lastX = Math.max(bundle.observation_window.duration_s ?? 0, ...samples.map((s) => secondsOf(s.t_send_mono_ns)), 1)

  const base = bundle.app.rtt_baseline_ms
  const observed = bundle.app.rtt_observed_ms

  // A log axis can show positive, finite values only. Missing responses and
  // non-positive values are not plotted (and not invented); the latter are counted.
  const isPlottable = (s: (typeof samples)[number]) => s.responded && s.rtt_ms !== null && Number.isFinite(s.rtt_ms) && s.rtt_ms > 0
  const nonPositive = samples.filter((s) => s.responded && s.rtt_ms !== null && Number.isFinite(s.rtt_ms) && s.rtt_ms <= 0).length
  const missing = samples.filter((s) => !s.responded)

  const positive = (v: number | null): v is number => v !== null && Number.isFinite(v) && v > 0
  const values = samples.filter(isPlottable).map((s) => s.rtt_ms as number)
  const candidates = [...values, ...[base, observed].filter(positive), 1]
  const minValue = Math.min(...candidates)
  const maxValue = Math.max(...candidates)

  const loExp = Math.floor(Math.log10(minValue))
  const loLog = loExp
  const maxLog = Math.log10(maxValue)
  const span = Math.max(maxLog - loLog, 1)
  const hiLog = maxLog + Math.max(span * HEADROOM_SHARE, MIN_HEADROOM_DECADES)

  const groupsSource = new Map<number, ChartMarker[]>()
  for (const marker of markers) {
    const seconds = secondsOf(marker.ns)
    if (seconds < 0 || seconds > lastX) continue
    groupsSource.set(marker.ns, [...(groupsSource.get(marker.ns) ?? []), marker])
  }
  const ordered = [...groupsSource.entries()].sort((a, b) => a[0] - b[0])

  const top = 20 + Math.max(ordered.length, 1) * LABEL_ROW
  const height = top + CHART.plotHeight + CHART.bottom
  const plot = { left: CHART.left, right: CHART.width - CHART.right, top, bottom: top + CHART.plotHeight }

  const x = (seconds: number) => plot.left + (seconds / lastX) * (plot.right - plot.left)
  const y = (ms: number) => plot.top + (1 - (Math.log10(ms) - loLog) / (hiLog - loLog)) * CHART.plotHeight

  const points: PlottedSample[] = samples.filter(isPlottable).map((s) => {
    const seconds = secondsOf(s.t_send_mono_ns)
    return { seq: s.seq, seconds, rtt_ms: s.rtt_ms as number, x: x(seconds), y: y(s.rtt_ms as number) }
  })

  // A gap in the responses breaks the line rather than being bridged.
  let path = ''
  let previousSeq: number | null = null
  const ordinal = new Map(samples.map((s, index) => [s.seq, index]))
  for (const point of points) {
    const contiguous = previousSeq !== null && ordinal.get(point.seq) === (ordinal.get(previousSeq) ?? -2) + 1
    path += `${contiguous ? 'L' : 'M'}${point.x.toFixed(1)} ${point.y.toFixed(1)}`
    previousSeq = point.seq
  }

  const decades: { value: number; y: number }[] = []
  for (let k = loExp; k <= hiLog; k += 1) decades.push({ value: 10 ** k, y: y(10 ** k) })
  const xTicks = Array.from({ length: Math.floor(lastX / 10) + 1 }, (_, i) => ({ seconds: i * 10, x: x(i * 10) }))

  const onsetSeconds = bundle.app.onset_ns === null ? null : secondsOf(bundle.app.onset_ns)
  const hasOnset = onsetSeconds !== null && observed !== null

  const baseLine = positive(base)
    ? { x1: x(0), x2: hasOnset ? x(onsetSeconds) : plot.right, y: y(base) }
    : null
  const observedLine = hasOnset && positive(observed) ? { x1: x(onsetSeconds), x2: plot.right, y: y(observed) } : null

  const groups: MarkerGroup[] = ordered.map(([ns, members], row) => {
    const seconds = secondsOf(ns)
    const anchor = x(seconds) > CHART.width - 200 ? 'end' : 'start'
    return {
      key: `${ns}`,
      label: joinLabels(members.map((m) => m.label)),
      tone: members.some((m) => m.tone === 'application') ? 'application' : 'hop',
      seconds,
      x: x(seconds),
      labelY: 14 + row * LABEL_ROW,
      anchor,
    }
  })

  return {
    width: CHART.width,
    height,
    plot,
    lastX,
    loLog,
    hiLog,
    lo: 10 ** loLog,
    hi: 10 ** hiLog,
    x,
    y,
    points,
    path,
    missing: missing.map((s) => ({ seq: s.seq, x: x(secondsOf(s.t_send_mono_ns)) })),
    nonPositive,
    decades,
    xTicks,
    baseLine,
    observedLine,
    groups,
    base,
    observed,
  }
}
