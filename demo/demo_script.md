# HOPTRACE live demo script

`demo/run_demo.sh` genuinely executes every step below against the real
WSL2 six-namespace testbed and the real fault controller. Nothing here
is pre-recorded or simulated — run the script again and it does the
same real work again, with a freshly rebuilt topology and a freshly
injected fault every time. Numbers quoted below are from an actual run
(commit `a674888`, trial `demo-run-01`); your own run will differ
slightly in exact RTT values and timestamps, not in kind.

From the repository root, inside WSL2 Ubuntu as root (see `README.md`):

```bash
bash demo/run_demo.sh
```

Must run as root (topology build and namespace entry require it). Takes
roughly 60–90 seconds end to end.

## What it actually does, step by step

**0. Rebuild + verify the testbed, verify ground-truth isolation live.**
Tears down and rebuilds the 6-node namespace topology from scratch,
re-applies the permanent ICMP rate-limit calibration, runs the Phase 0
connectivity and hop-count checks, (re)creates the `hoptrace-truth` /
`hoptrace-engine` / `hoptrace-eval` OS identities, and — before any
fault exists — tries to read `/var/lib/hoptrace/groundtruth.db` as
`hoptrace-engine` and confirms it fails with a real permission error.
This is a live OS-level check, not a comment claiming isolation exists.

**1–2. Start the app server, start the prober and app client (baseline).**
The prober (TCP-SYN transport) and the WebSocket app client both run
inside `ns-client`, sharing the same `CLOCK_MONOTONIC` clock, exactly
as the locked spec requires. For the first 25 of 35 seconds no fault
exists — this is the real baseline period the onset detector's
median/MAD threshold is computed against.

**3. Inject a real fault.** `hoptrace-truth` runs
`faultctl/controller.py inject --hop 2 --type latency --delay-ms 90`,
which issues a real `tc qdisc add ... netem delay 90ms` inside `ns-r2`
on the link *leaving* hop 2 toward hop 3 — and records the ground-truth
event in a DB the analysis engine cannot read. The printed event ID is
real, from a real SQLite insert.

**4. Observation continues** for the remaining ~10 seconds, under the
live fault, until the prober and app client finish their fixed round
count.

**5. HOPTRACE analysis, run as `hoptrace-engine`.** Runs the exact
frozen Phase 4b configuration — the `mad_sustained` onset detector,
`k_mad=5.0`, `min_run=3`, unmodified — via
`evaluate/tuning_analysis_4b.run_pipeline_with`, the same helper used
for the Phase 4b held-out scoring. (That scoring was done on an
*exposed* set and is not independent validation; see
`docs/EVIDENCE_LEDGER.md`.) Isolation here rests on the OS permission
on the ground-truth DB, which this script verifies live in step 0: this
process cannot read it. It is *not* a claim about the import graph —
`tuning_analysis_4b` imports the `groundtruth` module (import only; it
never opens the DB), while `correlate/` itself never imports it.

**6. Result presentation + evidence inspection.** Runs
`present/path_bundle.py` (produces `path_bundle.json`, the same format
the UI renders) and `present/report.py` (plain-text + JSON). From the
actual run:

> Degradation appears to begin at or after Hop 3.
> Confidence: high (score 1.0). Corroborating hops: 3, 4, 5. Hops 1–2
> unaffected — correctly, since a fault on hop 2's *egress* link cannot
> appear in hop 2's own measurement, only hop 3 onward (the "Hop N
> onward" physics this project relies on throughout).

**7. Fault removal.** `hoptrace-truth` runs
`controller.py clear-latest`, which issues a real
`tc qdisc del ... root` and closes out the ground-truth event's end
timestamp. The fault is not "reset" by rebuilding anything — this is
the same live qdisc being removed.

**8. Recovery check.** A fresh 10-round probe runs immediately after
clearing. From the actual run: hop 3 RTT was **78.5 ms** in the last
third of the faulted trial and **0.01 ms** immediately after clearing —
a real, measured return to baseline, not an assumption.

## A real finding from building this demo

The first version of this script used a 10s baseline / 25s faulted
split — the fault active for 71% of the observation window. The frozen `mad_sustained` detector's
threshold is `median + k_mad·MAD` computed over the *whole* window — it
assumes the fault is the *minority* of the series, so the median still
represents "normal." With the fault as the majority, the median itself
sat inside the faulted region and the detector correctly, by its own
design, reported no onset anywhere (`confidence: insufficient`). The
plain-language layer renders "no onset" as *"No significant degradation
was detected"* — for a real 90 ms fault. That is a **false negative**
under a violated precondition, and a known product gap: the system has
no "insufficient data" state and cannot distinguish "nothing happened"
from "the detector could not establish a baseline" (tracked as
issue HT-002/HT-018 in the project audit).

The fix applied here was timing, not detection logic: `BASELINE_S=25`
of the 35s capture keeps the baseline the statistical majority. This
demo therefore runs in the detector's *favourable regime*; it
illustrates the pipeline end to end and is not evidence that the
detector handles faults that span most of an observation window.
