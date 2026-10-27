"""Pure unit tests for evidence.py — no network, no root required.
Enforces the technical-honesty language requirement structurally."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from evidence import classify_evidence
from align import LocalizationResult
from onset import OnsetResult


def onset(t_ns):
    return OnsetResult(t_onset_ns=t_ns, confidence_raw=1.0, method="test")


class TestClassifyEvidence(unittest.TestCase):
    def test_all_five_tags_present(self):
        loc = LocalizationResult(hop_range={"min": 3, "max": 5}, corroborating_hops=[3, 4, 5])
        raw = {"app_onset": onset(1000), "hop_onsets": {3: onset(1000), 4: onset(1050), 5: onset(1100)},
               "unknown_hops": [], "buckets": [], "trial_id": "t1"}
        record = classify_evidence(loc, raw)
        tags = {c["tag"] for c in record["claims"]}
        self.assertEqual(tags, {"fact", "inference", "correlation", "confidence", "unknown"})

    def test_never_asserts_causation(self):
        loc = LocalizationResult(hop_range={"min": 3, "max": 5}, corroborating_hops=[3, 4, 5])
        raw = {"app_onset": onset(1000), "hop_onsets": {3: onset(1000)},
               "unknown_hops": [], "buckets": [], "trial_id": "t1"}
        record = classify_evidence(loc, raw)
        full_text = " ".join(c.get("text", "") for c in record["claims"]).lower()
        self.assertNotIn("caused", full_text)
        self.assertNotIn("is faulty", full_text)
        self.assertNotIn("is broken", full_text)
        self.assertIn("at or after hop 3", full_text)

    def test_insufficient_evidence_is_labeled_insufficient_not_a_fabricated_hop(self):
        loc = LocalizationResult(hop_range=None, corroborating_hops=[])
        raw = {"app_onset": onset(1000), "hop_onsets": {1: None, 2: None},
               "unknown_hops": [1, 2, 3, 4, 5], "buckets": [], "trial_id": "t1"}
        record = classify_evidence(loc, raw)
        inference = next(c for c in record["claims"] if c["tag"] == "inference")
        confidence = next(c for c in record["claims"] if c["tag"] == "confidence")
        self.assertIsNone(inference["hop_range"])
        self.assertEqual(confidence["level"], "insufficient")

    def test_confidence_score_is_bounded_0_1(self):
        loc = LocalizationResult(hop_range={"min": 1, "max": 5}, corroborating_hops=[1, 2, 3, 4, 5])
        raw = {"app_onset": onset(1000), "hop_onsets": {i: onset(1000) for i in range(1, 6)},
               "unknown_hops": [], "buckets": [], "trial_id": "t1"}
        record = classify_evidence(loc, raw)
        confidence = next(c for c in record["claims"] if c["tag"] == "confidence")
        self.assertGreaterEqual(confidence["score"], 0.0)
        self.assertLessEqual(confidence["score"], 1.0)
        self.assertEqual(confidence["level"], "high")

    def test_unknown_hops_are_listed_explicitly(self):
        loc = LocalizationResult(hop_range=None, corroborating_hops=[])
        raw = {"app_onset": None, "hop_onsets": {}, "unknown_hops": [2, 4], "buckets": [], "trial_id": "t1"}
        record = classify_evidence(loc, raw)
        unknown = next(c for c in record["claims"] if c["tag"] == "unknown")
        self.assertEqual(unknown["hops"], [2, 4])


if __name__ == "__main__":
    unittest.main()
