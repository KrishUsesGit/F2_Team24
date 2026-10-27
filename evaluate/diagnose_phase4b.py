#!/usr/bin/env python3
"""Phase 4b diagnostic pass -- READ-ONLY inspection of existing raw
artifacts (p4-tune-*, p4-held-*, p3-*). Makes no parameter changes.
Purpose: attribute observed failures to specific pipeline stages
(synchronize -> onset -> align -> evidence) using real numbers, not
guesses. Must run as hoptrace-eval (reads ground truth for labeling).
"""
from __future__ import annotations

import json
import os
import statistics as st
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "correlate"))
sys.path.insert(0, str(REPO_ROOT / "faultctl"))

from synchronize import build_synchronized_timeline, load_hop_samples, load_app_samples, EXPECTED_HOPS
from onset_candidates import detect_onset_mad
from align import DELTA_ALIGN_NS
import groundtruth as gt

EXPERIMENTS_DIR = str(REPO_ROOT / "experiments")


def dump_trial(trial_id: str, conn):
    d = os.path.join(EXPERIMENTS_DIR, trial_id)
    hop_path, app_path = os.path.join(d, "hop.jsonl"), os.path.join(d, "app.jsonl")
    if not os.path.exists(hop_path):
        print(f"MISSING {trial_id}")
        return

    events = gt.read_for_trial(conn, trial_id)
    gt_desc = (f"hop={events[0]['hop_target']} type={events[0]['impairment_type']} "
               f"mag={events[0]['magnitude']}") if events else "CLEAN CONTROL"

    hop_samples = load_hop_samples(hop_path)
    app_samples = load_app_samples(app_path)
    buckets = build_synchronized_timeline(hop_samples, app_samples)
    times = [b.t_start_ns for b in buckets]

    print(f"\n{'='*90}\n{trial_id}  [{gt_desc}]  n_buckets={len(buckets)}")

    app_series = [b.app_ping_rtt_ms for b in buckets]
    vals = [v for v in app_series if v is not None]
    med, mad = (st.median(vals), st.median([abs(v - st.median(vals)) for v in vals])) if vals else (None, None)
    app_onset = detect_onset_mad(app_series, times)
    print(f"  APP:  median={med:.4f} mad={mad:.6f}  n_valid={len(vals)}  "
          f"onset={'t='+str(app_onset.t_onset_ns) if app_onset else 'NONE'}")
    if vals:
        print(f"        range=[{min(vals):.4f}, {max(vals):.4f}]  "
              f"first5={[round(v,3) for v in vals[:5]]}  last5={[round(v,3) for v in vals[-5:]]}")

    onsets = {}
    for ttl in EXPECTED_HOPS:
        series = [b.hop_rtt_ms[ttl] for b in buckets]
        vals = [v for v in series if v is not None]
        attempted = [b for b in buckets if b.hop_total.get(ttl, 0) > 0]
        unknown_count = sum(1 for b in attempted if b.hop_unknown(ttl))
        unknown_frac = (unknown_count / len(attempted)) if attempted else 1.0
        onset = detect_onset_mad(series, times)
        onsets[ttl] = onset
        if vals:
            med_h = st.median(vals)
            mad_h = st.median([abs(v - med_h) for v in vals]) or 1e-9
            thr = med_h + 5.0 * mad_h
            print(f"  Hop{ttl}: median={med_h:.4f} mad={mad_h:.6f} threshold={thr:.4f} "
                  f"unknown_frac={unknown_frac:.2f} n_valid={len(vals)} "
                  f"onset={'t='+str(onset.t_onset_ns) if onset else 'NONE'}")
        else:
            print(f"  Hop{ttl}: NO VALID DATA unknown_frac={unknown_frac:.2f}")

    if app_onset:
        for ttl, onset in onsets.items():
            if onset:
                diff = (app_onset.t_onset_ns - onset.t_onset_ns) / 1e9
                concurrent = abs(app_onset.t_onset_ns - onset.t_onset_ns) <= DELTA_ALIGN_NS
                print(f"    hop{ttl} vs app: diff={diff:+.3f}s concurrent={concurrent}")


def main():
    conn = gt.connect()

    print("##### 1. CLEAN-CONTROL FALSE POSITIVES (held-out H1, H3 vs tuning T1-T3) #####")
    for t in ["p4-held-01-clean1", "p4-held-02-clean2", "p4-held-03-clean3",
              "p4-tune-01-clean1", "p4-tune-02-clean2", "p4-tune-03-clean3"]:
        dump_trial(t, conn)

    print("\n\n##### 2. LOSS TRIALS (both held-out: complete miss) #####")
    for t in ["p4-held-06-loss-hop4-severe", "p4-held-10-loss-hop1-mild",
              "p4-tune-06-loss-hop2-moderate", "p4-tune-10-loss-hop3-severe-transient"]:
        dump_trial(t, conn)

    print("\n\n##### 3. BANDWIDTH TRIALS (both held-out: complete miss) #####")
    for t in ["p4-held-07-bandwidth-hop1-moderate", "p4-held-09-bandwidth-hop3-transient",
              "p4-tune-07-bandwidth-hop4-moderate"]:
        dump_trial(t, conn)

    print("\n\n##### 4. UNKNOWN-HOP CONDITIONS #####")
    for t in ["p4-held-11-unknown-hop1", "p4-held-12-unknown-plus-impair",
              "p4-tune-11-unknown-hop2", "p4-tune-12-unknown-plus-impair"]:
        dump_trial(t, conn)


if __name__ == "__main__":
    main()
