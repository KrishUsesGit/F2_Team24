import type { LoadError } from '../data/loader.ts'
import { Pill } from './primitives/Pill.tsx'
import { Sticker } from './primitives/Sticker.tsx'

export function LoadingPanel({ label }: { label: string }) {
  return (
    <Sticker tone="mint" className="p-6">
      <p role="status" className="font-semibold">
        {label}
      </p>
    </Sticker>
  )
}

const KIND_TITLES: Record<LoadError['kind'], string> = {
  network: 'The data files could not be reached',
  http: 'The data file could not be loaded',
  parse: 'The data file is not valid JSON',
  schema: 'The data file has an unexpected format',
  aborted: 'The request was cancelled',
}

/** An explicit, non-silent failure state. Nothing is shown in place of missing data. */
export function ErrorPanel({ error, onRetry }: { error: LoadError; onRetry?: () => void }) {
  return (
    <Sticker tone="degraded" className="p-6">
      <div role="alert">
        <h3 className="text-lg font-bold">{KIND_TITLES[error.kind]}</h3>
        <p className="mt-2">{error.message}</p>
        {error.issues && error.issues.length > 0 ? (
          <ul className="mt-3 list-disc space-y-1 pl-5 font-mono text-sm">
            {error.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        ) : null}
        <p className="mt-3 font-mono text-sm break-all">{error.url}</p>
      </div>
      {onRetry ? (
        <div className="mt-4">
          <Pill onClick={onRetry}>Try again</Pill>
        </div>
      ) : null}
    </Sticker>
  )
}
