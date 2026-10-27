#!/usr/bin/env bash
# HOPTRACE Phase 0 — build the 6-namespace linear testbed.
# Must be run as root. Matches hoptrace-phase-0-5-spec.html §03.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/lib/common.sh"

# 1. create namespaces
for ns in "${NODES[@]}"; do
  ip netns add "$ns"
done

# 2. create the 5 veth pairs and move each end into its namespace
for i in 1 2 3 4 5; do
  a="$(veth_a $i)"; b="$(veth_b $i)"
  ip link add "$a" type veth peer name "$b"
  ip link set "$a" netns "${NODES[$((i-1))]}"
  ip link set "$b" netns "${NODES[$i]}"
  ip netns exec "${NODES[$((i-1))]}" ip addr add "$(addr_lo $i)/30" dev "$a"
  ip netns exec "${NODES[$i]}"       ip addr add "$(addr_hi $i)/30" dev "$b"
  ip netns exec "${NODES[$((i-1))]}" ip link set "$a" up
  ip netns exec "${NODES[$i]}"       ip link set "$b" up
  ip netns exec "${NODES[$((i-1))]}" ip link set lo up
  ip netns exec "${NODES[$i]}"       ip link set lo up
done

# 3. enable forwarding on the four router namespaces only
for r in "${ROUTERS[@]}"; do
  ip netns exec "$r" sysctl -qw net.ipv4.ip_forward=1
done

# 4. static routes — explicit per-subnet, no aggregation (plan §3 rationale)
ip netns exec ns-client ip route add 10.10.0.0/16 via 10.10.1.2

ip netns exec ns-r1 ip route add 10.10.3.0/30 via 10.10.2.2
ip netns exec ns-r1 ip route add 10.10.4.0/30 via 10.10.2.2
ip netns exec ns-r1 ip route add 10.10.5.0/30 via 10.10.2.2

ip netns exec ns-r2 ip route add 10.10.1.0/30 via 10.10.2.1
ip netns exec ns-r2 ip route add 10.10.4.0/30 via 10.10.3.2
ip netns exec ns-r2 ip route add 10.10.5.0/30 via 10.10.3.2

ip netns exec ns-r3 ip route add 10.10.1.0/30 via 10.10.3.1
ip netns exec ns-r3 ip route add 10.10.2.0/30 via 10.10.3.1
ip netns exec ns-r3 ip route add 10.10.5.0/30 via 10.10.4.2

ip netns exec ns-r4 ip route add 10.10.1.0/30 via 10.10.4.1
ip netns exec ns-r4 ip route add 10.10.2.0/30 via 10.10.4.1
ip netns exec ns-r4 ip route add 10.10.3.0/30 via 10.10.4.1

ip netns exec ns-server ip route add 10.10.0.0/16 via 10.10.5.1

# 5. testbed calibration: disable ICMP error-response rate limiting,
#    inside the router + server namespaces ONLY.
#
#    WHY (rationale, from Phase 0/Phase 1 findings):
#    Linux's default net.ipv4.icmp_ratelimit=1000 permits at most one
#    ICMP error message (Time-Exceeded / Destination-Unreachable) per
#    1000ms per namespace. The Phase 1 prober's round cadence (500ms)
#    sends probes to the same hop faster than that default cooldown
#    clears, so the *kernel itself* silently suppressed most ICMP
#    replies:
#      - Phase 0's back-to-back traceroute runs hit the same limiter.
#      - Phase 1 Gate A's first 200-round run, under the kernel default,
#        measured only ~60% hop-response/match rate.
#      - Phase 0 had already proven 0% real packet loss on this exact
#        topology (200/200 pings), so the ~60% figure was confirmed to
#        be rate-limiter noise, not real path behavior.
#      - Setting icmp_ratelimit=0 on ns-r1..ns-r4 and ns-server removed
#        it entirely: the same Gate A re-run then scored 200/200 (100%)
#        matched rounds.
#    Conclusion: the default ICMP error-response rate limit is an
#    experimental confound for this controlled testbed, not a property
#    of the paths being measured — so it is calibrated out permanently,
#    here, as part of building the testbed.
#
#    THIS DOES NOT:
#      - disable packet loss of any kind. tc netem loss/reorder/corrupt
#        is a completely separate subsystem, untouched by this setting.
#      - alter tc/netem latency, jitter, or bandwidth shaping in any way.
#      - touch the Windows host, or the WSL2/Ubuntu host's own DEFAULT
#        network namespace. It is applied ONLY inside the namespaces
#        HOPTRACE itself creates (ns-r1..ns-r4, ns-server) — ns-client
#        is left at the kernel default, since it never generates the
#        ICMP error replies this setting concerns.
#
#    ITS ONLY PURPOSE is to stop the kernel's own ICMP error-generation
#    throttle from acting as an uncontrolled confound on hop-level probe
#    measurements. It changes nothing about what a fault-injection trial
#    (tc netem) actually does to traffic.
for r in "${ROUTERS[@]}"; do
  ip netns exec "$r" sysctl -qw net.ipv4.icmp_ratelimit=0
done
ip netns exec ns-server sysctl -qw net.ipv4.icmp_ratelimit=0

echo "topology up."
echo "icmp_ratelimit calibration: $(ip netns exec ns-r1 sysctl -n net.ipv4.icmp_ratelimit) (ns-r1, expect 0)"
