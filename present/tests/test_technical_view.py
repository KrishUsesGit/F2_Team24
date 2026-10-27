"""Unit tests for present/technical_view.py against a REAL, existing
trial (read-only fixture: experiments/p4b-tune-09-jitter-hop1-moderate,
already-persisted from Phase 4b -- not modified by this test). Uses the
frozen correlate/pipeline.py only to produce the EvidenceRecord input
(exactly as any real caller would), never to validate its own
correctness -- this test checks technical_view's OWN extraction logic
against the raw files directly."""
import json
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(REPO_ROOT, "correlate"))
from technical_view import build_technical_view
from pipeline import run_pipeline

FIXTURE_DIR = os.path.join(REPO_ROOT, "experiments", "p4b-tune-09-jitter-hop1-moderate")
HOP_PATH = os.path.join(FIXTURE_DIR, "hop.jsonl")
APP_PATH = os.path.join(FIXTURE_DIR, "app.jsonl")


@unittest.skipUnless(os.path.exists(HOP_PATH), "fixture trial data not present in this environment")
class TestTechnicalView(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.evidence_record = run_pipeline(HOP_PATH, APP_PATH, trial_id="test-fixture", algorithm="cusum")
        cls.view = build_technical_view(HOP_PATH, APP_PATH, cls.evidence_record)

    def test_observation_window_matches_real_data_span(self):
        with open(HOP_PATH) as f:
            rows = [json.loads(l) for l in f if l.strip()]
        expected_start = min(r["t_send_mono_ns"] for r in rows)
        self.assertEqual(self.view["observation_window"]["t_start_ns"], expected_start)
        self.assertGreater(self.view["observation_window"]["duration_s"], 0)

    def test_hop_ips_present_for_responsive_hops(self):
        # this testbed's hops 2-5 are always responsive in a clean run;
        # each should show at least one real 10.10.x.x address
        for ttl in (2, 3, 4, 5):
            ips = self.view["hop_ips"][ttl]
            self.assertTrue(len(ips) >= 1, f"hop {ttl} should have at least one observed IP")
            for ip in ips:
                self.assertTrue(ip.startswith("10.10."), f"unexpected IP format: {ip}")

    def test_app_rtt_timeline_is_real_raw_samples_not_bucketed(self):
        with open(APP_PATH) as f:
            n_pings = sum(1 for l in f if l.strip() and json.loads(l)["kind"] == "ping")
        self.assertEqual(len(self.view["app_rtt_timeline"]), n_pings)

    def test_hop_rtt_timeline_has_all_five_expected_hops(self):
        self.assertEqual(set(self.view["hop_rtt_timeline"].keys()), {1, 2, 3, 4, 5})

    def test_confidence_and_evidence_claims_pass_through_unmodified(self):
        conf_claim = next(c for c in self.evidence_record["claims"] if c["tag"] == "confidence")
        self.assertEqual(self.view["confidence_level"], conf_claim["level"])
        self.assertEqual(self.view["confidence_score"], conf_claim["score"])
        self.assertEqual(self.view["evidence_record_claims"], self.evidence_record["claims"])

    def test_does_not_mutate_the_evidence_record(self):
        import copy
        before = copy.deepcopy(self.evidence_record)
        build_technical_view(HOP_PATH, APP_PATH, self.evidence_record)
        self.assertEqual(self.evidence_record, before)


if __name__ == "__main__":
    unittest.main()
