/**
 * Typed, validating loaders for the allowlisted presentation data. They never
 * throw to the UI: every failure is returned as a LoadError with a kind the UI
 * can explain (network, http, parse, schema, aborted).
 */
import type { ZodType } from 'zod'
import {
  bundleSchema,
  evaluationProjectionSchema,
  manifestSchema,
  type Bundle,
  type EvaluationProjection,
  type Manifest,
} from './schema.ts'
import { describeBundle, type BundleProvenance } from './provenance.ts'

export type LoadErrorKind = 'network' | 'http' | 'parse' | 'schema' | 'aborted'

export interface LoadError {
  kind: LoadErrorKind
  message: string
  url: string
  status?: number
  issues?: string[]
}

export type LoadResult<T> = { ok: true; value: T } | { ok: false; error: LoadError }

export interface LoaderOptions {
  fetchFn?: typeof fetch
  /** Document-relative base used to resolve `data/...`. Defaults to the page URL. */
  baseUrl?: string
  signal?: AbortSignal
}

export interface LoadedBundle {
  bundle: Bundle
  provenance: BundleProvenance
}

const MAX_ISSUES = 8

function resolveUrl(relativePath: string, baseUrl?: string): string {
  const base = baseUrl ?? (typeof document !== 'undefined' ? document.baseURI : 'http://localhost/')
  return new URL(`data/${relativePath}`, base).toString()
}

function fail<T>(error: LoadError): LoadResult<T> {
  return { ok: false, error }
}

async function fetchValidated<T>(
  relativePath: string,
  schema: ZodType<T>,
  options: LoaderOptions,
): Promise<LoadResult<T>> {
  const url = resolveUrl(relativePath, options.baseUrl)
  const fetchFn = options.fetchFn ?? fetch

  let response: Response
  try {
    response = await fetchFn(url, { signal: options.signal ?? null })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      return fail({ kind: 'aborted', message: 'Request was cancelled.', url })
    }
    return fail({ kind: 'network', message: 'Could not reach the data files.', url })
  }

  if (!response.ok) {
    const message =
      response.status === 404 ? 'The requested data file was not found.' : `The server answered ${response.status}.`
    return fail({ kind: 'http', message, url, status: response.status })
  }

  let raw: unknown
  try {
    raw = await response.json()
  } catch {
    return fail({ kind: 'parse', message: 'The data file is not valid JSON.', url })
  }

  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, MAX_ISSUES)
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    return fail({ kind: 'schema', message: 'The data file does not match the expected format.', url, issues })
  }
  return { ok: true, value: parsed.data }
}

export function loadManifest(options: LoaderOptions = {}): Promise<LoadResult<Manifest>> {
  return fetchValidated('index.json', manifestSchema, options)
}

export async function loadBundle(id: string, options: LoaderOptions = {}): Promise<LoadResult<LoadedBundle>> {
  const result = await fetchValidated(`bundles/${encodeURIComponent(id)}.json`, bundleSchema, options)
  if (!result.ok) return result
  return { ok: true, value: { bundle: result.value, provenance: describeBundle(result.value) } }
}

export function loadEvaluationProjection(
  phase: '4' | '4b',
  options: LoaderOptions = {},
): Promise<LoadResult<EvaluationProjection>> {
  return fetchValidated(`evaluation/phase${phase}.json`, evaluationProjectionSchema, options)
}

export interface EvaluationPair {
  phase4: EvaluationProjection
  phase4b: EvaluationProjection
}

export async function loadEvaluation(options: LoaderOptions = {}): Promise<LoadResult<EvaluationPair>> {
  const [phase4, phase4b] = await Promise.all([
    loadEvaluationProjection('4', options),
    loadEvaluationProjection('4b', options),
  ])
  if (!phase4.ok) return phase4
  if (!phase4b.ok) return phase4b
  return { ok: true, value: { phase4: phase4.value, phase4b: phase4b.value } }
}
