"""Raw-socket probe primitives: UDP and TCP-SYN, both TTL-limited.

Both transports live behind the same two functions so run_probe_round()
in prober.py can swap between them via a string, per spec §05/§07 —
"the choice is a configuration value, not a rewrite."

Requires CAP_NET_RAW (root). No external packages — stdlib only
(socket, struct, os, time), matching the "no unnecessary dependencies"
constraint from Phase 0 into Phase 1.
"""
from __future__ import annotations

import os
import socket
import struct
import time

ICMP_TIME_EXCEEDED = 11
ICMP_DEST_UNREACH = 3
IPPROTO_ICMP = socket.IPPROTO_ICMP


def checksum(data: bytes) -> int:
    """Standard Internet checksum (RFC 1071), used for the hand-built
    IP and TCP headers in the TCP-SYN transport. UDP uses a normal
    SOCK_DGRAM socket and lets the kernel compute its checksum."""
    if len(data) % 2:
        data += b"\x00"
    total = sum(struct.unpack("!%dH" % (len(data) // 2), data))
    total = (total >> 16) + (total & 0xFFFF)
    total += total >> 16
    return (~total) & 0xFFFF


def _parse_icmp_error(raw: bytes):
    """Parse an inbound raw ICMP packet. Returns a dict describing the
    ORIGINAL (embedded) packet this ICMP message refers to, or None if
    this isn't a Time-Exceeded / Destination-Unreachable error, or the
    packet is too short to contain a full embedded header.
    Handles both an embedded UDP and an embedded TCP original packet."""
    if len(raw) < 20 + 8:
        return None
    outer_ihl = (raw[0] & 0x0F) * 4
    icmp_start = outer_ihl
    if len(raw) < icmp_start + 8:
        return None
    icmp_type, icmp_code = raw[icmp_start], raw[icmp_start + 1]
    if icmp_type not in (ICMP_TIME_EXCEEDED, ICMP_DEST_UNREACH):
        return None

    inner_ip_start = icmp_start + 8
    if len(raw) < inner_ip_start + 20:
        return None
    inner_ihl = (raw[inner_ip_start] & 0x0F) * 4
    inner_proto = raw[inner_ip_start + 9]
    inner_dst_ip = socket.inet_ntoa(raw[inner_ip_start + 16:inner_ip_start + 20])

    l4_start = inner_ip_start + inner_ihl
    if len(raw) < l4_start + 4:
        return None
    inner_src_port, inner_dst_port = struct.unpack("!HH", raw[l4_start:l4_start + 4])

    return {
        "icmp_type": icmp_type,
        "icmp_code": icmp_code,
        "inner_proto": inner_proto,
        "inner_dst_ip": inner_dst_ip,
        "inner_src_port": inner_src_port,
        "inner_dst_port": inner_dst_port,
    }


def probe_udp(icmp_sock, dst_ip: str, dest_port: int, src_port: int, ttl: int,
              timeout_s: float):
    """Send one UDP probe with the given TTL; wait up to timeout_s for
    either an ICMP Time-Exceeded (intermediate hop) or an ICMP
    Destination-Unreachable/port-unreachable (final hop, since nothing
    listens on dest_port). Returns (hop_ip, rtt_ms, t_recv_mono_ns) or
    (None, None, None) on timeout."""
    t_send_ns = time.clock_gettime_ns(time.CLOCK_MONOTONIC)
    udp_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    try:
        udp_sock.setsockopt(socket.IPPROTO_IP, socket.IP_TTL, ttl)
        udp_sock.bind(("", src_port))
        udp_sock.sendto(b"hoptrace-phase1", (dst_ip, dest_port))

        deadline = time.monotonic() + timeout_s
        while True:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                return None, None, None
            icmp_sock.settimeout(remaining)
            try:
                raw, addr = icmp_sock.recvfrom(1024)
            except socket.timeout:
                return None, None, None
            t_recv_ns = time.clock_gettime_ns(time.CLOCK_MONOTONIC)
            info = _parse_icmp_error(raw)
            if (info and info["inner_proto"] == socket.IPPROTO_UDP
                    and info["inner_dst_ip"] == dst_ip
                    and info["inner_src_port"] == src_port
                    and info["inner_dst_port"] == dest_port):
                rtt_ms = (t_recv_ns - t_send_ns) / 1e6
                return addr[0], rtt_ms, t_recv_ns
            # unrelated ICMP traffic (e.g. a stray/late reply) — keep waiting
    finally:
        udp_sock.close()


def _build_tcp_syn_packet(src_ip: str, dst_ip: str, src_port: int, dst_port: int,
                           seq: int, ttl: int) -> bytes:
    ip_ver_ihl = (4 << 4) | 5
    ip_tos = 0
    ip_total_len = 20 + 20  # IP header + TCP header, no options, no payload
    ip_id = (os.getpid() ^ seq) & 0xFFFF
    ip_flags_frag = 0
    ip_proto = socket.IPPROTO_TCP
    ip_checksum = 0
    ip_src = socket.inet_aton(src_ip)
    ip_dst = socket.inet_aton(dst_ip)
    ip_header = struct.pack(
        "!BBHHHBBH4s4s",
        ip_ver_ihl, ip_tos, ip_total_len, ip_id, ip_flags_frag,
        ttl, ip_proto, ip_checksum, ip_src, ip_dst,
    )
    ip_checksum = checksum(ip_header)
    ip_header = struct.pack(
        "!BBHHHBBH4s4s",
        ip_ver_ihl, ip_tos, ip_total_len, ip_id, ip_flags_frag,
        ttl, ip_proto, ip_checksum, ip_src, ip_dst,
    )

    tcp_ack = 0
    tcp_offset_res = (5 << 4)
    tcp_flags = 0x02  # SYN
    tcp_window = 64240
    tcp_checksum = 0
    tcp_urg_ptr = 0
    tcp_header = struct.pack(
        "!HHLLBBHHH",
        src_port, dst_port, seq, tcp_ack, tcp_offset_res, tcp_flags,
        tcp_window, tcp_checksum, tcp_urg_ptr,
    )
    pseudo_header = struct.pack("!4s4sBBH", ip_src, ip_dst, 0, socket.IPPROTO_TCP, len(tcp_header))
    tcp_checksum = checksum(pseudo_header + tcp_header)
    tcp_header = struct.pack(
        "!HHLLBBHHH",
        src_port, dst_port, seq, tcp_ack, tcp_offset_res, tcp_flags,
        tcp_window, tcp_checksum, tcp_urg_ptr,
    )
    return ip_header + tcp_header


def probe_tcp_syn(icmp_sock, tcp_sock, src_ip: str, dst_ip: str, dest_port: int,
                   src_port: int, ttl: int, timeout_s: float, seq: int):
    """Send one hand-built TCP SYN with the given TTL via a raw IP_HDRINCL
    socket. An intermediate hop answers with ICMP Time-Exceeded (seen on
    icmp_sock); the final hop answers directly with a TCP RST or SYN-ACK
    (seen on tcp_sock, since nothing listens on dest_port). Returns
    (hop_ip, rtt_ms, t_recv_mono_ns) or (None, None, None) on timeout."""
    packet = _build_tcp_syn_packet(src_ip, dst_ip, src_port, dest_port, seq, ttl)
    t_send_ns = time.clock_gettime_ns(time.CLOCK_MONOTONIC)
    tcp_sock.sendto(packet, (dst_ip, 0))

    deadline = time.monotonic() + timeout_s
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return None, None, None
        import select
        readable, _, _ = select.select([icmp_sock, tcp_sock], [], [], remaining)
        if not readable:
            return None, None, None
        for s in readable:
            raw, addr = s.recvfrom(1024)
            t_recv_ns = time.clock_gettime_ns(time.CLOCK_MONOTONIC)
            if s is icmp_sock:
                info = _parse_icmp_error(raw)
                if (info and info["inner_proto"] == socket.IPPROTO_TCP
                        and info["inner_dst_ip"] == dst_ip
                        and info["inner_src_port"] == src_port
                        and info["inner_dst_port"] == dest_port):
                    rtt_ms = (t_recv_ns - t_send_ns) / 1e6
                    return addr[0], rtt_ms, t_recv_ns
            else:  # s is tcp_sock: a direct TCP reply (SYN-ACK or RST) from the far end
                if addr[0] != dst_ip:
                    continue
                ihl = (raw[0] & 0x0F) * 4
                if len(raw) < ihl + 20:
                    continue
                resp_src_port, resp_dst_port = struct.unpack("!HH", raw[ihl:ihl + 4])
                flags = raw[ihl + 13]
                is_rst_or_synack = bool(flags & 0x04) or (flags & 0x12) == 0x12
                if resp_src_port == dest_port and resp_dst_port == src_port and is_rst_or_synack:
                    rtt_ms = (t_recv_ns - t_send_ns) / 1e6
                    return addr[0], rtt_ms, t_recv_ns
            # anything else: unrelated traffic, keep waiting until deadline
