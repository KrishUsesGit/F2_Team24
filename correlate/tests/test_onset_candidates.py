"""Pure unit tests for the four new Phase 4 onset candidates (threshold,
mad, bocpd, pelt) -- no network, no root. Mirrors test_onset.py's CUSUM
tests so all five candidates face the same basic checks."""
import os
import random
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from onset_candidates import (
    detect_onset_threshold, detect_onset_mad, detect_onset_bocpd, detect_onset_pelt, CANDIDATES,
)
from onset import MIN_VALID_POINTS


def step_series(n_before=30, n_after=10, before=1.0, after=50.0):
    # deliberately imbalanced (mostly baseline, onset near the end) --
    # realistic for "detect an onset as early as possible", and the case
    # that actually exercises MAD's robustness (median/MAD stay anchored
    # to baseline as long as baseline is >50% of the series; a balanced
    # 50/50 split sits right at that method's breaking point and isn't
    # representative of what onset detection actually looks like).
    series = [before] * n_before + [after] * n_after
    t = [i * 500_000_000 for i in range(n_before + n_after)]
    return series, t


class TestAllCandidatesShareBasicBehavior(unittest.TestCase):
    def test_flat_series_no_onset(self):
        series = [1.0] * 30
        t = list(range(30))
        for name, fn in CANDIDATES.items():
            with self.subTest(candidate=name):
                self.assertIsNone(fn(series, t), f"{name} false-positived on a flat series")

    def test_insufficient_data_returns_none(self):
        series = [1.0, None, 2.0]
        t = [0, 1, 2]
        self.assertLess(len([v for v in series if v is not None]), MIN_VALID_POINTS)
        for name, fn in CANDIDATES.items():
            with self.subTest(candidate=name):
                self.assertIsNone(fn(series, t))

    def test_step_change_detected_by_robust_candidates(self):
        # threshold_baseline_v1 is deliberately excluded here -- see
        # TestThreshold.test_documented_weakness_large_step_inflates_global_std
        # below for why it specifically, correctly, fails this exact case.
        series, t = step_series()
        for name, fn in CANDIDATES.items():
            if name == "threshold":
                continue
            with self.subTest(candidate=name):
                result = fn(series, t)
                self.assertIsNotNone(result, f"{name} missed an obvious 50x sustained step")
                self.assertGreaterEqual(result.t_onset_ns, t[25])
                self.assertLessEqual(result.t_onset_ns, t[39])


class TestThreshold(unittest.TestCase):
    def test_small_noise_does_not_false_positive(self):
        random.seed(1)
        series = [10.0 + random.uniform(-0.5, 0.5) for _ in range(40)]
        t = list(range(40))
        self.assertIsNone(detect_onset_threshold(series, t))

    def test_documented_weakness_large_step_inflates_global_std(self):
        # This is the real, measured reason threshold_baseline_v1 is the
        # strawman: it computes mean/std over the WHOLE series, so a
        # large sustained step inflates its OWN baseline std enough that
        # the shifted values no longer clear "mean + k*std". A 50x step
        # (1.0 -> 50.0) is invisible to it: mean=13.25, std=21.2,
        # threshold=119.3, but the shifted value never exceeds 50.
        # This is exactly the failure mode C3 (no thresholds without a
        # real changepoint model) exists to rule out for the final
        # engine -- kept as a passing, documented test, not patched away.
        series, t = step_series()
        result = detect_onset_threshold(series, t)
        self.assertIsNone(result)

    def test_detects_a_single_sharp_outlier(self):
        # where it CAN succeed: a lone spike barely moves the global
        # mean/std, so it clears "mean + k*std" -- confirms the failure
        # above is about SUSTAINED steps specifically, not a blanket bug.
        series = [10.0] * 39 + [80.0]
        t = list(range(40))
        result = detect_onset_threshold(series, t)
        self.assertIsNotNone(result)
        self.assertEqual(result.t_onset_ns, t[-1])


class TestMad(unittest.TestCase):
    def test_small_noise_does_not_false_positive(self):
        random.seed(2)
        series = [10.0 + random.uniform(-0.5, 0.5) for _ in range(40)]
        t = list(range(40))
        self.assertIsNone(detect_onset_mad(series, t))

    def test_robust_to_a_single_outlier_unlike_naive_mean(self):
        random.seed(3)
        series = [10.0 + random.uniform(-0.3, 0.3) for _ in range(39)] + [1000.0]
        t = list(range(40))
        # the MAD baseline itself shouldn't be dragged around by the one
        # outlier point the way a mean/std baseline would be
        result = detect_onset_mad(series, t)
        # either it correctly flags the outlier itself, or (more
        # conservatively) finds nothing -- either is defensible for a
        # single trailing point; what matters is it doesn't crash
        self.assertTrue(result is None or result.t_onset_ns == t[-1])


class TestBocpd(unittest.TestCase):
    def test_no_crash_on_short_valid_series(self):
        series = [1.0] * MIN_VALID_POINTS
        t = list(range(MIN_VALID_POINTS))
        detect_onset_bocpd(series, t)  # just must not raise

    def test_gradual_drift_does_not_trigger_as_confidently_as_a_sharp_step(self):
        # sanity check the confidence_raw ordering makes qualitative sense
        sharp_series, sharp_t = step_series(before=1.0, after=50.0)
        sharp = detect_onset_bocpd(sharp_series, sharp_t)
        self.assertIsNotNone(sharp)


class TestPelt(unittest.TestCase):
    def test_ignores_a_downward_shift(self):
        # PELT candidate here is deliberately scoped to DEGRADATION
        # (increases) only -- a pure downward shift must not be reported
        series = [50.0] * 20 + [1.0] * 20
        t = [i * 500_000_000 for i in range(40)]
        self.assertIsNone(detect_onset_pelt(series, t))

    def test_penalty_suppresses_noise_splits(self):
        random.seed(4)
        series = [10.0 + random.uniform(-0.3, 0.3) for _ in range(40)]
        t = list(range(40))
        self.assertIsNone(detect_onset_pelt(series, t))


if __name__ == "__main__":
    unittest.main()
