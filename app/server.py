#!/usr/bin/env python3
"""HOPTRACE Phase 2 — controlled application server.

Echoes a ping's seq immediately; replies interaction_ack immediately.
The server never uses its own clock for RTT — RTT is computed entirely
client-side (spec §05/§09's single-clock design), so the server doesn't
need CLOCK_MONOTONIC at all, only reflects sequence numbers back.
"""
from __future__ import annotations

import argparse
import asyncio
import json

import ws_protocol as ws


async def handle_client(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
    peer = writer.get_extra_info("peername")
    print(f"client connected: {peer}", flush=True)
    try:
        await ws.server_handshake(reader, writer)
        while True:
            try:
                opcode, payload = await ws.read_frame(reader)
            except asyncio.IncompleteReadError:
                break
            if opcode == ws.OPCODE_CLOSE:
                await ws.send_close(writer, masked=False)
                break
            if opcode != ws.OPCODE_TEXT:
                continue
            msg = json.loads(payload.decode("utf-8"))
            mtype = msg.get("type")
            seq = msg.get("seq")
            if mtype == "ping":
                await ws.send_text(writer, json.dumps({"type": "ping_ack", "seq": seq}), masked=False)
            elif mtype == "interaction":
                await ws.send_text(writer, json.dumps({"type": "interaction_ack", "seq": seq}), masked=False)
    except (ConnectionResetError, asyncio.IncompleteReadError):
        pass
    finally:
        print(f"client disconnected: {peer}", flush=True)
        writer.close()


async def main():
    ap = argparse.ArgumentParser(description="HOPTRACE Phase 2 application server")
    ap.add_argument("--host", default="0.0.0.0")
    ap.add_argument("--port", type=int, default=8765)
    args = ap.parse_args()
    server = await asyncio.start_server(handle_client, args.host, args.port)
    addr = server.sockets[0].getsockname()
    print(f"listening on {addr}", flush=True)
    async with server:
        await server.serve_forever()


if __name__ == "__main__":
    asyncio.run(main())
