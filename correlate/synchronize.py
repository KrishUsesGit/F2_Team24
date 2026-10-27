"""Step 1-5 of Phase 3: a common CLOCK_MONOTONIC timeline that both the
path-measurement stream (HopSample) and the application-telemetry stream
(AppRttSample) can be read against, with explicit missing/unknown
handling on both sides.

No shared round/seq IDs exist between the two streams — prober.py and
client.py are separate processes with independent counters. Alignment
instead relies on C1: both run co-located, reading the SAME system-wide
CLOCK_MONOTONIC, so their t_send_mono_ns values are directly comparable
without any cross-host synchronization. This module turns that into a
stable, bucketed "observation identifier" (the bucket index) that both
streams share.

Bucket width matches the path prober's round interval (500ms, spec
§05) since that is the coarser of the two cadences (ping runs at
20Hz/50ms) — aggregating the finer stream up to the coarser one's
resolution, not the other way around.
"""
from __future__ import annotations

from dataclasses import dataclass, field
import json
import statistics as st

EXPECTED_HOPS = (1, 2, 3, 4, 5)  # spec §03
BUCKET_WIDTH_NS = 500_000_000    # 500ms, matches prober round interval


@dataclass
class Bucket:
    index: int
    t_start_ns: int
    t_end_ns: int
    app_ping_rtt_ms: float | None            # mean of RESPONDED pings sent in this window
    app_ping_responded: int
    app_ping_total: int
    hop_rtt_ms: dict                          # ttl(int) -> float | None (mean of responded)
    hop_responded: dict                       # ttl(int) -> int
    hop_total: dict                           # ttl(int) -> int

    def hop_unknown(self, ttl: int) -> bool:
        """A hop is UNKNOWN for this bucket if it was probed but never
        responded — mirrors HopSample's own UNKNOWN semantics (spec §05),
        never silently interpolated."""
        return self.hop_total.get(ttl, 0) > 0 and self.hop_responded.get(ttl, 0) == 0

    def app_unknown(self) -> bool:
        return self.app_ping_total > 0 and self.app_ping_responded == 0


def _load_jsonl(path: str) -> list[dict]:
    rows = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def load_hop_samples(path: str) -> list[dict]:
    return _load_jsonl(path)


def load_app_samples(path: str) -> list[dict]:
    return _load_jsonl(path)


def build_synchronized_timeline(hop_samples: list[dict], app_samples: list[dict],
                                 bucket_width_ns: int = BUCKET_WIDTH_NS) -> list[Bucket]:
    ping_samples = [s for s in app_samples if s["kind"] == "ping"]

    all_send_times = [s["t_send_mono_ns"] for s in hop_samples] + \
                      [s["t_send_mono_ns"] for s in ping_samples]
    if not all_send_times:
        return []
    t_min = min(all_send_times)
    t_max = max(all_send_times)
    n_buckets = (t_max - t_min) // bucket_width_ns + 1

    buckets: list[Bucket] = []
    for i in range(n_buckets):
        t_start = t_min + i * bucket_width_ns
        t_end = t_start + bucket_width_ns
        buckets.append(Bucket(
            index=i, t_start_ns=t_start, t_end_ns=t_end,
            app_ping_rtt_ms=None, app_ping_responded=0, app_ping_total=0,
            hop_rtt_ms={ttl: None for ttl in EXPECTED_HOPS},
            hop_responded={ttl: 0 for ttl in EXPECTED_HOPS},
            hop_total={ttl: 0 for ttl in EXPECTED_HOPS},
        ))

    def bucket_index(t_ns: int) -> int:
        idx = (t_ns - t_min) // bucket_width_ns
        return min(idx, n_buckets - 1)

    # accumulate hop samples
    hop_rtts_per_bucket = {(i, ttl): [] for i in range(n_buckets) for ttl in EXPECTED_HOPS}
    for s in hop_samples:
        i = bucket_index(s["t_send_mono_ns"])
        ttl = s["ttl"]
        b = buckets[i]
        b.hop_total[ttl] = b.hop_total.get(ttl, 0) + 1
        if s["responded"]:
            b.hop_responded[ttl] = b.hop_responded.get(ttl, 0) + 1
            hop_rtts_per_bucket[(i, ttl)].append(s["rtt_ms"])

    for i in range(n_buckets):
        for ttl in EXPECTED_HOPS:
            vals = hop_rtts_per_bucket[(i, ttl)]
            if vals:
                buckets[i].hop_rtt_ms[ttl] = st.mean(vals)

    # accumulate app ping samples
    ping_rtts_per_bucket = {i: [] for i in range(n_buckets)}
    for s in ping_samples:
        i = bucket_index(s["t_send_mono_ns"])
        b = buckets[i]
        b.app_ping_total += 1
        if s["responded"]:
            b.app_ping_responded += 1
            ping_rtts_per_bucket[i].append(s["rtt_ms"])

    for i in range(n_buckets):
        vals = ping_rtts_per_bucket[i]
        if vals:
            buckets[i].app_ping_rtt_ms = st.mean(vals)

    return buckets
