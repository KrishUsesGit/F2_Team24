#!/usr/bin/env python3
"""Round-level hop-identity match analysis — this is what spec §10's
Phase 1 gate ("hop identity matches topology in >=99% of 200 consecutive
rounds") actually asks for, as distinct from analyze_jsonl.py's raw
per-sample response rate. A round "matches" if every TTL 1..5 has at
least one responding sample (out of its 2) reporting the expected IP,
and no TTL reports an unexpected IP. Purely descriptive — no judgment
about causes, no thresholds beyond the one the spec itself states.
"""
import json
import sys
from collections import defaultdict

EXPECTED = {1: "10.10.1.2", 2: "10.10.2.2", 3: "10.10.3.2", 4: "10.10.4.2", 5: "10.10.5.2"}

def main():
    path = sys.argv[1]
    rounds = defaultdict(lambda: defaultdict(list))
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            d = json.loads(line)
            rounds[d["round_id"]][d["ttl"]].append(d)

    total_rounds = len(rounds)
    matched = 0
    mismatched_rounds = []
    unknown_hop_rounds = []

    for rid in sorted(rounds):
        ttls = rounds[rid]
        round_ok = True
        for ttl, expected_ip in EXPECTED.items():
            samples = ttls.get(ttl, [])
            responded_ips = set(s["hop_ip"] for s in samples if s["responded"])
            if not responded_ips:
                round_ok = False
                unknown_hop_rounds.append((rid, ttl))
            elif responded_ips != {expected_ip}:
                round_ok = False
                mismatched_rounds.append((rid, ttl, responded_ips))
        if round_ok:
            matched += 1

    rate = matched / total_rounds * 100 if total_rounds else 0.0
    print(f"total rounds: {total_rounds}")
    print(f"rounds where all 5 hops matched expected topology: {matched} ({rate:.2f}%)")
    print(f"rounds with >=1 hop UNKNOWN (no response either probe): {len(unknown_hop_rounds)}")
    if unknown_hop_rounds[:10]:
        print(f"  sample (round, ttl): {unknown_hop_rounds[:10]}")
    print(f"rounds with a WRONG (unexpected) hop IP: {len(mismatched_rounds)}")
    if mismatched_rounds[:10]:
        print(f"  sample (round, ttl, got): {mismatched_rounds[:10]}")

if __name__ == "__main__":
    main()
