#!/usr/bin/env bash
# HOPTRACE Phase 6 -- real end-to-end demo.
#
# Genuinely executes: baseline -> fault injection -> observation ->
# HOPTRACE analysis -> result presentation -> evidence inspection ->
# fault removal -> recovery, against the real WSL2 6-node namespace
# testbed and the real faultctl controller. No step is faked or
# pre-recorded. Must be run as root (topology build, namespace exec).
#
# Ground truth stays isolated: the fault is injected and cleared by
# the hoptrace-truth identity via faultctl/controller.py; the
# localization pipeline runs as hoptrace-engine, which this script
# explicitly verifies cannot read the ground-truth DB.
set -euo pipefail

if [[ "$(id -u)" != "0" ]]; then
  echo "ERROR: run_demo.sh must be run as root (topology build needs it)." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TESTBED="$ROOT/testbed/phase0"
TRIAL_ID="demo-run-01"
TRIAL_DIR="$ROOT/experiments/$TRIAL_ID"
HOP_JSONL="$TRIAL_DIR/hop.jsonl"
APP_JSONL="$TRIAL_DIR/app.jsonl"
RECOVERY_JSONL="$TRIAL_DIR/recovery_hop.jsonl"
EVIDENCE_JSON="$TRIAL_DIR/evidence_demo.json"
BUNDLE_JSON="$TRIAL_DIR/path_bundle.json"

FAULT_HOP=2
FAULT_DELAY_MS=90
ROUNDS=70
INTERVAL=0.5
DURATION=35.0
# The frozen mad_sustained detector's threshold is median + k_mad*MAD
# over the WHOLE observed series -- it assumes the fault is a MINORITY
# of the window, so the median still represents "normal". Baseline
# must dominate the capture, otherwise the detector reports no onset (a
# false negative, observed in this demo's first version). BASELINE_S=25
# of a 35s capture keeps baseline at ~71%. This is the detector's
# favourable regime, not a general guarantee.
BASELINE_S=25

log() { echo; echo "== $* =="; }

log "0/8  Rebuilding the testbed topology (fresh state)"
bash "$TESTBED/teardown_topology.sh" || true
bash "$TESTBED/setup_topology.sh"
bash "$TESTBED/verify_topology.sh"

log "0/8  Ensuring hoptrace-truth / hoptrace-engine / hoptrace-eval identities exist"
bash "$ROOT/faultctl/setup_identities.sh"

log "0/8  Verifying ground-truth isolation BEFORE any fault is injected"
if su -s /bin/bash hoptrace-engine -c "cat /var/lib/hoptrace/groundtruth.db" &>/dev/null; then
  echo "FAIL: hoptrace-engine COULD read the ground-truth DB -- isolation broken." >&2
  exit 1
else
  echo "PASS: hoptrace-engine cannot read /var/lib/hoptrace/groundtruth.db (permission denied, verified live)."
fi

rm -rf "$TRIAL_DIR"
mkdir -p "$TRIAL_DIR"
echo "{\"trial_id\": \"$TRIAL_ID\", \"role\": \"demo\", \"duration_s\": $DURATION, \"fault_hop\": $FAULT_HOP, \"fault_delay_ms\": $FAULT_DELAY_MS}" > "$TRIAL_DIR/trial_meta.json"

log "1/8  Starting the app server (ns-server)"
ip netns exec ns-server python3 "$ROOT/app/server.py" --host 0.0.0.0 --port 8765 \
  > "$TRIAL_DIR/server.log" 2>&1 &
SERVER_PID=$!
sleep 1

log "2/8  Starting prober + app client (ns-client, co-located, shared clock) -- BASELINE begins"
ip netns exec ns-client python3 "$ROOT/prober/prober.py" \
  --dst 10.10.5.2 --src 10.10.1.1 --transport tcp_syn \
  --rounds "$ROUNDS" --interval "$INTERVAL" --out "$HOP_JSONL" &
PROBER_PID=$!

ip netns exec ns-client python3 "$ROOT/app/client.py" \
  --host 10.10.5.2 --port 8765 --duration "$DURATION" --out "$APP_JSONL" &
CLIENT_PID=$!

sleep "$BASELINE_S"

log "3/8  Injecting a REAL fault via faultctl (hoptrace-truth identity, hop $FAULT_HOP, latency ${FAULT_DELAY_MS}ms)"
EVENT_ID=$(su -s /bin/bash hoptrace-truth -c \
  "cd '$ROOT/faultctl' && python3 controller.py inject --hop $FAULT_HOP --type latency --delay-ms $FAULT_DELAY_MS --trial-id $TRIAL_ID")
echo "ground-truth event_id: $EVENT_ID (recorded by hoptrace-truth; not visible to the analysis engine)"

log "4/8  Observation continues under fault until the trial completes"
wait "$PROBER_PID"
wait "$CLIENT_PID"
echo "prober + app client finished: $HOP_JSONL / $APP_JSONL"

log "5/8  Running HOPTRACE analysis as hoptrace-engine (frozen mad_sustained, k_mad=5.0, min_run=3)"
chmod 644 "$HOP_JSONL" "$APP_JSONL"
su -s /bin/bash hoptrace-engine -c \
  "python3 '$ROOT/demo/_run_engine_pipeline.py' '$HOP_JSONL' '$APP_JSONL' '$TRIAL_ID' '$ROOT/correlate' '$ROOT/evaluate' '$EVIDENCE_JSON'"

log "6/8  Result presentation + evidence inspection (path_bundle, real data only)"
python3 "$ROOT/present/path_bundle.py" \
  --hop-jsonl "$HOP_JSONL" --app-jsonl "$APP_JSONL" --evidence-json "$EVIDENCE_JSON" \
  --trial-id "$TRIAL_ID" --attach-evaluation "$ROOT/evaluate/held_out_results_4b.json" \
  --out "$BUNDLE_JSON"
python3 "$ROOT/present/report.py" \
  --hop-jsonl "$HOP_JSONL" --app-jsonl "$APP_JSONL" --evidence-json "$EVIDENCE_JSON"

log "7/8  Fault removal (hoptrace-truth clears the real netem qdisc)"
su -s /bin/bash hoptrace-truth -c \
  "cd '$ROOT/faultctl' && python3 controller.py clear-latest --hop $FAULT_HOP --trial-id $TRIAL_ID"

log "8/8  Recovery check -- a fresh short probe after the fault is cleared"
sleep 1
ip netns exec ns-client python3 "$ROOT/prober/prober.py" \
  --dst 10.10.5.2 --src 10.10.1.1 --transport tcp_syn \
  --rounds 10 --interval 0.5 --out "$RECOVERY_JSONL"

# Compare hop FAULT_HOP+1, not FAULT_HOP itself: AUTHORIZED_TARGETS maps
# a fault at hop N to the egress link LEAVING hop N (toward hop N+1).
# Hop N's own ICMP/TCP-RST reply is generated locally at hop N and never
# crosses that impaired link, so hop N's measurement is unaffected by
# design -- only hop N+1 onward sees it (the "Hop N onward" physics
# documented throughout this project). Checking hop N would silently
# show "no change" even when the fault is working correctly.
CHECK_HOP=$((FAULT_HOP + 1))
python3 - <<PYEOF
import json, statistics as st
def hop_rtts(path, ttl):
    vals = []
    for line in open(path):
        line = line.strip()
        if not line:
            continue
        s = json.loads(line)
        if s["ttl"] == ttl and s["responded"]:
            vals.append(s["rtt_ms"])
    return vals

faulted = hop_rtts("$HOP_JSONL", $CHECK_HOP)
recovered = hop_rtts("$RECOVERY_JSONL", $CHECK_HOP)
n = max(1, len(faulted) // 3)
print(f"hop $CHECK_HOP RTT, last third of the faulted trial: mean {st.mean(faulted[-n:]):.2f} ms (n={n})")
print(f"hop $CHECK_HOP RTT, after clearing the fault:        mean {st.mean(recovered):.2f} ms (n={len(recovered)})")
PYEOF

kill "$SERVER_PID" 2>/dev/null || true

log "Done"
echo "trial dir:      $TRIAL_DIR"
echo "evidence:        $EVIDENCE_JSON"
echo "path_bundle:      $BUNDLE_JSON"
echo "ground truth db:  /var/lib/hoptrace/groundtruth.db (owned by hoptrace-truth, unreadable by hoptrace-engine, verified above)"
