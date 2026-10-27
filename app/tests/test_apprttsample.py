"""Pure unit tests for AppRttSample — no network, no root required."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from apprttsample import AppRttSample


class TestAppRttSample(unittest.TestCase):
    def test_round_trip_responded_ping(self):
        s = AppRttSample(seq=10, kind="ping", t_send_mono_ns=1000,
                          t_recv_mono_ns=1050000, rtt_ms=50.0,
                          responded=True, missed_budget=False)
        self.assertEqual(AppRttSample.from_json(s.to_json()), s)

    def test_round_trip_responded_late_interaction(self):
        s = AppRttSample(seq=9, kind="interaction", t_send_mono_ns=1000,
                          t_recv_mono_ns=1200000000, rtt_ms=200.0,
                          responded=True, missed_budget=True)
        self.assertEqual(AppRttSample.from_json(s.to_json()), s)

    def test_missing_interaction_is_null_missed_budget_not_true(self):
        # the Phase 2 schema clarification (approved before Phase 3): a
        # missing response must never be represented as a measured
        # rtt_ms > 150 -- missed_budget is null, not True, when nothing
        # ever arrived.
        s = AppRttSample(seq=3, kind="interaction", t_send_mono_ns=500,
                          t_recv_mono_ns=None, rtt_ms=None,
                          responded=False, missed_budget=None)
        d = s.to_dict()
        for field in ("seq", "kind", "t_send_mono_ns", "t_recv_mono_ns",
                      "rtt_ms", "responded", "missed_budget"):
            self.assertIn(field, d)
        self.assertFalse(d["responded"])
        self.assertIsNone(d["t_recv_mono_ns"])
        self.assertIsNone(d["rtt_ms"])
        self.assertIsNone(d["missed_budget"])  # NOT True
        self.assertEqual(AppRttSample.from_json(s.to_json()), s)

    def test_missing_ping_has_missed_budget_false_not_null(self):
        # ping has no budget concept at all, responded or not -- distinct
        # from the interaction case, which uses null for "not applicable
        # because nothing arrived".
        s = AppRttSample(seq=4, kind="ping", t_send_mono_ns=500,
                          t_recv_mono_ns=None, rtt_ms=None,
                          responded=False, missed_budget=False)
        self.assertFalse(s.responded)
        self.assertFalse(s.missed_budget)

    def test_three_states_are_distinguishable_from_the_record_alone(self):
        within_budget = AppRttSample(seq=1, kind="interaction", t_send_mono_ns=0,
                                      t_recv_mono_ns=100_000_000, rtt_ms=100.0,
                                      responded=True, missed_budget=False)
        late = AppRttSample(seq=2, kind="interaction", t_send_mono_ns=0,
                             t_recv_mono_ns=200_000_000, rtt_ms=200.0,
                             responded=True, missed_budget=True)
        missing = AppRttSample(seq=3, kind="interaction", t_send_mono_ns=0,
                                t_recv_mono_ns=None, rtt_ms=None,
                                responded=False, missed_budget=None)
        # no two of the three states may collapse to the same
        # (responded, missed_budget) signature
        signatures = {(s.responded, s.missed_budget) for s in (within_budget, late, missing)}
        self.assertEqual(len(signatures), 3)


if __name__ == "__main__":
    unittest.main()
