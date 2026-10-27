import { motion, useScroll } from 'motion/react'
import { usePrefersReducedMotion } from '../hooks/usePrefersReducedMotion.ts'

/** A thin progress bar tied to scroll position. Not rendered under reduced motion. */
export function ScrollProgress() {
  const reduce = usePrefersReducedMotion()
  const { scrollYProgress } = useScroll()
  if (reduce) return null
  return (
    <motion.div
      aria-hidden="true"
      data-testid="scroll-progress"
      className="fixed top-0 right-0 left-0 z-40 h-1.5 origin-left border-b-2 border-ink bg-structure"
      style={{ scaleX: scrollYProgress }}
    />
  )
}
