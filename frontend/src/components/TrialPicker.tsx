import { Pill } from './primitives/Pill.tsx'

interface TrialPickerProps {
  ids: string[]
  selectedId: string | null
  onSelect: (id: string) => void
}

/** One toggle per available presentation bundle. Plain buttons: Tab to move, Enter/Space to choose. */
export function TrialPicker({ ids, selectedId, onSelect }: TrialPickerProps) {
  if (ids.length === 0) {
    return <p className="font-semibold">No presentation bundles were found.</p>
  }
  return (
    <div role="group" aria-label="Choose a recorded trial" className="flex flex-wrap gap-3">
      {ids.map((id) => (
        <Pill key={id} pressed={id === selectedId} onClick={() => onSelect(id)}>
          <span className="font-mono text-sm">{id}</span>
        </Pill>
      ))}
    </div>
  )
}
