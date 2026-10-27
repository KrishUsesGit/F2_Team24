import { useEffect, type RefObject } from 'react'

const MAX_TILT_DEG = 5

/**
 * Cursor-reactive depth: tilts the scene by a few degrees toward the pointer by
 * writing CSS variables (--tilt-x / --tilt-z). Active only for a real hover-
 * capable fine pointer; touch input and the reduced-motion preference disable it.
 */
export function useParallax(ref: RefObject<HTMLElement | null>, enabled: boolean): void {
  useEffect(() => {
    const element = ref.current
    if (!enabled || element === null || typeof window.matchMedia !== 'function') return undefined
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return undefined

    let frame = 0
    const apply = (tiltX: number, tiltZ: number) => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        element.style.setProperty('--tilt-x', `${tiltX.toFixed(2)}deg`)
        element.style.setProperty('--tilt-z', `${tiltZ.toFixed(2)}deg`)
      })
    }
    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      const box = element.getBoundingClientRect()
      if (box.width === 0 || box.height === 0) return
      const x = (event.clientX - box.left) / box.width - 0.5
      const y = (event.clientY - box.top) / box.height - 0.5
      apply(-y * MAX_TILT_DEG * 2, x * MAX_TILT_DEG * 2)
    }
    const reset = () => apply(0, 0)

    element.addEventListener('pointermove', onMove)
    element.addEventListener('pointerleave', reset)
    return () => {
      cancelAnimationFrame(frame)
      element.removeEventListener('pointermove', onMove)
      element.removeEventListener('pointerleave', reset)
      element.style.removeProperty('--tilt-x')
      element.style.removeProperty('--tilt-z')
    }
  }, [ref, enabled])
}
