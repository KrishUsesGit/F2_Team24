"""Phase 4 evaluation metrics. This module is the ONLY place in the
project that joins engine output (EvidenceRecord) with ground truth --
and it does so strictly AFTER the engine has already produced its
output, reading ground truth via the eval-permitted path (spec §04).
No function here feeds anything back into correlate/.

Ground-truth "correctness" reference point: per the established Hop-N-
onward physics (verified empirically in Phase 1-3: a fault injected on
Hop H's egress leaves Hop H's OWN measurement unaffected; the first hop
that can show it is H+1), the expected first-affected hop is
hop_target + 1, capped at 5 (the server). Clean-control trials have no
ground-truth event at all -- expected first-affected hop is None.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field


def expected_first_affected_hop(ground_truth_hop_target: int | None) -> int | None:
    if ground_truth_hop_target is None:
        return None
    return min(ground_truth_hop_target + 1, 5)


def _inference_claim(evidence_record: dict) -> dict:
    return next(c for c in evidence_record["claims"] if c["tag"] == "inference")


def _confidence_claim(evidence_record: dict) -> dict:
    return next(c for c in evidence_record["claims"] if c["tag"] == "confidence")


def reported_hop_range(evidence_record: dict):
    return _inference_claim(evidence_record)["hop_range"]


def is_positive_ground_truth(ground_truth_events: list) -> bool:
    """True if this trial actually had a fault injected (vs. a clean control)."""
    return len(ground_truth_events) > 0


def engine_detected_anything(evidence_record: dict) -> bool:
    return reported_hop_range(evidence_record) is not None


def is_exact_hop_match(evidence_record: dict, expected_hop: int | None) -> bool | None:
    """None = not applicable (e.g. clean control, or engine reported nothing)."""
    hop_range = reported_hop_range(evidence_record)
    if expected_hop is None or hop_range is None:
        return None
    return hop_range["min"] == expected_hop


def is_within_1_hop_match(evidence_record: dict, expected_hop: int | None) -> bool | None:
    hop_range = reported_hop_range(evidence_record)
    if expected_hop is None or hop_range is None:
        return None
    return abs(hop_range["min"] - expected_hop) <= 1


def is_false_attribution(evidence_record: dict, expected_hop: int | None) -> bool:
    """A confident (medium/high) claim that is either wrong, or made on a
    clean control with no fault at all. This is the single number the
    project's honesty requirement lives or dies on."""
    conf = _confidence_claim(evidence_record)
    hop_range = reported_hop_range(evidence_record)
    if conf["level"] not in ("medium", "high"):
        return False
    if hop_range is None:
        return False  # can't be a confident WRONG claim if it made no claim
    if expected_hop is None:
        return True  # confident claim on a clean control = false attribution, full stop
    return hop_range["min"] != expected_hop


def detection_latency_s(evidence_record: dict, ground_truth_t_start_ns: int | None):
    if ground_truth_t_start_ns is None:
        return None
    facts = [c for c in evidence_record["claims"] if c["tag"] == "fact" and "app_ping" in str(c.get("data_ref"))]
    if not facts:
        return None
    t_onset = facts[0]["data_ref"].get("t_onset_ns")
    if t_onset is None:
        return None
    return (t_onset - ground_truth_t_start_ns) / 1e9


@dataclass
class TrialResult:
    trial_id: str
    algorithm: str
    expected_hop: int | None       # None = clean control
    is_positive: bool              # True = fault was actually injected
    detected: bool                 # engine reported a non-null hop_range
    exact_match: bool | None
    within_1_match: bool | None
    false_attribution: bool
    confidence_level: str
    confidence_score: float
    detection_latency_s: float | None
    unknown_hops: list = field(default_factory=list)


def evaluate_trial(evidence_record: dict, ground_truth_events: list, algorithm: str) -> TrialResult:
    is_positive = is_positive_ground_truth(ground_truth_events)
    expected_hop = expected_first_affected_hop(ground_truth_events[0]["hop_target"]) if is_positive else None
    t_start = ground_truth_events[0]["t_start_mono_ns"] if is_positive else None
    conf = _confidence_claim(evidence_record)
    unk = next(c for c in evidence_record["claims"] if c["tag"] == "unknown")
    return TrialResult(
        trial_id=evidence_record["trial_id"], algorithm=algorithm, expected_hop=expected_hop,
        is_positive=is_positive, detected=engine_detected_anything(evidence_record),
        exact_match=is_exact_hop_match(evidence_record, expected_hop),
        within_1_match=is_within_1_hop_match(evidence_record, expected_hop),
        false_attribution=is_false_attribution(evidence_record, expected_hop),
        confidence_level=conf["level"], confidence_score=conf["score"],
        detection_latency_s=detection_latency_s(evidence_record, t_start),
        unknown_hops=unk["hops"],
    )


def wilson_ci(successes: int, n: int, z: float = 1.96):
    """Wilson score interval -- more defensible than a naive normal
    approximation at small n, which is what most of this phase's cells
    are. Returns (low, high), or (None, None) if n == 0."""
    if n == 0:
        return None, None
    p = successes / n
    denom = 1 + z * z / n
    center = (p + z * z / (2 * n)) / denom
    half = (z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n))) / denom
    return max(0.0, center - half), min(1.0, center + half)


def summarize(results: list) -> dict:
    n = len(results)
    positives = [r for r in results if r.is_positive]
    negatives = [r for r in results if not r.is_positive]

    exact = [r for r in positives if r.exact_match is not None]
    within1 = [r for r in positives if r.within_1_match is not None]

    n_exact_match = sum(1 for r in exact if r.exact_match)
    n_within1_match = sum(1 for r in within1 if r.within_1_match)

    detected_positive = sum(1 for r in positives if r.detected)
    detected_negative = sum(1 for r in negatives if r.detected)  # false positives on clean controls

    false_attributions = sum(1 for r in results if r.false_attribution)

    latencies = [r.detection_latency_s for r in positives if r.detection_latency_s is not None]

    precision_num = detected_positive  # of trials engine flagged as degraded... (see note)
    # Detection precision/recall, defined over the full population:
    #   recall    = detected_positive / n_positive  (of real faults, how many did we flag)
    #   precision = detected_positive / (detected_positive + detected_negative)
    #               (of everything we flagged, how many were real faults)
    n_flagged = detected_positive + detected_negative
    precision = (detected_positive / n_flagged) if n_flagged else None
    recall = (detected_positive / len(positives)) if positives else None

    return {
        "n_trials": n,
        "n_positive": len(positives),
        "n_negative_clean_control": len(negatives),
        "exact_hop_accuracy": {
            "numerator": n_exact_match, "denominator": len(exact),
            "rate": (n_exact_match / len(exact)) if exact else None,
            "ci95": wilson_ci(n_exact_match, len(exact)),
        },
        "within_1_hop_accuracy": {
            "numerator": n_within1_match, "denominator": len(within1),
            "rate": (n_within1_match / len(within1)) if within1 else None,
            "ci95": wilson_ci(n_within1_match, len(within1)),
        },
        "false_attribution_rate": {
            "numerator": false_attributions, "denominator": n,
            "rate": (false_attributions / n) if n else None,
            "ci95": wilson_ci(false_attributions, n),
        },
        "clean_control_false_positive_rate": {
            "numerator": detected_negative, "denominator": len(negatives),
            "rate": (detected_negative / len(negatives)) if negatives else None,
            "ci95": wilson_ci(detected_negative, len(negatives)),
        },
        "detection_precision": {"numerator": detected_positive, "denominator": n_flagged, "rate": precision},
        "detection_recall": {"numerator": detected_positive, "denominator": len(positives), "rate": recall},
        "detection_latency_s": {
            "n": len(latencies),
            "mean": (sum(latencies) / len(latencies)) if latencies else None,
            "min": min(latencies) if latencies else None,
            "max": max(latencies) if latencies else None,
        },
    }


def brier_score(results: list) -> dict:
    """Brier score over trials where the engine actually MADE a claim
    (hop_range is not None) -- a trial where it correctly abstained has
    no confidence-bearing inference to calibrate at all (confidence is
    ALWAYS ~0/"insufficient" by construction whenever hop_range is None,
    so including those would just reward abstention regardless of
    whether the underlying detector behavior was any good, and silently
    conflate "well-calibrated" with "usually says nothing").
    outcome = 1 if the claim was correct: within-1-hop for a real fault,
    or (never, by definition) for a clean control -- any claim at all on
    a clean control is wrong."""
    scored = []
    for r in results:
        if r.within_1_match is None and not (not r.is_positive and r.detected):
            continue  # no claim was made on this trial -- nothing to calibrate
        if r.is_positive:
            outcome = 1.0 if r.within_1_match else 0.0
        else:
            outcome = 0.0  # any claim on a clean control is incorrect by definition
        scored.append((r.confidence_score, outcome))
    if not scored:
        return {"n": 0, "brier": None}
    brier = sum((c - o) ** 2 for c, o in scored) / len(scored)
    return {"n": len(scored), "brier": brier}


def calibration_bins(results: list, n_bins: int = 4) -> list:
    """Reliability breakdown: for each confidence LEVEL bucket (not raw
    score decile, given the small n here -- deciles would be nearly
    empty), observed accuracy among that bucket's trials."""
    from collections import defaultdict
    buckets = defaultdict(list)
    for r in results:
        outcome = None
        if r.is_positive and r.within_1_match is not None:
            outcome = 1 if r.within_1_match else 0
        elif not r.is_positive:
            outcome = 0 if r.false_attribution else 1
        if outcome is not None:
            buckets[r.confidence_level].append(outcome)
    out = []
    for level in ("insufficient", "low", "medium", "high"):
        vals = buckets.get(level, [])
        out.append({
            "level": level, "n": len(vals),
            "observed_accuracy": (sum(vals) / len(vals)) if vals else None,
        })
    return out
