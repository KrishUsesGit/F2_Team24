#!/usr/bin/env bash
# HOPTRACE Phase 0 — tear down the testbed cleanly. Must be run as root.
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"
for ns in "${NODES[@]}"; do
  ip netns delete "$ns" 2>/dev/null || true
done
echo "torn down (namespaces removed; their veth halves go with them)."
