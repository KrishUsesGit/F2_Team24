"""Pure unit tests for HopSample — no network, no root required."""
import sys
import os
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from hopsample import HopSample


class TestHopSample(unittest.TestCase):
    def test_round_trip_responded(self):
        s = HopSample(round_id=3, ttl=2, hop_ip="10.10.2.2", rtt_ms=1.234,
                       responded=True, probe_index=0,
                       t_send_mono_ns=1000, t_recv_mono_ns=1234000)
        s2 = HopSample.from_json(s.to_json())
        self.assertEqual(s, s2)

    def test_round_trip_unresponded_is_null_not_omitted(self):
        s = HopSample(round_id=7, ttl=5, hop_ip=None, rtt_ms=None,
                       responded=False, probe_index=1,
                       t_send_mono_ns=999, t_recv_mono_ns=None)
        d = s.to_dict()
        # spec §05: a non-response is recorded as responded=False, never
        # silently dropped from the record — every field must still be present.
        for field in ("round_id", "ttl", "hop_ip", "rtt_ms", "responded",
                      "probe_index", "t_send_mono_ns", "t_recv_mono_ns"):
            self.assertIn(field, d)
        self.assertIsNone(d["hop_ip"])
        self.assertIsNone(d["rtt_ms"])
        self.assertFalse(d["responded"])

    def test_json_is_one_line(self):
        s = HopSample(round_id=0, ttl=1, hop_ip="10.10.1.2", rtt_ms=0.5,
                       responded=True, probe_index=0,
                       t_send_mono_ns=1, t_recv_mono_ns=2)
        self.assertNotIn("\n", s.to_json())


if __name__ == "__main__":
    unittest.main()
