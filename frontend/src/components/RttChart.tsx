import { useId } from 'react'
import { formatMs } from '../data/format.ts'
import type { Bundle } from '../data/schema.ts'
import { buildRttChart, type ChartMarker } from './rttChartGeometry.ts'

export type { ChartMarker } from './rttChartGeometry.ts'

/**
 * Application ping round-trip time over the observation window, drawn on a
 * logarithmic axis (RTT spans orders of magnitude). Every plotted value, mean
 * line and onset marker is a stored value from the bundle; nothing is
 * detected or recomputed here. The axis is sized to contain the highest stored
 * sample with headroom, and all data is clipped to the plotting rectangle.
 */
export function RttChart({ bundle, markers }: { bundle: Bundle; markers: ChartMarker[] }) {
  const titleId = useId()
  const descId = useId()
  const clipId = `rtt-clip-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`
  const chart = buildRttChart(bundle, markers)
  const { plot, base, observed } = chart
  const plotWidth = plot.right - plot.left
  const plotHeight = plot.bottom - plot.top

  const summary =
    observed !== null && base !== null
      ? `Application ping round-trip time over ${chart.lastX.toFixed(0)} seconds: mean ${formatMs(base)} before the detected onset and ${formatMs(observed)} after it.`
      : `Application ping round-trip time over ${chart.lastX.toFixed(0)} seconds: mean ${formatMs(base)}; no application onset was detected.`

  return (
    <figure className="m-0">
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-labelledby={`${titleId} ${descId}`}
        className="h-auto w-full overflow-visible"
        data-testid="rtt-chart"
        data-plot-top={plot.top}
        data-plot-bottom={plot.bottom}
      >
        <title id={titleId}>Application round-trip time</title>
        <desc id={descId}>{summary}</desc>
        <defs>
          <clipPath id={clipId}>
            <rect x={plot.left} y={plot.top} width={plotWidth} height={plotHeight} rx="10" />
          </clipPath>
        </defs>
        <rect x={plot.left} y={plot.top} width={plotWidth} height={plotHeight} fill="#ffffff" rx="10" />

        {chart.decades.map((tick) => (
          <g key={tick.value}>
            <line x1={plot.left} x2={plot.right} y1={tick.y} y2={tick.y} stroke="#14181a" strokeOpacity="0.18" />
            <text x={plot.left - 8} y={tick.y + 4} textAnchor="end" fontSize="12" fontFamily="var(--font-mono)" fill="#3d4d55">
              {tick.value} ms
            </text>
          </g>
        ))}
        {chart.xTicks.map((tick) => (
          <text key={tick.seconds} x={tick.x} y={plot.bottom + 18} textAnchor="middle" fontSize="12" fontFamily="var(--font-mono)" fill="#3d4d55">
            {tick.seconds}s
          </text>
        ))}

        <g clipPath={`url(#${clipId})`} data-testid="rtt-data">
          {chart.baseLine ? (
            <line x1={chart.baseLine.x1} x2={chart.baseLine.x2} y1={chart.baseLine.y} y2={chart.baseLine.y} stroke="#6a4dff" strokeWidth="2.5" strokeDasharray="7 5" data-testid="rtt-baseline" />
          ) : null}
          {chart.observedLine ? (
            <line x1={chart.observedLine.x1} x2={chart.observedLine.x2} y1={chart.observedLine.y} y2={chart.observedLine.y} stroke="#6a4dff" strokeWidth="2.5" strokeDasharray="7 5" data-testid="rtt-observed" />
          ) : null}

          <path d={chart.path} fill="none" stroke="#14181a" strokeWidth="1.6" strokeLinejoin="round" data-testid="rtt-trace" />

          {chart.missing.map((gap) => (
            <line key={gap.seq} x1={gap.x} x2={gap.x} y1={plot.bottom - 12} y2={plot.bottom} stroke="#ff6b4a" strokeWidth="2" />
          ))}
        </g>

        {/* The frame is drawn over the clipped data so that nothing can cross it. */}
        <rect x={plot.left} y={plot.top} width={plotWidth} height={plotHeight} fill="none" stroke="#14181a" strokeWidth="3" rx="10" />

        {chart.groups.map((group) => {
          const color = group.tone === 'application' ? '#14181a' : '#ff6b4a'
          const labelX = group.anchor === 'end' ? group.x - 7 : group.x + 7
          return (
            <g key={group.key} data-testid="rtt-marker">
              <line x1={group.x} x2={group.x} y1={group.labelY + 4} y2={plot.top} stroke={color} strokeWidth="3" />
              <line x1={group.x} x2={group.x} y1={plot.top} y2={plot.bottom} stroke={color} strokeWidth="3" clipPath={`url(#${clipId})`} />
              <circle cx={group.x} cy={group.labelY} r="5" fill={color} stroke="#14181a" strokeWidth="2" />
              <text x={labelX} y={group.labelY + 4} textAnchor={group.anchor} fontSize="12.5" fontWeight="700" fontFamily="var(--font-sans)" fill="#14181a">
                {group.label} at +{group.seconds.toFixed(1)} s
              </text>
            </g>
          )
        })}
      </svg>
      <figcaption className="mt-3 text-sm text-ink-soft">
        Logarithmic scale; the vertical axis is sized to hold the highest recorded round-trip time. Solid line: each
        ping's round-trip time. Dashed violet lines: the mean before and after the detected onset, as stored. Coral
        ticks on the floor: pings with no response.
        {chart.nonPositive > 0
          ? ` ${chart.nonPositive} ping(s) with a zero or negative round-trip time cannot be drawn on a logarithmic scale and are not plotted.`
          : ''}
      </figcaption>
    </figure>
  )
}
