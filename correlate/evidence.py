"""Correlation engine, stage 3: evidence classification.

Turns a LocalizationResult into the typed EvidenceRecord from spec §06 /
§12 — the ONLY thing downstream consumers (a future UI) may render
text from (C5). Every claim carries exactly one of five tags: fact,
inference, correlation, confidence, unknown. No claim in this module
ever asserts "Hop N caused..." — language is fixed to "degradation
first appears at/after Hop N" per the review's technical-honesty
requirement and this session's explicit instruction.

The confidence formula below is a disclosed, FIXED heuristic — not
fitted against any evaluation data. Spec §11.1 / C9 reserve the real,
calibrated weighting for Phase 4, using Phase 4a tuning data only. This
is a placeholder sufficient to produce a well-formed EvidenceRecord for
Phase 3's end-to-end demonstration, nothing more.
"""
from __future__ import annotations

import time


def _fact_claims(raw_samples: dict) -> list[dict]:
    claims = []
    buckets = raw_samples.get("buckets", [])
    if buckets:
        first, last = buckets[0], buckets[-1]
        claims.append({
            "tag": "fact",
            "text": f"{len(buckets)} synchronized {500}ms observation buckets covering "
                    f"t={first.t_start_ns}..{last.t_end_ns} (CLOCK_MONOTONIC ns).",
            "data_ref": {"series": "buckets", "count": len(buckets)},
        })
    app_onset = raw_samples.get("app_onset")
    if app_onset is not None:
        claims.append({
            "tag": "fact",
            "text": f"Application ping RTT onset detected at t={app_onset.t_onset_ns} "
                    f"(method={app_onset.method}).",
            "data_ref": {"series": "app_ping", "round_id": None, "t_onset_ns": app_onset.t_onset_ns},
        })
    for ttl, onset in sorted(raw_samples.get("hop_onsets", {}).items()):
        if onset is not None:
            claims.append({
                "tag": "fact",
                "text": f"Hop {ttl} RTT onset detected at t={onset.t_onset_ns} "
                        f"(method={onset.method}).",
                "data_ref": {"series": f"hop_{ttl}", "t_onset_ns": onset.t_onset_ns},
            })
    return claims


def _inference_claim(localization) -> dict:
    if localization.hop_range is None:
        return {
            "tag": "inference",
            "hop_range": None,
            "text": "Evidence is insufficient to infer where degradation first appears.",
        }
    lo, hi = localization.hop_range["min"], localization.hop_range["max"]
    if lo == hi:
        text = f"Evidence is consistent with degradation first appearing at or after Hop {lo}."
    else:
        text = (f"Evidence is consistent with degradation first appearing at or after Hop {lo}, "
                f"persisting through Hop {hi}.")
    return {"tag": "inference", "hop_range": localization.hop_range, "text": text}


def _correlation_claim(localization, raw_samples: dict) -> dict:
    app_onset = raw_samples.get("app_onset")
    if localization.hop_range is None or app_onset is None:
        return {"tag": "correlation", "lag_ms": None,
                "text": "No temporal correlation established between application and path signals."}
    lo = localization.hop_range["min"]
    hop_onset = raw_samples.get("hop_onsets", {}).get(lo)
    lag_ms = None
    if hop_onset is not None:
        lag_ms = (app_onset.t_onset_ns - hop_onset.t_onset_ns) / 1e6
    return {
        "tag": "correlation",
        "lag_ms": lag_ms,
        "text": ("Application degradation onset is temporally correlated with the Hop "
                 f"{lo} path-level onset (this is an association, not a causal claim)."),
    }


def _confidence_claim(localization, raw_samples: dict) -> dict:
    """Disclosed, fixed, NOT-tuned heuristic -- see module docstring."""
    if localization.hop_range is None:
        return {"tag": "confidence", "level": "insufficient", "score": 0.0,
                "factors": {"reason": "no persistent, corroborated hop-level onset found"}}

    hop_onsets = raw_samples.get("hop_onsets", {})
    measured_downstream = [ttl for ttl in hop_onsets if ttl >= localization.hop_range["min"]]
    corroborating_fraction = (len(localization.corroborating_hops) / len(measured_downstream)
                               if measured_downstream else 0.0)

    unknown_hops = set(raw_samples.get("unknown_hops", []))
    completeness_fraction = 1.0 - (len(unknown_hops) / 5.0)

    score = round(corroborating_fraction * completeness_fraction, 3)
    if score >= 0.8:
        level = "high"
    elif score >= 0.5:
        level = "medium"
    elif score > 0.0:
        level = "low"
    else:
        level = "insufficient"

    return {
        "tag": "confidence", "level": level, "score": score,
        "factors": {
            "corroborating_hops": localization.corroborating_hops,
            "corroborating_fraction": round(corroborating_fraction, 3),
            "unknown_hops": sorted(unknown_hops),
            "completeness_fraction": round(completeness_fraction, 3),
            "note": "fixed, disclosed heuristic -- NOT fitted/calibrated (spec C9 reserves that for Phase 4a-only tuning)",
        },
    }


def _unknown_claim(raw_samples: dict) -> dict:
    unknown_hops = sorted(raw_samples.get("unknown_hops", []))
    if not unknown_hops:
        return {"tag": "unknown", "hops": [], "text": "No hops were UNKNOWN for this trial."}
    return {
        "tag": "unknown", "hops": unknown_hops,
        "text": f"Hop(s) {unknown_hops} had insufficient responses to evaluate and are reported "
                f"as unknown, not interpolated or assumed healthy.",
    }


def classify_evidence(localization, raw_samples: dict) -> dict:
    """localization: LocalizationResult
    raw_samples: {"app_onset": OnsetResult|None, "hop_onsets": dict[int, OnsetResult|None],
                   "unknown_hops": list[int], "buckets": list[Bucket], "trial_id": str}
    Returns an EvidenceRecord dict matching spec §06 exactly.
    """
    claims = []
    claims.extend(_fact_claims(raw_samples))
    claims.append(_inference_claim(localization))
    claims.append(_correlation_claim(localization, raw_samples))
    claims.append(_confidence_claim(localization, raw_samples))
    claims.append(_unknown_claim(raw_samples))
    return {
        "trial_id": raw_samples.get("trial_id"),
        "generated_at_mono_ns": time.clock_gettime_ns(time.CLOCK_MONOTONIC),
        "claims": claims,
    }
