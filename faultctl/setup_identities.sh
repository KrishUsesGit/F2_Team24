#!/usr/bin/env bash
# HOPTRACE Phase 3 (locked spec Phase 3 / §04) -- one-time identity and
# isolation setup. Idempotent: safe to re-run.
#
# Creates three system accounts:
#   hoptrace-truth  -- the fault controller. Owns the ground-truth DB.
#   hoptrace-engine -- the localization/analysis engine. Must NOT be
#                       able to read the ground-truth DB.
#   hoptrace-eval   -- the evaluation harness. MAY read the ground-truth
#                       DB (added to hoptrace-truth's group).
#
# Grants hoptrace-truth a narrowly-scoped, passwordless sudo rule
# limited to `ip netns exec ns-r{1..4} tc ...` -- nothing else. This is
# what lets the controller run as a low-privilege identity while still
# being able to do the one privileged thing (network namespace / tc
# manipulation) it legitimately needs.
set -euo pipefail

id -u hoptrace-truth  &>/dev/null || useradd -r -M -s /usr/sbin/nologin hoptrace-truth
id -u hoptrace-engine &>/dev/null || useradd -r -M -s /usr/sbin/nologin hoptrace-engine
id -u hoptrace-eval   &>/dev/null || useradd -r -M -s /usr/sbin/nologin hoptrace-eval

usermod -aG hoptrace-truth hoptrace-eval

mkdir -p /var/lib/hoptrace
chown hoptrace-truth:hoptrace-truth /var/lib/hoptrace
chmod 750 /var/lib/hoptrace   # owner rwx, group rx (eval can traverse), other none

cat > /etc/sudoers.d/hoptrace-truth <<'EOF'
# HOPTRACE fault controller: hoptrace-truth may run `tc` inside exactly
# the four router namespaces it is authorized to manipulate, and
# nothing else. No shell, no other command, no other namespace.
hoptrace-truth ALL=(root) NOPASSWD: /usr/sbin/ip netns exec ns-r1 /usr/sbin/tc *
hoptrace-truth ALL=(root) NOPASSWD: /usr/sbin/ip netns exec ns-r2 /usr/sbin/tc *
hoptrace-truth ALL=(root) NOPASSWD: /usr/sbin/ip netns exec ns-r3 /usr/sbin/tc *
hoptrace-truth ALL=(root) NOPASSWD: /usr/sbin/ip netns exec ns-r4 /usr/sbin/tc *
EOF
chmod 440 /etc/sudoers.d/hoptrace-truth
visudo -c -f /etc/sudoers.d/hoptrace-truth

echo "identities configured:"
id hoptrace-truth
id hoptrace-engine
id hoptrace-eval
echo "ground-truth dir:"
ls -ld /var/lib/hoptrace
