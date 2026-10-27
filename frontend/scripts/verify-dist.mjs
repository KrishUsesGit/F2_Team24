#!/usr/bin/env node
/**
 * Verifies the PRODUCTION BUILD, not the source: walks dist/ and fails if it
 * contains anything outside the approved set, any raw trace / database /
 * credential file, any per-trial label, or any runtime CDN reference.
 * Read-only: it never modifies dist/.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist', import.meta.url))
const failures = []
const fail = (message) => failures.push(message)

function walk(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

let files
try {
  files = walk(dist).map((f) => relative(dist, f).split(sep).join('/'))
} catch {
  console.error('dist/ not found: run "npm run build" first')
  process.exit(1)
}

const APPROVED_DATA = [
  /^data\/index\.json$/,
  /^data\/bundles\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/,
  /^data\/evaluation\/phase4b?\.json$/,
]
const APPROVED_APP = [/^index\.html$/, /^assets\/[^/]+\.(js|css|woff2?)$/]
const PROHIBITED_NAME = /\.jsonl$|\.db$|\.sqlite3?$|\.env|\.pem$|\.key$|id_rsa|credential|secret|groundtruth|trial_meta|held_out_results|frozen_config|\.map$/i

for (const file of files) {
  if (PROHIBITED_NAME.test(file)) fail(`prohibited file in dist: ${file}`)
  const approved = [...APPROVED_DATA, ...APPROVED_APP].some((re) => re.test(file))
  if (!approved) fail(`unexpected file in dist (not on the approved list): ${file}`)
}

if (!files.includes('data/index.json')) fail('data/index.json is missing from dist')
if (!files.includes('data/evaluation/phase4.json') || !files.includes('data/evaluation/phase4b.json')) {
  fail('evaluation projections are missing from dist')
}
if (files.filter((f) => f.startsWith('data/bundles/')).length === 0) fail('no presentation bundles in dist')

// Label / protected-data markers must not appear in any emitted evaluation file.
const LABEL_MARKERS = ['per_trial_detail', 'held_out_set', 'fault_type', 'expected_hop', 'tuning_set', 'impairment_type']
for (const file of files.filter((f) => f.startsWith('data/evaluation/'))) {
  const text = readFileSync(join(dist, file), 'utf-8')
  for (const marker of LABEL_MARKERS) if (text.includes(marker)) fail(`${file} contains label field "${marker}"`)
  if (/p4-held|p4-tune|p4b-tune/.test(text)) fail(`${file} names an experiment trial`)
}

// No runtime CDN / remote dependency in anything that executes or styles the page.
const REMOTE = /fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare|unpkg\.com|cdn\.jsdelivr|googletagmanager|https?:\/\/[^\s"')]*\.(js|css|woff2?)\b/i
for (const file of files.filter((f) => /\.(html|css|js)$/.test(f))) {
  const text = readFileSync(join(dist, file), 'utf-8')
  const hit = REMOTE.exec(text)
  if (hit) fail(`${file} references a remote runtime dependency: ${hit[0].slice(0, 80)}`)
}
const html = readFileSync(join(dist, 'index.html'), 'utf-8')
if (/<script[^>]+src="https?:/i.test(html) || /<link[^>]+href="https?:/i.test(html)) {
  fail('index.html loads a remote script or stylesheet')
}

// Fonts must be bundled.
if (!files.some((f) => f.endsWith('.woff2'))) fail('no bundled .woff2 font file in dist/assets')

// No per-user / per-machine filesystem path may ship in any emitted file. The historical
// demo bundle records one; the build must emit a sanitized copy (vite/dataAllowlist.ts).
const LOCAL_PATH = /(?:\/mnt\/[a-zA-Z]\/|[A-Za-z]:[\\/]+Users[\\/]|\/(?:home|Users)\/[^/\s"']+\/|OneDrive)/
for (const file of files) {
  if (!/\.(json|html|css|js)$/.test(file)) continue
  const hit = LOCAL_PATH.exec(readFileSync(join(dist, file), 'utf-8'))
  if (hit) fail(`${file} contains a local filesystem path: ${hit[0].slice(0, 60)}`)
}

if (failures.length > 0) {
  console.error(`verify:dist FAILED (${failures.length}):`)
  for (const message of failures) console.error('  - ' + message)
  process.exit(1)
}

const bundles = files.filter((f) => f.startsWith('data/bundles/')).length
console.log(`verify:dist OK: ${files.length} files (${bundles} bundles, 2 evaluation projections, 1 index); no raw traces, databases, labels, credentials or remote runtime dependencies.`)
