#!/usr/bin/env python3
"""Phase 4 pilot: re-run all 5 onset-detection candidates over the
EXISTING Phase 3 trials (already-persisted raw data, zero new network
cost). Per the user's explicit framing, Phase 3's trials are
exploratory/provisional -- this script uses them ONLY to (a) sanity
check all 5 algorithms run on real data without crashing, (b) measure
effect sizes/variance to inform the Phase 4a pilot's power calculation,
and (c) measure per-algorithm runtime. It is NOT the tuning set and
NOT the held-out set -- nothing here selects a winning algorithm.

Must run as hoptrace-eval (ground truth read access) -- the engine call
itself (run_pipeline) never sees ground truth; this script joins the
two only after the fact, exactly like the real evaluation harness will.
"""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "correlate"))
sys.path.insert(0, str(REPO_ROOT / "faultctl"))
sys.path.insert(0, str(REPO_ROOT / "evaluate"))

from pipeline import run_pipeline
from onset_candidates import CANDIDATES
import groundtruth as gt
import metrics as m

EXPERIMENTS_DIR = str(REPO_ROOT / "experiments")

PILOT_TRIALS = [
    "p3-latency-hop3", "p3-jitter-hop1", "p3-loss-hop2", "p3-bandwidth-hop4", "p3-jitter-hop1-v2",
]


def main():
    conn = gt.connect()  # fails loudly if not run as hoptrace-truth/eval -- that's the point

    results_by_algo = {name: [] for name in CANDIDATES}
    timings_by_algo = {name: [] for name in CANDIDATES}

    for trial_id in PILOT_TRIALS:
        d = os.path.join(EXPERIMENTS_DIR, trial_id)
        hop_path = os.path.join(d, "hop.jsonl")
        app_path = os.path.join(d, "app.jsonl")
        if not (os.path.exists(hop_path) and os.path.exists(app_path)):
            print(f"SKIP {trial_id}: raw data missing")
            continue

        events = gt.read_for_trial(conn, trial_id)

        for algo in CANDIDATES:
            t0 = time.monotonic()
            record = run_pipeline(hop_path, app_path, trial_id=trial_id, algorithm=algo)
            elapsed = time.monotonic() - t0
            timings_by_algo[algo].append(elapsed)
            result = m.evaluate_trial(record, events, algo)
            results_by_algo[algo].append(result)
            hop_range = m.reported_hop_range(record)
            expected = m.expected_first_affected_hop(events[0]["hop_target"]) if events else None
            print(f"{trial_id:22s} algo={algo:10s} expected_hop={str(expected):4s} "
                  f"reported={hop_range} exact={result.exact_match} within1={result.within_1_match} "
                  f"conf={result.confidence_level}/{result.confidence_score:.2f} "
                  f"elapsed={elapsed*1000:.1f}ms")

    print()
    print("=== per-algorithm pilot summary ===")
    for algo in CANDIDATES:
        rs = results_by_algo[algo]
        ts = timings_by_algo[algo]
        summary = m.summarize(rs)
        print(f"\n-- {algo} --")
        print(f"  runtime: mean={sum(ts)/len(ts)*1000:.2f}ms max={max(ts)*1000:.2f}ms (n={len(ts)})")
        print(f"  exact_hop_accuracy: {summary['exact_hop_accuracy']}")
        print(f"  within_1_hop_accuracy: {summary['within_1_hop_accuracy']}")
        print(f"  false_attribution_rate: {summary['false_attribution_rate']}")


if __name__ == "__main__":
    main()
