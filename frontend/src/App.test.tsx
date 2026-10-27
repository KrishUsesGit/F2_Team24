import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { formatMs } from './data/format.ts'
import { bundleSchema } from './data/schema.ts'
import { EXPECTED_REAL_BUNDLES, fetchFromAllowlist, readRealBundle } from './test/repo.ts'

const CAUSAL_PHRASES = [/caused/i, /is faulty/i, /is broken/i, /responsible for/i, /your fault/i, /\bPASSED\b/]

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', fetchFromAllowlist())
})

function hopButton(ttl: number) {
  return screen.getByRole('button', { name: new RegExp(`^Hop ${ttl}:`) })
}

async function chooseTrial(user: ReturnType<typeof userEvent.setup>, id: string) {
  const group = await screen.findByRole('group', { name: 'Choose a recorded trial' })
  await user.click(within(group).getByRole('button', { name: id }))
}

describe('application shell with real data', () => {
  it('states the product message and what the evidence does and does not show', async () => {
    render(<App />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      "Don't just detect lag. Find where the degradation begins.",
    )
    const banner = await screen.findByRole('region', { name: 'Evidence status' })
    await waitFor(() => expect(banner).toHaveTextContent('not been independently validated'))
    expect(banner).toHaveTextContent('mad_sustained')
    expect(banner).toHaveTextContent('k_mad=5, min_run=3')
    expect(banner).toHaveTextContent('3/12 = 25% against at most 10%')
  })

  it('shows both stored evaluations and labels the Phase 4b one as an exposed set', async () => {
    render(<App />)
    const phase4 = await screen.findByRole('article', { name: /Phase 4: detector mad$/ })
    const phase4b = await screen.findByRole('article', { name: /Phase 4b: detector mad_sustained/ })
    expect(phase4).toHaveTextContent('False-attribution target not met')
    expect(phase4).toHaveTextContent('3/12 = 25%')
    expect(phase4b).toHaveTextContent('Numeric thresholds met on an exposed set')
    expect(phase4b).toHaveTextContent('not independent validation')
    expect(phase4b).toHaveTextContent('1/12 = 8.3%')
  })

  it.each(EXPECTED_REAL_BUNDLES)('loads %s and shows its stored interpretation verbatim', async (id) => {
    const user = userEvent.setup()
    render(<App />)
    await chooseTrial(user, id)
    const stored = bundleSchema.parse(readRealBundle(id))
    await waitFor(() => expect(screen.getByTestId('plain-language')).toHaveTextContent(stored.plain_language.summary))
    const group = screen.getByRole('group', { name: 'Choose a recorded trial' })
    expect(within(group).getByRole('button', { name: id })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getAllByRole('listitem').length).toBeGreaterThan(0)
  })

  it('displays each selected hop measurement exactly as stored (p4-held-04)', async () => {
    const user = userEvent.setup()
    render(<App />)
    const id = 'p4-held-04-latency-hop2-moderate'
    await chooseTrial(user, id)
    const stored = bundleSchema.parse(readRealBundle(id))
    await waitFor(() => expect(screen.getByTestId('plain-language')).toHaveTextContent('Hop 3'))

    for (const hop of stored.hops) {
      await user.click(hopButton(hop.ttl))
      const inspector = screen.getByRole('complementary', { name: `Hop ${hop.ttl}` })
      expect(inspector).toHaveTextContent(hop.ip ?? 'No response observed')
      expect(inspector).toHaveTextContent(`Probe samples${hop.sample_count}`)
      expect(inspector).toHaveTextContent(formatMs(hop.rtt_baseline_ms))
      if (hop.rtt_observed_ms !== null) expect(inspector).toHaveTextContent(formatMs(hop.rtt_observed_ms))
    }
    // A literal anchor against the stored numbers (hop 3: 0.0137 ms before, 51.1379 ms after onset).
    await user.click(hopButton(3))
    const hop3 = screen.getByRole('complementary', { name: 'Hop 3' })
    expect(hop3).toHaveTextContent('0.014 ms')
    expect(hop3).toHaveTextContent('51.1 ms')
    expect(hop3).toHaveTextContent('Corroborated onset')
  })

  it('shows unknown hops as unknown and does not assume they are healthy (p4-held-12)', async () => {
    const user = userEvent.setup()
    render(<App />)
    await chooseTrial(user, 'p4-held-12-unknown-plus-impair')
    await waitFor(() => expect(hopButton(1)).toHaveAccessibleName(/Unknown/))
    for (const ttl of [1, 2]) {
      expect(hopButton(ttl)).not.toHaveAccessibleName(/No corroborated onset/)
      await user.click(hopButton(ttl))
      const inspector = screen.getByRole('complementary', { name: `Hop ${ttl}` })
      expect(inspector).toHaveTextContent('Unknown')
      expect(inspector).toHaveTextContent('No response observed')
      expect(inspector).not.toHaveTextContent('No corroborated onset')
    }
    expect(screen.getByTestId('result-state')).toHaveTextContent('Partially localized')
  })

  it('does not treat "no degradation" as proof of health (p4-held-01)', async () => {
    const user = userEvent.setup()
    render(<App />)
    await chooseTrial(user, 'p4-held-01-clean1')
    await waitFor(() => expect(screen.getByTestId('result-state')).toHaveTextContent('No significant degradation'))
    expect(screen.getByText('No onset detected does not prove that the network is healthy.')).toBeInTheDocument()
  })

  it('labels the confidence score as an uncalibrated heuristic, not a probability', async () => {
    render(<App />)
    await screen.findByTestId('plain-language')
    expect(screen.getByText(/It is not a probability, it has not been calibrated/)).toBeInTheDocument()
  })

  it('lets the trial be chosen with the keyboard', async () => {
    const user = userEvent.setup()
    render(<App />)
    const group = await screen.findByRole('group', { name: 'Choose a recorded trial' })
    const target = within(group).getByRole('button', { name: 'p4-held-01-clean1' })
    target.focus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(target).toHaveAttribute('aria-pressed', 'true'))
    expect(new URL(window.location.href).searchParams.get('trial')).toBe('p4-held-01-clean1')
  })

  it('uses no causal or over-claiming language in any state', async () => {
    const user = userEvent.setup()
    render(<App />)
    for (const id of EXPECTED_REAL_BUNDLES) {
      await chooseTrial(user, id)
      const stored = bundleSchema.parse(readRealBundle(id))
      await waitFor(() => expect(screen.getByTestId('plain-language')).toHaveTextContent(stored.plain_language.summary))
      const text = document.body.textContent ?? ''
      for (const phrase of CAUSAL_PHRASES) expect(text).not.toMatch(phrase)
    }
  })

  it('has no automatically detectable accessibility violations (contrast is checked separately)', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await chooseTrial(user, 'p4-held-12-unknown-plus-impair')
    await waitFor(() => expect(screen.getByTestId('plain-language')).toBeInTheDocument())
    await screen.findByRole('article', { name: /Phase 4b/ })
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
  })

  it('renders the final state immediately when the user prefers reduced motion', async () => {
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
    try {
      render(<App />)
      const heading = screen.getByRole('heading', { level: 1 })
      expect(heading).toBeVisible()
      // No entrance animation: the hero starts fully opaque and un-translated.
      const hero = heading.closest('section')
      expect(hero?.style.opacity === '' || hero?.style.opacity === '1').toBe(true)
      expect(hero?.style.transform ?? '').not.toMatch(/translate/)
      await screen.findByTestId('plain-language')
    } finally {
      window.matchMedia = original
    }
  })

  it('animates the hero in when reduced motion is not requested', () => {
    render(<App />)
    const hero = screen.getByRole('heading', { level: 1 }).closest('section')
    expect(hero?.style.opacity).toBe('0')
  })
})

describe('explicit loading and error states', () => {
  it('shows a retryable error when the data cannot be reached, then recovers', async () => {
    const user = userEvent.setup()
    const working = fetchFromAllowlist()
    let failing = true
    vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) =>
      failing ? Promise.reject(new TypeError('Failed to fetch')) : working(input, init),
    )
    render(<App />)
    const alerts = await screen.findAllByRole('alert')
    expect(alerts.some((alert) => /could not be reached/i.test(alert.textContent ?? ''))).toBe(true)
    expect(screen.queryByTestId('plain-language')).not.toBeInTheDocument()

    failing = false
    await user.click(screen.getAllByRole('button', { name: 'Try again' })[0]!)
    await screen.findByTestId('plain-language')
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the failing field paths when a bundle does not match the schema', async () => {
    const working = fetchFromAllowlist()
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      if (url.includes('/bundles/')) {
        const broken = structuredClone(readRealBundle('demo-run-01')) as Record<string, unknown>
        delete broken['hops']
        return new Response(JSON.stringify(broken), { status: 200 })
      }
      return working(input, init)
    })
    render(<App />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('unexpected format')
    expect(alert).toHaveTextContent(/hops:/)
    expect(screen.queryByTestId('plain-language')).not.toBeInTheDocument()
  })

  it('reports a missing bundle without inventing content', async () => {
    const working = fetchFromAllowlist()
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return url.includes('/bundles/') ? new Response('{}', { status: 404 }) : working(input, init)
    })
    render(<App />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent(/not found/i)
    expect(screen.queryByTestId('result-state')).not.toBeInTheDocument()
  })

  it('makes no validation claim when the stored evaluation cannot be loaded', async () => {
    const working = fetchFromAllowlist()
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return url.includes('/evaluation/') ? new Response('{}', { status: 500 }) : working(input, init)
    })
    render(<App />)
    const banner = await screen.findByRole('region', { name: 'Evidence status' })
    await waitFor(() => expect(banner).toHaveTextContent('no validation claim is being made'))
    expect(banner).not.toHaveTextContent('mad_sustained')
  })
})
