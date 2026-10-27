#!/usr/bin/env python3
"""Prints the load-bearing parts of an EvidenceRecord JSON file compactly,
for reading experiment output without wading through every fact claim."""
import json
import sys

with open(sys.argv[1]) as f:
    record = json.load(f)

by_tag = {}
for c in record["claims"]:
    by_tag.setdefault(c["tag"], []).append(c)

inf = by_tag.get("inference", [{}])[0]
corr = by_tag.get("correlation", [{}])[0]
conf = by_tag.get("confidence", [{}])[0]
unk = by_tag.get("unknown", [{}])[0]
facts = by_tag.get("fact", [])

print(f"trial_id: {record['trial_id']}")
print(f"INFERENCE   : hop_range={inf.get('hop_range')}  -- {inf.get('text')}")
print(f"CORRELATION : lag_ms={corr.get('lag_ms')}  -- {corr.get('text')}")
print(f"CONFIDENCE  : level={conf.get('level')} score={conf.get('score')} factors={conf.get('factors')}")
print(f"UNKNOWN     : hops={unk.get('hops')}")
print(f"({len(facts)} fact claims -- onsets per series:)")
for f_ in facts:
    if "onset" in f_["text"]:
        print(f"  {f_['text']}")
