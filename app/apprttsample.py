"""AppRttSample: the Phase 2 application telemetry record.

Matches hoptrace-phase-0-5-spec.html §06, amended with the responded
clarification approved before Phase 3. Like hopsample.py in Phase 1,
this module is ONLY the data shape and its serialization — no
detection, no thresholds beyond the spec's own literal missed_budget
definition, no judgment. Phase 4 decides what these numbers mean.

Three distinct, non-collapsible states, enforced by construction:
  1. responded=True,  rtt_ms=<float>, missed_budget=<rtt_ms > 150>
  2. (ping only, missing) responded=False, rtt_ms=None, missed_budget=False
     — no budget concept exists for ping at all, responded or not.
  3. (interaction only, missing) responded=False, rtt_ms=None,
     missed_budget=None — a missing response is NOT the same as a
     measured late response; it must never be represented as a
     measured rtt_ms > 150.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict
import json


@dataclass
class AppRttSample:
    seq: int
    kind: str                    # "ping" | "interaction"
    t_send_mono_ns: int
    t_recv_mono_ns: int | None   # null = no ack received
    rtt_ms: float | None         # null = no ack received
    responded: bool              # True iff t_recv_mono_ns/rtt_ms are populated
    missed_budget: bool | None   # interaction only when responded=False (see module docstring)

    def to_dict(self) -> dict:
        return asdict(self)

    def to_json(self) -> str:
        return json.dumps(self.to_dict(), separators=(",", ":"))

    @staticmethod
    def from_dict(d: dict) -> "AppRttSample":
        return AppRttSample(
            seq=d["seq"],
            kind=d["kind"],
            t_send_mono_ns=d["t_send_mono_ns"],
            t_recv_mono_ns=d["t_recv_mono_ns"],
            rtt_ms=d["rtt_ms"],
            responded=d["responded"],
            missed_budget=d["missed_budget"],
        )

    @staticmethod
    def from_json(s: str) -> "AppRttSample":
        return AppRttSample.from_dict(json.loads(s))
