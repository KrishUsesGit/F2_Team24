"""Correlation engine, stage 2: cross-series alignment + downstream
persistence (review §11, spec §07/§11.6).

Finds the shallowest hop whose onset time is concurrent (within
DELTA_ALIGN_NS) with the application onset, AND where every hop from
there through the deepest measured hop also shows a concurrent onset.
A hop spiking in isolation with no downstream continuation is evidence
AGAINST localizing there, not for it — that is what separates "the
degradation starts here and persists" from "hop 3 just had a noisy
blip" (review §11).

DELTA_ALIGN_NS is spec §11.6 — an explicitly OPEN, not-yet-validated
parameter ("~3x the probe round interval (1.5s)... should be validated
against real Phase 4a traces, not treated as permanently fixed"). It is
used here unchanged, as a documented default, not a tuned value.
"""
from __future__ import annotations

from dataclasses import dataclass, field

DELTA_ALIGN_NS = 1_500_000_000  # spec §11.6 documented default, still OPEN


@dataclass
class LocalizationResult:
    hop_range: dict | None          # {"min": int, "max": int} or None
    corroborating_hops: list        # sorted list[int]
    upstream_clean_hops: list = field(default_factory=list)  # hops BEFORE hop_range.min with no onset — supports the finding, not required


def _concurrent(a_ns: int, b_ns: int) -> bool:
    return abs(a_ns - b_ns) <= DELTA_ALIGN_NS


def align_and_localize(app_onset, hop_onsets: dict) -> LocalizationResult:
    """app_onset: OnsetResult | None
    hop_onsets: dict[int(ttl), OnsetResult | None], keys 1..5 expected.
    """
    if app_onset is None:
        # no application-level degradation detected at all -- nothing to
        # localize. This is the correct output for "hop evidence changes
        # but application degradation is absent" (spec test scenario).
        return LocalizationResult(hop_range=None, corroborating_hops=[])

    max_ttl = max(hop_onsets.keys()) if hop_onsets else 0
    for candidate in sorted(hop_onsets.keys()):
        onset = hop_onsets.get(candidate)
        if onset is None or not _concurrent(onset.t_onset_ns, app_onset.t_onset_ns):
            continue
        # downstream persistence: every hop from `candidate` to the deepest
        # measured hop must ALSO show a concurrent onset.
        downstream_ttls = [ttl for ttl in hop_onsets if ttl >= candidate]
        corroborating = []
        all_persist = True
        for ttl in sorted(downstream_ttls):
            o = hop_onsets.get(ttl)
            if o is not None and _concurrent(o.t_onset_ns, app_onset.t_onset_ns):
                corroborating.append(ttl)
            else:
                all_persist = False
        if not all_persist:
            continue  # isolated spike at `candidate`, not a persistent shift -- keep looking deeper
        upstream_clean = [ttl for ttl in sorted(hop_onsets.keys()) if ttl < candidate
                           and hop_onsets.get(ttl) is None]
        return LocalizationResult(
            hop_range={"min": candidate, "max": max(corroborating)},
            corroborating_hops=corroborating,
            upstream_clean_hops=upstream_clean,
        )

    # app-level degradation exists, but no hop shows a corroborating,
    # persistent onset -- e.g. hop evidence is missing/UNKNOWN, or the
    # degradation genuinely doesn't originate on the measured path.
    return LocalizationResult(hop_range=None, corroborating_hops=[])
