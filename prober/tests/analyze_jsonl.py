#!/usr/bin/env python3
"""Descriptive statistics over a HopSample JSONL file: response rate and
RTT mean/stddev per TTL. Purely descriptive — no changepoint detection,
no thresholds, no pass/fail judgment about the network. That's Phase 4's
job. This exists only to turn raw samples into the numbers the Phase 1
gate criteria (spec §10) ask for.
"""
import json
import sys
import statistics as st
from collections import defaultdict

def main():
    path = sys.argv[1]
    by_ttl = defaultdict(list)
    expected_ip = {}
    total = 0
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            total += 1
            by_ttl[d["ttl"]].append(d)

    print(f"total samples: {total}")
    for ttl in sorted(by_ttl):
        rows = by_ttl[ttl]
        responded = [r for r in rows if r["responded"]]
        rate = len(responded) / len(rows) * 100
        ips = sorted(set(r["hop_ip"] for r in responded))
        rtts = [r["rtt_ms"] for r in responded]
        if rtts:
            mean = st.mean(rtts)
            stdev = st.pstdev(rtts) if len(rtts) > 1 else 0.0
            print(f"ttl={ttl}: {len(responded)}/{len(rows)} responded ({rate:.1f}%) "
                  f"ips={ips} rtt_ms mean={mean:.4f} stdev={stdev:.4f} "
                  f"min={min(rtts):.4f} max={max(rtts):.4f}")
        else:
            print(f"ttl={ttl}: {len(responded)}/{len(rows)} responded ({rate:.1f}%) "
                  f"ips={ips} (no responses)")

if __name__ == "__main__":
    main()
