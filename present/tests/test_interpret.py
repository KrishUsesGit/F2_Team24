"""Pure unit tests for present/interpret.py -- the critical test file
for the Result Interpretability Requirement. No network, no root, no
dependency on correlate/ or faultctl/ (interpret.py imports neither)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from interpret import (
    interpret_evidence, _assert_no_forbidden_language,
    RESULT_LOCALIZED, RESULT_PARTIALLY_LOCALIZED, RESULT_NOT_LOCALIZED, RESULT_NO_DEGRADATION,
)


def make_record(hop_range=None, level="insufficient", score=0.0, app_onset=True, trial_id="t1"):
    claims = []
    if app_onset:
        claims.append({"tag": "fact", "text": "Application ping RTT onset detected at t=123 (method=x).",
                        "data_ref": {"series": "app_ping", "t_onset_ns": 123}})
    claims.append({"tag": "inference", "hop_range": hop_range, "text": "x"})
    claims.append({"tag": "correlation", "lag_ms": None, "text": "x"})
    claims.append({"tag": "confidence", "level": level, "score": score, "factors": {}})
    claims.append({"tag": "unknown", "hops": [], "text": "x"})
    return {"trial_id": trial_id, "generated_at_mono_ns": 0, "claims": claims}


class TestFourStates(unittest.TestCase):
    def test_no_degradation_when_no_app_onset_at_all(self):
        rec = make_record(hop_range=None, app_onset=False)
        result = interpret_evidence(rec)
        self.assertEqual(result.result_state, RESULT_NO_DEGRADATION)
        self.assertEqual(result.plain_language, "No significant degradation was detected during this test.")

    def test_not_localized_when_app_onset_but_no_hop_range(self):
        rec = make_record(hop_range=None, app_onset=True)
        result = interpret_evidence(rec)
        self.assertEqual(result.result_state, RESULT_NOT_LOCALIZED)
        self.assertEqual(result.plain_language,
                          "We detected application degradation, but couldn't establish a reliable network-path location.")

    def test_partially_localized_when_confidence_medium(self):
        rec = make_record(hop_range={"min": 3, "max": 5}, level="medium", score=0.6)
        result = interpret_evidence(rec)
        self.assertEqual(result.result_state, RESULT_PARTIALLY_LOCALIZED)
        self.assertEqual(result.plain_language, "We detected degradation, but the exact location is uncertain.")
        self.assertNotIn("3", result.plain_language)  # literal wording, no hop number per approved design

    def test_partially_localized_when_confidence_low(self):
        rec = make_record(hop_range={"min": 2, "max": 5}, level="low", score=0.2)
        result = interpret_evidence(rec)
        self.assertEqual(result.result_state, RESULT_PARTIALLY_LOCALIZED)

    def test_localized_when_confidence_high(self):
        rec = make_record(hop_range={"min": 4, "max": 5}, level="high", score=1.0)
        result = interpret_evidence(rec)
        self.assertEqual(result.result_state, RESULT_LOCALIZED)
        self.assertEqual(result.plain_language, "Degradation appears to begin at or after Hop 4.")

    def test_localized_uses_the_correct_hop_number_not_a_hardcoded_one(self):
        rec = make_record(hop_range={"min": 2, "max": 5}, level="high", score=1.0)
        result = interpret_evidence(rec)
        self.assertIn("Hop 2", result.plain_language)
        self.assertNotIn("Hop 4", result.plain_language)


class TestNeverCausal(unittest.TestCase):
    def test_forbidden_language_detector_actually_catches_something(self):
        with self.assertRaises(AssertionError):
            _assert_no_forbidden_language("Hop 3 caused the lag.")
        with self.assertRaises(AssertionError):
            _assert_no_forbidden_language("Router 4 is faulty.")

    def test_sweep_every_state_produces_no_forbidden_language(self):
        forbidden = ("caused", "fault", "broken", "responsible")
        configs = [
            dict(hop_range=None, app_onset=False),
            dict(hop_range=None, app_onset=True),
            dict(hop_range={"min": 1, "max": 5}, level="low"),
            dict(hop_range={"min": 3, "max": 5}, level="medium"),
            dict(hop_range={"min": 5, "max": 5}, level="high"),
        ]
        for cfg in configs:
            with self.subTest(cfg=cfg):
                rec = make_record(**cfg)
                result = interpret_evidence(rec)
                lowered = result.plain_language.lower()
                for word in forbidden:
                    self.assertNotIn(word, lowered)

    def test_result_includes_hop_range_and_confidence_for_downstream_use(self):
        rec = make_record(hop_range={"min": 3, "max": 5}, level="high", score=0.9)
        result = interpret_evidence(rec)
        self.assertEqual(result.hop_range, {"min": 3, "max": 5})
        self.assertEqual(result.confidence_level, "high")


if __name__ == "__main__":
    unittest.main()
