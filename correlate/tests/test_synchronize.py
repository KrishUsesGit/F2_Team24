"""Pure unit tests for synchronize.py — no network, no root required."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from synchronize import build_synchronized_timeline, EXPECTED_HOPS


def hop_sample(round_id, ttl, t_send, rtt_ms=1.0, responded=True):
    return {"round_id": round_id, "ttl": ttl, "hop_ip": f"10.10.{ttl}.2" if responded else None,
            "rtt_ms": rtt_ms if responded else None, "responded": responded, "probe_index": 0,
            "t_send_mono_ns": t_send, "t_recv_mono_ns": t_send + int(rtt_ms * 1e6) if responded else None}


def ping_sample(seq, t_send, rtt_ms=1.0, responded=True):
    return {"seq": seq, "kind": "ping", "t_send_mono_ns": t_send,
            "t_recv_mono_ns": t_send + int(rtt_ms * 1e6) if responded else None,
            "rtt_ms": rtt_ms if responded else None, "responded": responded, "missed_budget": False}


class TestSynchronize(unittest.TestCase):
    def test_bucket_count_and_means(self):
        # two 500ms buckets: [0, 500ms) and [500ms, 1000ms]
        hop_samples = [
            hop_sample(0, 1, 0, rtt_ms=10.0),
            hop_sample(0, 1, 100_000_000, rtt_ms=20.0),
            hop_sample(1, 1, 600_000_000, rtt_ms=100.0),
        ]
        app_samples = [ping_sample(0, 0, rtt_ms=1.0), ping_sample(1, 550_000_000, rtt_ms=50.0)]
        buckets = build_synchronized_timeline(hop_samples, app_samples)
        self.assertEqual(len(buckets), 2)
        self.assertAlmostEqual(buckets[0].hop_rtt_ms[1], 15.0)  # mean(10,20)
        self.assertAlmostEqual(buckets[1].hop_rtt_ms[1], 100.0)
        self.assertAlmostEqual(buckets[0].app_ping_rtt_ms, 1.0)
        self.assertAlmostEqual(buckets[1].app_ping_rtt_ms, 50.0)

    def test_unknown_hop_never_interpolated(self):
        hop_samples = [
            hop_sample(0, 2, 0, responded=False),
            hop_sample(0, 2, 50_000_000, responded=False),
        ]
        buckets = build_synchronized_timeline(hop_samples, [ping_sample(0, 0)])
        self.assertIsNone(buckets[0].hop_rtt_ms[2])
        self.assertTrue(buckets[0].hop_unknown(2))

    def test_hop_never_probed_is_not_marked_unknown(self):
        # a hop with zero total probes in a bucket is "no data", distinct
        # from "probed but no response" -- hop_unknown() must not conflate them
        buckets = build_synchronized_timeline([hop_sample(0, 1, 0)], [ping_sample(0, 0)])
        self.assertFalse(buckets[0].hop_unknown(3))  # ttl 3 never appears in hop_samples

    def test_app_unknown(self):
        buckets = build_synchronized_timeline(
            [hop_sample(0, 1, 0)],
            [ping_sample(0, 0, responded=False), ping_sample(1, 10_000_000, responded=False)],
        )
        self.assertTrue(buckets[0].app_unknown())
        self.assertIsNone(buckets[0].app_ping_rtt_ms)

    def test_all_expected_hops_present_in_every_bucket(self):
        buckets = build_synchronized_timeline([hop_sample(0, 1, 0)], [ping_sample(0, 0)])
        for ttl in EXPECTED_HOPS:
            self.assertIn(ttl, buckets[0].hop_rtt_ms)


if __name__ == "__main__":
    unittest.main()
