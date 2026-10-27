import { Sticker } from './primitives/Sticker.tsx'

/**
 * Curated limitations, mirroring docs/EVIDENCE_LEDGER.md. These are statements
 * about the research state, not measurements; they are kept visible by design.
 */
const LIMITATIONS: { title: string; body: string }[] = [
  {
    title: 'Loss and bandwidth are not localized',
    body: 'None of the 4 loss and bandwidth trials was localized, in either the exposed held-out set or the Phase 4b tuning set. Whether bandwidth limits can be observed at all with the current light probe traffic is unproven.',
  },
  {
    title: 'No onset detected is not proof of health',
    body: 'A fault that covers most of the observation window, or too little data, can also produce "no onset". The system has no separate "insufficient data" result yet.',
  },
  {
    title: 'Confidence is a heuristic, not a probability',
    body: 'The level is derived from how many hops were unknown. It has not been calibrated and does not measure how strong the signal was.',
  },
  {
    title: 'Nothing here independently validates the current detector',
    body: 'The only independent held-out result (Phase 4) missed its target. A fresh, sealed evaluation has not been run.',
  },
  {
    title: 'The alignment window is a fixed choice',
    body: 'Application and hop onsets are matched within a fixed 1.5 second window that has not been validated, and onset times have 500 ms resolution.',
  },
]

export function LimitationsPanel() {
  return (
    <ul className="grid gap-4 md:grid-cols-2">
      {LIMITATIONS.map((item) => (
        <li key={item.title}>
          <Sticker tone="mint" className="h-full p-5">
            <h3 className="font-display text-base font-semibold">{item.title}</h3>
            <p className="mt-2">{item.body}</p>
          </Sticker>
        </li>
      ))}
    </ul>
  )
}
