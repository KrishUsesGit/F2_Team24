/**
 * Display-only selectors over a loaded bundle. They pick and group stored
 * values; they never detect, threshold, align or score anything.
 */
import type { Bundle, Claim, Hop } from './schema.ts'

export type ClaimTag = Claim['tag']

export const CLAIM_TAGS: ClaimTag[] = ['fact', 'inference', 'correlation', 'confidence', 'unknown']

export type ClaimsByTag = { [T in ClaimTag]: Extract<Claim, { tag: T }>[] }

export function claimsByTag(bundle: Bundle): ClaimsByTag {
  const grouped: ClaimsByTag = { fact: [], inference: [], correlation: [], confidence: [], unknown: [] }
  for (const claim of bundle.evidence_record_claims ?? []) {
    ;(grouped[claim.tag] as Claim[]).push(claim)
  }
  return grouped
}

/** Measured-fact claims whose stored data reference is this hop's series. */
export function factsForHop(bundle: Bundle, ttl: number): Extract<Claim, { tag: 'fact' }>[] {
  return (bundle.evidence_record_claims ?? []).filter(
    (claim): claim is Extract<Claim, { tag: 'fact' }> =>
      claim.tag === 'fact' && claim.data_ref?.['series'] === `hop_${ttl}`,
  )
}

export function unknownClaim(bundle: Bundle): Extract<Claim, { tag: 'unknown' }> | undefined {
  return (bundle.evidence_record_claims ?? []).find(
    (claim): claim is Extract<Claim, { tag: 'unknown' }> => claim.tag === 'unknown',
  )
}

/** Where the inspector starts: the reported range's first hop, else the first unknown hop, else Hop 1. */
export function defaultSelectedHop(bundle: Bundle): number {
  if (bundle.hop_range) return bundle.hop_range.min
  const firstUnknown = bundle.hops.find((hop) => hop.status === 'unknown')
  return firstUnknown ? firstUnknown.ttl : 1
}

/**
 * The hop the interpretation says degradation appears to begin at or after.
 * Only the `localized` state names a hop in plain language, so only then is a
 * hop marked as the boundary (the partially-localized text deliberately omits it).
 */
export function boundaryHop(bundle: Bundle): number | null {
  return bundle.plain_language.result_state === 'localized' && bundle.hop_range ? bundle.hop_range.min : null
}

/** Seconds from the start of the observation window (display of stored timestamps). */
export function secondsIntoWindow(ns: number | null, bundle: Bundle): number | null {
  const start = bundle.observation_window.t_start_ns
  return ns === null || start === null ? null : (ns - start) / 1e9
}

export type SegmentRelation = 'plain' | 'persisting' | 'unknown'

/**
 * How the link before `hop` is drawn, using only stored statuses: unknown if
 * either end is unknown, "persisting" if both ends carry a corroborated onset.
 */
export function segmentRelation(previous: Hop | null, hop: Hop): SegmentRelation {
  if (hop.status === 'unknown' || previous?.status === 'unknown') return 'unknown'
  if (previous && previous.status === 'degraded' && hop.status === 'degraded') return 'persisting'
  return 'plain'
}

/** The testbed's fixed topology (spec section 03); the bundle itself carries no hop roles. */
export const TESTBED_ROLES: Record<number, string> = {
  1: 'router',
  2: 'router',
  3: 'router',
  4: 'router',
  5: 'server',
}
