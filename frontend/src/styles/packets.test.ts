import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Regression: the pause rule once sat inside `@layer components` while the
 * `animation` shorthand that starts the packets was unlayered. Unlayered rules
 * win over layered ones whatever their specificity, so "Pause" changed the
 * label but the packets kept moving. jsdom cannot resolve the cascade, so this
 * checks the structure that makes it work; scripts/check-preview.mjs verifies
 * the behaviour in a real browser.
 */
const css = readFileSync(join(process.cwd(), 'src/styles/index.css'), 'utf-8')

function enclosingAtRules(source: string, index: number): string[] {
  const stack: string[] = []
  let prelude = ''
  for (let i = 0; i < index; i += 1) {
    const ch = source[i]
    if (ch === '{') {
      stack.push(prelude.trim())
      prelude = ''
    } else if (ch === '}') {
      stack.pop()
      prelude = ''
    } else if (ch === ';') {
      prelude = ''
    } else {
      prelude += ch
    }
  }
  return stack
}

describe('packet pause rule cascade', () => {
  const pauseAt = css.indexOf(".packets[data-running='false'] .packet")
  const animationAt = css.indexOf('.packet { animation: packet-x')

  it('exists exactly once', () => {
    expect(pauseAt).toBeGreaterThan(-1)
    expect(css.indexOf(".packets[data-running='false'] .packet", pauseAt + 1)).toBe(-1)
  })

  it('is not inside any @layer (so it cannot lose to the unlayered animation shorthand)', () => {
    expect(enclosingAtRules(css, pauseAt).some((rule) => rule.includes('@layer'))).toBe(false)
    expect(enclosingAtRules(css, animationAt).some((rule) => rule.includes('@layer'))).toBe(false)
  })

  it('comes after the animation shorthands it must override', () => {
    expect(pauseAt).toBeGreaterThan(animationAt)
    expect(pauseAt).toBeGreaterThan(css.indexOf('.packet { animation: packet-y'))
  })
})
