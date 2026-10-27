import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FRONTEND_DIR } from '../test/repo.ts'

const css = readFileSync(join(FRONTEND_DIR, 'src', 'styles', 'index.css'), 'utf-8')

function token(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(css)
  if (!match?.[1]) throw new Error(`design token --color-${name} not found`)
  return match[1]
}

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

describe('WCAG AA contrast of the declared text/background pairs', () => {
  const textPairs: [string, string][] = [
    ['ink', 'mint-100'],
    ['ink', 'mint-50'],
    ['ink', 'mint-200'],
    ['ink', 'paper'],
    ['ink', 'signal'],
    ['ink', 'healthy'],
    ['ink', 'degraded'],
    ['ink', 'unknown'],
    ['paper', 'structure'],
    ['ink-soft', 'mint-100'],
    ['ink-soft', 'mint-200'],
    ['ink-soft', 'paper'],
  ]
  it.each(textPairs)('%s on %s is at least 4.5:1', (fg, bg) => {
    expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the focus ring (structure) at least 3:1 against every surface it sits on', () => {
    for (const surface of ['mint-100', 'mint-50', 'mint-200', 'paper', 'unknown']) {
      expect(contrast(token('structure'), token(surface))).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the thick outline visible against every card tone', () => {
    for (const tone of ['paper', 'mint-200', 'signal', 'structure', 'healthy', 'degraded', 'unknown']) {
      expect(contrast(token('ink'), token(tone))).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('no runtime CDN or remote asset in the stylesheet source', () => {
  it('references no http(s) URL', () => {
    expect(css).not.toMatch(/https?:\/\//)
  })
  it('self-hosts the three fonts through npm packages', () => {
    for (const pkg of ['unbounded', 'instrument-sans', 'jetbrains-mono']) {
      expect(css).toContain(`@fontsource-variable/${pkg}`)
    }
  })
})
