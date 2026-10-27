"""Tests for present/path_bundle.py -- the critical guarantee is that
every hop's "status" is byte-traceable to existing frozen fields
(unknown_hops, downstream_persistence_hops), never independently
decided, plus a forbidden-language sweep across real trial data.

Uses the already-produced evidence_4b.json fixtures (generated during
Phase 5 verification with the frozen mad_sustained algorithm selected
in Phase 4b) as EvidenceRecord input -- matching path_bundle.py's real
usage, which consumes an already-produced EvidenceRecord and never
runs the pipeline itself. Deliberately does NOT recompute evidence via
run_pipeline(algorithm="cusum"): that naive/superseded algorithm is the
one Phase 4b diagnosed as producing spurious onsets on clean-control
data, which would make these tests validate the wrong algorithm."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "correlate"))
from path_bundle import build_path_bundle, _hop_status, _split_baseline_observed, FORBIDDEN_SUBSTRINGS

EXP = os.path.join(REPO_ROOT, "experiments")

FIXTURES = {
    "localized": os.path.join(EXP, "p4-held-04-latency-hop2-moderate"),
    "clean": os.path.join(EXP, "p4-held-01-clean1"),
    "partial_unknown": os.path.join(EXP, "p4-held-12-unknown-plus-impair"),
}


def _bundle_for(name):
    d = FIXTURES[name]
    hop_path = os.path.join(d, "hop.jsonl")
    app_path = os.path.join(d, "app.jsonl")
    with open(os.path.join(d, "evidence_4b.json")) as f:
        record = json.load(f)
    return build_path_bundle(hop_path, app_path, record, trial_id=name)


class TestHopStatusPureFunction(unittest.TestCase):
    def test_unknown_takes_priority(self):
        self.assertEqual(_hop_status(3, unknown_hops={3}, corroborating_hops={3}), "unknown")

    def test_degraded_only_if_corroborating(self):
        self.assertEqual(_hop_status(4, unknown_hops=set(), corroborating_hops={4, 5}), "degraded")

    def test_healthy_is_the_default(self):
        self.assertEqual(_hop_status(1, unknown_hops=set(), corroborating_hops={4, 5}), "healthy")


class TestSplitBaselineObserved(unittest.TestCase):
    def test_no_onset_gives_single_mean_no_observed(self):
        timeline = [{"t_send_mono_ns": i, "rtt_ms": 1.0, "responded": True} for i in range(5)]
        result = _split_baseline_observed(timeline, onset_ns=None)
        self.assertEqual(result["baseline_ms"], 1.0)
        self.assertIsNone(result["observed_ms"])

    def test_splits_correctly_at_onset(self):
        timeline = (
            [{"t_send_mono_ns": i, "rtt_ms": 1.0, "responded": True} for i in range(5)]
            + [{"t_send_mono_ns": i, "rtt_ms": 100.0, "responded": True} for i in range(5, 10)]
        )
        result = _split_baseline_observed(timeline, onset_ns=5)
        self.assertEqual(result["baseline_ms"], 1.0)
        self.assertEqual(result["observed_ms"], 100.0)

    def test_unresponded_samples_excluded(self):
        timeline = [{"t_send_mono_ns": 0, "rtt_ms": None, "responded": False},
                    {"t_send_mono_ns": 1, "rtt_ms": 2.0, "responded": True}]
        result = _split_baseline_observed(timeline, onset_ns=None)
        self.assertEqual(result["baseline_ms"], 2.0)


@unittest.skipUnless(os.path.exists(os.path.join(FIXTURES["localized"], "hop.jsonl")),
                      "fixture trial data not present in this environment")
class TestBuildPathBundleAgainstRealTrials(unittest.TestCase):
    def test_localized_trial_status_matches_frozen_fields_exactly(self):
        bundle = _bundle_for("localized")
        d = FIXTURES["localized"]
        with open(os.path.join(d, "evidence_4b.json")) as f:
            record = json.load(f)
        from technical_view import build_technical_view
        technical = build_technical_view(os.path.join(d, "hop.jsonl"),
                                          os.path.join(d, "app.jsonl"), record)
        corroborating = set(technical["downstream_persistence_hops"])
        unknown = set(technical["unknown_hops"])
        for hop in bundle["hops"]:
            ttl = hop["ttl"]
            expected = "unknown" if ttl in unknown else ("degraded" if ttl in corroborating else "healthy")
            self.assertEqual(hop["status"], expected, f"hop {ttl} status mismatch")

    def test_clean_trial_has_no_degraded_hops(self):
        bundle = _bundle_for("clean")
        statuses = {h["ttl"]: h["status"] for h in bundle["hops"]}
        self.assertNotIn("degraded", statuses.values())
        self.assertEqual(bundle["plain_language"]["result_state"], "no_degradation")

    def test_unknown_hop_trial_shows_unknown_status_not_healthy(self):
        bundle = _bundle_for("partial_unknown")
        unknown_ttls = {h["ttl"] for h in bundle["hops"] if h["status"] == "unknown"}
        self.assertTrue(len(unknown_ttls) > 0)
        for ttl in unknown_ttls:
            self.assertIn(ttl, bundle["unknown_hops"])

    def test_evidence_record_claims_forwarded_unmodified(self):
        for name in FIXTURES:
            d = FIXTURES[name]
            with open(os.path.join(d, "evidence_4b.json")) as f:
                record = json.load(f)
            bundle = _bundle_for(name)
            self.assertEqual(bundle["evidence_record_claims"], record["claims"])

    def test_attach_evaluation_labels_exposed_set_and_stores_no_absolute_path(self):
        from path_bundle import attach_evaluation
        results_path = os.path.join(REPO_ROOT, "evaluate", "held_out_results_4b.json")
        bundle = attach_evaluation(_bundle_for("clean"), results_path)
        ev = bundle["evaluation"]
        self.assertEqual(ev["evidence_status"], "exposed_holdout_not_independent")
        self.assertIn("EXPOSED", ev["scope"])
        self.assertEqual(ev["source_file"], "held_out_results_4b.json")
        with open(results_path) as f:
            self.assertEqual(ev["summary"], json.load(f)["summary"])  # numbers pass through unchanged

    def test_all_five_hops_present_every_trial(self):
        for name in FIXTURES:
            bundle = _bundle_for(name)
            self.assertEqual({h["ttl"] for h in bundle["hops"]}, {1, 2, 3, 4, 5})

    def test_no_forbidden_language_across_all_fixture_trials(self):
        for name in FIXTURES:
            bundle = _bundle_for(name)
            texts = [bundle["plain_language"]["summary"]]
            for h in bundle["hops"]:
                texts.extend(h["why_highlighted"])
            for text in texts:
                lowered = text.lower()
                for phrase in FORBIDDEN_SUBSTRINGS:
                    self.assertNotIn(phrase, lowered, f"forbidden phrase in trial {name}: {text!r}")

    def test_real_rtt_values_present_not_fabricated(self):
        bundle = _bundle_for("localized")
        degraded_hops = [h for h in bundle["hops"] if h["status"] == "degraded"]
        self.assertTrue(len(degraded_hops) > 0)
        for h in degraded_hops:
            self.assertIsNotNone(h["rtt_observed_ms"])
            self.assertGreater(h["rtt_observed_ms"], h["rtt_baseline_ms"])


if __name__ == "__main__":
    unittest.main()
