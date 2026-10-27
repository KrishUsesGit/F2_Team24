import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { bundleSchema } from './data/schema.ts'
import { boundaryHop, defaultSelectedHop } from './data/select.ts'
import { statusLabel } from './components/primitives/StatusBadge.tsx'
import { EXPECTED_REAL_BUNDLES, fetchFromAllowlist, readRealBundle } from './test/repo.ts'

/** Any trace of a machine-local path, in text or markup. */
const LOCAL_PATH = /\/mnt\/[a-zA-Z]\/|[A-Za-z]:[\\/]+Users|\/(?:home|Users)\/[^/\s"']+\/|OneDrive/

let requested: string[] = []

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  requested = []
  const real = fetchFromAllowlist()
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    requested.push(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
    return real(input, init)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubReducedMotion(): () => void {
  const original = window.matchMedia
  window.matchMedia = (query: string) =>
    ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList
  return () => {
    window.matchMedia = original
  }
}

const hopButton = (ttl: number) => screen.getByRole('button', { name: new RegExp(`^Hop ${ttl}:`) })

async function choose(user: ReturnType<typeof userEvent.setup>, id: string) {
  const group = await screen.findByRole('group', { name: 'Choose a recorded trial' })
  await user.click(within(group).getByRole('button', { name: id }))
  const stored = bundleSchema.parse(readRealBundle(id))
  await waitFor(() => expect(screen.getByTestId('plain-language')).toHaveTextContent(stored.plain_language.summary))
  return stored
}

describe('hop selection', () => {
  it('selects the first hop of the stored range by default and exposes selection as aria-pressed', async () => {
    const user = userEvent.setup()
    render(<App />)
    const stored = await choose(user, 'p4-held-04-latency-hop2-moderate')
    const expected = defaultSelectedHop(stored)
    expect(expected).toBe(stored.hop_range?.min)
    for (const hop of stored.hops) {
      expect(hopButton(hop.ttl)).toHaveAttribute('aria-pressed', String(hop.ttl === expected))
    }
    expect(screen.getByRole('complementary', { name: `Hop ${expected}` })).toBeInTheDocument()
  })

  it('moves the selection and the inspector together when another hop is chosen', async () => {
    const user = userEvent.setup()
    render(<App />)
    const stored = await choose(user, 'demo-run-01')
    const other = stored.hops.find((hop) => hop.ttl !== defaultSelectedHop(stored))!
    await user.click(hopButton(other.ttl))
    expect(hopButton(other.ttl)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('button', { pressed: true }).filter((b) => b.hasAttribute('data-ttl'))).toHaveLength(1)
    const inspector = screen.getByRole('complementary', { name: `Hop ${other.ttl}` })
    for (const line of other.why_highlighted) expect(inspector).toHaveTextContent(line)
  })

  it('returns to the default hop when a different trial is loaded', async () => {
    const user = userEvent.setup()
    render(<App />)
    await choose(user, 'demo-run-01')
    await user.click(hopButton(1))
    expect(hopButton(1)).toHaveAttribute('aria-pressed', 'true')
    const next = await choose(user, 'p4-held-04-latency-hop2-moderate')
    expect(hopButton(defaultSelectedHop(next))).toHaveAttribute('aria-pressed', 'true')
    expect(hopButton(1)).toHaveAttribute('aria-pressed', 'false')
  })

  it('explains an isolated, uncorroborated onset rather than hiding or promoting it', async () => {
    const user = userEvent.setup()
    render(<App />)
    const stored = await choose(user, 'p4-held-01-clean1')
    const isolated = stored.hops.find((hop) => hop.status === 'healthy' && hop.onset_ns !== null)
    expect(isolated, 'clean1 is expected to hold an isolated onset').toBeDefined()
    await user.click(hopButton(isolated!.ttl))
    const inspector = screen.getByRole('complementary', { name: `Hop ${isolated!.ttl}` })
    expect(inspector).toHaveTextContent('not corroborated')
    expect(inspector).toHaveTextContent('No corroborated onset')
  })
})

describe.each(EXPECTED_REAL_BUNDLES)('rendering driven by the real bundle %s', (id) => {
  it('takes every hop status, the boundary, the confidence and the evidence from the stored file', async () => {
    const user = userEvent.setup()
    render(<App />)
    const stored = await choose(user, id)

    for (const hop of stored.hops) {
      expect(hopButton(hop.ttl)).toHaveAttribute('data-status', hop.status)
      expect(hopButton(hop.ttl)).toHaveAccessibleName(new RegExp(statusLabel(hop.status)))
    }

    const boundary = boundaryHop(stored)
    const statement = screen.getByTestId('boundary-statement')
    if (boundary === null) {
      expect(statement).not.toHaveTextContent(/appears to begin at or after Hop/)
      expect(screen.queryByTestId('boundary-tag')).not.toBeInTheDocument()
    } else {
      expect(boundary).toBe(stored.hop_range?.min)
      expect(statement).toHaveTextContent(`Degradation appears to begin at or after Hop ${boundary}.`)
      expect(screen.getAllByTestId('boundary-tag')).toHaveLength(1)
      expect(hopButton(boundary)).toHaveAccessibleName(/appears to begin at or after this hop/)
    }

    expect(screen.getByTestId('confidence-level')).toHaveTextContent(stored.confidence.level)
    expect(screen.getByText(`score ${stored.confidence.score.toFixed(2)} (heuristic, 0 to 1)`)).toBeInTheDocument()

    const claims = stored.evidence_record_claims ?? []
    for (const claim of claims) {
      if (claim.tag === 'fact' || claim.tag === 'inference' || claim.tag === 'correlation') {
        expect(document.body.textContent).toContain(claim.text)
      }
    }
    expect(screen.getByTestId('rtt-chart')).toBeInTheDocument()
  })

  it('never states a cause and never uses a pass/fail verdict', async () => {
    const user = userEvent.setup()
    render(<App />)
    await choose(user, id)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/\bcaused\b|\bis faulty\b|\bis broken\b|\bresponsible for\b|\bPASSED\b|\bFAILED\b/i)
    expect(text).not.toMatch(/Hop \d (is|was) (the )?(cause|culprit|source)/i)
  })
})

describe('keyboard access', () => {
  it('moves between hops with the arrow keys, Home and End', async () => {
    const user = userEvent.setup()
    render(<App />)
    const stored = await choose(user, 'demo-run-01')
    const last = stored.hops.length
    hopButton(1).focus()
    await user.keyboard('{ArrowRight}')
    expect(hopButton(2)).toHaveFocus()
    await user.keyboard('{ArrowDown}')
    expect(hopButton(3)).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(hopButton(2)).toHaveFocus()
    await user.keyboard('{End}')
    expect(hopButton(last)).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(hopButton(last)).toHaveFocus()
    await user.keyboard('{Home}')
    expect(hopButton(1)).toHaveFocus()
  })

  it('selects the focused hop with Enter and with Space', async () => {
    const user = userEvent.setup()
    render(<App />)
    await choose(user, 'demo-run-01')
    hopButton(2).focus()
    await user.keyboard('{Enter}')
    expect(hopButton(2)).toHaveAttribute('aria-pressed', 'true')
    hopButton(4).focus()
    await user.keyboard(' ')
    expect(hopButton(4)).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('complementary', { name: 'Hop 4' })).toBeInTheDocument()
  })

  it('reaches every hop with Tab and keeps the route a labelled list', async () => {
    const user = userEvent.setup()
    render(<App />)
    const stored = await choose(user, 'demo-run-01')
    const list = screen.getByRole('list', { name: 'Observed path from client to server' })
    expect(within(list).getAllByRole('button')).toHaveLength(stored.hops.length)
    hopButton(1).focus()
    for (let ttl = 2; ttl <= stored.hops.length; ttl += 1) {
      await user.tab()
      expect(hopButton(ttl)).toHaveFocus()
    }
  })

  it('offers a skip link to the main content', () => {
    render(<App />)
    expect(screen.getByRole('link', { name: 'Skip to main content' })).toHaveAttribute('href', '#main')
  })
})

describe('motion', () => {
  it('labels the packets as an illustration and lets them be paused', async () => {
    const user = userEvent.setup()
    render(<App />)
    await choose(user, 'demo-run-01')
    expect(screen.getByTestId('packet-caption')).toHaveTextContent('Illustration only')
    expect(screen.getByTestId('packet-caption')).toHaveTextContent('not measured traffic')
    expect(screen.getByTestId('packet-caption')).toHaveTextContent('no packet-level observations')
    expect(screen.getByTestId('packets')).toHaveAttribute('data-running', 'true')
    const pause = screen.getByRole('button', { name: 'Pause packet animation' })
    await user.click(pause)
    expect(screen.getByTestId('packets')).toHaveAttribute('data-running', 'false')
    expect(screen.getByRole('button', { name: 'Resume packet animation' })).toBeInTheDocument()
  })

  it('removes the packets, the pause control and the scroll bar under reduced motion', async () => {
    const restore = stubReducedMotion()
    try {
      const user = userEvent.setup()
      render(<App />)
      await choose(user, 'demo-run-01')
      expect(screen.getByTestId('packets')).toHaveAttribute('data-hidden', 'true')
      expect(screen.queryByRole('button', { name: /packet animation/ })).not.toBeInTheDocument()
      expect(screen.queryByTestId('scroll-progress')).not.toBeInTheDocument()
      expect(screen.getByTestId('packet-caption')).toHaveTextContent('reduced motion')
      expect(screen.getByTestId('packet-caption')).toHaveTextContent('Illustration only')
      // The scene stays fully usable.
      await user.click(hopButton(2))
      expect(hopButton(2)).toHaveAttribute('aria-pressed', 'true')
      // Nothing is left waiting to be revealed by scrolling.
      for (const el of document.querySelectorAll('.reveal')) expect(el).toHaveAttribute('data-visible', 'true')
      // No cursor parallax variables are written.
      expect(screen.getByTestId('path-scene').style.getPropertyValue('--tilt-x')).toBe('')
    } finally {
      restore()
    }
  })

  it('shows the scroll progress bar when motion is allowed', async () => {
    render(<App />)
    expect(await screen.findByTestId('scroll-progress')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('safe data exposure in the rendered interface', () => {
  it.each(EXPECTED_REAL_BUNDLES)('shows no local filesystem path for %s, in text or in markup', async (id) => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await choose(user, id)
    await user.click(hopButton(1))
    // Open every disclosure so that hidden technical text is in the document too.
    for (const details of container.querySelectorAll('details')) details.open = true
    expect(container.textContent ?? '').not.toMatch(LOCAL_PATH)
    expect(container.innerHTML).not.toMatch(LOCAL_PATH)
  })

  it('shows the historical demo bundle with only the base name of its source file', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    const onDisk = bundleSchema.parse(readRealBundle('demo-run-01'))
    expect(onDisk.evaluation?.source_file).toMatch(LOCAL_PATH) // the artifact itself is preserved
    await choose(user, 'demo-run-01')
    for (const details of container.querySelectorAll('details')) details.open = true
    expect(container.textContent).toContain('held_out_results_4b.json')
    expect(container.textContent).not.toContain(onDisk.evaluation!.source_file)
  })

  it('only ever requests files from the explicit /data/ allowlist, and nothing remote', async () => {
    const user = userEvent.setup()
    render(<App />)
    for (const id of EXPECTED_REAL_BUNDLES) await choose(user, id)
    expect(requested.length).toBeGreaterThan(0)
    for (const url of requested) {
      expect(new URL(url, window.location.href).origin).toBe(window.location.origin)
      expect(url).toMatch(/\/data\/(index\.json|bundles\/[A-Za-z0-9._-]+\.json|evaluation\/phase4b?\.json)$/)
    }
  })

  it('loads no external script, stylesheet, font or image', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await choose(user, 'demo-run-01')
    const external = [...container.querySelectorAll('[src], [href]')]
      .map((el) => el.getAttribute('src') ?? el.getAttribute('href') ?? '')
      .filter((value) => /^(https?:)?\/\//.test(value))
    expect(external).toEqual([])
  })
})
