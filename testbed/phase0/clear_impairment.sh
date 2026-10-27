#!/usr/bin/env bash
# HOPTRACE Phase 0 — MANUAL scaffolding only (not the Phase 3 fault controller).
# usage: clear_impairment.sh <hop 1-4>
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <hop 1-4>" >&2
  exit 2
fi
hop="$1"

if ! [[ "$hop" =~ ^[1-4]$ ]]; then
  echo "ERROR: hop must be 1-4" >&2
  exit 2
fi

router="ns-r${hop}"
iface="$(veth_a $((hop+1)))"

# --- interface-existence validation, required before touching tc ---
if ! ip netns list | awk '{print $1}' | grep -qx "$router"; then
  echo "ERROR: namespace '$router' does not exist." >&2
  exit 1
fi
if ! ip netns exec "$router" ip link show "$iface" >/dev/null 2>&1; then
  echo "ERROR: interface '$iface' does not exist inside '$router'." >&2
  exit 1
fi

ip netns exec "$router" tc qdisc del dev "$iface" root netem 2>/dev/null || true
echo "cleared impairment on ${router}'s link segment (hop $hop onward)."
