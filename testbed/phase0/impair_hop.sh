#!/usr/bin/env bash
# HOPTRACE Phase 0 — MANUAL scaffolding only (not the Phase 3 fault controller).
# usage: impair_hop.sh <hop 1-4> <delay_ms>
#
# Applies netem on the router's SERVER-FACING interface, i.e. the egress
# link/segment FROM Hop N ONWARD. This impairs a link segment, not the
# router itself — it is not evidence that "Router N is faulty" (spec C8).
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <hop 1-4> <delay_ms>" >&2
  exit 2
fi
hop="$1"; delay_ms="$2"

if ! [[ "$hop" =~ ^[1-4]$ ]]; then
  echo "ERROR: hop must be 1-4 (this topology has 4 router hops; hop 5 is the server, not impairable here)" >&2
  exit 2
fi

router="ns-r${hop}"
iface="$(veth_a $((hop+1)))"   # ns-r{hop}'s server-facing interface, on subnet (hop+1)

# --- interface-existence validation, required before applying tc ---
# `ip netns list` prints "name (id: N)" per line, not the bare name — match
# on the first field only, or an exact-line grep silently never matches.
if ! ip netns list | awk '{print $1}' | grep -qx "$router"; then
  echo "ERROR: namespace '$router' does not exist. Is the topology up? Run setup_topology.sh first." >&2
  exit 1
fi
if ! ip netns exec "$router" ip link show "$iface" >/dev/null 2>&1; then
  echo "ERROR: interface '$iface' does not exist inside '$router'. Topology may be malformed — refusing to apply tc." >&2
  exit 1
fi

ip netns exec "$router" tc qdisc add dev "$iface" root netem delay "${delay_ms}ms"
echo "applied: ${delay_ms}ms delay on ${router}'s egress link toward hop $((hop+1))+ (link-segment impairment, per hop $hop onward — not a claim that $router is faulty)"
