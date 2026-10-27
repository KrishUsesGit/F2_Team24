"""Pure unit tests for align.py — no network, no root required."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from align import align_and_localize, DELTA_ALIGN_NS
from onset import OnsetResult


def onset(t_ns):
    return OnsetResult(t_onset_ns=t_ns, confidence_raw=1.0, method="test")


class TestAlignAndLocalize(unittest.TestCase):
    def test_no_app_onset_means_no_localization(self):
        # "hop evidence changes but application degradation is absent"
        hop_onsets = {1: None, 2: None, 3: onset(1000), 4: onset(1100), 5: onset(1200)}
        result = align_and_localize(None, hop_onsets)
        self.assertIsNone(result.hop_range)
        self.assertEqual(result.corroborating_hops, [])

    def test_concurrent_and_persistent_localizes_to_shallowest(self):
        app = onset(1_000_000_000)
        hop_onsets = {
            1: None, 2: None,
            3: onset(1_000_000_000),
            4: onset(1_050_000_000),
            5: onset(1_100_000_000),
        }
        result = align_and_localize(app, hop_onsets)
        self.assertEqual(result.hop_range, {"min": 3, "max": 5})
        self.assertEqual(result.corroborating_hops, [3, 4, 5])

    def test_isolated_spike_without_downstream_persistence_is_rejected(self):
        # hop 2 spikes concurrently with the app, but hop 3/4/5 show nothing
        # -- review §11: this must NOT be localized to hop 2.
        app = onset(1_000_000_000)
        hop_onsets = {1: None, 2: onset(1_000_000_000), 3: None, 4: None, 5: None}
        result = align_and_localize(app, hop_onsets)
        self.assertIsNone(result.hop_range)

    def test_outside_alignment_tolerance_is_not_corroborating(self):
        app = onset(1_000_000_000)
        far_away = onset(1_000_000_000 + DELTA_ALIGN_NS + 1)
        hop_onsets = {1: None, 2: None, 3: far_away}
        result = align_and_localize(app, hop_onsets)
        self.assertIsNone(result.hop_range)

    def test_missing_hop_data_does_not_fabricate_a_range(self):
        # app degrades, hop 3 shows nothing (UNKNOWN handled upstream in
        # the pipeline) -- must not silently claim a hop_range anyway.
        app = onset(1_000_000_000)
        hop_onsets = {1: None, 2: None, 3: None, 4: None, 5: None}
        result = align_and_localize(app, hop_onsets)
        self.assertIsNone(result.hop_range)
        self.assertEqual(result.corroborating_hops, [])


if __name__ == "__main__":
    unittest.main()
