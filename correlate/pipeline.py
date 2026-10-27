#!/usr/bin/env python3
"""HOPTRACE Phase 3 (this session's usage) / spec Phase 4 groundwork —
end-to-end orchestration: load the two raw streams, synchronize them,
run the provisional onset detector per series, align + localize,
classify into an EvidenceRecord.

This module has NO reference to any ground-truth source. It reads only
the two files it is given on the command line (a HopSample JSONL and an
AppRttSample JSONL) — there is no code path here, or anywhere in
correlate/, that could read what impairment was injected or when. That
is a stronger isolation property than "the process lacks permission" —
there is nothing to read in the first place.
"""
from __future__ import annotations

import argparse
import json
import uuid

from synchronize import build_synchronized_timeline, load_hop_samples, load_app_samples, EXPECTED_HOPS
from onset import detect_onset as detect_onset_default
from onset_candidates import CANDIDATES
from align import align_and_localize
from evidence import classify_evidence

UNKNOWN_FRACTION_THRESHOLD = 0.5  # disclosed, fixed -- not tuned (see onset.py/evidence.py docstrings)


def run_pipeline(hop_path: str, app_path: str, trial_id: str | None = None,
                  algorithm: str = "cusum") -> dict:
    """algorithm selects which onset_candidates.CANDIDATES entry runs
    stage 1 -- this is exactly the swap point Phase 4's algorithm
    comparison exercises. Default ("cusum") matches Phase 3's behavior
    unchanged when this parameter isn't touched."""
    detect_onset = CANDIDATES[algorithm]

    hop_samples = load_hop_samples(hop_path)
    app_samples = load_app_samples(app_path)
    buckets = build_synchronized_timeline(hop_samples, app_samples)

    if not buckets:
        raise ValueError("no data in either stream -- nothing to correlate")

    times = [b.t_start_ns for b in buckets]

    app_series = [b.app_ping_rtt_ms for b in buckets]
    app_onset = detect_onset(app_series, times)

    hop_onsets = {}
    unknown_hops = []
    for ttl in EXPECTED_HOPS:
        hop_series = [b.hop_rtt_ms[ttl] for b in buckets]
        attempted = [b for b in buckets if b.hop_total.get(ttl, 0) > 0]
        unknown_count = sum(1 for b in attempted if b.hop_unknown(ttl))
        unknown_fraction = (unknown_count / len(attempted)) if attempted else 1.0
        if unknown_fraction >= UNKNOWN_FRACTION_THRESHOLD:
            unknown_hops.append(ttl)
        hop_onsets[ttl] = detect_onset(hop_series, times)

    localization = align_and_localize(app_onset, hop_onsets)

    raw_samples = {
        "app_onset": app_onset,
        "hop_onsets": hop_onsets,
        "unknown_hops": unknown_hops,
        "buckets": buckets,
        "trial_id": trial_id or str(uuid.uuid4()),
    }
    return classify_evidence(localization, raw_samples)


def main():
    ap = argparse.ArgumentParser(description="HOPTRACE correlation pipeline (provisional, Phase 3)")
    ap.add_argument("--hop-jsonl", required=True)
    ap.add_argument("--app-jsonl", required=True)
    ap.add_argument("--trial-id", default=None)
    ap.add_argument("--out", default=None)
    ap.add_argument("--algorithm", default="cusum", choices=list(CANDIDATES.keys()))
    args = ap.parse_args()

    record = run_pipeline(args.hop_jsonl, args.app_jsonl, args.trial_id, args.algorithm)
    text = json.dumps(record, indent=2, default=lambda o: o.__dict__)
    if args.out:
        with open(args.out, "w") as f:
            f.write(text)
    else:
        print(text)


if __name__ == "__main__":
    main()
