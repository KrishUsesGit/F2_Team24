"""Pure unit tests for the Phase 4b diagnostic-driven variants -- no
network, no root. Each test targets the specific mechanism the variant
was built to fix, using synthetic data shaped like the real diagnostic
findings (tiny-noise-floor false positives; early-blip-then-real-later-
signal)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from onset_candidates_v2 import (
    detect_onset_mad_absfloor, detect_onset_mad_sustained, detect_onset_mad_largest_run,
)


def near_zero_noise_series(n=40, base=0.007, jitter=0.0007):
    # mimics the real diagnosed clean-hop pattern: tiny absolute noise
    import random
    random.seed(7)
    series = [base + random.uniform(-jitter, jitter) for _ in range(n)]
    t = list(range(n))
    return series, t


def early_blip_then_real_signal(n_before=20, blip_len=1, blip_val=0.02,
                                 base=0.007, real_val=50.0, real_start=60, n=70):
    # real_start=60/n=70 keeps the fault period a MINORITY of the series
    # (~14%) -- a 50/50 split would contaminate the global median/MAD
    # baseline itself (the same pathology documented in
    # test_onset_candidates.py's step_series), which is not what this
    # test is checking.
    import random
    random.seed(8)
    series = [base + random.uniform(-0.0005, 0.0005) for _ in range(n)]
    # a brief, single-bucket noise blip early on -- mimics measurement jitter
    for i in range(5, 5 + blip_len):
        series[i] = blip_val
    # the REAL, sustained fault starting later
    for i in range(real_start, n):
        series[i] = real_val
    t = list(range(n))
    return series, t


class TestAbsFloor(unittest.TestCase):
    def test_ignores_near_zero_noise_that_fooled_plain_mad(self):
        series, t = near_zero_noise_series()
        result = detect_onset_mad_absfloor(series, t, abs_floor_ms=0.5)
        self.assertIsNone(result)

    def test_still_detects_a_real_large_shift(self):
        series = [0.007] * 30 + [50.0] * 10
        t = list(range(40))
        result = detect_onset_mad_absfloor(series, t, abs_floor_ms=0.5)
        self.assertIsNotNone(result)
        self.assertGreaterEqual(result.t_onset_ns, t[25])


class TestSustained(unittest.TestCase):
    def test_ignores_a_single_bucket_blip(self):
        series, t = early_blip_then_real_signal(real_start=1000)  # no real signal reachable, blip only
        series = [0.007] * 20 + [0.02] + [0.007] * 19  # single-point blip, otherwise flat
        t = list(range(40))
        result = detect_onset_mad_sustained(series, t, min_run=3)
        self.assertIsNone(result)

    def test_detects_a_sustained_run(self):
        series = [0.007] * 20 + [50.0] * 10
        t = list(range(30))
        result = detect_onset_mad_sustained(series, t, min_run=3)
        self.assertIsNotNone(result)
        self.assertEqual(result.t_onset_ns, t[20])


class TestLargestRun(unittest.TestCase):
    def test_prefers_the_real_later_sustained_fault_over_an_early_blip(self):
        series, t = early_blip_then_real_signal(blip_len=1, real_start=60, n=70)
        result = detect_onset_mad_largest_run(series, t)
        self.assertIsNotNone(result)
        # must land at the REAL fault's start, not the earlier single-point blip
        self.assertEqual(result.t_onset_ns, t[60])

    def test_flat_series_no_onset(self):
        series = [0.007] * 40
        t = list(range(40))
        self.assertIsNone(detect_onset_mad_largest_run(series, t))


if __name__ == "__main__":
    unittest.main()
