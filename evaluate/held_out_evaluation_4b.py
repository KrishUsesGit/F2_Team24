#!/usr/bin/env python3
"""Phase 4b SECONDARY VALIDATION: scores the frozen Phase 4b configuration
(mad_sustained) on the ORIGINAL p4-held-* set.

EVIDENCE STATUS (corrected, WP-1): the p4-held-* RAW files are
byte-unmodified since collection, but this set is EXPOSED -- it is NOT
an independent holdout for Phase 4b. evaluate/diagnose_phase4b.py loaded
these trials' raw traces together with their ground-truth labels
(p4-held-01..03, 06, 07, 09, 10, 11, 12) BEFORE the Phase 4b candidate
detectors were designed, so the traces informed that design. The numbers
this script writes are valid as a historical record of what the frozen
configuration scored; they must not be cited as independent validation.
See docs/EVIDENCE_LEDGER.md.

HISTORICAL SCRIPT: running it OVERWRITES evaluate/held_out_results_4b.json
and reads ground truth (must run as hoptrace-eval). Do not re-run it.
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "correlate"))
sys.path.insert(0, str(REPO_ROOT / "faultctl"))
sys.path.insert(0, str(REPO_ROOT / "evaluate"))

from tuning_analysis_4b import run_pipeline_with
from onset_candidates_v2 import detect_onset_mad_sustained
import groundtruth as gt
import metrics as m

EXPERIMENTS_DIR = str(REPO_ROOT / "experiments")
FROZEN_CONFIG_PATH = str(REPO_ROOT / "evaluate" / "frozen_config_4b.json")

ORIGINAL_HELD_OUT_TRIALS = [f"p4-held-{i:02d}-{name}" for i, name in [
    (1, "clean1"), (2, "clean2"), (3, "clean3"),
    (4, "latency-hop2-moderate"), (5, "jitter-hop3-mild"), (6, "loss-hop4-severe"),
    (7, "bandwidth-hop1-moderate"), (8, "jitter-hop2-transient"), (9, "bandwidth-hop3-transient"),
    (10, "loss-hop1-mild"), (11, "unknown-hop1"), (12, "unknown-plus-impair"),
]]


def main():
    with open(FROZEN_CONFIG_PATH) as f:
        frozen = json.load(f)
    print(f"SECONDARY VALIDATION -- frozen algorithm: {frozen['selected_algorithm']}")
    print(f"Frozen config git commit: {frozen['git_commit']}")
    print("Running against the ORIGINAL p4-held-* set (raw files unmodified; set is EXPOSED -- "
          "not an independent holdout for Phase 4b, see docs/EVIDENCE_LEDGER.md)\n")

    conn = gt.connect()
    results = []
    per_trial_detail = []

    for trial_id in ORIGINAL_HELD_OUT_TRIALS:
        d = os.path.join(EXPERIMENTS_DIR, trial_id)
        hop_path, app_path = os.path.join(d, "hop.jsonl"), os.path.join(d, "app.jsonl")
        events = gt.read_for_trial(conn, trial_id)
        record = run_pipeline_with(hop_path, app_path, trial_id, detect_onset_mad_sustained)
        result = m.evaluate_trial(record, events, "mad_sustained")
        results.append(result)
        expected = m.expected_first_affected_hop(events[0]["hop_target"]) if events else None
        fault_type = events[0]["impairment_type"] if events else "clean_control"
        detail = {"trial_id": trial_id, "fault_type": fault_type, "expected_hop": expected,
                   "reported": m.reported_hop_range(record), "exact_match": result.exact_match,
                   "within_1_match": result.within_1_match, "false_attribution": result.false_attribution,
                   "confidence_level": result.confidence_level, "confidence_score": result.confidence_score}
        per_trial_detail.append(detail)
        print(f"{trial_id:36s} type={fault_type:10s} expected={str(expected):4s} "
              f"reported={detail['reported']} exact={detail['exact_match']} "
              f"within1={detail['within_1_match']} false_attr={detail['false_attribution']} "
              f"conf={detail['confidence_level']}")

    print("\n=== SECONDARY VALIDATION summary (mad_sustained on ORIGINAL held-out) ===")
    summary = m.summarize(results)
    print(json.dumps(summary, indent=2))
    brier = m.brier_score(results)
    print(f"\nBrier: {brier}")
    calib = m.calibration_bins(results)
    print("Calibration:")
    for row in calib:
        print(f"  {row}")

    print("\n=== comparison vs original Phase 4 (mad, same held-out set) ===")
    print("  Phase 4 (mad):      within1=100% (3/3) false_attr=25% (3/12) clean_fp=50% (2/4) brier=0.432")
    s = summary
    w1 = s["within_1_hop_accuracy"]["rate"]
    fa = s["false_attribution_rate"]["rate"]
    cfp = s["clean_control_false_positive_rate"]["rate"]
    print(f"  Phase 4b (mad_sustained): within1={w1*100 if w1 is not None else 0:.0f}% "
          f"({s['within_1_hop_accuracy']['numerator']}/{s['within_1_hop_accuracy']['denominator']}) "
          f"false_attr={fa*100:.0f}% ({s['false_attribution_rate']['numerator']}/12) "
          f"clean_fp={cfp*100:.0f}% ({s['clean_control_false_positive_rate']['numerator']}/4) "
          f"brier={brier['brier']}")

    print("\n=== GATE CHECK (locked spec: within1>=80%, false_attribution<=10%) ===")
    within1_pass = (w1 or 0) >= 0.80
    fa_pass = fa <= 0.10
    print(f"  within_1_hop_accuracy >= 80%: {w1*100 if w1 else 0:.1f}% -> {'PASS' if within1_pass else 'FAIL'}")
    print(f"  false_attribution_rate <= 10%: {fa*100:.1f}% -> {'PASS' if fa_pass else 'FAIL'}")
    print(f"  OVERALL GATE: {'PASS' if (within1_pass and fa_pass) else 'FAIL'}")

    out = {
        "validation_type": "secondary -- original held-out set, frozen Phase 4b config",
        "frozen_config": frozen, "held_out_set": ORIGINAL_HELD_OUT_TRIALS,
        "per_trial_detail": per_trial_detail, "summary": summary, "brier_score": brier,
        "calibration_by_level": calib,
        "gate_check": {"within_1_hop_accuracy_pass": within1_pass, "false_attribution_rate_pass": fa_pass,
                       "overall_pass": within1_pass and fa_pass},
    }
    out_path = str(REPO_ROOT / "evaluate" / "held_out_results_4b.json")
    with open(out_path, "w") as f:
        json.dump(out, f, indent=2, default=str)
    print(f"\nresults written to {out_path}")


if __name__ == "__main__":
    main()
