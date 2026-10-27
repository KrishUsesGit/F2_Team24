// Production-preview check in a real browser.
//
// Starts the real `vite preview` server on the built dist/, opens the page in
// the locally installed Chrome or Edge, and switches through all four recorded
// trials in one page session, as a user does. For every trial it fails unless:
//   - the bundle request returned HTTP 200 with a JSON content type,
//   - no request failed at the network level,
//   - no error panel is shown and the stored plain-language summary is rendered,
//   - the five hop controls are present and one is selected.
// It then checks, in the same session, the demo interactions: packet pause/resume,
// the guided explanation toggle and walkthrough, technical evidence, and a
// degraded-to-clean trial switch.
// It also checks that a prohibited URL returns no research data.
//
// Usage: npm run build && npm run check:preview
// Set BROWSER_PATH to use a specific Chrome/Edge executable.

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { launchBrowser } from './lib/browser.mjs'

const ROOT = process.cwd()
const VITE_CLI = join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js')
const TRIALS = ['demo-run-01', 'p4-held-01-clean1', 'p4-held-04-latency-hop2-moderate', 'p4-held-12-unknown-plus-impair']

if (!existsSync(join(ROOT, 'dist', 'index.html'))) {
  console.error('check-preview: dist/ not found. Run `npm run build` first.')
  process.exit(2)
}

const port = await new Promise((resolve) => {
  const probe = createServer().listen(0, '127.0.0.1', () => {
    const { port: free } = probe.address()
    probe.close(() => resolve(free))
  })
})
const origin = `http://127.0.0.1:${port}`

const preview = spawn(process.execPath, [VITE_CLI, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  cwd: ROOT,
  stdio: 'ignore',
})
const stopAll = (browser) => {
  browser?.close()
  preview.kill()
}

let ready = false
for (let attempt = 0; attempt < 100 && !ready; attempt += 1) {
  try {
    ready = (await fetch(origin + '/')).ok
  } catch {
    await sleep(100)
  }
}
if (!ready) {
  console.error('check-preview: `vite preview` did not start.')
  stopAll()
  process.exit(2)
}

let browser
try {
  browser = await launchBrowser('hoptrace-preview-')
} catch (error) {
  console.error('check-preview: ' + error.message)
  stopAll()
  process.exit(2)
}
const { send } = browser

const responses = new Map() // requestId -> { url, status, type }
const failed = []
browser.onEvent((method, params) => {
  if (method === 'Network.responseReceived') {
    responses.set(params.requestId, { url: params.response.url, status: params.response.status, type: params.response.mimeType })
  } else if (method === 'Network.loadingFailed' && !params.canceled) {
    failed.push(`${params.errorText} (${responses.get(params.requestId)?.url ?? params.requestId})`)
  }
})
await send('Network.enable')
await send('Network.setCacheDisabled', { cacheDisabled: true })
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false })
await send('Page.navigate', { url: origin + '/' })

const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
  return result.value
}

const failures = []
const lines = []

for (const id of TRIALS) {
  const before = responses.size
  const state = await evaluate(`(async () => {
    const wait = (ms) => new Promise((r) => setTimeout(r, ms))
    const id = ${JSON.stringify(id)}
    let button = null
    for (let i = 0; i < 100 && !button; i += 1) {
      button = [...document.querySelectorAll('[role="group"] button')].find((b) => b.textContent.trim() === id)
      if (!button) await wait(100)
    }
    if (!button) return { error: 'trial button not found' }
    button.click()
    for (let i = 0; i < 100; i += 1) {
      const alert = document.querySelector('[role="alert"]')
      const summary = document.querySelector('[data-testid="plain-language"]')
      const pressed = button.getAttribute('aria-pressed') === 'true'
      if (alert) return { alert: alert.textContent }
      if (summary && pressed && document.querySelector('[data-testid="result-state"]') &&
          document.querySelector('.path-route') && summary.closest('section')) {
        await wait(150)
        break
      }
      await wait(100)
    }
    return {
      alert: document.querySelector('[role="alert"]')?.textContent ?? null,
      summary: document.querySelector('[data-testid="plain-language"]')?.textContent ?? null,
      pressed: button.getAttribute('aria-pressed'),
      hops: document.querySelectorAll('button.hop-node').length,
      selected: document.querySelectorAll('button.hop-node[aria-pressed="true"]').length,
      url: location.search,
    }
  })()`)

  const bundleUrl = `${origin}/data/bundles/${id}.json`
  const hit = [...responses.values()].filter((r) => r.url === bundleUrl).at(-1)
  let stored = null
  try {
    stored = await (await fetch(bundleUrl)).json()
  } catch {
    failures.push(`trial ${id}: ${bundleUrl} did not return JSON`)
  }

  const where = `trial ${id}`
  if (state.error) failures.push(`${where}: ${state.error}`)
  else {
    if (!hit) failures.push(`${where}: the browser never requested ${bundleUrl}`)
    else if (hit.status !== 200 || !/json/.test(hit.type)) failures.push(`${where}: HTTP ${hit.status} ${hit.type}`)
    if (state.alert) failures.push(`${where}: error panel shown: ${state.alert.slice(0, 120)}`)
    if (stored && state.summary !== stored.plain_language.summary) failures.push(`${where}: rendered summary differs from the stored bundle`)
    if (state.pressed !== 'true') failures.push(`${where}: trial button is not selected`)
    if (state.hops !== 5 || state.selected !== 1) failures.push(`${where}: expected 5 hop controls with 1 selected, got ${state.hops}/${state.selected}`)
    if (state.url !== `?trial=${id}`) failures.push(`${where}: address bar is ${state.url}`)
  }
  lines.push(`  ${id}: HTTP ${hit?.status ?? 'none'} ${hit?.type ?? ''}, ${state.alert ? 'ERROR PANEL' : 'rendered'}, ${before} -> ${responses.size} responses`)
}

// ---- interactions the demo relies on, in the real browser
{
  const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms))
  const click = (expr) => evaluate(`(${expr}).click()`)
  const btn = (re) => `[...document.querySelectorAll('button')].find((b) => ${re}.test(b.textContent))`
  const pick = (id) => click(`[...document.querySelectorAll('[role="group"] button')].find((b) => b.textContent.trim() === ${JSON.stringify(id)})`)
  const waitSummary = (id) => evaluate(`(async () => { for (let i = 0; i < 80; i += 1) { if (document.querySelector('[role="group"] button[aria-pressed="true"]')?.textContent.trim() === ${JSON.stringify(id)} && document.querySelector('[data-testid="plain-language"]')) return true; await new Promise((r) => setTimeout(r, 100)) } return false })()`)
  const D = 'p4-held-04-latency-hop2-moderate'
  const C = 'p4-held-01-clean1'

  await pick(D); await waitSummary(D)

  // packets: pause freezes them, resume restarts them
  await evaluate(`document.querySelector('[data-testid="path-scene"]').scrollIntoView({block:'center'})`)
  await sleepMs(900)
  const packets = () => evaluate(`({ left: [...document.querySelectorAll('.packet')].map((p) => Math.round(p.getBoundingClientRect().left)), state: [...document.querySelectorAll('.packet')].map((p) => getComputedStyle(p).animationPlayState), label: [...document.querySelectorAll('button')].find((b) => /packet animation/.test(b.textContent))?.textContent })`)
  const p0 = await packets(); await sleepMs(400); const p1 = await packets()
  if (JSON.stringify(p0.left) === JSON.stringify(p1.left)) failures.push('packets are not moving by default')
  await click(btn('/Pause packet animation/'))
  await sleepMs(300)
  const q0 = await packets(); await sleepMs(600); const q1 = await packets()
  if (!q0.state.every((s) => s === 'paused') || JSON.stringify(q0.left) !== JSON.stringify(q1.left) || !/Resume/.test(q0.label)) failures.push(`pause does not stop the packets: ${JSON.stringify([q0, q1.left])}`)
  await click(btn('/Resume packet animation/'))
  await sleepMs(300)
  const r0 = await packets(); await sleepMs(500); const r1 = await packets()
  if (!r0.state.every((s) => s === 'running') || JSON.stringify(r0.left) === JSON.stringify(r1.left)) failures.push(`resume does not restart the packets: ${JSON.stringify([r0, r1.left])}`)
  lines.push(`  packets: pause -> ${q0.state[0]} (frozen=${JSON.stringify(q0.left) === JSON.stringify(q1.left)}), resume -> ${r0.state[0]}`)

  // guided explanation: toggle, walkthrough, trial switch, technical evidence
  const guided = () => evaluate(`!!document.querySelector('#guided-title')`)
  if (await guided()) failures.push('guided explanation is on by default')
  await click(btn('/Guided explanation/'))
  await sleepMs(300)
  if (!(await guided())) failures.push('guided toggle did not open the panel')
  await click(btn('/Start the 5-step walkthrough/'))
  const step = () => evaluate(`document.querySelector('[data-testid="walkthrough-progress"]')?.textContent ?? null`)
  const seen = []
  for (let i = 0; i < 4; i += 1) { seen.push(await step()); await click(btn('/^Next$/')); await sleepMs(120) }
  seen.push(await step())
  await click(btn('/^Previous$/')); await sleepMs(120)
  seen.push(await step())
  await click(btn('/Exit walkthrough/')); await sleepMs(150)
  const exited = await evaluate(`!document.querySelector('[data-testid="walkthrough"]') && !!document.querySelector('[data-testid="explanation-overview"]')`)
  if (seen.join('|') !== 'Step 1 of 5|Step 2 of 5|Step 3 of 5|Step 4 of 5|Step 5 of 5|Step 4 of 5' || !exited) failures.push(`walkthrough controls: ${seen.join('|')} exited=${exited}`)
  const degradedText = await evaluate(`document.querySelector('#guided-title').closest('section').innerText`)
  if (!/The symptom the application saw/.test(degradedText) || !degradedText.includes(D)) failures.push('guided panel does not describe the degraded trial')

  await click(`document.querySelector('button[aria-controls]') ? [...document.querySelectorAll('button[aria-expanded]')].find((b) => /Technical details/.test(b.textContent)) : null`)
  await sleepMs(150)
  const tech = await evaluate(`(() => { const b = [...document.querySelectorAll('button[aria-expanded]')].find((x) => /Technical details/.test(x.textContent)); const p = document.getElementById(b.getAttribute('aria-controls')); return { exp: b.getAttribute('aria-expanded'), h: p.getBoundingClientRect().height, hasTrial: p.innerText.includes(${JSON.stringify(D)}) } })()`)
  if (tech.exp !== 'true' || tech.h <= 0 || !tech.hasTrial) failures.push(`technical evidence did not expand: ${JSON.stringify(tech)}`)

  await pick(C); await waitSummary(C); await sleepMs(300)
  const cleanText = await evaluate(`document.querySelector('#guided-title')?.closest('section').innerText ?? ''`)
  if (!cleanText.includes(C) || cleanText.includes(D) || /The symptom the application saw/.test(cleanText) || !/No onset was detected/.test(cleanText)) failures.push(`guided panel is stale or uses symptom wording on the clean trial: ${cleanText.slice(0, 200)}`)
  if (await evaluate(`document.querySelector('[data-testid="walkthrough"]') !== null`)) failures.push('walkthrough survived a trial change')
  await click(btn('/Guided explanation/')); await sleepMs(200)
  if (await guided()) failures.push('guided toggle did not close the panel')
  lines.push(`  guided: toggle on/off, walkthrough ${seen.join(' > ')}, technical evidence expanded, clean trial explained distinctly`)
}

// A prohibited URL must not return research data (the preview server answers with the app page).
for (const path of ['/data/bundles/../../experiments/demo-run-01/path_bundle.json', '/data/evaluation/held_out_results_4b.json', '/package.json']) {
  const res = await fetch(origin + path)
  const text = await res.text()
  if (/"trial_id"|expected_hop|"fault_type"|"scripts"/.test(text) || /json/.test(res.headers.get('content-type') ?? '')) {
    failures.push(`prohibited URL ${path} returned data (HTTP ${res.status})`)
  }
}

if (failed.length > 0) failures.push(`failed network requests: ${failed.join('; ')}`)

stopAll(browser)

console.log(lines.join('\n'))
if (failures.length > 0) {
  console.error(`check-preview FAILED (${failures.length}):`)
  for (const line of failures) console.error('  - ' + line)
  process.exit(1)
}
console.log(`check-preview OK: ${TRIALS.length} trials switched in one real-browser session against \`vite preview\`; every bundle HTTP 200 JSON, rendered, no failed requests; packet pause/resume, guided explanation and technical evidence work; prohibited URLs return no data.`)
process.exit(0)
