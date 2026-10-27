#!/usr/bin/env python3
"""Phase 4 HELD-OUT evaluation: run ONLY the frozen algorithm/config
against the held-out set, which was never touched during tuning/
selection. This produces the final, reported metrics. Must run as
hoptrace-eval.
"""
from __future__ import annotations

import json
import sys
import os
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "correlate"))
sys.path.insert(0, str(REPO_ROOT / "faultctl"))
sys.path.insert(0, str(REPO_ROOT / "evaluate"))

from pipeline import run_pipeline
import groundtruth as gt
import metrics as m

EXPERIMENTS_DIR = str(REPO_ROOT / "experiments")
FROZEN_CONFIG_PATH = str(REPO_ROOT / "evaluate" / "frozen_config.json")

HELD_OUT_TRIALS = [f"p4-held-{i:02d}-{name}" for i, name in [
    (1, "clean1"), (2, "clean2"), (3, "clean3"),
    (4, "latency-hop2-moderate"), (5, "jitter-hop3-mild"), (6, "loss-hop4-severe"),
    (7, "bandwidth-hop1-moderate"), (8, "jitter-hop2-transient"), (9, "bandwidth-hop3-transient"),
    (10, "loss-hop1-mild"), (11, "unknown-hop1"), (12, "unknown-plus-impair"),
]]


def main():
    with open(FROZEN_CONFIG_PATH) as f:
        frozen = json.load(f)
    algo = frozen["selected_algorithm"]
    print(f"Using FROZEN algorithm: {algo}")
    print(f"Frozen at: {frozen['frozen_at_wall_clock_utc']}")

    conn = gt.connect()
    results = []
    per_trial_detail = []

    for trial_id in HELD_OUT_TRIALS:
        d = os.path.join(EXPERIMENTS_DIR, trial_id)
        hop_path, app_path = os.path.join(d, "hop.jsonl"), os.path.join(d, "app.jsonl")
        if not (os.path.exists(hop_path) and os.path.exists(app_path)):
            print(f"MISSING {trial_id}")
            continue
        events = gt.read_for_trial(conn, trial_id)
        record = run_pipeline(hop_path, app_path, trial_id=trial_id, algorithm=algo)
        result = m.evaluate_trial(record, events, algo)
        results.append(result)

        expected = m.expected_first_affected_hop(events[0]["hop_target"]) if events else None
        fault_type = events[0]["impairment_type"] if events else "clean_control"
        detail = {
            "trial_id": trial_id, "fault_type": fault_type,
            "expected_hop": expected, "reported": m.reported_hop_range(record),
            "exact_match": result.exact_match, "within_1_match": result.within_1_match,
            "false_attribution": result.false_attribution,
            "confidence_level": result.confidence_level, "confidence_score": result.confidence_score,
            "detection_latency_s": result.detection_latency_s,
        }
        per_trial_detail.append(detail)
        print(f"{trial_id:36s} type={fault_type:10s} expected={str(expected):4s} "
              f"reported={detail['reported']} exact={detail['exact_match']} "
              f"within1={detail['within_1_match']} false_attr={detail['false_attribution']} "
              f"conf={detail['confidence_level']}")

    print("\n=== HELD-OUT overall summary (frozen algorithm only) ===")
    summary = m.summarize(results)
    print(json.dumps(summary, indent=2))

    brier = m.brier_score(results)
    print(f"\nBrier score: {brier}")

    calib = m.calibration_bins(results)
    print("\nCalibration (by confidence level):")
    for row in calib:
        print(f"  {row}")

    # breakdown by fault type
    print("\n=== breakdown by fault type ===")
    by_type = {}
    for r, d in zip(results, per_trial_detail):
        by_type.setdefault(d["fault_type"], []).append(r)
    for ftype, rs in by_type.items():
        s = m.summarize(rs)
        print(f"  {ftype}: n={len(rs)} within1={s['within_1_hop_accuracy']} "
              f"false_attr={s['false_attribution_rate']}")

    out = {
        "frozen_config_used": frozen,
        "held_out_set": HELD_OUT_TRIALS,
        "per_trial_detail": per_trial_detail,
        "summary": summary,
        "brier_score": brier,
        "calibration_by_level": calib,
    }
    out_path = str(REPO_ROOT / "evaluate" / "held_out_results.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\nresults written to {out_path}")


if __name__ == "__main__":
    main()
