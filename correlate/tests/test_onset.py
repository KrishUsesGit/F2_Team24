"""Pure unit tests for onset.py's PROVISIONAL CUSUM baseline —
no network, no root required."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from onset import detect_onset, MIN_VALID_POINTS


class TestDetectOnset(unittest.TestCase):
    def test_flat_series_no_onset(self):
        series = [1.0] * 30
        t = list(range(30))
        self.assertIsNone(detect_onset(series, t))

    def test_step_change_detected_near_the_step(self):
        series = [1.0] * 20 + [50.0] * 20
        t = [i * 500_000_000 for i in range(40)]
        result = detect_onset(series, t)
        self.assertIsNotNone(result)
        step_time = t[20]
        # onset should be flagged at or shortly after the actual step,
        # not dozens of samples early or late
        self.assertGreaterEqual(result.t_onset_ns, t[15])
        self.assertLessEqual(result.t_onset_ns, t[30])
        self.assertEqual(result.method, "provisional_cusum_v1")

    def test_insufficient_data_returns_none(self):
        series = [1.0, None, 2.0]
        t = [0, 1, 2]
        self.assertLess(len([v for v in series if v is not None]), MIN_VALID_POINTS)
        self.assertIsNone(detect_onset(series, t))

    def test_none_values_are_skipped_not_treated_as_zero(self):
        # a run of Nones in the middle of an otherwise-flat series must
        # not itself look like a drop/step to the detector
        series = [10.0] * 10 + [None] * 5 + [10.0] * 10
        t = list(range(25))
        self.assertIsNone(detect_onset(series, t))

    def test_small_noise_does_not_false_positive(self):
        import random
        random.seed(42)
        series = [10.0 + random.uniform(-0.5, 0.5) for _ in range(40)]
        t = list(range(40))
        result = detect_onset(series, t)
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
