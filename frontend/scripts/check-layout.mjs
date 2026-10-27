// Responsive layout check against the REAL production build, in a real browser.
//
// jsdom has no layout engine, so horizontal overflow cannot be tested in unit
// tests. This script serves dist/ from a tiny local static server, drives the
// locally installed Chrome or Edge through the DevTools protocol (no added
// dependency; Node's built-in WebSocket), and fails if at any tested width,
// for any real bundle:
//   - the page scrolls horizontally,
//   - hop labels on the 3D path overlap each other,
//   - a hop control is smaller than 44 x 44 CSS pixels.
//
// Usage: npm run build && npm run check:layout
// Set BROWSER_PATH to use a specific Chrome/Edge executable.

import { existsSync, readFileSync, statSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { launchBrowser } from './lib/browser.mjs'

const DIST = resolve(process.cwd(), 'dist')
const WIDTHS = [320, 375, 414, 768, 1024, 1099, 1100, 1280, 1440, 1920]
const TRIALS = ['demo-run-01', 'p4-held-01-clean1', 'p4-held-04-latency-hop2-moderate', 'p4-held-12-unknown-plus-impair']
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.woff2': 'font/woff2', '.svg': 'image/svg+xml' }

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('check-layout: dist/ not found. Run `npm run build` first.')
  process.exit(2)
}

// Static server for dist/ only.
const server = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost')
  let file = normalize(join(DIST, decodeURIComponent(url.pathname)))
  if (!file.startsWith(DIST + sep) && file !== DIST) {
    response.writeHead(403).end()
    return
  }
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(DIST, 'index.html')
  response.writeHead(200, { 'content-type': MIME[extname(file)] ?? 'application/octet-stream' })
  response.end(readFileSync(file))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`

let browser
try {
  browser = await launchBrowser('hoptrace-layout-')
} catch (error) {
  console.error('check-layout: ' + error.message)
  server.close()
  process.exit(2)
}
const { send } = browser

const MEASURE = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  for (let i = 0; i < 60 && !document.querySelector('[data-testid="boundary-statement"]'); i += 1) await wait(100)
  await wait(300)
  const root = document.documentElement
  const uprights = [...document.querySelectorAll('.hop-upright')].map((el) => el.getBoundingClientRect())
  const scene = document.querySelector('[data-testid="path-scene"]')
  const stage = scene && getComputedStyle(scene.querySelector('.path-stage')).transformStyle
  let overlaps = 0
  if (stage === 'preserve-3d') {
    const labels = [...document.querySelectorAll('.hop-upright > span:last-child')].map((el) => el.getBoundingClientRect())
    for (let i = 1; i < labels.length; i += 1) if (labels[i].left < labels[i - 1].right - 1) overlaps += 1
  }
  const tag = document.querySelector('[data-testid="boundary-tag"]')
  const lead = document.querySelector('#path > div p')
  const tagCollides = !!(tag && lead && tag.getBoundingClientRect().top < lead.getBoundingClientRect().bottom - 1 &&
    tag.getBoundingClientRect().bottom > lead.getBoundingClientRect().top)
  const chart = document.querySelector('[data-testid="rtt-chart"]')
  let chartProblem = null
  if (chart) {
    const top = Number(chart.dataset.plotTop)
    const bottom = Number(chart.dataset.plotBottom)
    const box = document.querySelector('[data-testid="rtt-trace"]').getBBox()
    if (box.y <= top || box.y + box.height >= bottom) chartProblem = 'trace leaves the plot (' + box.y.toFixed(1) + '..' + (box.y + box.height).toFixed(1) + ' vs ' + top + '..' + bottom + ')'
    const labels = [...chart.querySelectorAll('[data-testid="rtt-marker"] text')].map((t) => t.getBoundingClientRect())
    const frame = [...chart.children].filter((e) => e.tagName === 'rect' && e.getAttribute('fill') === 'none').at(-1).getBoundingClientRect()
    for (let i = 0; i < labels.length && !chartProblem; i += 1) {
      if (labels[i].bottom > frame.top + 1) chartProblem = 'a marker label overlaps the plot frame'
      for (let j = i + 1; j < labels.length; j += 1) {
        const a = labels[i], b = labels[j]
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) chartProblem = 'two marker labels overlap'
      }
    }
  }
  const small = [...document.querySelectorAll('button.hop-node')]
    .map((el) => ({ ttl: el.dataset.ttl, ...el.getBoundingClientRect().toJSON() }))
    .filter((r) => r.width < 44 || r.height < 44)
    .map((r) => r.ttl + ':' + Math.round(r.width) + 'x' + Math.round(r.height))
  return {
    ready: !!document.querySelector('[data-testid="boundary-statement"]'),
    scrollWidth: root.scrollWidth,
    clientWidth: root.clientWidth,
    mode3d: stage === 'preserve-3d',
    overlaps,
    tagCollides,
    chartProblem,
    small,
    hops: document.querySelectorAll('button.hop-node').length,
  }
})()`

const failures = []
let checks = 0
for (const width of WIDTHS) {
  for (const trial of TRIALS) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 768 })
    await send('Page.navigate', { url: `${origin}/?trial=${trial}` })
    await sleep(400)
    const { result } = await send('Runtime.evaluate', { expression: MEASURE, awaitPromise: true, returnByValue: true })
    const m = result.value
    checks += 1
    const where = `${width}px ${trial}`
    if (!m.ready) failures.push(`${where}: page did not render the trial`)
    else {
      if (m.scrollWidth > m.clientWidth) failures.push(`${where}: horizontal overflow (${m.scrollWidth} > ${m.clientWidth})`)
      if (m.overlaps > 0) failures.push(`${where}: ${m.overlaps} overlapping hop label(s) in 3D mode`)
      if (m.chartProblem) failures.push(`${where}: RTT chart: ${m.chartProblem}`)
      if (m.tagCollides) failures.push(`${where}: the boundary tag overlaps the section text`)
      if (m.small.length > 0) failures.push(`${where}: hop controls under 44px: ${m.small.join(', ')}`)
      if (m.hops !== 5) failures.push(`${where}: expected 5 hop controls, found ${m.hops}`)
    }
  }
}

browser.close()
server.close()

if (failures.length > 0) {
  console.error(`check-layout FAILED (${failures.length} of ${checks} checks):`)
  for (const line of failures) console.error('  - ' + line)
  process.exit(1)
}
console.log(`check-layout OK: ${checks} checks (${WIDTHS.length} widths x ${TRIALS.length} real trials): no horizontal overflow, no overlapping hop labels or text, RTT trace and marker labels contained, all hop controls >= 44px.`)
process.exit(0)
