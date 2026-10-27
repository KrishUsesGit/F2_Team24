import type { ReactNode } from 'react'

export type Tone = 'paper' | 'mint' | 'signal' | 'structure' | 'healthy' | 'degraded' | 'unknown'

export const TONE_CLASSES: Record<Tone, string> = {
  paper: 'bg-paper text-ink',
  mint: 'bg-mint-200 text-ink',
  signal: 'bg-signal text-ink',
  structure: 'bg-structure text-paper',
  healthy: 'bg-healthy text-ink',
  degraded: 'bg-degraded text-ink',
  unknown: 'bg-unknown text-ink',
}

interface StickerProps {
  as?: 'div' | 'section' | 'article' | 'aside'
  tone?: Tone
  className?: string
  children: ReactNode
  'aria-labelledby'?: string
}

/** A thick-outlined card with a solid offset shadow. */
export function Sticker({ as = 'div', tone = 'paper', className = '', children, ...rest }: StickerProps) {
  const Element = as
  return (
    <Element
      className={`rounded-card border-[3px] border-ink shadow-sticker ${TONE_CLASSES[tone]} ${className}`}
      {...rest}
    >
      {children}
    </Element>
  )
}
