"""Pure unit tests for groundtruth.py's schema/serialization logic,
using a temp DB path -- NOT /var/lib/hoptrace (that requires the real
identity setup and is exercised by the live verification pass instead).
No root required."""
import os
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import groundtruth as gt


class TestGroundTruth(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmpdir, "test_groundtruth.db")

    def test_connect_creates_schema_and_sets_640(self):
        conn = gt.connect(self.db_path)
        self.assertTrue(os.path.exists(self.db_path))
        mode = os.stat(self.db_path).st_mode & 0o777
        self.assertEqual(mode, 0o640)
        conn.close()

    def test_insert_and_read_round_trip(self):
        conn = gt.connect(self.db_path)
        gt.insert_event(conn, {
            "event_id": "e1", "trial_id": "t1", "hop_target": 3,
            "impairment_type": "latency", "magnitude": {"delay_ms": 100.0},
            "t_start_mono_ns": 1000, "t_end_mono_ns": None,
            "tc_command": "sudo ip netns exec ns-r3 tc qdisc add ...",
        })
        rows = gt.read_all(conn)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["event_id"], "e1")
        self.assertEqual(rows[0]["hop_target"], 3)
        self.assertEqual(rows[0]["magnitude"], {"delay_ms": 100.0})
        self.assertIsNone(rows[0]["t_end_mono_ns"])
        conn.close()

    def test_set_end_time(self):
        conn = gt.connect(self.db_path)
        gt.insert_event(conn, {
            "event_id": "e2", "trial_id": "t1", "hop_target": 1,
            "impairment_type": "loss", "magnitude": {"loss_pct": 20.0},
            "t_start_mono_ns": 500, "t_end_mono_ns": None, "tc_command": "...",
        })
        gt.set_end_time(conn, "e2", 9999)
        rows = gt.read_for_trial(conn, "t1")
        self.assertEqual(rows[0]["t_end_mono_ns"], 9999)
        conn.close()

    def test_find_open_event_ignores_closed_events(self):
        conn = gt.connect(self.db_path)
        gt.insert_event(conn, {"event_id": "closed1", "trial_id": "t1", "hop_target": 3,
                                "impairment_type": "latency", "magnitude": {}, "t_start_mono_ns": 1,
                                "t_end_mono_ns": 100, "tc_command": "x"})
        gt.insert_event(conn, {"event_id": "open1", "trial_id": "t1", "hop_target": 3,
                                "impairment_type": "loss", "magnitude": {}, "t_start_mono_ns": 200,
                                "t_end_mono_ns": None, "tc_command": "y"})
        found = gt.find_open_event(conn, "t1", 3)
        self.assertEqual(found["event_id"], "open1")
        conn.close()

    def test_find_open_event_returns_none_when_nothing_open(self):
        conn = gt.connect(self.db_path)
        found = gt.find_open_event(conn, "nonexistent-trial", 1)
        self.assertIsNone(found)
        conn.close()

    def test_read_for_trial_filters_correctly(self):
        conn = gt.connect(self.db_path)
        gt.insert_event(conn, {"event_id": "a", "trial_id": "trial-A", "hop_target": 1,
                                "impairment_type": "latency", "magnitude": {}, "t_start_mono_ns": 1,
                                "t_end_mono_ns": None, "tc_command": "x"})
        gt.insert_event(conn, {"event_id": "b", "trial_id": "trial-B", "hop_target": 2,
                                "impairment_type": "loss", "magnitude": {}, "t_start_mono_ns": 2,
                                "t_end_mono_ns": None, "tc_command": "y"})
        rows = gt.read_for_trial(conn, "trial-A")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["event_id"], "a")
        conn.close()


if __name__ == "__main__":
    unittest.main()
