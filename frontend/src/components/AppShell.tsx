import type { ReactNode } from 'react'

function PathMark() {
  // Five nodes on a line: the observed path, as a small identity mark.
  return (
    <svg width="54" height="14" viewBox="0 0 54 14" aria-hidden="true" focusable="false">
      <path d="M5 7h44" stroke="#14181a" strokeWidth="3" strokeLinecap="round" />
      {[5, 16, 27, 38, 49].map((x, index) => (
        <circle
          key={x}
          cx={x}
          cy="7"
          r="4.2"
          fill={['#2fd3e0', '#b4ff3d', '#b4ff3d', '#ff6b4a', '#ff6b4a'][index]}
          stroke="#14181a"
          strokeWidth="2.4"
        />
      ))}
    </svg>
  )
}

const NAV_LINK =
  'inline-flex min-h-11 items-center rounded-full border-[3px] border-ink bg-paper px-4 py-1.5 text-sm font-semibold shadow-sticker-sm motion-safe:transition-[transform,box-shadow] motion-safe:duration-150 hover:-translate-y-0.5 hover:shadow-sticker active:translate-x-1 active:translate-y-1 active:shadow-none'

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-50 focus:rounded-full focus:border-[3px] focus:border-ink focus:bg-paper focus:px-4 focus:py-2 focus:font-semibold"
      >
        Skip to main content
      </a>
      <header className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-5 md:px-8">
        <a
          href="./"
          className="inline-flex items-center gap-3 rounded-full border-[3px] border-ink bg-paper px-4 py-2 shadow-sticker-sm"
        >
          <PathMark />
          <span className="font-display text-lg font-bold tracking-tight">HOPTRACE</span>
        </a>
        <nav aria-label="Sections" className="flex flex-wrap gap-3">
          <a href="#trial" className={NAV_LINK}>
            Trial
          </a>
          <a href="#path" className={NAV_LINK}>
            Path
          </a>
          <a href="#evidence" className={NAV_LINK}>
            Evidence
          </a>
          <a href="#evaluation" className={NAV_LINK}>
            Evaluation status
          </a>
          <a href="#limitations" className={NAV_LINK}>
            Limitations
          </a>
        </nav>
      </header>
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-4 pb-24 md:px-8">
        {children}
      </main>
      <footer className="mx-auto max-w-6xl px-4 pb-10 text-sm text-ink-soft md:px-8">
        <p>
          Network Path Fault Localization through Application-to-Hop Correlation. Data are read from the project's
          stored presentation files; nothing on this page is computed in the browser.
        </p>
      </footer>
    </div>
  )
}
