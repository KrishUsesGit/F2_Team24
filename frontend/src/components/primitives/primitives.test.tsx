import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { HOP_STATUSES } from '../../data/schema.ts'
import { Disclosure } from './Disclosure.tsx'
import { Pill } from './Pill.tsx'
import { StatusBadge, statusLabel } from './StatusBadge.tsx'

describe('StatusBadge: status is never conveyed by colour alone', () => {
  it('gives every status a distinct text label', () => {
    const labels = HOP_STATUSES.map((status) => statusLabel(status))
    expect(new Set(labels).size).toBe(HOP_STATUSES.length)
  })

  it.each(HOP_STATUSES)('renders %s with visible text and an icon hidden from assistive tech', (status) => {
    const { container } = render(<StatusBadge status={status} />)
    const badge = container.querySelector('[data-status]')
    expect(badge).toHaveTextContent(statusLabel(status))
    const icon = container.querySelector('svg')
    expect(icon).toHaveAttribute('aria-hidden', 'true')
  })

  it('does not call a hop with no onset "healthy" or "normal"', () => {
    expect(statusLabel('healthy')).not.toMatch(/healthy|normal|ok|good/i)
  })

  it('draws the unknown state with a dashed outline as well', () => {
    const { container } = render(<StatusBadge status="unknown" />)
    expect(container.querySelector('[data-status="unknown"]')).toHaveClass('border-dashed')
  })
})

describe('Pill', () => {
  it('is a native button operable by keyboard and reports pressed state', async () => {
    const user = userEvent.setup()
    let clicks = 0
    render(
      <Pill pressed={false} onClick={() => (clicks += 1)}>
        Choose
      </Pill>,
    )
    const button = screen.getByRole('button', { name: 'Choose' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    await user.tab()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    await user.keyboard(' ')
    expect(clicks).toBe(2)
  })

  it('omits aria-pressed when it is not a toggle', () => {
    render(<Pill>Plain</Pill>)
    expect(screen.getByRole('button', { name: 'Plain' })).not.toHaveAttribute('aria-pressed')
  })
})

describe('Disclosure', () => {
  it('toggles aria-expanded and shows or hides its region from the keyboard', async () => {
    const user = userEvent.setup()
    render(
      <Disclosure summary="More detail">
        <p>Hidden words</p>
      </Disclosure>,
    )
    const button = screen.getByRole('button', { name: 'More detail' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Hidden words')).not.toBeVisible()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Hidden words')).toBeVisible()
    expect(button).toHaveAttribute('aria-controls', screen.getByText('Hidden words').parentElement?.id ?? 'x')
  })
})
