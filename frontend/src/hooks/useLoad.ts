import { useEffect, useState } from 'react'
import type { LoadError, LoadResult } from '../data/loader.ts'

export type LoadState<T> =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; value: T }
  | { status: 'error'; error: LoadError }

/**
 * Runs `load` (which must be referentially stable, e.g. useCallback) and exposes
 * idle / loading / ready / error. Pass `null` to stay idle. A new `reloadToken`
 * re-runs the load; an in-flight request is aborted when inputs change or the
 * component unmounts.
 */
export function useLoad<T>(
  load: ((signal: AbortSignal) => Promise<LoadResult<T>>) | null,
  reloadToken = 0,
): LoadState<T> {
  const [state, setState] = useState<LoadState<T>>(load === null ? { status: 'idle' } : { status: 'loading' })

  useEffect(() => {
    if (load === null) {
      setState({ status: 'idle' })
      return undefined
    }
    const controller = new AbortController()
    setState({ status: 'loading' })
    void load(controller.signal).then((result) => {
      if (controller.signal.aborted) return
      if (result.ok) setState({ status: 'ready', value: result.value })
      else if (result.error.kind !== 'aborted') setState({ status: 'error', error: result.error })
    })
    return () => controller.abort()
  }, [load, reloadToken])

  return state
}
