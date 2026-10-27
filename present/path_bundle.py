#!/usr/bin/env python3
"""Phase 6 — UI-ready data bundle. NOT an analysis engine.

This module performs ONLY:
  - transformation of already-computed evidence into UI-ready shape
  - descriptive summarization (mean RTT before/after an already-reported
    onset timestamp) of already-collected raw measurements
  - templated, evidence-bounded explanatory text

It NEVER:
  - calls detect_onset, align_and_localize, or classify_evidence
  - invents a status not already implied by unknown_hops /
    downstream_persistence_hops (== corroborating_hops)
  - computes a new threshold, confidence value, or timestamp

Every hop's "status" is a byte-traceable re-expression of existing
typed fields (see _hop_status) -- covered by
present/tests/test_path_bundle.py, which asserts this correspondence
directly against real trials, not just synthetic ones.

Does not modify interpret.py, technical_view.py, or report.py (Phase 5,
frozen at c202be0) -- imports them unchanged.
"""
from __future__ import annotations

import argparse
import json
import os
import statistics as st
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(_HERE, "..", "correlate"))
sys.path.insert(0, _HERE)

from interpret import interpret_evidence
from technical_view import build_technical_view
from synchronize import EXPECTED_HOPS

FORBIDDEN_SUBSTRINGS = ("caused", "is faulty", "is broken", "responsible for", "your fault")


def _hop_status(ttl: int, unknown_hops: set, corroborating_hops: set) -> str:
    """Pure re-expression of existing frozen fields -- no new decision."""
    if ttl in unknown_hops:
        return "unknown"
    if ttl in corroborating_hops:
        return "degraded"
    return "healthy"


def _split_baseline_observed(timeline: list, onset_ns) -> dict:
    """Descriptive summary only: mean RTT of already-collected samples,
    split at an already-reported onset timestamp. Computes nothing that
    feeds back into detection -- for display only."""
    responded = [s for s in timeline if s["responded"]]
    if not responded:
        return {"baseline_ms": None, "observed_ms": None}
    if onset_ns is None:
        vals = [s["rtt_ms"] for s in responded]
        return {"baseline_ms": round(st.mean(vals), 4), "observed_ms": None}
    before = [s["rtt_ms"] for s in responded if s["t_send_mono_ns"] < onset_ns]
    after = [s["rtt_ms"] for s in responded if s["t_send_mono_ns"] >= onset_ns]
    return {
        "baseline_ms": round(st.mean(before), 4) if before else None,
        "observed_ms": round(st.mean(after), 4) if after else None,
    }


def _why_highlighted(ttl: int, status: str, corroborating_hops: list, confidence_level: str) -> list:
    """Templated, evidence-bounded text -- every sentence traces to an
    existing typed field, never a new inference."""
    if status == "unknown":
        return ["This hop did not respond to enough probes to evaluate."]
    if status == "degraded":
        bullets = ["Application degradation onset is temporally correlated with this hop's onset."]
        downstream = sorted(h for h in corroborating_hops if h > ttl)
        if downstream:
            hop_list = ", ".join(f"Hop {h}" for h in downstream)
            bullets.append(f"Downstream persistence observed at {hop_list}.")
        bullets.append(f"Confidence: {confidence_level}.")
        return bullets
    return ["No onset was detected here that aligned with the application-level degradation."]


def _assert_evidence_bounded(bundle: dict) -> None:
    texts = [bundle["plain_language"]["summary"]]
    for h in bundle["hops"]:
        texts.extend(h["why_highlighted"])
    for text in texts:
        lowered = text.lower()
        for phrase in FORBIDDEN_SUBSTRINGS:
            if phrase in lowered:
                raise AssertionError(
                    f"path_bundle produced forbidden causal language ({phrase!r}): {text!r}"
                )


def build_path_bundle(hop_jsonl_path: str, app_jsonl_path: str, evidence_record: dict,
                       trial_id: str | None = None) -> dict:
    interpretation = interpret_evidence(evidence_record)
    technical = build_technical_view(hop_jsonl_path, app_jsonl_path, evidence_record)

    corroborating = technical["downstream_persistence_hops"]
    unknown = set(technical["unknown_hops"])
    onset_ts = technical["onset_timestamps_ns"]

    hops = []
    for ttl in EXPECTED_HOPS:
        status = _hop_status(ttl, unknown, set(corroborating))
        ips = technical["hop_ips"].get(ttl, [])
        timeline = technical["hop_rtt_timeline"].get(ttl, [])
        onset_ns = onset_ts.get(f"hop_{ttl}")
        rtts = _split_baseline_observed(timeline, onset_ns)
        hops.append({
            "ttl": ttl,
            "ip": ips[0] if ips else None,
            "all_ips": ips,
            "status": status,
            "rtt_baseline_ms": rtts["baseline_ms"],
            "rtt_observed_ms": rtts["observed_ms"],
            "onset_ns": onset_ns,
            "sample_count": len(timeline),
            "why_highlighted": _why_highlighted(ttl, status, corroborating, technical["confidence_level"]),
        })

    app_timeline_raw = technical["app_rtt_timeline"]
    app_onset_ns = onset_ts.get("app")
    app_rtts = _split_baseline_observed(app_timeline_raw, app_onset_ns)

    bundle = {
        "trial_id": trial_id or evidence_record.get("trial_id"),
        "plain_language": {
            "result_state": interpretation.result_state,
            "summary": interpretation.plain_language,
        },
        "hop_range": interpretation.hop_range,
        "confidence": {
            "level": technical["confidence_level"],
            "score": technical["confidence_score"],
            "factors": technical["confidence_factors"],
        },
        "alignment_delta_ms": technical["alignment_delta_ms"],
        "observation_window": technical["observation_window"],
        "evidence_record_claims": technical["evidence_record_claims"],
        "app": {
            "onset_ns": app_onset_ns,
            "rtt_baseline_ms": app_rtts["baseline_ms"],
            "rtt_observed_ms": app_rtts["observed_ms"],
            "sample_count": len(app_timeline_raw),
            "timeline": app_timeline_raw,
        },
        "hops": hops,
        "unknown_hops": sorted(unknown),
    }
    _assert_evidence_bounded(bundle)
    return bundle


def attach_evaluation(bundle: dict, held_out_results_path: str) -> dict:
    """Reads the frozen held-out result file VERBATIM. Never recomputes,
    never alters a value. Explicitly scoped as system-wide, not this trial.

    The numbers are a faithful historical record; the scope/evidence_status
    text states how they may be cited: the p4-held-* set was EXPOSED to
    Phase 4b candidate design (see docs/EVIDENCE_LEDGER.md), so they are
    not independent validation. Bundles generated before this wording
    (experiments/*/path_bundle.json) carry the older scope string and are
    kept unchanged as historical artifacts."""
    with open(held_out_results_path) as f:
        results = json.load(f)
    frozen = results.get("frozen_config", {})
    bundle["evaluation"] = {
        "scope": ("overall system, scored on an EXPOSED held-out set -- not independent "
                  "validation, not specific to this trial"),
        "evidence_status": "exposed_holdout_not_independent",
        "source_file": os.path.basename(held_out_results_path),
        "summary": results.get("summary"),
        "brier_score": results.get("brier_score"),
        "gate_check": results.get("gate_check"),
        "algorithm": frozen.get("selected_algorithm"),
        "git_commit": frozen.get("git_commit"),
    }
    return bundle


def main():
    ap = argparse.ArgumentParser(description="HOPTRACE Phase 6 path_bundle generator")
    ap.add_argument("--hop-jsonl", required=True)
    ap.add_argument("--app-jsonl", required=True)
    ap.add_argument("--evidence-json", required=True)
    ap.add_argument("--trial-id", default=None)
    ap.add_argument("--attach-evaluation", default=None, help="path to held_out_results_4b.json")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    with open(args.evidence_json) as f:
        evidence_record = json.load(f)

    bundle = build_path_bundle(args.hop_jsonl, args.app_jsonl, evidence_record, args.trial_id)
    if args.attach_evaluation:
        bundle = attach_evaluation(bundle, args.attach_evaluation)

    with open(args.out, "w") as f:
        json.dump(bundle, f, indent=2, default=str)
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
