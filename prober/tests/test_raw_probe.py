"""Pure unit tests for packet checksums / ICMP parsing — no network, no root."""
import sys
import os
import socket
import struct
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from raw_probe import checksum, _parse_icmp_error, _build_tcp_syn_packet


class TestChecksum(unittest.TestCase):
    def test_known_vector(self):
        # RFC 1071 worked example: 0x0001 0xf203 0xf4f5 0xf6f7 -> checksum 0x220d
        data = bytes.fromhex("0001f203f4f5f6f7")
        self.assertEqual(checksum(data), 0x220D)

    def test_self_verification(self):
        # a packet with its checksum field correctly filled in must checksum to 0
        payload = b"hoptrace phase1 test payload"
        cksum = checksum(payload)
        with_checksum = struct.pack("!H", cksum) + payload
        self.assertEqual(checksum(with_checksum), 0)


class TestBuildTcpSyn(unittest.TestCase):
    def test_structure_and_self_checksum(self):
        pkt = _build_tcp_syn_packet("10.10.1.1", "10.10.5.2", 45001, 80, seq=1234, ttl=3)
        self.assertEqual(len(pkt), 40)  # 20 IP + 20 TCP, no options/payload

        ip_ver_ihl = pkt[0]
        self.assertEqual(ip_ver_ihl >> 4, 4)      # IPv4
        self.assertEqual(ip_ver_ihl & 0x0F, 5)    # 5 words = 20 bytes, no options
        ttl = pkt[8]
        self.assertEqual(ttl, 3)
        proto = pkt[9]
        self.assertEqual(proto, socket.IPPROTO_TCP)
        src_ip = socket.inet_ntoa(pkt[12:16])
        dst_ip = socket.inet_ntoa(pkt[16:20])
        self.assertEqual(src_ip, "10.10.1.1")
        self.assertEqual(dst_ip, "10.10.5.2")

        # IP header checksum must self-verify (checksum over the 20 IP bytes == 0)
        self.assertEqual(checksum(pkt[0:20]), 0)

        tcp_header = pkt[20:40]
        src_port, dst_port = struct.unpack("!HH", tcp_header[0:4])
        self.assertEqual(src_port, 45001)
        self.assertEqual(dst_port, 80)
        flags = tcp_header[13]
        self.assertEqual(flags, 0x02)  # SYN only

        # TCP checksum must self-verify against the pseudo-header
        pseudo = struct.pack("!4s4sBBH", socket.inet_aton("10.10.1.1"),
                              socket.inet_aton("10.10.5.2"), 0,
                              socket.IPPROTO_TCP, len(tcp_header))
        self.assertEqual(checksum(pseudo + tcp_header), 0)


class TestParseIcmpError(unittest.TestCase):
    def _build_fake_time_exceeded(self, orig_dst_ip, orig_src_port, orig_dst_port,
                                   inner_proto=socket.IPPROTO_UDP):
        # outer IP header (20B, values don't matter for parsing except IHL)
        outer_ip = bytes([0x45]) + bytes(19)
        # ICMP header: type=11 (time exceeded), code=0, checksum=0, unused=0
        icmp_hdr = struct.pack("!BBHI", 11, 0, 0, 0)
        # embedded original IP header (20B): set protocol + dst ip
        inner_ip = bytearray(20)
        inner_ip[0] = 0x45
        inner_ip[9] = inner_proto
        inner_ip[16:20] = socket.inet_aton(orig_dst_ip)
        # embedded original L4 header: src_port, dst_port (first 4 bytes suffice)
        inner_l4 = struct.pack("!HH", orig_src_port, orig_dst_port) + b"\x00\x00\x00\x00"
        return outer_ip + icmp_hdr + bytes(inner_ip) + inner_l4

    def test_matches_expected_probe(self):
        raw = self._build_fake_time_exceeded("10.10.5.2", 44000, 33434)
        info = _parse_icmp_error(raw)
        self.assertIsNotNone(info)
        self.assertEqual(info["icmp_type"], 11)
        self.assertEqual(info["inner_proto"], socket.IPPROTO_UDP)
        self.assertEqual(info["inner_dst_ip"], "10.10.5.2")
        self.assertEqual(info["inner_src_port"], 44000)
        self.assertEqual(info["inner_dst_port"], 33434)

    def test_rejects_non_icmp_error_type(self):
        # type=8 (echo request) must not be treated as a traceroute response
        outer_ip = bytes([0x45]) + bytes(19)
        icmp_hdr = struct.pack("!BBHI", 8, 0, 0, 0)
        raw = outer_ip + icmp_hdr + bytes(28)
        self.assertIsNone(_parse_icmp_error(raw))

    def test_rejects_truncated_packet(self):
        self.assertIsNone(_parse_icmp_error(b"\x45" + bytes(10)))


if __name__ == "__main__":
    unittest.main()
