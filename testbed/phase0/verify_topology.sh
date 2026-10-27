#!/usr/bin/env bash
# HOPTRACE Phase 0 — automated checks (Tests 1-2 from the approved plan).
# Test 3 (netem apply/measure/clear) is run manually — a before/after
# comparison shouldn't be silently averaged away by a script.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

pass() { echo "PASS: $1"; }
fail() { echo "FAIL: $1"; exit 1; }

echo "== Test 1: zero-loss baseline connectivity (200 packets) =="
ping_out=$(ip netns exec ns-client ping -c 200 -i 0.02 "$SERVER_IP" 2>&1)
echo "$ping_out" | tail -4
loss=$(echo "$ping_out" | grep -oP '\d+(?=% packet loss)')
if [[ "$loss" == "0" ]]; then
  pass "zero-loss baseline (200/200 packets, 0% loss)"
else
  fail "baseline loss = ${loss}%"
fi

echo
echo "== Test 2: exactly 5 hops, in order, x2 =="
expected="10.10.1.2 10.10.2.2 10.10.3.2 10.10.4.2 10.10.5.2"
for run in 1 2; do
  # 2s gap between runs: the server's ICMP port-unreachable reply is subject to
  # net.ipv4.icmp_ratelimit (default 1000ms/type); running two traceroutes back
  # to back can collide with that cooldown and manifest as spurious timeouts on
  # the final hop. This is the same ICMP-ratelimit caveat documented in the
  # architecture review, not a topology defect — the delay avoids tripping it
  # rather than masking a real failure.
  [[ $run -gt 1 ]] && sleep 2
  hops=$(ip netns exec ns-client traceroute -n -q1 "$SERVER_IP" 2>&1 | tail -n +2 | awk '{print $2}' | tr '\n' ' ' | sed 's/ *$//')
  echo "run $run: $hops"
  if [[ "$hops" == "$expected" ]]; then
    pass "run $run matches expected hop sequence"
  else
    fail "run $run mismatch: got [$hops] expected [$expected]"
  fi
done

echo
echo "Tests 1-2 complete. Run Test 3 (impairment) manually via impair_hop.sh / clear_impairment.sh."
