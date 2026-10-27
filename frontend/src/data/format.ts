/** Display-only formatting. Never alters or recomputes a measured value. */

export function formatPercent(rate: number | null): string {
  if (rate === null) return 'n/a'
  const pct = rate * 100
  return Number.isInteger(pct) ? `${pct}%` : `${pct.toFixed(1)}%`
}

export function formatRatio(numerator: number, denominator: number): string {
  return `${numerator}/${denominator}`
}

export function formatMs(value: number | null): string {
  if (value === null) return 'n/a'
  if (value < 1) return `${value.toFixed(3)} ms`
  return `${value.toFixed(1)} ms`
}

export function formatScore(value: number): string {
  return value.toFixed(2)
}

export function formatDuration(seconds: number | null): string {
  return seconds === null ? 'n/a' : `${seconds.toFixed(1)} s`
}
