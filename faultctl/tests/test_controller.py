"""Pure unit tests for controller.py's authorization/validation logic.
Network calls (_run_tc, _interface_exists) are mocked -- these tests
check the controller's OWN validation, not the OS-level sudoers
enforcement (which is exercised by the live verification pass, since
it requires the real hoptrace-truth identity). No root required."""
import os
import sys
import tempfile
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import controller
import groundtruth as gt


class TestControllerValidation(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.mkdtemp()
        self.db_path = os.path.join(self.tmpdir, "gt.db")
        self._patch_db = mock.patch.object(gt, "DB_PATH", self.db_path)
        self._patch_db.start()

    def tearDown(self):
        self._patch_db.stop()

    def test_unauthorized_hop_rejected_before_any_subprocess_call(self):
        with mock.patch("controller.subprocess.run") as run:
            with self.assertRaises(ValueError):
                controller.inject(hop=99, fault_type="latency", trial_id="t1", delay_ms=100)
            run.assert_not_called()

    def test_hop_5_is_the_server_not_a_router_and_is_rejected(self):
        # only the 4 router hops are authorized injection targets -- hop 5 is the server
        with self.assertRaises(ValueError):
            controller.inject(hop=5, fault_type="latency", trial_id="t1", delay_ms=100)

    def test_latency_requires_delay_ms(self):
        with mock.patch.object(controller, "_interface_exists", return_value=True):
            with self.assertRaises(ValueError):
                controller.inject(hop=1, fault_type="latency", trial_id="t1")

    def test_jitter_requires_both_delay_and_jitter(self):
        with mock.patch.object(controller, "_interface_exists", return_value=True):
            with self.assertRaises(ValueError):
                controller.inject(hop=1, fault_type="jitter", trial_id="t1", delay_ms=50)

    def test_loss_requires_loss_pct(self):
        with mock.patch.object(controller, "_interface_exists", return_value=True):
            with self.assertRaises(ValueError):
                controller.inject(hop=1, fault_type="loss", trial_id="t1")

    def test_bandwidth_requires_rate_kbit(self):
        with mock.patch.object(controller, "_interface_exists", return_value=True):
            with self.assertRaises(ValueError):
                controller.inject(hop=1, fault_type="bandwidth", trial_id="t1")

    def test_missing_interface_refuses_to_inject(self):
        with mock.patch.object(controller, "_interface_exists", return_value=False):
            with self.assertRaises(RuntimeError):
                controller.inject(hop=1, fault_type="latency", trial_id="t1", delay_ms=100)

    def test_successful_inject_records_ground_truth_with_correct_magnitude(self):
        with mock.patch.object(controller, "_interface_exists", return_value=True), \
             mock.patch.object(controller, "_run_tc", return_value="sudo ip netns exec ns-r2 tc ..."):
            event_id = controller.inject(hop=2, fault_type="jitter", trial_id="t1",
                                          delay_ms=50, jitter_ms=30)
        conn = gt.connect(self.db_path)
        rows = gt.read_for_trial(conn, "t1")
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["event_id"], event_id)
        self.assertEqual(rows[0]["hop_target"], 2)
        self.assertEqual(rows[0]["impairment_type"], "jitter")
        self.assertEqual(rows[0]["magnitude"], {"delay_ms": 50, "jitter_ms": 30})
        self.assertIsNotNone(rows[0]["t_start_mono_ns"])
        self.assertIsNone(rows[0]["t_end_mono_ns"])
        conn.close()

    def test_authorized_targets_match_testbed_topology(self):
        # hops 1-4 map to the four router namespaces' server-facing egress
        # interfaces (spec C8: "the link leaving Hop N", not the router itself)
        self.assertEqual(controller.AUTHORIZED_TARGETS[1], ("ns-r1", "veth-s2-a"))
        self.assertEqual(controller.AUTHORIZED_TARGETS[2], ("ns-r2", "veth-s3-a"))
        self.assertEqual(controller.AUTHORIZED_TARGETS[3], ("ns-r3", "veth-s4-a"))
        self.assertEqual(controller.AUTHORIZED_TARGETS[4], ("ns-r4", "veth-s5-a"))
        self.assertNotIn(5, controller.AUTHORIZED_TARGETS)


if __name__ == "__main__":
    unittest.main()
