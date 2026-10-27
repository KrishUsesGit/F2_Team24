/**
 * Explicit allowlist of presentation data that the frontend may read from the
 * repository. Pure functions (no Vite imports) so they can be unit-tested and
 * shared by the dev middleware and the production build.
 *
 * What is served, and nothing else:
 *   data/index.json                       list of trial ids that have a bundle
 *   data/bundles/<id>.json                experiments/<id>/path_bundle.json, with local
 *                                         filesystem paths removed (see sanitizeBundle)
 *   data/evaluation/phase4.json           PROJECTION of evaluate/held_out_results.json
 *   data/evaluation/phase4b.json          PROJECTION of evaluate/held_out_results_4b.json
 *
 * Never served: *.jsonl raw traces, any other file under experiments/, the
 * ground-truth database, per-trial labels, or any caller-supplied path. The
 * evaluation files contain per-trial fault types / expected hops
 * (ground-truth-derived labels); the projections copy only aggregate fields,
 * verbatim, and omit every per-trial field.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

export interface DataResponse {
  status: number
  contentType: string
  body: string
}

const JSON_TYPE = 'application/json; charset=utf-8'

const METRIC_KEYS = [
  'exact_hop_accuracy',
  'within_1_hop_accuracy',
  'false_attribution_rate',
  'clean_control_false_positive_rate',
  'detection_precision',
  'detection_recall',
] as const

type Phase = '4' | '4b'

const PHASE_FILES: Record<Phase, { config: string; results: string; embeddedConfigKey: string }> = {
  '4': {
    config: 'evaluate/frozen_config.json',
    results: 'evaluate/held_out_results.json',
    embeddedConfigKey: 'frozen_config_used',
  },
  '4b': {
    config: 'evaluate/frozen_config_4b.json',
    results: 'evaluate/held_out_results_4b.json',
    embeddedConfigKey: 'frozen_config',
  },
}

type Json = Record<string, unknown>

function isRecord(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * A string that contains an absolute per-user / per-machine filesystem path
 * (a WSL /mnt/<drive>/ path, a Windows drive path, or a /home/ or /Users/ path).
 * Relative paths such as "../evaluate/x.json" do not match.
 */
const LOCAL_PATH = /(?:^|[\s"'(=:])(?:\/mnt\/[a-zA-Z]\/|[A-Za-z]:[\\/]|\/(?:home|Users)\/)/

/** JSON paths (e.g. "evaluation.source_file") of every string value holding a local filesystem path. */
export function findLocalPaths(value: unknown, at = ''): string[] {
  if (typeof value === 'string') return LOCAL_PATH.test(value) ? [at || '(root)'] : []
  if (Array.isArray(value)) return value.flatMap((item, i) => findLocalPaths(item, `${at}[${i}]`))
  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, inner]) => findLocalPaths(inner, at ? `${at}.${key}` : key))
  }
  return []
}

function baseName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * Browser-facing copy of a bundle. The historical demo bundle records the
 * evaluation source as an absolute local path; the served copy keeps only the
 * file name. The artifact on disk is never modified. Any OTHER local path left
 * in the data is an error (never silently served).
 */
export function sanitizeBundle(bundle: Json): Json {
  const copy = JSON.parse(JSON.stringify(bundle)) as Json
  const evaluation = copy['evaluation']
  if (isRecord(evaluation) && typeof evaluation['source_file'] === 'string') {
    evaluation['source_file'] = baseName(evaluation['source_file'])
  }
  const remaining = findLocalPaths(copy)
  if (remaining.length > 0) {
    throw new Error(`bundle contains a local filesystem path at: ${remaining.join(', ')}`)
  }
  return copy
}

function isRegularFile(path: string): boolean {
  try {
    const s = lstatSync(path)
    return s.isFile() && !s.isSymbolicLink()
  } catch {
    return false
  }
}

function readJsonObject(path: string): Json {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf-8'))
  if (!isRecord(parsed)) throw new Error('expected a JSON object')
  return parsed
}

/** Trial ids that have a regular, parseable experiments/<id>/path_bundle.json. */
export function listTrialIds(repoRoot: string): string[] {
  const experiments = join(repoRoot, 'experiments')
  let entries
  try {
    entries = readdirSync(experiments, { withFileTypes: true })
  } catch {
    return []
  }
  const ids: string[] = []
  for (const entry of entries) {
    // isDirectory() is false for symlinks, so a symlinked directory is skipped.
    if (!entry.isDirectory() || !ID_PATTERN.test(entry.name)) continue
    const file = join(experiments, entry.name, 'path_bundle.json')
    if (!isRegularFile(file)) continue
    try {
      readJsonObject(file)
    } catch {
      continue
    }
    ids.push(entry.name)
  }
  return ids.sort()
}

function pick(source: Json, keys: readonly string[]): Json {
  const out: Json = {}
  for (const key of keys) {
    if (key in source) out[key] = source[key]
  }
  return out
}

function pickMetric(value: unknown): unknown {
  if (!isRecord(value)) return value
  return pick(value, ['numerator', 'denominator', 'rate', 'ci95'])
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Aggregate-only view of one evaluation phase. Values are copied verbatim from
 * the repository files; nothing is recomputed. The frozen configuration is read
 * directly from its own file and cross-checked against the copy embedded in the
 * results file: a mismatch is an error, never silently reconciled.
 */
export function buildEvaluationProjection(repoRoot: string, phase: Phase): Json {
  const files = PHASE_FILES[phase]
  const config = readJsonObject(join(repoRoot, files.config))
  const results = readJsonObject(join(repoRoot, files.results))
  const embedded = results[files.embeddedConfigKey]
  if (!isRecord(embedded)) throw new Error(`${files.results}: missing ${files.embeddedConfigKey}`)

  for (const key of ['selected_algorithm', 'onset_detector_params', 'delta_align_ns', 'unknown_fraction_threshold']) {
    if (!sameJson(config[key], embedded[key])) {
      throw new Error(`frozen configuration mismatch for ${key} between ${files.config} and ${files.results}`)
    }
  }

  const summary = results['summary']
  if (!isRecord(summary)) throw new Error(`${files.results}: missing summary`)

  const metrics: Json = {}
  for (const key of METRIC_KEYS) metrics[key] = pickMetric(summary[key])

  const projection: Json = {
    schema: 1,
    phase,
    source_files: [files.config.split('/').pop(), files.results.split('/').pop()],
    algorithm: config['selected_algorithm'],
    algorithm_params: config['onset_detector_params'],
    delta_align_ns: config['delta_align_ns'],
    unknown_fraction_threshold: config['unknown_fraction_threshold'],
    n_trials: summary['n_trials'],
    n_positive: summary['n_positive'],
    n_negative_clean_control: summary['n_negative_clean_control'],
    metrics,
    brier_score: results['brier_score'],
  }
  if ('git_commit' in config) projection['git_commit'] = config['git_commit']
  if ('validation_type' in results) projection['validation_type'] = results['validation_type']
  if ('gate_check' in results) projection['gate_check'] = results['gate_check']
  if ('known_unresolved_limitation' in config) {
    projection['known_unresolved_limitation'] = config['known_unresolved_limitation']
  }
  return projection
}

function json(status: number, value: unknown): DataResponse {
  return { status, contentType: JSON_TYPE, body: JSON.stringify(value) }
}

function notFound(): DataResponse {
  return json(404, { error: 'not found' })
}

/**
 * Resolve a request for `data/<relativePath>`. `relativePath` is matched
 * against fixed patterns; it is never used to build a filesystem path.
 */
export function resolveDataRequest(repoRoot: string, relativePath: string): DataResponse {
  let rel: string
  try {
    rel = decodeURIComponent(relativePath).replace(/^\/+/, '')
  } catch {
    return notFound()
  }
  if (rel.includes('\0') || rel.includes('\\') || rel.split('/').includes('..')) return notFound()

  try {
    if (rel === 'index.json') {
      return json(200, { schema: 1, trials: listTrialIds(repoRoot).map((id) => ({ id })) })
    }
    const bundle = /^bundles\/([^/]+)\.json$/.exec(rel)
    if (bundle) {
      const id = bundle[1] ?? ''
      // Membership in the fresh listing is the authorization; the id is never joined unchecked.
      if (!ID_PATTERN.test(id) || !listTrialIds(repoRoot).includes(id)) return notFound()
      const source = readJsonObject(join(repoRoot, 'experiments', id, 'path_bundle.json'))
      return json(200, sanitizeBundle(source))
    }
    if (rel === 'evaluation/phase4.json') return json(200, buildEvaluationProjection(repoRoot, '4'))
    if (rel === 'evaluation/phase4b.json') return json(200, buildEvaluationProjection(repoRoot, '4b'))
  } catch {
    return json(500, { error: 'data unavailable' })
  }
  return notFound()
}

/** Every file the production build emits, derived through resolveDataRequest. */
export function allowedAssets(repoRoot: string): { fileName: string; source: string }[] {
  const relPaths = [
    'index.json',
    ...listTrialIds(repoRoot).map((id) => `bundles/${id}.json`),
    'evaluation/phase4.json',
    'evaluation/phase4b.json',
  ]
  return relPaths.map((rel) => {
    const res = resolveDataRequest(repoRoot, rel)
    if (res.status !== 200) throw new Error(`allowlisted data file could not be built: data/${rel}`)
    return { fileName: `data/${rel}`, source: res.body }
  })
}
