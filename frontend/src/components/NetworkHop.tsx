import type { KeyboardEvent, Ref } from 'react'
import type { Hop } from '../data/schema.ts'
import { TESTBED_ROLES } from '../data/select.ts'
import { statusLabel, StatusIcon } from './primitives/StatusBadge.tsx'

interface NetworkHopProps {
  hop: Hop
  index: number
  selected: boolean
  boundary: boolean
  onSelect: (ttl: number) => void
  onKeyNavigate: (event: KeyboardEvent<HTMLButtonElement>, index: number) => void
  buttonRef: Ref<HTMLButtonElement>
}

/** One selectable hop: a button standing on the path plate. */
export function NetworkHop({ hop, index, selected, boundary, onSelect, onKeyNavigate, buttonRef }: NetworkHopProps) {
  const label = statusLabel(hop.status)
  const role = TESTBED_ROLES[hop.ttl]
  return (
    <button
      ref={buttonRef}
      type="button"
      className="hop-node"
      aria-pressed={selected}
      aria-label={`Hop ${hop.ttl}: ${label}${boundary ? '. Degradation appears to begin at or after this hop' : ''}`}
      data-ttl={hop.ttl}
      data-status={hop.status}
      onClick={() => onSelect(hop.ttl)}
      onKeyDown={(event) => onKeyNavigate(event, index)}
    >
      <span className="hop-shadow" aria-hidden="true" />
      <span className="hop-upright origin-upright" style={{ ['--i' as string]: index + 1 }}>
        <span className="puck" data-status={hop.status} aria-hidden="true">
          {hop.ttl}
          <span className="absolute -top-2 -right-2 grid h-7 w-7 place-items-center rounded-full border-[3px] border-ink bg-paper">
            <StatusIcon status={hop.status} size={14} />
          </span>
        </span>
        <span className="flex flex-col items-center text-center lg:order-first lg:mb-1">
          {boundary ? (
            <span
              data-testid="boundary-tag"
              className="mb-1 rounded-full border-[3px] border-ink bg-signal max-w-[9.5rem] px-2.5 py-0.5 text-center text-xs leading-tight font-bold"
            >
              Appears to begin at or after here
            </span>
          ) : null}
          <span className="font-display text-base font-bold lg:rounded-full lg:border-[3px] lg:border-ink lg:bg-paper lg:px-3 lg:py-0.5">
            Hop {hop.ttl}
          </span>
          <span className="text-sm font-semibold">{label}</span>
          {role ? <span className="text-xs text-ink-soft">{role} in this testbed</span> : null}
        </span>
      </span>
    </button>
  )
}
