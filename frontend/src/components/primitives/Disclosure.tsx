import { useId, useState, type ReactNode } from 'react'

interface DisclosureProps {
  summary: string
  children: ReactNode
  defaultOpen?: boolean
}

/** Expandable detail region: a real <button> with aria-expanded / aria-controls. */
export function Disclosure({ summary, children, defaultOpen = false }: DisclosureProps) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()
  return (
    <div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-full border-[3px] border-ink bg-paper px-4 py-1.5 text-sm font-semibold shadow-sticker-sm motion-safe:transition-[transform,box-shadow] motion-safe:duration-150 hover:-translate-y-0.5 hover:shadow-sticker active:translate-x-1 active:translate-y-1 active:shadow-none"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          focusable="false"
          className={open ? 'rotate-90 motion-safe:transition-transform' : 'motion-safe:transition-transform'}
        >
          <path d="M5 2.5 9.5 7 5 11.5" />
        </svg>
        {summary}
      </button>
      <div id={panelId} hidden={!open} className="mt-3">
        {children}
      </div>
    </div>
  )
}
