#!/usr/bin/env python3
"""Phase 4b TUNING stage: compare the current frozen algorithm (mad,
rolling_mad_v1) against the three diagnostic-driven variants, using
ONLY the new p4b-tune-* dataset. The original p4-tune-*/p4-held-* data
is never read by this script. Must run as hoptrace-eval.

Does NOT reuse correlate/pipeline.py's run_pipeline (which is frozen
Phase 4 code, kept byte-for-byte reproducible) -- inlines the same
four-stage orchestration here instead, parameterized by an arbitrary
detect_onset function, so pipeline.py needs no Phase 4b changes at all.
"""
from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "correlate"))
sys.path.insert(0, str(REPO_ROOT / "faultctl"))
sys.path.insert(0, str(REPO_ROOT / "evaluate"))

from synchronize import build_synchronized_timeline, load_hop_samples, load_app_samples, EXPECTED_HOPS
from onset_candidates import detect_onset_mad as mad_v1  # frozen Phase 4 baseline, unmodified
from onset_candidates_v2 import CANDIDATES_V2
from align import align_and_localize
from evidence import classify_evidence
import groundtruth as gt
import metrics as m

EXPERIMENTS_DIR = str(REPO_ROOT / "experiments")
UNKNOWN_FRACTION_THRESHOLD = 0.5

ALL_CANDIDATES = {"mad_v1_frozen": mad_v1, **CANDIDATES_V2}

TUNING_TRIALS_4B = [f"p4b-tune-{i:02d}-{name}" for i, name in [
    (1, "clean1"), (2, "clean2"), (3, "clean3"), (4, "clean4"),
    (5, "loss-hop1-moderate"), (6, "loss-hop3-mild"),
    (7, "bandwidth-hop2-severe"), (8, "bandwidth-hop4-mild"),
    (9, "jitter-hop1-moderate"), (10, "latency-hop3-moderate"),
]]


def run_pipeline_with(hop_path, app_path, trial_id, detect_onset_fn):
    hop_samples = load_hop_samples(hop_path)
    app_samples = load_app_samples(app_path)
    buckets = build_synchronized_timeline(hop_samples, app_samples)
    times = [b.t_start_ns for b in buckets]

    app_series = [b.app_ping_rtt_ms for b in buckets]
    app_onset = detect_onset_fn(app_series, times)

    hop_onsets, unknown_hops = {}, []
    for ttl in EXPECTED_HOPS:
        hop_series = [b.hop_rtt_ms[ttl] for b in buckets]
        attempted = [b for b in buckets if b.hop_total.get(ttl, 0) > 0]
        unknown_count = sum(1 for b in attempted if b.hop_unknown(ttl))
        unknown_fraction = (unknown_count / len(attempted)) if attempted else 1.0
        if unknown_fraction >= UNKNOWN_FRACTION_THRESHOLD:
            unknown_hops.append(ttl)
        hop_onsets[ttl] = detect_onset_fn(hop_series, times)

    localization = align_and_localize(app_onset, hop_onsets)
    raw_samples = {"app_onset": app_onset, "hop_onsets": hop_onsets, "unknown_hops": unknown_hops,
                   "buckets": buckets, "trial_id": trial_id or str(uuid.uuid4())}
    return classify_evidence(localization, raw_samples)


def main():
    conn = gt.connect()
    results_by_algo = {name: [] for name in ALL_CANDIDATES}

    for trial_id in TUNING_TRIALS_4B:
        d = os.path.join(EXPERIMENTS_DIR, trial_id)
        hop_path, app_path = os.path.join(d, "hop.jsonl"), os.path.join(d, "app.jsonl")
        if not (os.path.exists(hop_path) and os.path.exists(app_path)):
            print(f"MISSING {trial_id}")
            continue
        events = gt.read_for_trial(conn, trial_id)
        expected = m.expected_first_affected_hop(events[0]["hop_target"]) if events else None
        for algo, fn in ALL_CANDIDATES.items():
            record = run_pipeline_with(hop_path, app_path, trial_id, fn)
            result = m.evaluate_trial(record, events, algo)
            results_by_algo[algo].append(result)
            print(f"{trial_id:32s} algo={algo:18s} expected={str(expected):4s} "
                  f"reported={m.reported_hop_range(record)} exact={result.exact_match} "
                  f"within1={result.within_1_match} false_attr={result.false_attribution} "
                  f"conf={result.confidence_level}")

    print("\n=== PHASE 4b TUNING summary (new data only) ===")
    scoreboard = {}
    for algo in ALL_CANDIDATES:
        rs = results_by_algo[algo]
        summary = m.summarize(rs)
        brier = m.brier_score(rs)
        scoreboard[algo] = {"summary": summary, "brier": brier}
        print(f"\n-- {algo} --")
        print(f"  within_1_hop_accuracy: {summary['within_1_hop_accuracy']}")
        print(f"  false_attribution_rate: {summary['false_attribution_rate']}")
        print(f"  clean_control_false_positive_rate: {summary['clean_control_false_positive_rate']}")
        print(f"  detection_recall: {summary['detection_recall']}")
        print(f"  brier: {brier}")

    def rank_key(algo):
        s = scoreboard[algo]["summary"]
        within1 = s["within_1_hop_accuracy"]["rate"] or 0.0
        fa = s["false_attribution_rate"]["rate"] or 0.0
        cc_fp = s["clean_control_false_positive_rate"]["rate"] or 0.0
        brier = scoreboard[algo]["brier"]["brier"]
        brier = brier if brier is not None else 1.0
        # same rule family as Phase 4, but with clean-control FP rate as an
        # EXPLICIT additional tiebreak given it's the diagnosed failure mode
        return (-within1, fa, cc_fp, brier)

    ranked = sorted(ALL_CANDIDATES.keys(), key=rank_key)
    print(f"\n=== RANKING (best first): {ranked} ===")
    winner = ranked[0]
    print(f"SELECTED: {winner}")

    frozen = {
        "phase": "4b",
        "selected_algorithm": winner,
        "selection_ranking": ranked,
        "selection_rule": "primary=within_1_hop_accuracy (desc), then false_attribution_rate (asc), "
                           "then clean_control_false_positive_rate (asc), then brier (asc)",
        "tuning_set": TUNING_TRIALS_4B,
        "tuning_set_scoreboard": scoreboard,
        "delta_align_ns": 1_500_000_000,
        "unknown_fraction_threshold": 0.5,
        "frozen_at_mono_ns": time.clock_gettime_ns(time.CLOCK_MONOTONIC),
        "frozen_at_wall_clock_utc": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    out_path = str(REPO_ROOT / "evaluate" / "frozen_config_4b.json")
    with open(out_path, "w") as f:
        json.dump(frozen, f, indent=2, default=str)
    print(f"\nfrozen config (candidate, pre-git-hash) written to {out_path}")


if __name__ == "__main__":
    main()
