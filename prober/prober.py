#!/usr/bin/env python3
"""HOPTRACE Phase 1 — path measurement engine.

Implements run_probe_round(round_id, transport) exactly as specified in
hoptrace-phase-0-5-spec.html §07. This module ONLY measures and records
HopSample rows — it contains no changepoint detection, no thresholds, no
notion of "degraded" or "faulty". That judgment is explicitly out of
scope until Phase 4's algorithm-selection experiment (spec §08); hard-
coding an assumption about it here would violate C3.

Must be run as root (raw sockets) inside the ns-client namespace, e.g.:
  ip netns exec ns-client python3 prober.py --transport udp --rounds 200
"""
from __future__ import annotations

import argparse
import json
import socket
import sys
import time
from typing import List

from hopsample import HopSample
from raw_probe import probe_udp, probe_tcp_syn

TTL_RANGE = range(1, 6)   # 1..5, matches spec §03's five measurable hops
SAMPLES_PER_HOP = 2       # locked, spec §05
ROUND_INTERVAL_S = 0.5    # locked, spec §05
PROBE_TIMEOUT_S = 0.3     # locked, spec §05
UDP_BASE_DEST_PORT = 33434
UDP_SRC_PORT = 44000
TCP_DEST_PORT = 80
TCP_BASE_SRC_PORT = 45000


def run_probe_round(round_id: int, transport: str, dst_ip: str, src_ip: str,
                     icmp_sock, tcp_sock=None) -> List[HopSample]:
    """One probing round: TTL 1..5, SAMPLES_PER_HOP probes each, sequential.

    Sequential (not concurrent) by design: the locked spec requires one
    fixed 5-tuple per round for ECMP-hash consistency, which rules out
    varying the source/dest port to disambiguate concurrent in-flight
    probes. Sequential sending needs no disambiguation at all — at most
    one probe is outstanding at a time — at the cost of a round taking
    longer than 500ms when hops are slow or silent. In the unimpaired
    testbed this measured well under budget (see Phase 1 report).
    """
    samples: List[HopSample] = []

    if transport == "udp":
        dest_port = UDP_BASE_DEST_PORT + round_id
        src_port = UDP_SRC_PORT
    elif transport == "tcp_syn":
        dest_port = TCP_DEST_PORT
        src_port = TCP_BASE_SRC_PORT + round_id
    else:
        raise ValueError(f"unknown transport: {transport!r} (must be 'udp' or 'tcp_syn')")

    seq_counter = round_id * 1000
    for ttl in TTL_RANGE:
        for probe_index in range(SAMPLES_PER_HOP):
            t_send_ns = time.clock_gettime_ns(time.CLOCK_MONOTONIC)
            if transport == "udp":
                hop_ip, rtt_ms, t_recv_ns = probe_udp(
                    icmp_sock, dst_ip, dest_port, src_port, ttl, PROBE_TIMEOUT_S)
            else:
                seq_counter += 1
                hop_ip, rtt_ms, t_recv_ns = probe_tcp_syn(
                    icmp_sock, tcp_sock, src_ip, dst_ip, dest_port, src_port,
                    ttl, PROBE_TIMEOUT_S, seq_counter)

            samples.append(HopSample(
                round_id=round_id,
                ttl=ttl,
                hop_ip=hop_ip,
                rtt_ms=rtt_ms,
                responded=(hop_ip is not None),
                probe_index=probe_index,
                t_send_mono_ns=t_send_ns,
                t_recv_mono_ns=t_recv_ns,
            ))
    return samples


def open_sockets(transport: str):
    icmp_sock = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_ICMP)
    tcp_sock = None
    if transport == "tcp_syn":
        tcp_sock = socket.socket(socket.AF_INET, socket.SOCK_RAW, socket.IPPROTO_TCP)
        tcp_sock.setsockopt(socket.IPPROTO_IP, socket.IP_HDRINCL, 1)
    return icmp_sock, tcp_sock


def main():
    ap = argparse.ArgumentParser(description="HOPTRACE Phase 1 path prober")
    ap.add_argument("--dst", default="10.10.5.2", help="server IP (spec §03)")
    ap.add_argument("--src", default="10.10.1.1", help="client IP (spec §03), used for TCP SYN header")
    ap.add_argument("--transport", choices=["udp", "tcp_syn"], required=True)
    ap.add_argument("--rounds", type=int, default=10)
    ap.add_argument("--interval", type=float, default=ROUND_INTERVAL_S)
    ap.add_argument("--out", default=None, help="JSONL output path; defaults to stdout")
    args = ap.parse_args()

    icmp_sock, tcp_sock = open_sockets(args.transport)
    out = open(args.out, "w") if args.out else sys.stdout

    try:
        for round_id in range(args.rounds):
            round_start = time.monotonic()
            samples = run_probe_round(round_id, args.transport, args.dst, args.src,
                                       icmp_sock, tcp_sock)
            for s in samples:
                out.write(s.to_json() + "\n")
            out.flush()
            elapsed = time.monotonic() - round_start
            sleep_for = args.interval - elapsed
            if sleep_for > 0:
                time.sleep(sleep_for)
    finally:
        icmp_sock.close()
        if tcp_sock:
            tcp_sock.close()
        if args.out:
            out.close()


if __name__ == "__main__":
    main()
