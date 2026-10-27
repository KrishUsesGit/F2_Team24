"""Phase 4b: diagnostic-driven candidate variants, kept in a SEPARATE
module from onset_candidates.py (Phase 4's frozen candidates, which
stay byte-for-byte untouched -- the original held-out result must
remain reproducible against the exact code that produced it).

Each variant here targets ONE specific mechanism identified by
evaluate/diagnose_phase4b.py's read-only inspection of existing
artifacts (see the Phase 4b report for the full diagnosis):

  mechanism found: rolling_mad_v1's threshold = median + k_mad*MAD is an
  ABSOLUTE gap that collapses to near-zero on near-silent hop series
  (median~0.007ms, MAD~0.0005ms), so ordinary measurement jitter
  crosses it almost every trial, clean or not. And because it reports
  the FIRST crossing rather than the most significant one, on trials
  with a real later fault (loss/bandwidth) it still fires on early
  noise and never reaches the real signal.

None of these were selected yet -- this module only DEFINES candidates
for the Phase 4b tuning comparison (evaluate/tuning_analysis_4b.py) to
test on NEW tuning data. No claim is made here about which one wins.
"""
from __future__ import annotations

import statistics as st

from onset import OnsetResult, MIN_VALID_POINTS

METHOD_MAD_ABSFLOOR = "mad_absfloor_v1"
METHOD_MAD_SUSTAINED = "mad_sustained_v1"
METHOD_MAD_LARGEST_RUN = "mad_largest_run_v1"


def _valid(series, t):
    pairs = [(v, tt) for v, tt in zip(series, t) if v is not None]
    return [v for v, _ in pairs], [tt for _, tt in pairs]


def detect_onset_mad_absfloor(series, t, k_mad: float = 5.0, abs_floor_ms: float = 0.5):
    """Same as rolling_mad_v1, but the trigger requires the point to
    exceed median + max(k_mad*MAD, abs_floor_ms) -- an absolute floor
    that ordinary sub-millisecond measurement jitter cannot cross
    regardless of how tiny the series' own MAD happens to be.
    abs_floor_ms=0.5 is a fixed, disclosed, ROUND number chosen because
    it sits comfortably above every observed clean-control noise
    ceiling in the diagnostic pass (app noise up to ~0.1ms, hop noise
    up to ~0.02ms) and well below the smallest real injected magnitude
    class (mildest fault types start at several ms) -- not fitted by
    search, just reasoned from the diagnosis."""
    values, times = _valid(series, t)
    if len(values) < MIN_VALID_POINTS:
        return None
    med = st.median(values)
    mad = st.median([abs(v - med) for v in values]) or 1e-9
    threshold = med + max(k_mad * mad, abs_floor_ms)
    for v, tt in zip(values, times):
        if v > threshold:
            return OnsetResult(t_onset_ns=tt, confidence_raw=(v - med) / mad, method=METHOD_MAD_ABSFLOOR)
    return None


def detect_onset_mad_sustained(series, t, k_mad: float = 5.0, min_run: int = 3):
    """Same MAD threshold as rolling_mad_v1, but requires min_run
    CONSECUTIVE points above threshold before declaring onset (at the
    first point of that run) -- directly targets "fires on a single
    noisy bucket" rather than a real, sustained shift."""
    values, times = _valid(series, t)
    if len(values) < MIN_VALID_POINTS:
        return None
    med = st.median(values)
    mad = st.median([abs(v - med) for v in values]) or 1e-9
    threshold = med + k_mad * mad
    run_start = None
    run_len = 0
    for i, v in enumerate(values):
        if v > threshold:
            if run_start is None:
                run_start = i
            run_len += 1
            if run_len >= min_run:
                return OnsetResult(t_onset_ns=times[run_start],
                                    confidence_raw=(v - med) / mad, method=METHOD_MAD_SUSTAINED)
        else:
            run_start = None
            run_len = 0
    return None


def detect_onset_mad_largest_run(series, t, k_mad: float = 5.0):
    """Same MAD threshold, but instead of the FIRST crossing, scans the
    whole series for every above-threshold run and reports the start of
    the LONGEST one -- directly targets "an early noise blip wins over
    the real, later, more sustained fault period" (the loss/bandwidth
    failure mechanism identified in diagnosis)."""
    values, times = _valid(series, t)
    if len(values) < MIN_VALID_POINTS:
        return None
    med = st.median(values)
    mad = st.median([abs(v - med) for v in values]) or 1e-9
    threshold = med + k_mad * mad

    runs = []  # (start_idx, length)
    run_start = None
    for i, v in enumerate(values):
        if v > threshold:
            if run_start is None:
                run_start = i
        else:
            if run_start is not None:
                runs.append((run_start, i - run_start))
                run_start = None
    if run_start is not None:
        runs.append((run_start, len(values) - run_start))

    if not runs:
        return None
    best_start, best_len = max(runs, key=lambda r: r[1])
    v_at_start = values[best_start]
    return OnsetResult(t_onset_ns=times[best_start],
                        confidence_raw=(v_at_start - med) / mad, method=METHOD_MAD_LARGEST_RUN)


CANDIDATES_V2 = {
    "mad_absfloor": detect_onset_mad_absfloor,
    "mad_sustained": detect_onset_mad_sustained,
    "mad_largest_run": detect_onset_mad_largest_run,
}
