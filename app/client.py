#!/usr/bin/env python3
"""HOPTRACE Phase 2 — controlled application client.

Sends a 20Hz ping stream and a Poisson-mean-2/sec interaction stream
over one persistent WebSocket/TCP connection. RTT is measured entirely
client-side against CLOCK_MONOTONIC — the same clock and the same call
(time.clock_gettime_ns(time.CLOCK_MONOTONIC)) the Phase 1 prober uses,
since both are meant to run co-located in ns-client (spec C1), which is
what makes their timestamps directly comparable for Phase 3 correlation.

Detects three distinct, non-collapsible states, per spec §05/§06 (as
amended by the responded/missed_budget clarification approved before
Phase 3):
  - within budget: responded=True, rtt_ms is real, missed_budget=False
  - late: responded=True, rtt_ms is real, missed_budget=True
    (interaction only, rtt_ms > 150)
  - missing: responded=False, rtt_ms=null, t_recv_mono_ns=null, and
    missed_budget is null for interaction (never confused with a
    measured rtt_ms > 150) or False for ping (no budget concept)

No changepoint detection, no confidence scoring, no localization —
out of scope until Phase 4 (C3). This module only measures and records.
"""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import time

import ws_protocol as ws
from apprttsample import AppRttSample

PING_INTERVAL_S = 0.05          # 20 Hz — locked, spec §05
INTERACTION_MEAN_RATE = 2.0     # events/sec — locked, spec §05
INTERACTION_BUDGET_MS = 150.0   # locked, spec §05 / §06
MISSING_TIMEOUT_S = 2.0         # NOT spec-locked — documented choice, see Phase 2 report


def now_ns() -> int:
    return time.clock_gettime_ns(time.CLOCK_MONOTONIC)


class AppClient:
    def __init__(self, out_path: str):
        self.pending: dict[tuple[str, int], int] = {}  # (kind, seq) -> t_send_mono_ns
        self.ping_seq = 0
        self.interaction_seq = 0
        self.out = open(out_path, "w")
        self.reader = None
        self.writer = None

    def emit(self, sample: AppRttSample):
        self.out.write(sample.to_json() + "\n")
        self.out.flush()

    async def ping_loop(self, duration_s: float):
        deadline = time.monotonic() + duration_s
        next_send = time.monotonic()
        while time.monotonic() < deadline:
            seq = self.ping_seq
            self.ping_seq += 1
            t_send = now_ns()
            self.pending[("ping", seq)] = t_send
            await ws.send_text(self.writer, json.dumps({"type": "ping", "seq": seq}), masked=True)
            next_send += PING_INTERVAL_S
            sleep_for = next_send - time.monotonic()
            if sleep_for > 0:
                await asyncio.sleep(sleep_for)

    async def interaction_loop(self, duration_s: float):
        deadline = time.monotonic() + duration_s
        while True:
            interval = random.expovariate(INTERACTION_MEAN_RATE)
            await asyncio.sleep(interval)
            if time.monotonic() >= deadline:
                break
            seq = self.interaction_seq
            self.interaction_seq += 1
            t_send = now_ns()
            self.pending[("interaction", seq)] = t_send
            await ws.send_text(self.writer, json.dumps({"type": "interaction", "seq": seq}), masked=True)

    async def receive_loop(self):
        while True:
            try:
                opcode, payload = await ws.read_frame(self.reader)
            except asyncio.IncompleteReadError:
                return
            if opcode == ws.OPCODE_CLOSE:
                return
            if opcode != ws.OPCODE_TEXT:
                continue
            t_recv = now_ns()
            msg = json.loads(payload.decode("utf-8"))
            mtype = msg.get("type")
            seq = msg.get("seq")
            if mtype == "ping_ack":
                key = ("ping", seq)
            elif mtype == "interaction_ack":
                key = ("interaction", seq)
            else:
                continue
            t_send = self.pending.pop(key, None)
            if t_send is None:
                continue  # already finalized as missing, or a stray duplicate
            rtt_ms = (t_recv - t_send) / 1e6
            kind = key[0]
            missed_budget = (kind == "interaction" and rtt_ms > INTERACTION_BUDGET_MS)
            self.emit(AppRttSample(seq=seq, kind=kind, t_send_mono_ns=t_send,
                                    t_recv_mono_ns=t_recv, rtt_ms=rtt_ms,
                                    responded=True, missed_budget=missed_budget))

    async def missing_sweep_loop(self):
        while True:
            await asyncio.sleep(0.25)
            now = now_ns()
            timed_out = [k for k, t_send in self.pending.items()
                         if (now - t_send) / 1e9 > MISSING_TIMEOUT_S]
            for key in timed_out:
                t_send = self.pending.pop(key)
                kind, seq = key
                self.emit(self._missing_sample(kind, seq, t_send))

    @staticmethod
    def _missing_sample(kind: str, seq: int, t_send: int) -> AppRttSample:
        """A response that never arrived. Per the Phase 2 schema
        clarification (approved before Phase 3): a missing response is
        NOT represented as a measured rtt_ms > 150 — rtt_ms stays null,
        and missed_budget is null for interaction (distinct from both
        "responded within budget" and "responded late"), or False for
        ping (no budget concept exists for ping at all)."""
        missed_budget = None if kind == "interaction" else False
        return AppRttSample(seq=seq, kind=kind, t_send_mono_ns=t_send,
                             t_recv_mono_ns=None, rtt_ms=None,
                             responded=False, missed_budget=missed_budget)

    async def finalize_pending(self):
        for key, t_send in list(self.pending.items()):
            kind, seq = key
            self.emit(self._missing_sample(kind, seq, t_send))
        self.pending.clear()

    async def run(self, host: str, port: int, duration_s: float):
        self.reader, self.writer = await asyncio.open_connection(host, port)
        await ws.client_handshake(self.reader, self.writer, host, port)
        recv_task = asyncio.create_task(self.receive_loop())
        sweep_task = asyncio.create_task(self.missing_sweep_loop())
        await asyncio.gather(self.ping_loop(duration_s), self.interaction_loop(duration_s))
        await asyncio.sleep(min(MISSING_TIMEOUT_S + 0.5, 2.5))  # let in-flight replies land
        recv_task.cancel()
        sweep_task.cancel()
        for t in (recv_task, sweep_task):
            try:
                await t
            except asyncio.CancelledError:
                pass
        await self.finalize_pending()
        try:
            await ws.send_close(self.writer, masked=True)
        except Exception:
            pass
        self.writer.close()
        self.out.close()


async def main():
    ap = argparse.ArgumentParser(description="HOPTRACE Phase 2 application client")
    ap.add_argument("--host", default="10.10.5.2")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--duration", type=float, default=30.0)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    client = AppClient(args.out)
    await client.run(args.host, args.port, args.duration)


if __name__ == "__main__":
    asyncio.run(main())
