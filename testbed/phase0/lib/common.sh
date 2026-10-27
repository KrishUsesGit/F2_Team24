#!/usr/bin/env bash
# HOPTRACE Phase 0 — sourced by every other Phase 0 script.
# Single source of truth for namespace names and addressing.
# Matches: hoptrace-phase-0-5-spec.html §03 exactly.
set -euo pipefail

NODES=(ns-client ns-r1 ns-r2 ns-r3 ns-r4 ns-server)   # index 0..5
ROUTERS=(ns-r1 ns-r2 ns-r3 ns-r4)                     # the four forwarding namespaces

# subnet N (1..5) = 10.10.N.0/30 ; low-index node = .1, high-index node = .2
subnet() { echo "10.10.$1.0/30"; }
addr_lo() { echo "10.10.$1.1"; }   # address of NODES[$1-1] in subnet $1
addr_hi() { echo "10.10.$1.2"; }   # address of NODES[$1]   in subnet $1
veth_a() { echo "veth-s$1-a"; }    # host-side name of subnet $1's pair, low-index end
veth_b() { echo "veth-s$1-b"; }    # high-index end

CLIENT_IP="10.10.1.1"
SERVER_IP="10.10.5.2"
