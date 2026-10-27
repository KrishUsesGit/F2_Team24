"""HopSample: the Phase 1 measurement record.

Matches hoptrace-phase-0-5-spec.html §06 exactly. This module contains
ONLY the data shape and its (de)serialization — no detection, no
thresholds, no judgment about whether a value is "good" or "bad". Phase 4
decides what these numbers mean; Phase 1 only records them.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import json


@dataclass
class HopSample:
    round_id: int
    ttl: int                    # 1..5
    hop_ip: str | None
    rtt_ms: float | None
    responded: bool
    probe_index: int            # 0 or 1, within-round sample
    t_send_mono_ns: int
    t_recv_mono_ns: int | None

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"))

    @staticmethod
    def from_dict(d: dict) -> "HopSample":
        return HopSample(
            round_id=d["round_id"],
            ttl=d["ttl"],
            hop_ip=d["hop_ip"],
            rtt_ms=d["rtt_ms"],
            responded=d["responded"],
            probe_index=d["probe_index"],
            t_send_mono_ns=d["t_send_mono_ns"],
            t_recv_mono_ns=d["t_recv_mono_ns"],
        )

    @staticmethod
    def from_json(s: str) -> "HopSample":
        return HopSample.from_dict(json.loads(s))
