"""Phase 5 — technical evidence layer.

Builds the full technical-evidence bundle a normal user's plain-
language interpretation sits alongside. Two data sources, both
READ-ONLY:
  1. The raw HopSample/AppRttSample JSONL files (for hop IPs, the full
     RTT timeline, and the observation window -- none of which survive
     into EvidenceRecord, since bucketing/onset detection intentionally
     discard per-sample detail).
  2. The EvidenceRecord itself (for onset timestamps, alignment delta,
     downstream persistence, unknown hops, confidence + factors --
     already computed by the frozen pipeline, just passed through here
     verbatim, never recomputed).

Only correlate/synchronize.py's pure I/O functions are imported
(load_hop_samples, load_app_samples) -- never detect_onset,
align_and_localize, or classify_evidence. This module cannot affect a
single number in the frozen Phase 4b evaluation.
"""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "correlate"))
from synchronize import load_hop_samples, load_app_samples, EXPECTED_HOPS  # pure I/O only


def _get_claim(evidence_record: dict, tag: str) -> dict:
    return next(c for c in evidence_record["claims"] if c["tag"] == tag)


def _observation_window(hop_samples: list, app_samples: list) -> dict:
    all_t = [s["t_send_mono_ns"] for s in hop_samples] + [s["t_send_mono_ns"] for s in app_samples]
    if not all_t:
        return {"t_start_ns": None, "t_end_ns": None, "duration_s": None}
    t0, t1 = min(all_t), max(all_t)
    return {"t_start_ns": t0, "t_end_ns": t1, "duration_s": (t1 - t0) / 1e9}


def _hop_ips(hop_samples: list) -> dict:
    ips = {ttl: set() for ttl in EXPECTED_HOPS}
    for s in hop_samples:
        if s["responded"] and s["hop_ip"]:
            ips[s["ttl"]].add(s["hop_ip"])
    return {ttl: sorted(v) for ttl, v in ips.items()}


def _app_rtt_timeline(app_samples: list) -> list:
    return [
        {"seq": s["seq"], "t_send_mono_ns": s["t_send_mono_ns"], "rtt_ms": s["rtt_ms"],
         "responded": s["responded"]}
        for s in app_samples if s["kind"] == "ping"
    ]


def _hop_rtt_timeline(hop_samples: list) -> dict:
    timelines = {ttl: [] for ttl in EXPECTED_HOPS}
    for s in hop_samples:
        timelines[s["ttl"]].append({
            "round_id": s["round_id"], "t_send_mono_ns": s["t_send_mono_ns"],
            "rtt_ms": s["rtt_ms"], "responded": s["responded"], "hop_ip": s["hop_ip"],
        })
    return timelines


def _onset_timestamps(evidence_record: dict) -> dict:
    out = {}
    for c in evidence_record["claims"]:
        if c["tag"] != "fact":
            continue
        ref = c.get("data_ref") or {}
        series = ref.get("series")
        if series == "app_ping":
            out["app"] = ref.get("t_onset_ns")
        elif isinstance(series, str) and series.startswith("hop_"):
            out[series] = ref.get("t_onset_ns")
    return out


def build_technical_view(hop_jsonl_path: str, app_jsonl_path: str, evidence_record: dict) -> dict:
    hop_samples = load_hop_samples(hop_jsonl_path)
    app_samples = load_app_samples(app_jsonl_path)

    correlation = _get_claim(evidence_record, "correlation")
    confidence = _get_claim(evidence_record, "confidence")
    unknown = _get_claim(evidence_record, "unknown")

    return {
        "observation_window": _observation_window(hop_samples, app_samples),
        "hop_ips": _hop_ips(hop_samples),
        "app_rtt_timeline": _app_rtt_timeline(app_samples),
        "hop_rtt_timeline": _hop_rtt_timeline(hop_samples),
        "onset_timestamps_ns": _onset_timestamps(evidence_record),
        "alignment_delta_ms": correlation.get("lag_ms"),
        "downstream_persistence_hops": confidence["factors"].get("corroborating_hops", []),
        "unknown_hops": unknown["hops"],
        "confidence_level": confidence["level"],
        "confidence_score": confidence["score"],
        "confidence_factors": confidence["factors"],
        "evidence_record_claims": evidence_record["claims"],
    }
