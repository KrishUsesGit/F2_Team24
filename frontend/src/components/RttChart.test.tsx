import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { bundleSchema, type Bundle } from '../data/schema.ts'
import { EXPECTED_REAL_BUNDLES, readRealBundle } from '../test/repo.ts'
import { RttChart } from './RttChart.tsx'
import { buildRttChart, type ChartMarker } from './rttChartGeometry.ts'

const real = (id: string): Bundle => bundleSchema.parse(readRealBundle(id))

/** Same rule the page uses: corroborated hop onsets from the stored hops. */
function hopMarkers(bundle: Bundle): ChartMarker[] {
  return bundle.hops.flatMap((hop) =>
    hop.status === 'degraded' && hop.onset_ns !== null ? [{ label: `Hop ${hop.ttl} onset`, ns: hop.onset_ns, tone: 'hop' as const }] : [],
  )
}

function withTimeline(bundle: Bundle, timeline: Bundle['app']['timeline']): Bundle {
  return { ...bundle, app: { ...bundle.app, timeline } }
}

describe.each(EXPECTED_REAL_BUNDLES)('RTT chart geometry for the real bundle %s', (id) => {
  const bundle = real(id)
  const before = JSON.stringify(bundle)
  const chart = buildRttChart(bundle, hopMarkers(bundle))
  const stored = bundle.app.timeline.filter((s) => s.responded && s.rtt_ms !== null && s.rtt_ms > 0)

  it('plots exactly the stored samples, with their values untouched', () => {
    expect(chart.points.map((p) => p.rtt_ms)).toEqual(stored.map((s) => s.rtt_ms))
    expect(chart.points.map((p) => p.seq)).toEqual(stored.map((s) => s.seq))
    expect(JSON.stringify(bundle)).toBe(before) // the bundle itself is never modified
  })

  it('keeps every sample inside the plotting rectangle', () => {
    for (const p of chart.points) {
      expect(p.y).toBeGreaterThanOrEqual(chart.plot.top)
      expect(p.y).toBeLessThanOrEqual(chart.plot.bottom)
      expect(p.x).toBeGreaterThanOrEqual(chart.plot.left)
      expect(p.x).toBeLessThanOrEqual(chart.plot.right)
    }
  })

  it('leaves visible headroom above the highest sample (at least 8% of the plot height)', () => {
    const highest = Math.min(...chart.points.map((p) => p.y))
    expect(highest - chart.plot.top).toBeGreaterThanOrEqual(0.08 * (chart.plot.bottom - chart.plot.top))
  })

  it('has a domain that holds the highest sample, both means, and the lowest sample', () => {
    const all = [...stored.map((s) => s.rtt_ms as number), bundle.app.rtt_baseline_ms, bundle.app.rtt_observed_ms].filter(
      (v): v is number => v !== null,
    )
    expect(chart.lo).toBeLessThanOrEqual(Math.min(...all))
    expect(chart.hi).toBeGreaterThan(Math.max(...all))
  })

  it('draws tick labels, reference lines and the trace from one and the same scale', () => {
    for (const tick of chart.decades) expect(tick.y).toBeCloseTo(chart.y(tick.value), 9)
    if (bundle.app.rtt_baseline_ms !== null) expect(chart.baseLine?.y).toBeCloseTo(chart.y(bundle.app.rtt_baseline_ms), 9)
    const peak = chart.points.reduce((a, b) => (b.rtt_ms > a.rtt_ms ? b : a))
    expect(peak.y).toBeCloseTo(chart.y(peak.rtt_ms), 9)
    if (bundle.app.onset_ns !== null && bundle.app.rtt_observed_ms !== null) {
      const start = bundle.observation_window.t_start_ns!
      const onsetX = chart.x((bundle.app.onset_ns - start) / 1e9)
      expect(chart.observedLine?.y).toBeCloseTo(chart.y(bundle.app.rtt_observed_ms), 9)
      expect(chart.observedLine?.x1).toBeCloseTo(onsetX, 9)
      expect(chart.baseLine?.x2).toBeCloseTo(onsetX, 9) // the two means meet at the onset
    } else {
      expect(chart.observedLine).toBeNull()
    }
  })

  it('merges markers that share an onset time and keeps their labels above the plot', () => {
    const times = new Set(hopMarkers(bundle).map((m) => m.ns))
    expect(chart.groups).toHaveLength(times.size)
    for (const group of chart.groups) {
      expect(group.labelY + 6).toBeLessThan(chart.plot.top)
    }
    const rows = chart.groups.map((g) => g.labelY)
    for (let i = 1; i < rows.length; i += 1) expect(rows[i]! - rows[i - 1]!).toBeGreaterThanOrEqual(17)
  })
})

describe('extreme and unusable values', () => {
  const base = real('p4-held-04-latency-hop2-moderate')
  const first = base.app.timeline[0]!

  it('contains a 10-million-ms outlier without capping or changing it', () => {
    const timeline = base.app.timeline.map((s, i) => (i === 300 ? { ...s, rtt_ms: 1e7 } : s))
    const chart = buildRttChart(withTimeline(base, timeline), [])
    const outlier = chart.points.find((p) => p.rtt_ms === 1e7)
    expect(outlier).toBeDefined()
    expect(outlier!.y).toBeGreaterThan(chart.plot.top)
    expect(chart.hi).toBeGreaterThan(1e7)
  })

  it('does not plot missing, zero, negative or non-finite values, and does not invent them', () => {
    const timeline = [
      first,
      { ...first, seq: 1001, responded: false, rtt_ms: null },
      { ...first, seq: 1002, responded: true, rtt_ms: 0 },
      { ...first, seq: 1003, responded: true, rtt_ms: -4 },
      { ...first, seq: 1004, responded: true, rtt_ms: Number.POSITIVE_INFINITY },
      { ...first, seq: 1005, responded: true, rtt_ms: null },
    ]
    const chart = buildRttChart(withTimeline(base, timeline), [])
    expect(chart.points.map((p) => p.seq)).toEqual([first.seq])
    expect(chart.missing.map((m) => m.seq)).toEqual([1001])
    expect(chart.nonPositive).toBe(2)
    expect(chart.path).not.toMatch(/NaN|Infinity/)
  })

  it('breaks the line across a gap instead of bridging missing pings', () => {
    const t = base.app.timeline
    const timeline = [t[0]!, t[1]!, { ...t[2]!, responded: false, rtt_ms: null }, t[3]!, t[4]!]
    const chart = buildRttChart(withTimeline(base, timeline), [])
    expect((chart.path.match(/M/g) ?? []).length).toBe(2)
  })

  it('stays finite with no responses at all, or an empty timeline', () => {
    for (const timeline of [base.app.timeline.map((s) => ({ ...s, responded: false, rtt_ms: null })), []]) {
      const chart = buildRttChart({ ...withTimeline(base, timeline), app: { ...base.app, timeline, rtt_baseline_ms: null, rtt_observed_ms: null, onset_ns: null } }, [])
      for (const n of [chart.lo, chart.hi, chart.height, chart.plot.top, chart.lastX]) expect(Number.isFinite(n)).toBe(true)
      expect(chart.hi).toBeGreaterThan(chart.lo)
      expect(chart.path).toBe('')
    }
  })

  it('puts two different onset times on separate label rows', () => {
    const markers: ChartMarker[] = [
      { label: 'Hop 2 onset', ns: base.observation_window.t_start_ns! + 5e9, tone: 'hop' },
      { label: 'Hop 3 onset', ns: base.observation_window.t_start_ns! + 12e9, tone: 'hop' },
    ]
    const chart = buildRttChart(base, markers)
    expect(chart.groups).toHaveLength(2)
    expect(chart.groups[0]!.labelY).not.toBe(chart.groups[1]!.labelY)
    expect(chart.groups[1]!.labelY + 6).toBeLessThan(chart.plot.top)
  })
})

describe('rendered RTT chart', () => {
  it.each(EXPECTED_REAL_BUNDLES)('draws %s clipped to the plot with the frame over the data', (id) => {
    const bundle = real(id)
    render(<RttChart bundle={bundle} markers={hopMarkers(bundle)} />)
    const svg = screen.getByTestId('rtt-chart')
    const top = Number(svg.getAttribute('data-plot-top'))
    const bottom = Number(svg.getAttribute('data-plot-bottom'))

    const data = screen.getByTestId('rtt-data')
    expect(data.getAttribute('clip-path')).toMatch(/^url\(#rtt-clip-[A-Za-z0-9_-]+\)$/)
    const clipId = /#(.+)\)/.exec(data.getAttribute('clip-path')!)![1]!
    expect(svg.querySelector(`clipPath[id="${clipId}"] rect`)).not.toBeNull()

    // Every vertex of the drawn trace lies inside the plot.
    const d = screen.getByTestId('rtt-trace').getAttribute('d')!
    const ys = [...d.matchAll(/[ML][\d.]+ ([\d.]+)/g)].map((m) => Number(m[1]))
    expect(ys.length).toBeGreaterThan(0)
    expect(Math.min(...ys)).toBeGreaterThan(top)
    expect(Math.max(...ys)).toBeLessThan(bottom)

    // The frame (the last un-filled rect) comes after the clipped data in paint order.
    const children = [...svg.children]
    const frame = children.filter((el) => el.tagName === 'rect' && el.getAttribute('fill') === 'none').at(-1)!
    expect(children.indexOf(frame)).toBeGreaterThan(children.indexOf(data))
  })

  it('shows one combined label when several hops share the same onset time', () => {
    const bundle = real('demo-run-01')
    render(<RttChart bundle={bundle} markers={hopMarkers(bundle)} />)
    const labels = screen.getAllByTestId('rtt-marker')
    expect(labels).toHaveLength(1)
    expect(labels[0]).toHaveTextContent(/^Hops 3, 4, 5 onset at \+\d+\.\d s$/)
  })
})
