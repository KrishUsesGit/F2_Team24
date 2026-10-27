#!/usr/bin/env python3
"""Descriptive statistics over an AppRttSample JSONL file: per-kind
response rate, RTT mean/stdev, sequence-gap detection, and — for
interaction — the three non-collapsible states kept distinct per the
Phase 2 schema clarification (approved before Phase 3):
  1. responded within budget   (responded=True,  missed_budget=False)
  2. responded late            (responded=True,  missed_budget=True)
  3. missing / no response     (responded=False, missed_budget=null)
A missing response is never counted as, or confused with, a measured
late response. Purely descriptive — no changepoint detection, no
judgment beyond the spec's own literal definitions.
"""
import json
import sys
import statistics as st
from collections import defaultdict


def main():
    path = sys.argv[1]
    by_kind = defaultdict(list)
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            by_kind[d["kind"]].append(d)

    for kind in ("ping", "interaction"):
        rows = by_kind.get(kind, [])
        if not rows:
            print(f"{kind}: no samples")
            continue
        seqs = sorted(r["seq"] for r in rows)
        expected = list(range(seqs[0], seqs[-1] + 1)) if seqs else []
        gaps = sorted(set(expected) - set(seqs))
        responded = [r for r in rows if r["responded"]]
        missing = [r for r in rows if not r["responded"]]
        rtts = [r["rtt_ms"] for r in responded]

        print(f"-- {kind} ({len(rows)} sent, seq {seqs[0]}..{seqs[-1]}) --")
        print(f"  sequence gaps: {len(gaps)}" + (f" e.g. {gaps[:10]}" if gaps else " (none)"))
        print(f"  responded: {len(responded)}/{len(rows)} ({len(responded)/len(rows)*100:.2f}%)")
        print(f"  missing (no reply ever, before {kind!r}'s timeout): {len(missing)} "
              f"({len(missing)/len(rows)*100:.2f}%)")
        if rtts:
            mean = st.mean(rtts)
            stdev = st.pstdev(rtts) if len(rtts) > 1 else 0.0
            print(f"  rtt_ms (responded only): mean={mean:.4f} stdev={stdev:.4f} "
                  f"min={min(rtts):.4f} max={max(rtts):.4f}")

        if kind == "interaction":
            within_budget = [r for r in responded if r["missed_budget"] is False]
            late = [r for r in responded if r["missed_budget"] is True]
            # sanity: missing rows must carry missed_budget=null, never True/False confused with "late"
            missing_wrong_shape = [r for r in missing if r["missed_budget"] is not None
                                    or r["rtt_ms"] is not None]
            print(f"  state 1 -- responded within 150ms budget: {len(within_budget)} "
                  f"({len(within_budget)/len(rows)*100:.2f}%)")
            print(f"  state 2 -- responded LATE (rtt_ms > 150): {len(late)} "
                  f"({len(late)/len(rows)*100:.2f}%)")
            print(f"  state 3 -- MISSING (no response, missed_budget=null): {len(missing)} "
                  f"({len(missing)/len(rows)*100:.2f}%)")
            if missing_wrong_shape:
                print(f"  *** SCHEMA VIOLATION: {len(missing_wrong_shape)} missing rows "
                      f"do not have rtt_ms=null and missed_budget=null ***")


if __name__ == "__main__":
    main()
