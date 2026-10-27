"""Correlation engine, stage 1: onset detection.

*** PROVISIONAL BASELINE — NOT the Phase 4 algorithm selection. ***

C3 (spec §02) requires the FINAL onset-detection stage to be one of the
five candidates in spec §08 (threshold-baseline, CUSUM, BOCPD, PELT,
rolling-MAD), chosen by the §08 selection experiment against a Phase 4a
tuning set. That experiment has not run. This module implements exactly
ONE of those candidates — a two-sided CUSUM, chosen here only because it
is simple enough to reason about end-to-end for this first pipeline
version, not because it has been shown to be the best choice. It MUST
be treated as replaceable: detect_onset()'s signature (spec §07) is the
contract Phase 4 builds its comparison against, not this implementation.

No thresholds here are fitted against evaluation data (C9) — the
drift/threshold multipliers below are fixed, disclosed constants, not
values tuned to make any specific experiment look good.
"""
from __future__ import annotations

from dataclasses import dataclass
import statistics as st

METHOD_NAME = "provisional_cusum_v1"

MIN_VALID_POINTS = 5      # below this, there's not enough signal to claim anything
CUSUM_K_MULT = 0.5        # drift allowance, in units of MAD
CUSUM_H_MULT = 5.0        # decision threshold, in units of MAD


@dataclass
class OnsetResult:
    t_onset_ns: int
    confidence_raw: float   # NOT calibrated — see evidence.py's own disclosed confidence model
    method: str


def _mad(values: list[float], med: float) -> float:
    deviations = [abs(v - med) for v in values]
    mad = st.median(deviations) if deviations else 0.0
    return mad if mad > 0 else 1e-9  # avoid div-by-zero on a perfectly flat series


def detect_onset(series: list[float | None], t: list[int]) -> OnsetResult | None:
    """series[i] is the value observed at time t[i] (nanoseconds), or
    None for a bucket with no data (missing/unknown — spec §05's
    UNKNOWN concept, carried through rather than interpolated). Returns
    None if there isn't enough valid data to say anything at all."""
    assert len(series) == len(t)
    valid = [(v, tt) for v, tt in zip(series, t) if v is not None]
    if len(valid) < MIN_VALID_POINTS:
        return None

    values = [v for v, _ in valid]
    times = [tt for _, tt in valid]
    baseline = st.median(values)
    mad = _mad(values, baseline)
    k = CUSUM_K_MULT * mad
    h = CUSUM_H_MULT * mad

    s_pos = 0.0
    peak = 0.0
    onset_idx = None
    for i, v in enumerate(values):
        s_pos = max(0.0, s_pos + (v - baseline - k))
        if s_pos > peak:
            peak = s_pos
        if onset_idx is None and s_pos > h:
            onset_idx = i

    if onset_idx is None:
        return None

    confidence_raw = min(peak / h, 5.0) if h > 0 else 0.0  # uncapped ratio, soft-capped for sanity
    return OnsetResult(t_onset_ns=times[onset_idx], confidence_raw=confidence_raw, method=METHOD_NAME)
