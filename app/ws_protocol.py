"""Minimal RFC 6455 WebSocket handshake + framing — client and server
sides, text frames only, no fragmentation, no compression extensions.

Hand-rolled (stdlib only: asyncio, base64, hashlib, struct, os) to keep
exact control over the wire path for RTT measurement and to stay
consistent with Phase 0/1's no-unnecessary-dependencies approach —
Phase 1's raw-socket prober was considerably more low-level than this.
"""
from __future__ import annotations

import asyncio
import base64
import hashlib
import os
import struct

WS_MAGIC = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"
OPCODE_TEXT = 0x1
OPCODE_CLOSE = 0x8


def compute_accept_key(client_key: str) -> str:
    sha1 = hashlib.sha1((client_key + WS_MAGIC).encode("ascii")).digest()
    return base64.b64encode(sha1).decode("ascii")


def make_client_key() -> str:
    return base64.b64encode(os.urandom(16)).decode("ascii")


def build_handshake_request(host: str, port: int, path: str, key: str) -> bytes:
    return (
        f"GET {path} HTTP/1.1\r\n"
        f"Host: {host}:{port}\r\n"
        f"Upgrade: websocket\r\n"
        f"Connection: Upgrade\r\n"
        f"Sec-WebSocket-Key: {key}\r\n"
        f"Sec-WebSocket-Version: 13\r\n"
        f"\r\n"
    ).encode("ascii")


def build_handshake_response(accept_key: str) -> bytes:
    return (
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        f"Sec-WebSocket-Accept: {accept_key}\r\n"
        "\r\n"
    ).encode("ascii")


async def read_http_headers(reader: asyncio.StreamReader) -> dict:
    headers = {}
    while True:
        line = await reader.readline()
        if line in (b"\r\n", b""):
            break
        text = line.decode("ascii", errors="replace").strip()
        if ":" in text:
            k, v = text.split(":", 1)
            headers[k.strip().lower()] = v.strip()
    return headers


async def server_handshake(reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
    request_line = await reader.readline()
    headers = await read_http_headers(reader)
    client_key = headers.get("sec-websocket-key")
    if not client_key:
        raise ValueError(f"missing Sec-WebSocket-Key in request line {request_line!r}, headers {headers}")
    accept = compute_accept_key(client_key)
    writer.write(build_handshake_response(accept))
    await writer.drain()


async def client_handshake(reader: asyncio.StreamReader, writer: asyncio.StreamWriter,
                            host: str, port: int, path: str = "/") -> None:
    key = make_client_key()
    writer.write(build_handshake_request(host, port, path, key))
    await writer.drain()
    status_line = await reader.readline()
    if b"101" not in status_line:
        raise ConnectionError(f"WebSocket handshake failed, status line: {status_line!r}")
    headers = await read_http_headers(reader)
    expected = compute_accept_key(key)
    if headers.get("sec-websocket-accept") != expected:
        raise ConnectionError("Sec-WebSocket-Accept mismatch — possible proxy/middlebox interference")


def encode_frame(payload: bytes, opcode: int = OPCODE_TEXT, masked: bool = False) -> bytes:
    """RFC 6455 §5.2. Client-to-server frames MUST be masked; server-to-
    client frames MUST NOT be masked — callers must pass the right value."""
    header = bytearray()
    header.append(0x80 | opcode)  # FIN=1, no fragmentation
    length = len(payload)
    mask_bit = 0x80 if masked else 0x00
    if length <= 125:
        header.append(mask_bit | length)
    elif length <= 0xFFFF:
        header.append(mask_bit | 126)
        header += struct.pack("!H", length)
    else:
        header.append(mask_bit | 127)
        header += struct.pack("!Q", length)
    if masked:
        mask_key = os.urandom(4)
        header += mask_key
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    return bytes(header) + payload


async def read_frame(reader: asyncio.StreamReader):
    """Returns (opcode, payload_bytes). Raises asyncio.IncompleteReadError
    if the peer closed the connection mid-frame (treated as a clean EOF
    by callers)."""
    b0 = await reader.readexactly(1)
    opcode = b0[0] & 0x0F
    b1 = await reader.readexactly(1)
    masked = bool(b1[0] & 0x80)
    length_code = b1[0] & 0x7F
    if length_code == 126:
        length = struct.unpack("!H", await reader.readexactly(2))[0]
    elif length_code == 127:
        length = struct.unpack("!Q", await reader.readexactly(8))[0]
    else:
        length = length_code
    mask_key = await reader.readexactly(4) if masked else None
    payload = await reader.readexactly(length) if length else b""
    if masked:
        payload = bytes(b ^ mask_key[i % 4] for i, b in enumerate(payload))
    return opcode, payload


async def send_text(writer: asyncio.StreamWriter, text: str, masked: bool) -> None:
    writer.write(encode_frame(text.encode("utf-8"), OPCODE_TEXT, masked))
    await writer.drain()


async def send_close(writer: asyncio.StreamWriter, masked: bool) -> None:
    writer.write(encode_frame(b"", OPCODE_CLOSE, masked))
    await writer.drain()
