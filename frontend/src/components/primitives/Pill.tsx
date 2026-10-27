import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { TONE_CLASSES, type Tone } from './Sticker.tsx'

interface PillProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  tone?: Tone
  /** For toggle-style pills (e.g. a trial choice); sets aria-pressed. */
  pressed?: boolean
  children: ReactNode
}

/** A pill-shaped button with the "pressed sticker" interaction. Native <button>: keyboard operable. */
export function Pill({ tone = 'paper', pressed, children, type = 'button', ...rest }: PillProps) {
  const activeTone: Tone = pressed ? 'signal' : tone
  return (
    <button
      type={type}
      aria-pressed={pressed}
      className={[
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-full border-[3px] border-ink px-5 py-2',
        'cursor-pointer font-semibold shadow-sticker-sm',
        'motion-safe:transition-[transform,box-shadow] motion-safe:duration-150 motion-safe:ease-snap',
        'hover:-translate-y-0.5 hover:shadow-sticker',
        'active:translate-x-1 active:translate-y-1 active:shadow-none',
        'disabled:cursor-not-allowed disabled:opacity-60',
        TONE_CLASSES[activeTone],
      ].join(' ')}
      {...rest}
    >
      {children}
    </button>
  )
}
