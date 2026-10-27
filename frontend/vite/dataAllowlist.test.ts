import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { evaluationProjectionSchema } from '../src/data/schema.ts'
import { REPO_ROOT } from '../src/test/repo.ts'
import {
  allowedAssets,
  buildEvaluationProjection,
  findLocalPaths,
  listTrialIds,
  resolveDataRequest,
} from './dataAllowlist.ts'

function source(id: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(REPO_ROOT, 'experiments', id, 'path_bundle.json'), 'utf-8'))
}
const REAL = [
  'demo-run-01',
  'p4-held-01-clean1',
  'p4-held-04-latency-hop2-moderate',
  'p4-held-12-unknown-plus-impair',
]

describe('trial listing', () => {
  it('lists exactly the experiment directories that hold a path_bundle.json', () => {
    const ids = listTrialIds(REPO_ROOT)
    for (const id of REAL) expect(ids).toContain(id)
    // Directories without a bundle (raw tuning trials) must never appear.
    expect(ids.some((id) => id.startsWith('p4-tune-') || id.startsWith('p4b-tune-'))).toBe(false)
  })
})

describe('bundle serving', () => {
  const source = (id: string) =>
    JSON.parse(readFileSync(join(REPO_ROOT, 'experiments', id, 'path_bundle.json'), 'utf-8')) as Record<string, unknown>

  it.each(REAL)('serves %s with the same content as experiments/<id>/path_bundle.json', (id) => {
    const res = resolveDataRequest(REPO_ROOT, `bundles/${id}.json`)
    expect(res.status).toBe(200)
    const served = JSON.parse(res.body) as { evaluation?: { source_file?: string } } & Record<string, unknown>
    const original = source(id) as { evaluation?: { source_file?: string } } & Record<string, unknown>
    // Identical in every field except the (possibly absolute) evaluation source path.
    if (served.evaluation) delete served.evaluation.source_file
    if (original.evaluation) delete original.evaluation.source_file
    expect(served).toEqual(original)
  })
})

describe('no local filesystem path reaches the browser (regression)', () => {
  it('the historical demo bundle on disk still contains its absolute path (artifact preserved)', () => {
    // If this fails, the historical source artifact was edited; it must stay unchanged.
    const demo = source('demo-run-01')
    expect(findLocalPaths(demo)).toEqual(['evaluation.source_file'])
  })

  it.each(REAL)('the served copy of %s contains no local path anywhere', (id) => {
    const res = resolveDataRequest(REPO_ROOT, `bundles/${id}.json`)
    expect(findLocalPaths(JSON.parse(res.body))).toEqual([])
    expect(res.body).not.toMatch(/\/mnt\/|Users[\\/]|OneDrive|Krish/i)
  })

  it('reduces the demo bundle source path to its file name', () => {
    const served = JSON.parse(resolveDataRequest(REPO_ROOT, 'bundles/demo-run-01.json').body)
    expect(served.evaluation.source_file).toBe('held_out_results_4b.json')
  })

  it.each(REAL)('serves a bare file name (no directory part) as the evaluation source of %s', (id) => {
    const served = JSON.parse(resolveDataRequest(REPO_ROOT, `bundles/${id}.json`).body)
    expect(served.evaluation.source_file).toMatch(/^[A-Za-z0-9._-]+$/)
  })

  it('refuses (never serves) a bundle that carries a local path anywhere else', () => {
    const root = mkdtempSync(join(tmpdir(), 'hoptrace-paths-'))
    try {
      const id = 'p4-held-01-clean1'
      mkdirSync(join(root, 'experiments', id), { recursive: true })
      const bundle = source(id)
      ;(bundle['hops'] as { why_highlighted: string[] }[])[0]!.why_highlighted.push('see C:\\Users\\someone\\notes.txt')
      writeFileSync(join(root, 'experiments', id, 'path_bundle.json'), JSON.stringify(bundle))
      expect(resolveDataRequest(root, `bundles/${id}.json`).status).toBe(500)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('detects the path shapes it must catch and ignores relative paths and ordinary text', () => {
    expect(findLocalPaths({ a: '/mnt/c/Users/x/y.json' })).toEqual(['a'])
    expect(findLocalPaths({ a: 'C:\\Users\\x\\y.json' })).toEqual(['a'])
    expect(findLocalPaths({ a: ['ok', 'see /home/someone/file'] })).toEqual(['a[1]'])
    expect(findLocalPaths({ a: '../evaluate/held_out_results_4b.json', b: 'Hop 3 at 10.10.3.2', c: 'a/b/c' })).toEqual([])
  })
})

describe('everything outside the allowlist is refused', () => {
  const refused = [
    'hop.jsonl',
    'bundles/p4-held-01-clean1.jsonl',
    'bundles/p4-held-01-clean1/hop.jsonl',
    'bundles/p4-held-01-clean1/path_bundle.json',
    'bundles/../evaluate/held_out_results.json',
    'bundles/..%2f..%2fevaluate%2fheld_out_results.json',
    'bundles/%2e%2e%2fevaluate%2fheld_out_results.json',
    'bundles/..\\..\\evaluate\\held_out_results.json',
    'bundles/p4-held-01-clean1.json%00.jsonl',
    'evaluation/held_out_results.json',
    'evaluation/held_out_results_4b.json',
    'evaluation/frozen_config_4b.json',
    'evaluation/phase4.json/extra',
    'evaluation/phase5.json',
    '../package.json',
    '/etc/passwd',
    'experiments/p4-held-04-latency-hop2-moderate/hop.jsonl',
    'experiments/p4-held-04-latency-hop2-moderate/app.jsonl',
    'bundles/p4-tune-01-clean1.json', // a real experiment directory with no bundle
    'bundles/does-not-exist.json',
    'bundles/.json',
    '',
    '%',
  ]
  it.each(refused)('refuses %j', (path) => {
    expect(resolveDataRequest(REPO_ROOT, path).status).not.toBe(200)
  })
})

describe('evaluation projections', () => {
  const FORBIDDEN_KEYS = ['per_trial_detail', 'held_out_set', 'fault_type', 'expected_hop', 'tuning_set', 'reported']

  it.each(['4', '4b'] as const)('phase %s validates against the strict frontend schema', (phase) => {
    const projection = buildEvaluationProjection(REPO_ROOT, phase)
    expect(evaluationProjectionSchema.safeParse(projection).success).toBe(true)
  })

  function allKeys(value: unknown): string[] {
    if (Array.isArray(value)) return value.flatMap(allKeys)
    if (typeof value === 'object' && value !== null) {
      return Object.entries(value).flatMap(([key, inner]) => [key, ...allKeys(inner)])
    }
    return []
  }

  it.each(['4', '4b'] as const)('phase %s contains no per-trial labels', (phase) => {
    const projection = buildEvaluationProjection(REPO_ROOT, phase)
    const keys = allKeys(projection)
    for (const key of FORBIDDEN_KEYS) expect(keys).not.toContain(key)
    // And no trial name (which encodes the fault type and hop) appears anywhere in a value.
    expect(JSON.stringify(projection)).not.toMatch(
      /p4-held|p4-tune|p4b-tune|latency-hop|jitter-hop|loss-hop|bandwidth-hop/,
    )
  })

  it('copies the frozen configuration straight from the configuration files', () => {
    const cfg4 = JSON.parse(readFileSync(join(REPO_ROOT, 'evaluate/frozen_config.json'), 'utf-8'))
    const cfg4b = JSON.parse(readFileSync(join(REPO_ROOT, 'evaluate/frozen_config_4b.json'), 'utf-8'))
    const p4 = buildEvaluationProjection(REPO_ROOT, '4')
    const p4b = buildEvaluationProjection(REPO_ROOT, '4b')
    expect(p4['algorithm']).toBe(cfg4.selected_algorithm)
    expect(p4b['algorithm']).toBe(cfg4b.selected_algorithm)
    expect(p4['algorithm']).toBe('mad')
    expect(p4b['algorithm']).toBe('mad_sustained')
    expect(p4b['algorithm_params']).toEqual(cfg4b.onset_detector_params)
    expect(p4b['git_commit']).toBe(cfg4b.git_commit)
  })

  it('copies result values verbatim from the result files', () => {
    const res4 = JSON.parse(readFileSync(join(REPO_ROOT, 'evaluate/held_out_results.json'), 'utf-8'))
    const p4 = buildEvaluationProjection(REPO_ROOT, '4') as {
      metrics: { false_attribution_rate: { numerator: number; denominator: number; rate: number } }
    }
    expect(p4.metrics.false_attribution_rate.numerator).toBe(res4.summary.false_attribution_rate.numerator)
    expect(p4.metrics.false_attribution_rate.denominator).toBe(res4.summary.false_attribution_rate.denominator)
    expect(p4.metrics.false_attribution_rate.rate).toBe(res4.summary.false_attribution_rate.rate)
    expect(p4.metrics.false_attribution_rate.numerator).toBe(3)
    expect(p4.metrics.false_attribution_rate.denominator).toBe(12)
  })

  it('fails (never reconciles) when the config file and the results file disagree', () => {
    const root = mkdtempSync(join(tmpdir(), 'hoptrace-allowlist-'))
    try {
      mkdirSync(join(root, 'evaluate'), { recursive: true })
      for (const file of ['frozen_config.json', 'held_out_results.json']) {
        cpSync(join(REPO_ROOT, 'evaluate', file), join(root, 'evaluate', file))
      }
      const cfg = JSON.parse(readFileSync(join(root, 'evaluate', 'frozen_config.json'), 'utf-8'))
      cfg.selected_algorithm = 'something_else'
      writeFileSync(join(root, 'evaluate', 'frozen_config.json'), JSON.stringify(cfg))
      expect(() => buildEvaluationProjection(root, '4')).toThrow(/mismatch/)
      expect(resolveDataRequest(root, 'evaluation/phase4.json').status).toBe(500)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe('production asset list', () => {
  const assets = allowedAssets(REPO_ROOT)
  const names = assets.map((asset) => asset.fileName)

  it('contains only the index, the bundles and the two evaluation projections', () => {
    for (const name of names) {
      expect(name).toMatch(/^data\/(index\.json|bundles\/[A-Za-z0-9._-]+\.json|evaluation\/phase4b?\.json)$/)
    }
    expect(names).toContain('data/index.json')
    expect(names).toContain('data/evaluation/phase4.json')
    expect(names).toContain('data/evaluation/phase4b.json')
    for (const id of REAL) expect(names).toContain(`data/bundles/${id}.json`)
  })

  it('never includes raw traces, databases or label files', () => {
    for (const name of names) expect(name).not.toMatch(/\.jsonl$|\.db$|\.sqlite|held_out_results|frozen_config|trial_meta/)
  })
})
