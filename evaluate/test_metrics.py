"""Pure unit tests for evaluate/metrics.py -- no network, no root."""
import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(__file__))
import metrics as m


def evidence(hop_range, level="high", score=1.0, app_onset_t=None):
    claims = [
        {"tag": "inference", "hop_range": hop_range, "text": "x"},
        {"tag": "correlation", "lag_ms": None, "text": "x"},
        {"tag": "confidence", "level": level, "score": score, "factors": {}},
        {"tag": "unknown", "hops": [], "text": "x"},
    ]
    if app_onset_t is not None:
        claims.append({"tag": "fact", "text": "Application ping RTT onset ...",
                        "data_ref": {"series": "app_ping", "t_onset_ns": app_onset_t}})
    return {"trial_id": "t1", "generated_at_mono_ns": 0, "claims": claims}


def gt(hop_target, t_start=1_000_000_000):
    return [{"event_id": "e1", "trial_id": "t1", "hop_target": hop_target,
              "impairment_type": "latency", "magnitude": {}, "t_start_mono_ns": t_start,
              "t_end_mono_ns": t_start + 5_000_000_000, "tc_command": "x"}]


class TestExpectedHop(unittest.TestCase):
    def test_hop_n_onward_offset(self):
        self.assertEqual(m.expected_first_affected_hop(3), 4)
        self.assertEqual(m.expected_first_affected_hop(4), 5)  # capped at 5
        self.assertIsNone(m.expected_first_affected_hop(None))


class TestExactAndWithin1(unittest.TestCase):
    def test_exact_match(self):
        rec = evidence({"min": 4, "max": 5})
        self.assertTrue(m.is_exact_hop_match(rec, expected_hop=4))
        self.assertFalse(m.is_exact_hop_match(rec, expected_hop=3))

    def test_within_1_but_not_exact(self):
        rec = evidence({"min": 3, "max": 5})
        self.assertFalse(m.is_exact_hop_match(rec, expected_hop=4))
        self.assertTrue(m.is_within_1_hop_match(rec, expected_hop=4))

    def test_no_claim_is_not_applicable_not_wrong(self):
        rec = evidence(None)
        self.assertIsNone(m.is_exact_hop_match(rec, expected_hop=4))
        self.assertIsNone(m.is_within_1_hop_match(rec, expected_hop=4))


class TestFalseAttribution(unittest.TestCase):
    def test_confident_wrong_claim_on_real_fault(self):
        rec = evidence({"min": 2, "max": 5}, level="high")
        self.assertTrue(m.is_false_attribution(rec, expected_hop=4))

    def test_confident_claim_on_clean_control_is_false_attribution(self):
        rec = evidence({"min": 4, "max": 5}, level="high")
        self.assertTrue(m.is_false_attribution(rec, expected_hop=None))

    def test_low_confidence_wrong_claim_is_not_counted(self):
        rec = evidence({"min": 2, "max": 5}, level="low")
        self.assertFalse(m.is_false_attribution(rec, expected_hop=4))

    def test_no_claim_is_never_false_attribution(self):
        rec = evidence(None, level="high")
        self.assertFalse(m.is_false_attribution(rec, expected_hop=4))
        self.assertFalse(m.is_false_attribution(rec, expected_hop=None))

    def test_correct_confident_claim_is_not_false_attribution(self):
        rec = evidence({"min": 4, "max": 5}, level="high")
        self.assertFalse(m.is_false_attribution(rec, expected_hop=4))


class TestSummarize(unittest.TestCase):
    def test_mixed_population(self):
        results = [
            m.evaluate_trial(evidence({"min": 4, "max": 5}), gt(3), "cusum"),   # exact
            m.evaluate_trial(evidence({"min": 3, "max": 5}), gt(3), "cusum"),   # within-1, not exact
            m.evaluate_trial(evidence(None), gt(2), "cusum"),                  # missed positive
            m.evaluate_trial(evidence(None), [], "cusum"),                    # clean control, correct
            m.evaluate_trial(evidence({"min": 2, "max": 5}, level="high"), [], "cusum"),  # FALSE POSITIVE
        ]
        summary = m.summarize(results)
        self.assertEqual(summary["n_trials"], 5)
        self.assertEqual(summary["n_positive"], 3)
        self.assertEqual(summary["n_negative_clean_control"], 2)
        self.assertEqual(summary["exact_hop_accuracy"]["numerator"], 1)
        self.assertEqual(summary["exact_hop_accuracy"]["denominator"], 2)  # only the 2 that made a claim
        self.assertEqual(summary["within_1_hop_accuracy"]["numerator"], 2)
        self.assertEqual(summary["clean_control_false_positive_rate"]["numerator"], 1)
        self.assertEqual(summary["clean_control_false_positive_rate"]["denominator"], 2)
        self.assertEqual(summary["detection_recall"]["numerator"], 2)
        self.assertEqual(summary["detection_recall"]["denominator"], 3)

    def test_wilson_ci_bounds_are_sane(self):
        lo, hi = m.wilson_ci(3, 4)
        self.assertGreater(lo, 0.0)
        self.assertLess(hi, 1.0)
        self.assertLess(lo, 3 / 4)
        self.assertGreater(hi, 3 / 4)

    def test_wilson_ci_empty_denominator(self):
        self.assertEqual(m.wilson_ci(0, 0), (None, None))


class TestBrierAndCalibration(unittest.TestCase):
    def test_perfect_confidence_gives_zero_brier(self):
        results = [
            m.evaluate_trial(evidence({"min": 4, "max": 5}, score=1.0), gt(3), "cusum"),
        ]
        b = m.brier_score(results)
        self.assertAlmostEqual(b["brier"], 0.0)

    def test_correct_abstention_on_clean_control_is_excluded_not_rewarded(self):
        # a clean control where the engine correctly found nothing has no
        # confidence-bearing claim to score -- must not appear in Brier at all
        results = [m.evaluate_trial(evidence(None, score=0.0), [], "cusum")]
        b = m.brier_score(results)
        self.assertEqual(b["n"], 0)
        self.assertIsNone(b["brier"])

    def test_false_positive_claim_on_clean_control_is_scored_as_wrong(self):
        results = [m.evaluate_trial(evidence({"min": 3, "max": 5}, score=0.9, level="high"), [], "cusum")]
        b = m.brier_score(results)
        self.assertEqual(b["n"], 1)
        self.assertAlmostEqual(b["brier"], 0.81)  # (0.9 - 0)^2

    def test_overconfident_wrong_gives_high_brier(self):
        results = [m.evaluate_trial(evidence({"min": 1, "max": 5}, score=1.0, level="high"), gt(3), "cusum")]
        b = m.brier_score(results)
        self.assertAlmostEqual(b["brier"], 1.0)


if __name__ == "__main__":
    unittest.main()
