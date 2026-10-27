import { useRef, useState, type KeyboardEvent } from 'react'
import type { Bundle } from '../data/schema.ts'
import { boundaryHop, segmentRelation } from '../data/select.ts'
import { useInViewOnce } from '../hooks/useInViewOnce.ts'
import { useParallax } from '../hooks/useParallax.ts'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.ts'
import { NetworkHop } from './NetworkHop.tsx'
import { PacketAnimation } from './PacketAnimation.tsx'
import { Pill } from './primitives/Pill.tsx'
import { StatusBadge } from './primitives/StatusBadge.tsx'

interface NetworkPathProps {
  bundle: Bundle
  selectedTtl: number
  onSelect: (ttl: number) => void
}

/**
 * The observed path: the client, then five selectable hops. Each hop shows the
 * status stored in the bundle; nothing is derived here beyond drawing the link
 * between two hops from their stored statuses.
 */
export function NetworkPath({ bundle, selectedTtl, onSelect }: NetworkPathProps) {
  const reduceMotion = usePrefersReducedMotion()
  const [paused, setPaused] = useState(false)
  const sceneRef = useRef<HTMLDivElement>(null)
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  const built = useInViewOnce(sceneRef, !reduceMotion)
  useParallax(sceneRef, !reduceMotion)

  const boundary = boundaryHop(bundle)

  function onKeyNavigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = bundle.hops.length - 1
    let target: number | null = null
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') target = Math.min(index + 1, last)
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') target = Math.max(index - 1, 0)
    else if (event.key === 'Home') target = 0
    else if (event.key === 'End') target = last
    if (target === null) return
    event.preventDefault()
    buttons.current[target]?.focus()
  }

  return (
    <div>
      <div ref={sceneRef} className="path-scene" data-built={built} data-testid="path-scene">
        <div className="path-stage">
          <div className="path-plate" aria-hidden="true" />
          <ol className="path-route" aria-label="Observed path from client to server">
            <li className="origin-item">
              <div className="hop-node hop-static" data-testid="origin-node">
                <span className="hop-shadow" aria-hidden="true" />
                <span className="hop-upright origin-upright" style={{ ['--i' as string]: 0 }}>
                  <span className="puck puck-origin" aria-hidden="true">
                    Client
                  </span>
                  <span className="flex flex-col items-center text-center lg:order-first lg:mb-1">
                    <span className="font-display text-base font-bold lg:rounded-full lg:border-[3px] lg:border-ink lg:bg-paper lg:px-3 lg:py-0.5">
                      Client
                    </span>
                    <span className="text-xs text-ink-soft">start of the path</span>
                  </span>
                </span>
              </div>
            </li>
            {bundle.hops.map((hop, index) => {
              const previous = index > 0 ? (bundle.hops[index - 1] ?? null) : null
              return (
                <li key={hop.ttl} className="hop-item" style={{ ['--i' as string]: index + 1 }}>
                  <span
                    className="seg"
                    aria-hidden="true"
                    data-rel={segmentRelation(previous, hop)}
                    style={{ ['--i' as string]: index + 1 }}
                  />
                  <NetworkHop
                    hop={hop}
                    index={index}
                    selected={hop.ttl === selectedTtl}
                    boundary={hop.ttl === boundary}
                    onSelect={onSelect}
                    onKeyNavigate={onKeyNavigate}
                    buttonRef={(element) => {
                      buttons.current[index] = element
                    }}
                  />
                </li>
              )
            })}
            <PacketAnimation running={!paused} hidden={reduceMotion} />
          </ol>
        </div>
      </div>

      <div className="mt-8 flex flex-wrap items-start justify-between gap-4 md:mt-10">
        <p className="max-w-xl text-sm" data-testid="packet-caption">
          <strong>Illustration only.</strong>{' '}
          {reduceMotion
            ? 'Packet animation is off because your device asks for reduced motion.'
            : 'The moving packets show direction and order from client to server. They are not measured traffic: the data contain no packet-level observations.'}
        </p>
        {!reduceMotion ? (
          <Pill pressed={paused} onClick={() => setPaused((value) => !value)}>
            {paused ? 'Resume packet animation' : 'Pause packet animation'}
          </Pill>
        ) : null}
      </div>

      <ul className="mt-6 flex flex-wrap gap-x-6 gap-y-3" aria-label="Legend">
        <li className="flex items-center gap-2 text-sm">
          <StatusBadge status="degraded" />
          <span>Onset corroborated by the application and downstream hops</span>
        </li>
        <li className="flex items-center gap-2 text-sm">
          <StatusBadge status="healthy" />
          <span>Not corroborated (not proof of health)</span>
        </li>
        <li className="flex items-center gap-2 text-sm">
          <StatusBadge status="unknown" />
          <span>Too few responses to evaluate</span>
        </li>
      </ul>
      <p className="mt-3 text-sm text-ink-soft">
        A hatched link means an onset persists across both neighbouring hops. Testbed: client, four routers, then the
        server as the fifth observed hop.
      </p>
    </div>
  )
}
