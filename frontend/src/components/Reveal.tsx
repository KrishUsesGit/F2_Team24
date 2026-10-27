import { useRef, type ReactNode } from 'react'
import { useInViewOnce } from '../hooks/useInViewOnce.ts'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.ts'

/** Fades a section in once as it scrolls into view. Always visible without IntersectionObserver or under reduced motion. */
export function Reveal({ children, className = '' }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const reduce = usePrefersReducedMotion()
  const visible = useInViewOnce(ref, !reduce)
  return (
    <div ref={ref} className={`reveal ${className}`} data-visible={visible}>
      {children}
    </div>
  )
}
