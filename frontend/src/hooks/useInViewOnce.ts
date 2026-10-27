import { useEffect, useState, type RefObject } from 'react'

/**
 * True once the element has entered the viewport (and stays true). Without
 * IntersectionObserver (or when told not to wait) content is shown at once, so
 * nothing is ever left hidden.
 */
export function useInViewOnce(ref: RefObject<Element | null>, enabled = true): boolean {
  const unsupported = typeof IntersectionObserver === 'undefined'
  const [seen, setSeen] = useState(false)

  useEffect(() => {
    const element = ref.current
    if (!enabled || unsupported || element === null) return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setSeen(true)
          observer.disconnect()
        }
      },
      { threshold: 0.2 },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [ref, enabled, unsupported])

  return !enabled || unsupported || seen
}
