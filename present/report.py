#!/usr/bin/env python3
"""Phase 5 — combined report: plain-language interpretation (A) +
technical evidence (B), per the locked Result Interpretability
Requirement. Output is plain text + JSON only -- no graphical UI, per
the approved Phase 5 plan.

Consumes an already-produced EvidenceRecord (from the frozen
correlate/pipeline.py) plus the same trial's raw hop.jsonl/app.jsonl.
Does not run the pipeline itself -- this is a presentation layer, not
part of the localization engine.
"""
from __future__ import annotations

import argparse
import json

from interpret import interpret_evidence
from technical_view import build_technical_view


def build_report(hop_jsonl_path: str, app_jsonl_path: str, evidence_record: dict) -> dict:
    interpretation = interpret_evidence(evidence_record)
    technical = build_technical_view(hop_jsonl_path, app_jsonl_path, evidence_record)
    return {
        "trial_id": evidence_record.get("trial_id"),
        "plain_language": {
            "result_state": interpretation.result_state,
            "summary": interpretation.plain_language,
        },
        "technical_evidence": technical,
    }


def render_text(report: dict) -> str:
    lines = []
    lines.append(f"HOPTRACE result -- trial {report['trial_id']}")
    lines.append("=" * 60)
    lines.append("")
    lines.append("RESULT")
    lines.append(f"  {report['plain_language']['summary']}")
    lines.append("")
    lines.append("TECHNICAL EVIDENCE")
    t = report["technical_evidence"]
    w = t["observation_window"]
    if w["duration_s"] is not None:
        lines.append(f"  Observation window: {w['duration_s']:.1f}s "
                      f"(t={w['t_start_ns']}..{w['t_end_ns']} ns, CLOCK_MONOTONIC)")
    lines.append(f"  Confidence: {t['confidence_level']} (score={t['confidence_score']})")
    lines.append(f"  Confidence factors: {t['confidence_factors']}")
    lines.append(f"  Alignment delta: {t['alignment_delta_ms']} ms")
    lines.append(f"  Downstream-persistence hops: {t['downstream_persistence_hops']}")
    lines.append(f"  Unknown/unresponsive hops: {t['unknown_hops']}")
    lines.append(f"  Onset timestamps (ns): {t['onset_timestamps_ns']}")
    lines.append("  Hop IPs observed:")
    for ttl, ips in t["hop_ips"].items():
        lines.append(f"    Hop {ttl}: {ips if ips else '(no response)'}")
    lines.append(f"  App RTT timeline: {len(t['app_rtt_timeline'])} samples "
                  f"(full data in JSON output)")
    for ttl, series in t["hop_rtt_timeline"].items():
        lines.append(f"  Hop {ttl} RTT timeline: {len(series)} samples")
    lines.append("")
    lines.append("Evidence claims (fact / inference / correlation / confidence / unknown):")
    for c in t["evidence_record_claims"]:
        lines.append(f"  [{c['tag']}] {c.get('text', '')}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description="HOPTRACE Phase 5 report generator")
    ap.add_argument("--hop-jsonl", required=True)
    ap.add_argument("--app-jsonl", required=True)
    ap.add_argument("--evidence-json", required=True, help="path to an already-produced EvidenceRecord")
    ap.add_argument("--out-json", default=None)
    args = ap.parse_args()

    with open(args.evidence_json) as f:
        evidence_record = json.load(f)

    report = build_report(args.hop_jsonl, args.app_jsonl, evidence_record)
    print(render_text(report))

    if args.out_json:
        with open(args.out_json, "w") as f:
            json.dump(report, f, indent=2, default=str)
        print(f"\n(full JSON report written to {args.out_json})")


if __name__ == "__main__":
    main()
