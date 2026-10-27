import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe from 'axe-core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App.tsx'
import { formatMs } from './data/format.ts'
import { bundleSchema } from './data/schema.ts'
import { EXPECTED_REAL_BUNDLES, fetchFromAllowlist, readRealBundle } from './test/repo.ts'

beforeEach(() => {
  window.history.replaceState(null, '', '/')
  vi.stubGlobal('fetch', fetchFromAllowlist())
})

const toggle = () => screen.getByRole('button', { name: /Guided explanation/ })
const startWalkthrough = () => screen.getByRole('button', { name: 'Start the 5-step walkthrough' })

async function choose(user: ReturnType<typeof userEvent.setup>, id: string) {
  const group = await screen.findByRole('group', { name: 'Choose a recorded trial' })
  await user.click(within(group).getByRole('button', { name: id }))
  const stored = bundleSchema.parse(readRealBundle(id))
  await waitFor(() => expect(screen.getByTestId('plain-language')).toHaveTextContent(stored.plain_language.summary))
  return stored
}

describe('guided explanation toggle', () => {
  it('is Off by default and shows no explanation panel', async () => {
    render(<App />)
    await screen.findByTestId('plain-language')
    expect(toggle()).toHaveAttribute('aria-pressed', 'false')
    expect(screen.queryByRole('region', { name: 'Guided explanation' })).not.toBeInTheDocument()
  })

  it.each(EXPECTED_REAL_BUNDLES)('explains the stored data of %s when switched On', async (id) => {
    const user = userEvent.setup()
    render(<App />)
    const stored = await choose(user, id)
    await user.click(toggle())
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    const panel = screen.getByRole('region', { name: 'Guided explanation' })
    expect(panel).toHaveTextContent(id)
    expect(panel).toHaveTextContent(stored.plain_language.summary)
    expect(panel).toHaveTextContent(`Stored confidence: ${stored.confidence.level}`)
    expect(panel).toHaveTextContent('not a probability')
    expect(panel).toHaveTextContent('has not been independently validated')
    if (stored.app.onset_ns !== null) {
      expect(panel).toHaveTextContent(formatMs(stored.app.rtt_baseline_ms))
      expect(panel).toHaveTextContent(formatMs(stored.app.rtt_observed_ms))
    } else {
      expect(panel).toHaveTextContent('No onset was detected')
    }
    for (const hop of stored.hops.filter((h) => h.status === 'unknown')) {
      expect(panel).toHaveTextContent(`Hop ${hop.ttl}`)
    }
    expect(panel.textContent).not.toMatch(/\bcaused\b|\bis faulty\b|\bis broken\b|\bresponsible for\b|\bPASSED\b/i)
    await user.click(toggle())
    expect(screen.queryByRole('region', { name: 'Guided explanation' })).not.toBeInTheDocument()
  })

  it('updates when the trial changes and keeps the toggle On', async () => {
    const user = userEvent.setup()
    render(<App />)
    await choose(user, 'demo-run-01')
    await user.click(toggle())
    expect(screen.getByRole('region', { name: 'Guided explanation' })).toHaveTextContent('demo-run-01')
    const next = await choose(user, 'p4-held-12-unknown-plus-impair')
    const panel = await screen.findByRole('region', { name: 'Guided explanation' })
    expect(toggle()).toHaveAttribute('aria-pressed', 'true')
    expect(panel).toHaveTextContent('p4-held-12-unknown-plus-impair')
    expect(panel).not.toHaveTextContent('demo-run-01')
    expect(panel).toHaveTextContent(next.plain_language.summary)
    expect(panel).toHaveTextContent('reported as unknown, not as healthy')
  })
})

describe('five-step walkthrough', () => {
  it('steps with Previous and Next, stops at the ends, and exits', async () => {
    const user = userEvent.setup()
    render(<App />)
    await choose(user, 'p4-held-04-latency-hop2-moderate')
    await user.click(toggle())
    await user.click(startWalkthrough())
    const progress = () => screen.getByTestId('walkthrough-progress')
    expect(progress()).toHaveTextContent('Step 1 of 5')
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled()
    for (let n = 2; n <= 5; n += 1) {
      await user.click(screen.getByRole('button', { name: 'Next' }))
      expect(progress()).toHaveTextContent(`Step ${n} of 5`)
    }
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled()
    expect(screen.getByTestId('walkthrough')).toHaveTextContent('What this does not show')
    await user.click(screen.getByRole('button', { name: 'Previous' }))
    expect(progress()).toHaveTextContent('Step 4 of 5')
    await user.click(screen.getByRole('button', { name: 'Exit walkthrough' }))
    expect(screen.queryByTestId('walkthrough')).not.toBeInTheDocument()
    expect(screen.getByTestId('explanation-overview')).toBeInTheDocument()
  })

  it('shows the selected trial numbers at step 1 and restarts when the trial changes', async () => {
    const user = userEvent.setup()
    render(<App />)
    const stored = await choose(user, 'p4-held-04-latency-hop2-moderate')
    await user.click(toggle())
    await user.click(startWalkthrough())
    expect(screen.getByTestId('walkthrough')).toHaveTextContent(formatMs(stored.app.rtt_observed_ms))
    await user.click(screen.getByRole('button', { name: 'Next' }))
    await choose(user, 'p4-held-01-clean1')
    expect(screen.queryByTestId('walkthrough')).not.toBeInTheDocument()
    expect(screen.getByTestId('explanation-overview')).toHaveTextContent('No onset was detected')
  })

  it('is keyboard operable', async () => {
    const user = userEvent.setup()
    render(<App />)
    await choose(user, 'demo-run-01')
    toggle().focus()
    await user.keyboard('{Enter}')
    startWalkthrough().focus()
    await user.keyboard('{Enter}')
    screen.getByRole('button', { name: 'Next' }).focus()
    await user.keyboard('{Enter}')
    expect(screen.getByTestId('walkthrough-progress')).toHaveTextContent('Step 2 of 5')
  })

  it('has no automatically detectable accessibility violations while open', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await choose(user, 'p4-held-12-unknown-plus-impair')
    await user.click(toggle())
    await user.click(startWalkthrough())
    const results = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } })
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([])
  })
})

describe('wording follows the selected bundle', () => {
  it('uses symptom wording only when the application onset was detected', async () => {
    const user = userEvent.setup()
    render(<App />)
    const degraded = await choose(user, 'p4-held-04-latency-hop2-moderate')
    expect(degraded.app.onset_ns).not.toBeNull()
    await user.click(toggle())
    expect(screen.getByRole('region', { name: 'Guided explanation' })).toHaveTextContent('The symptom the application saw')
    expect(screen.getByRole('heading', { name: 'First, the symptom' })).toBeInTheDocument()

    const clean = await choose(user, 'p4-held-01-clean1')
    expect(clean.app.onset_ns).toBeNull()
    const panel = await screen.findByRole('region', { name: 'Guided explanation' })
    expect(panel).toHaveTextContent('What the application measured')
    expect(panel).not.toHaveTextContent('The symptom the application saw')
    expect(panel).toHaveTextContent('No onset was detected')
    expect(panel).toHaveTextContent('not proof that nothing was wrong')
    expect(screen.queryByRole('heading', { name: 'First, the symptom' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'First, what the application measured' })).toBeInTheDocument()
    expect(document.body.textContent).not.toContain('The application noticed something')

    await choose(user, 'demo-run-01')
    expect(await screen.findByRole('region', { name: 'Guided explanation' })).toHaveTextContent('The symptom the application saw')
    expect(screen.getByRole('region', { name: 'Guided explanation' })).not.toHaveTextContent('What the application measured')
  })
})
