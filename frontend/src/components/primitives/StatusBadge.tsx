import type { HopStatus } from '../../data/schema.ts'
import { TONE_CLASSES, type Tone } from './Sticker.tsx'

interface StatusStyle {
  label: string
  tone: Tone
  dashed: boolean
}

/**
 * Labels are deliberately modest. In the data, "healthy" only means the hop has
 * no corroborated onset (an isolated onset may still have been recorded); it is
 * not proof that the hop is healthy.
 */
const STATUS_STYLES: Record<HopStatus, StatusStyle> = {
  healthy: { label: 'No corroborated onset', tone: 'healthy', dashed: false },
  degraded: { label: 'Corroborated onset', tone: 'degraded', dashed: false },
  unknown: { label: 'Unknown', tone: 'unknown', dashed: true },
}

export function statusLabel(status: HopStatus): string {
  return STATUS_STYLES[status].label
}

export function StatusIcon({ status, size = 18 }: { status: HopStatus; size?: number }) {
  return <Icon status={status} size={size} />
}

function Icon({ status, size = 18 }: { status: HopStatus; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 18 18',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
    focusable: false,
  }
  if (status === 'healthy') {
    return (
      <svg {...common}>
        <circle cx="9" cy="9" r="6.5" />
        <path d="M6 9h6" />
      </svg>
    )
  }
  if (status === 'degraded') {
    return (
      <svg {...common}>
        <path d="M2 14.5 7 6l3 5 2-3 4 6.5" />
      </svg>
    )
  }
  return (
    <svg {...common} strokeDasharray="2.4 2.4">
      <circle cx="9" cy="9" r="6.5" />
      <path strokeDasharray="0" d="M7.2 7.4a1.9 1.9 0 1 1 2.7 1.7c-.6.3-.9.8-.9 1.4M9 13h.01" />
    </svg>
  )
}

/** Status shown as label + icon + colour + outline style, never colour alone. */
export function StatusBadge({ status }: { status: HopStatus }) {
  const style = STATUS_STYLES[status]
  return (
    <span
      data-status={status}
      className={[
        'inline-flex items-center gap-1.5 rounded-full border-[3px] border-ink px-3 py-0.5 text-sm font-semibold',
        style.dashed ? 'border-dashed' : '',
        TONE_CLASSES[style.tone],
      ].join(' ')}
    >
      <Icon status={status} />
      {style.label}
    </span>
  )
}
