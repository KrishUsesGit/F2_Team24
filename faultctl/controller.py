#!/usr/bin/env python3
"""HOPTRACE fault-injection controller — locked spec §04.

Run as OS user hoptrace-truth (see setup_identities.sh). Escalates
ONLY through a narrowly-scoped sudoers NOPASSWD rule limited to
`ip netns exec ns-r{1..4} tc ...` — nothing else, no shell, no other
command. This is the "controller must only manipulate the controlled
namespaces/interfaces it is authorized to manipulate" requirement
enforced at the OS level, not just in this script's own logic (the
AUTHORIZED_TARGETS check below is a second, redundant layer).

No listening socket, no daemon -- every invocation is a one-shot CLI
command (inject or clear). Imports nothing from correlate/ and is
never imported by it (fault injection stays independent of the
localization engine, both ways).
"""
from __future__ import annotations

import argparse
import subprocess
import sys
import time
import uuid

import groundtruth as gt

# hop -> (namespace, interface). Matches testbed/phase0/lib/common.sh's
# veth_a(hop+1) -- the router's SERVER-FACING egress interface, i.e.
# "the link leaving Hop N", not the router itself (semantics preserved
# from impair_hop.sh / spec C8).
AUTHORIZED_TARGETS = {
    1: ("ns-r1", "veth-s2-a"),
    2: ("ns-r2", "veth-s3-a"),
    3: ("ns-r3", "veth-s4-a"),
    4: ("ns-r4", "veth-s5-a"),
}


def now_ns() -> int:
    return time.clock_gettime_ns(time.CLOCK_MONOTONIC)


def _run_tc(namespace: str, tc_args: list) -> str:
    cmd = ["sudo", "/usr/sbin/ip", "netns", "exec", namespace, "/usr/sbin/tc"] + tc_args
    subprocess.run(cmd, check=True, capture_output=True, text=True)
    return " ".join(cmd)


def _interface_exists(namespace: str, iface: str) -> bool:
    # Uses `tc qdisc show dev <iface>` rather than `ip link show` so the
    # check stays within the sudoers rule's authorized command (tc only)
    # instead of requiring a second, broader grant just for a pre-check.
    cmd = ["sudo", "/usr/sbin/ip", "netns", "exec", namespace, "/usr/sbin/tc", "qdisc", "show", "dev", iface]
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode == 0 and "Cannot find device" not in result.stderr


def inject(hop: int, fault_type: str, trial_id: str, delay_ms=None, jitter_ms=None,
           loss_pct=None, rate_kbit=None) -> str:
    if hop not in AUTHORIZED_TARGETS:
        raise ValueError(f"hop {hop} is not an authorized fault-injection target "
                          f"(only {sorted(AUTHORIZED_TARGETS)})")
    namespace, iface = AUTHORIZED_TARGETS[hop]

    if not _interface_exists(namespace, iface):
        raise RuntimeError(f"interface {iface} does not exist in {namespace} -- "
                            f"is the topology up? refusing to inject.")

    if fault_type == "latency":
        if delay_ms is None:
            raise ValueError("latency requires --delay-ms")
        magnitude = {"delay_ms": delay_ms}
        tc_args = ["qdisc", "add", "dev", iface, "root", "netem", "delay", f"{delay_ms}ms"]
    elif fault_type == "jitter":
        if delay_ms is None or jitter_ms is None:
            raise ValueError("jitter requires --delay-ms and --jitter-ms")
        magnitude = {"delay_ms": delay_ms, "jitter_ms": jitter_ms}
        tc_args = ["qdisc", "add", "dev", iface, "root", "netem",
                   "delay", f"{delay_ms}ms", f"{jitter_ms}ms"]
    elif fault_type == "loss":
        if loss_pct is None:
            raise ValueError("loss requires --loss-pct")
        magnitude = {"loss_pct": loss_pct}
        tc_args = ["qdisc", "add", "dev", iface, "root", "netem", "loss", f"{loss_pct}%"]
    elif fault_type == "bandwidth":
        if rate_kbit is None:
            raise ValueError("bandwidth requires --rate-kbit")
        # burst/latency are fixed, disclosed defaults -- not tuned per trial
        magnitude = {"rate_kbit": rate_kbit, "burst_kbit": 32, "tbf_latency_ms": 400}
        tc_args = ["qdisc", "add", "dev", iface, "root", "tbf", "rate", f"{rate_kbit}kbit",
                   "burst", "32kbit", "latency", "400ms"]
    else:
        raise ValueError(f"unknown fault_type {fault_type!r}")

    t_start = now_ns()
    tc_command = _run_tc(namespace, tc_args)

    event_id = str(uuid.uuid4())
    conn = gt.connect()
    gt.insert_event(conn, {
        "event_id": event_id, "trial_id": trial_id, "hop_target": hop,
        "impairment_type": fault_type, "magnitude": magnitude,
        "t_start_mono_ns": t_start, "t_end_mono_ns": None, "tc_command": tc_command,
    })
    print(event_id)
    return event_id


def clear(hop: int, event_id: str) -> None:
    if hop not in AUTHORIZED_TARGETS:
        raise ValueError(f"hop {hop} is not an authorized fault-injection target")
    namespace, iface = AUTHORIZED_TARGETS[hop]
    _run_tc(namespace, ["qdisc", "del", "dev", iface, "root"])
    t_end = now_ns()
    conn = gt.connect()
    gt.set_end_time(conn, event_id, t_end)


def clear_latest(hop: int, trial_id: str) -> str:
    """Looks up the open event for (trial_id, hop) itself, instead of
    requiring the caller to round-trip the event_id printed by inject()
    through the shell -- simpler and more robust for scripted trials."""
    conn = gt.connect()
    event = gt.find_open_event(conn, trial_id, hop)
    if event is None:
        raise RuntimeError(f"no open ground-truth event for trial_id={trial_id!r} hop={hop}")
    clear(hop, event["event_id"])
    return event["event_id"]


def main():
    ap = argparse.ArgumentParser(description="HOPTRACE fault-injection controller (spec §04)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    inj = sub.add_parser("inject")
    inj.add_argument("--hop", type=int, required=True)
    inj.add_argument("--type", required=True, choices=["latency", "jitter", "loss", "bandwidth"])
    inj.add_argument("--trial-id", required=True)
    inj.add_argument("--delay-ms", type=float, default=None)
    inj.add_argument("--jitter-ms", type=float, default=None)
    inj.add_argument("--loss-pct", type=float, default=None)
    inj.add_argument("--rate-kbit", type=float, default=None)

    clr = sub.add_parser("clear")
    clr.add_argument("--hop", type=int, required=True)
    clr.add_argument("--event-id", required=True)

    clrl = sub.add_parser("clear-latest")
    clrl.add_argument("--hop", type=int, required=True)
    clrl.add_argument("--trial-id", required=True)

    args = ap.parse_args()
    try:
        if args.cmd == "inject":
            inject(args.hop, args.type, args.trial_id, args.delay_ms, args.jitter_ms,
                   args.loss_pct, args.rate_kbit)
        elif args.cmd == "clear":
            clear(args.hop, args.event_id)
        elif args.cmd == "clear-latest":
            print(clear_latest(args.hop, args.trial_id))
    except (ValueError, RuntimeError) as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
