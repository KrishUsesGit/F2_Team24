# HOPTRACE — Full Project Audit Report

Audit date: 2026-10-14 · Repo HEAD: `cf647fd` (branch `master`) · Auditor mode: read-only, evidence first

> **Status note added at publication.** This is a point-in-time audit of commit `cf647fd`, written *before* work package WP-1. Findings about the missing README, hardcoded machine paths, missing `.gitattributes`, and overstated UI/demo/docstring claims (parts of HT-001, HT-005, HT-006, HT-009, HT-013) were addressed by WP-1; see `README.md` and `docs/EVIDENCE_LEDGER.md` for the current state. Findings about evaluation integrity (no independent validation), confidence, loss/bandwidth localization, the detector's global-baseline assumption, the missing "insufficient data" state, and spec Phase 5 remain **open**. The text below is left as written.

## 0. How this audit was done (and its limits)

- **Nothing existing was modified.** The only new file is this report (untracked, uncommitted). `git status` before and after: only one pre-existing untracked, unrelated local file, plus this file afterwards.
- Unit tests were run as the unprivileged `hoptrace-engine` identity with `python3 -B` (no bytecode writes). The ground-truth DB mtime was identical before and after (`2026-09-17 11:37:40`).
- Ground truth was read once, **read-only (`mode=ro`), as `hoptrace-eval`** (the designated evaluation identity), solely to inventory which trials have labels. The localization engine was never run against it.
- **No held-out raw traces were analysed.** For held-out data I used only the already-committed result files. One exploratory raw-statistics check (section E.7) used **tuning** data only (`p4b-tune-*`), made no parameter changes, and read no ground truth.
- **Not executed**, deliberately: topology build/teardown, live prober/app/fault-controller runs, `demo/run_demo.sh`. They create namespaces, apply `tc` qdiscs, and write to the ground-truth DB. No topology currently exists (`ip netns list` is empty), so Phase 0–3 live behaviour was **not re-verified today**; it is rated from artifacts and code.
- Label convention: **VERIFIED** (I observed it today), **FROM ARTIFACT** (a persisted file shows it, not re-run), **INFERRED** (from code reading), **UNKNOWN** (cannot be established; with how to verify).

## A. Executive summary

HOPTRACE is a substantial, well-structured research prototype. A six-namespace testbed, a raw-socket prober, a hand-rolled RFC 6455 telemetry channel, a fault controller with real OS-level ground-truth isolation, a correlation pipeline, an interpretability layer, a UI, and a demo script all exist and all 116 unit tests pass.

The engineering is ahead of the science. The headline claim "the frozen detector passed the localization gate" is **not supported by independent evidence**:

1. **The only genuinely independent held-out result failed.** Phase 4 (`mad`): false attribution 3/12 = 25% against a ≤10% limit, clean-control false positives 2/4, recall 3/8. This exactly matches the figures in your brief (VERIFIED in `evaluate/held_out_results.json`).
2. **The Phase 4b "PASS" is not an independent validation.** `mad_sustained` was validated on the same 12 held-out trials after `evaluate/diagnose_phase4b.py` loaded those trials' raw traces together with their ground-truth labels (lines 85–101) to design the new candidates. The validator's docstring says the set was "never touched by any Phase 4b tuning decision". That is not accurate. The UI's wording ("generated once against 12 held-out trials", "PASSED") inherits the problem. No independent evidence currently exists for the frozen configuration.
3. **Two of four fault classes are not localized at all, and one is probably unobservable.** Held-out recall by class is latency 1/1, jitter 3/3, loss 0/2, bandwidth 0/2; the same 0/4 holds on the Phase 4b tuning set. On tuning traces, bandwidth faults (even 100 kbit) leave RTT statistics indistinguishable from a clean run, so with sparse probing they appear to have no observable effect. Overall "50% recall" hides this.
4. **The detector is blind when the fault covers most of the window**, and the product text turns that blindness into a claim. Onset thresholds use one global median/MAD over the whole window. My own first demo run reproduced it: a real 90 ms fault covering 71% of the window produced "No significant degradation was detected." The interpretation layer maps *any* detector abstention to that sentence and has no "insufficient data" state.
5. **Confidence is degenerate and uncalibrated.** `corroborating_fraction` is 1.0 in all 11 persisted evidence files; the score reduces to `1 − unknown_hops/5`. It carries no information about signal strength, yet "high" confidence is what flips the UI to "Localized". The spec's calibration gate is unmet.
6. **Phase numbering in the brief does not match the locked spec or the repo.** Spec Phase 5 is the 288-cell evaluation harness (not started); spec Phase 6 is UI/demo, which the spec says must not start until the calibration check passes. No "Integration/API" phase exists in the spec, and no backend/API exists in the repo.
7. **Reproducibility is weak.** There is no script that collected any of the 39 experiment trials (including how "unknown-hop" trials silenced a router). Ten files hardcode `/mnt/c/Users/REDACTED/...`. There is no README or setup document. Git runs with `core.autocrlf=true` and no `.gitattributes`. The ground-truth labels for all trials live in one DB file outside the repo.

What is solid: ground-truth isolation holds at the OS level (VERIFIED live today), the evidence-bounded language is enforced in code, the data model separates fact/inference/correlation/confidence/unknown, and results are reported with denominators and Wilson CIs.

## B. Verified phase-status matrix

Phase numbers follow the **locked spec** (`hoptrace-phase-0-5-spec.html` §10), with the brief's naming alongside where they differ.

| Phase | Status | Evidence inspected | What works | What remains | Confidence |
|---|---|---|---|---|---|
| **0 — Testbed** | PARTIALLY COMPLETE | `testbed/phase0/*.sh` (all pass `bash -n`; no CRLF), `demo-run-01` artifacts | Setup/teardown/verify scripts, static routes, forwarding, permanent `icmp_ratelimit=0` calibration with rationale | Not re-run today. `setup_topology.sh` is not idempotent (needs teardown first). No persisted gate log. Namespaces vanish on every WSL restart | Medium |
| **1 — Probing** | PARTIALLY COMPLETE | `prober/*.py`, 9 unit tests (pass) | TCP-SYN (default) and UDP transports, TTL 1–5, 2 probes/hop, 0.3 s timeout, 0.5 s rounds, UNKNOWN = `responded:false`, RFC 1071 checksums | Tests cover parsing/format only, not live probing. Spec gate (≥99% hop identity over 200 rounds; firewalled hop → UNKNOWN) has no persisted artifact. No script creates a "silent hop" | Medium |
| **2 — App telemetry** | PARTIALLY COMPLETE | `app/*.py`, 10 tests (pass) | Hand-rolled WebSocket, 20 Hz ping, Poisson 2/s interactions, client-side RTT on `CLOCK_MONOTONIC`, per-kind sequence counters, distinct within-budget/late/missing states | Spec gate (5-minute unimpaired run: std < 5 ms, zero gaps, 0% budget misses) has no artifact; longest persisted capture is ~37 s. WS parser handles only text/close frames | Medium |
| **3 — Fault controller + ground truth** | PARTIALLY COMPLETE (isolation VERIFIED) | `faultctl/*`, 15 tests (pass), live permission tests, DB inventory | Four fault classes, hops 1–4 only (hop 5 = server rejected), authorization table, sudoers-scoped `tc`, SQLite on ext4 `0640`. **Live: engine gets `Permission denied` on the file and the directory; eval can read, cannot write** | Gate "all 4 types at all 4 hops" not demonstrated: no `latency@hop4` event exists in the DB. No artifact found measuring the ±50 ms start/end logging accuracy. `t_start` is taken before `tc` runs. Sudoers uses `tc *` wildcards. DB is a single copy outside the repo | High (isolation) / Low (gate) |
| **4 — Correlation engine (code)** | VERIFIED COMPLETE (as code) | `correlate/*.py`, 38 tests (pass) | Synchronize → onset → align → classify; typed EvidenceRecord; `correlate/` never imports `groundtruth` | See Phase 4 selection | High |
| **4 — Algorithm selection and gate** | **FAILED GATE** (Phase 4) → **UNVALIDATED** (Phase 4b) | `frozen_config*.json`, `held_out_results*.json`, `diagnose_phase4b.py`, file mtimes | Honest Phase 4 failure preserved. Phase 4b root-cause diagnosis is real and reproducible | No independent evidence for `mad_sustained`. Spec hard gate (drop candidates with >5% clean-control FP) not implemented. Tuning sets (12 + 10) vs spec 120. Selection rested on 2 localized trials and a manual tie-break | High |
| **5 (spec) — Evaluation harness (288-cell matrix) and calibration check; 5a pilot** | **NOT STARTED** | `power_calc.py`, `pilot_analysis.py` | 5-trial exploratory pilot; power analysis that explicitly justifies a scaled-down design | No 24-trial pilot, no matrix, no sealed holdout, no calibration test | High |
| **5 (repo) — Interpretability layer** (not in spec; brief's "Phase 5 Integration/API" does not match) | PARTIALLY COMPLETE | `present/interpret.py`, `technical_view.py`, `report.py`, 28 tests | Four locked result strings, runtime forbidden-language assertion, evidence passthrough | No "insufficient data" state; abstention ⇒ "No significant degradation" | High |
| **Integration / API (brief's Phase 5)** | **NOT STARTED** | Repo search: no server, route, schema file, or integration test | — | Define the data contract; serve evidence | High |
| **6 — UI + demo** | PARTIALLY COMPLETE | `ui/*`, `demo/*`, `experiments/demo-run-01` | UI renders real `path_bundle.json` (not hardcoded measurements). Demo exercised real injection → analysis → removal → recovery | Spec says Phase 6 must not start until calibration passes (it was started). UI cannot show the live demo result. Visual quality below target. Offline fragility. Copy overclaims | Medium |

## C. Repository and environment map

**Git (VERIFIED):** repo root `C:\Users\REDACTED\OneDrive\Desktop\hoptrace`; initialized; branch `master`; HEAD `cf647fd`; 8 commits; **no remote; no tags**; 208 tracked files (132 under `experiments/`); working tree clean except one untracked, unrelated local file (not part of the code); ignored: `__pycache__/`, `*.pyc`.

**Commit history:** `323bd6a` baseline (Phases 0–4 lumped, 2026-09-16 22:37 IST) → `74c2395`, `63baff8`, `1f9521b` (Phase 4b, committed within ~2 minutes of each other on 2026-09-17 01:41–01:43) → `c202be0` (interpretability) → `17036fc`, `a674888` (path_bundle, UI) → `cf647fd` (demo).

```
testbed/phase0/   setup/teardown/verify_topology.sh, impair_hop.sh + clear_impairment.sh (manual scaffolding), lib/common.sh
prober/           raw_probe.py, prober.py, hopsample.py, tests/ (+2 analysis helpers, not tests)
app/              ws_protocol.py, server.py, client.py, apprttsample.py, tests/
faultctl/         controller.py, groundtruth.py, setup_identities.sh, tests/
correlate/        synchronize.py, onset.py, onset_candidates.py (frozen, 5), onset_candidates_v2.py (4b variants),
                  align.py, evidence.py, pipeline.py, tests/, experiments/ (s1,s2 provisional artifacts)
evaluate/         metrics.py, tuning_analysis{,_4b}.py, held_out_evaluation{,_4b}.py, diagnose_phase4b.py,
                  pilot_analysis.py, power_calc.py, frozen_config{,_4b}.json, held_out_results{,_4b}.json, test_metrics.py
present/          interpret.py, technical_view.py, report.py, path_bundle.py, tests/
ui/               index.html, styles/main.css (697 lines), scripts/app.js (397 lines)
demo/             run_demo.sh, _run_engine_pipeline.py, demo_script.md
experiments/      40 trial directories (inventory in E.8)
docs              hoptrace-architecture-review.html, hoptrace-phase-0-5-spec.html, hoptrace-phase-0-plan.html  (no README)
.claude/launch.json  (Claude-desktop-specific preview config; the only record of how the UI is served)
```

**Entry points:** `demo/run_demo.sh` (root; full live demo) · `faultctl/controller.py {inject,clear,clear-latest}` (as `hoptrace-truth`) · `prober/prober.py` / `app/client.py` / `app/server.py` (inside namespaces) · `present/path_bundle.py` and `present/report.py` (evidence → UI bundle / text) · `evaluate/*.py` (as `hoptrace-eval`).

**Runtime (VERIFIED):** WSL2 Ubuntu 24.04.5 LTS, kernel 6.18.33.2-microsoft-standard-WSL2, Python 3.12.3, iproute2 6.1.0 (`ip`, `tc`). **Dependencies: standard library only** (import survey across all `.py` files shows no third-party module). The UI loads GSAP 3.12.5 and Google Fonts from CDNs. Windows host Python is 3.13 (used only for tooling).

**Current WSL state (VERIFIED):** no namespaces; identities `hoptrace-truth/engine/eval` exist (eval ∈ truth's group); `/var/lib/hoptrace` is `750 hoptrace-truth`; `groundtruth.db` is `640`, 29 events over 28 trial IDs; sudoers file present.

**Setup instructions:** none in the repo apart from script header comments and the HTML plan/spec. Reconstructing the working environment (derived from the scripts, not from documentation):

1. `wsl -d Ubuntu-24.04 -u root`
2. `bash faultctl/setup_identities.sh` (idempotent)
3. `bash testbed/phase0/teardown_topology.sh; bash testbed/phase0/setup_topology.sh; bash testbed/phase0/verify_topology.sh`
4. Tests: see section F. Live demo: `bash demo/run_demo.sh` (does steps 2–3 itself)
5. UI: from the repo root, `python3 -m http.server 8420`, open `/ui/index.html`

**Environment constraints:**
- `/mnt/c` (drvfs) ignores `chmod`, so the ground-truth DB must stay on ext4 (it does).
- Namespaces and `tc` state are lost whenever WSL stops.
- Repo lives inside a OneDrive-synced folder (sync/locking risk for `.git`).
- `core.autocrlf=true` plus no `.gitattributes`: a fresh Windows checkout would convert the `.sh` scripts to CRLF, which breaks them under WSL. They are LF today.
- Tool quirk: Git-Bash silently drops `$…` tokens in inline multi-line `wsl … bash -c '…'` strings; real script files are unaffected.

## D. Technical architecture (real data flow)

```
ns-client:  prober.py (raw sockets, TCP-SYN, TTL 1..5, 2 probes/hop, 0.5 s rounds)  ─┐  same CLOCK_MONOTONIC
            client.py (WebSocket, 20 Hz ping + ~2/s interactions, client-side RTT)   ─┘  (co-located, no sync needed)
                      │ real traffic through ns-r1 … ns-r4 (static routes, forwarding) to ns-server (server.py echo)
faultctl/controller.py (as hoptrace-truth) ── sudo ip netns exec ns-rN tc qdisc add/del (egress toward the server)
            └─► ground-truth events → /var/lib/hoptrace/groundtruth.db (0640)          [engine: Permission denied]
hop.jsonl + app.jsonl  (only inputs to the engine)
   → synchronize.py : 500 ms buckets; per-bucket mean RTT of RESPONDED samples; hop_total/hop_responded kept
   → onset detector (frozen: mad_sustained; k_mad=5.0, min_run=3): one global median/MAD per series; first run of ≥3 consecutive buckets above median+5·MAD
   → align.py : app onset vs hop onsets within ±1.5 s; shallowest hop h whose onset is concurrent AND all hops ≥h concurrent (downstream persistence)
   → evidence.py : EvidenceRecord {fact, inference, correlation, confidence, unknown}
   → present/interpret.py (4 result states) + technical_view.py + path_bundle.py → UI (static JSON) / report.py (text)
evaluate/metrics.py joins EvidenceRecord with ground truth AFTER the fact (as hoptrace-eval).
```

**Fault semantics:** a fault "at hop N" is a `tc` qdisc on router N's server-facing egress. Hop N's own reply never crosses it, so the first affected hop is N+1 ("Hop N onward"). The fault is one-directional. Hop 5 (server) cannot be impaired. `metrics.expected_first_affected_hop = min(N+1, 5)`.

**Unknown hops:** a hop is UNKNOWN in a bucket if probed but never answered. It is UNKNOWN for the trial if ≥50% of its attempted buckets are unknown (fixed, untuned). Unknown hops yield no onset, and because persistence requires every downstream hop to show a concurrent onset, an unknown downstream hop blocks any candidate upstream of it.

**Confidence:** `score = corroborating_fraction × (1 − unknown_hops/5)`; ≥0.8 high, ≥0.5 medium, >0 low. Fixed heuristic, never fitted; self-documented as uncalibrated. In practice `corroborating_fraction` is always 1.0 (persistence already forces it).

## E. Algorithm and evaluation findings

### E.1 Algorithm actually in use
`mad_sustained` (`correlate/onset_candidates_v2.py`) via `evaluate/tuning_analysis_4b.run_pipeline_with`. `correlate/pipeline.py`'s `run_pipeline` **cannot select it**: its `algorithm` argument draws only from the frozen Phase 4 `CANDIDATES` and defaults to naive `cusum`. The documented methodology ("frozen mad_sustained") therefore runs only through the duplicate orchestration in `tuning_analysis_4b.py`. The two implementations are separate copies of the same four stages. One existing test (`test_technical_view.py`) exercises the default `cusum` path.

### E.2 Frozen configurations
- Phase 4 (`frozen_config.json`, 2026-09-16T16:50:52Z): `mad`, `k_mad=5.0`, `δ_align=1.5 s`, unknown fraction 0.5.
- Phase 4b (`frozen_config_4b.json`): `mad_sustained`, `k_mad=5.0`, `min_run=3`, same δ and unknown threshold, `git_commit: 74c2395`. Its `mad_absfloor` vs `mad_sustained` tie was broken manually (disclosed). The file also records an unresolved limitation: loss/bandwidth were detected by none of the four candidates.

### E.3 Verification of the brief's reported figures
`held_out_results.json` (Phase 4, `mad`): false attribution 3/12 = 25% (CI 8.9–53.2%); exact 2/3; within-1 3/3; clean-control FP 2/4; precision 3/5; recall 3/8; Brier 0.432 (n=5). **All match the brief.** Gate (spec §10: within-1 ≥ 80%, FA ≤ 10%): FA fails. VERIFIED.

`held_out_results_4b.json` (`mad_sustained`, same 12 trials): FA 1/12 = 8.3% (CI 1.5–35.4%); exact 3/4; within-1 4/4 (CI 51–100%); clean FP 0/4; precision 4/4; recall 4/8; Brier 0.04 (n=4); `gate_check.overall_pass = true`. The numbers are arithmetically consistent with the per-trial rows. **Their validity is the problem** (E.4).

### E.4 Evaluation integrity (data-leakage review)
Provenance from file mtimes (IST) and git:

| Time | Event |
|---|---|
| 09-16 22:12–22:20 | `p4-tune-*` collected; `frozen_config.json` 22:20:52 |
| 09-16 22:22–22:30 | `p4-held-*` collected **after** the freeze; `held_out_results.json` 22:30:44 |
| 09-16 22:37 | `diagnose_phase4b.py` created. It loads `p4-held-06/10` (loss), `07/09` (bandwidth), `11/12` (unknown) and clean `01–03` with `gt.read_for_trial` labels |
| 09-17 01:33–01:39 | `p4b-tune-*` collected (new, separate data) |
| 09-17 01:42:03 / 01:42:55 | `frozen_config_4b.json` / `held_out_results_4b.json` (52 s after the freeze) |

- **Phase 4 held-out run: clean as far as the artifacts show.** Collected after the freeze (mtimes); `held_out_results.json` was written 30 s after the last trace; I found no evidence of earlier scoring (the repo cannot prove a negative).
- **Phase 4b validation: contaminated by design exposure.** The held-out traces and labels informed which candidates to build (a human-in-the-loop leak). The spec's own rule (§08) is that a poor held-out outcome is "reported as-is, not fed back to retune." The Phase 4b iteration was run at your explicit request in the earlier session, but the consequence is that the 12-trial set can no longer be called held-out.
- **Provenance is weak.** The freeze/validation ordering rests on mtimes and a `frozen_at` timestamp. The three Phase 4b commits were created within two minutes of each other after the fact, so git alone cannot prove ordering. A freeze has no tag.
- **Misstatements to correct:** `held_out_evaluation_4b.py` docstring ("never touched by any Phase 4b tuning decision"), and the UI copy ("generated once against 12 held-out trials", "PASSED", "Three real, held-out trials").
- **Label leakage surfaces other than the DB:** trial directory names encode fault type and hop (`p4-held-06-loss-hop4-severe`); `held_out_results*.json` (in the repo, readable by the engine identity because `/mnt/c` enforces no permissions) lists fault type and expected hop per trial; `demo-run-01/trial_meta.json` records `fault_hop` and `fault_delay_ms`. No engine code path reads these, but "ground truth isolated" is verified only for the DB file.
- **A documentation claim is false.** `demo/_run_engine_pipeline.py` and `demo/demo_script.md` say the engine process's import graph contains no ground-truth module. It imports `evaluate/tuning_analysis_4b.py`, which imports `groundtruth` and `metrics` (module import only; it never connects). `correlate/`, `present/`, `prober/`, `app/` do not import `groundtruth` (VERIFIED by grep). The real guard is the OS permission, not the import graph.
- The Phase 4 tuning set had `mad` at FA 2/12, within-1 4/4; held-out FA became 3/12 with clean FP 2/4. That generalization gap is evidence that tuning-set numbers overstate performance.

### E.5 Metric definitions: implementation vs spec
| Metric | Spec §09 | Implementation | Effect |
|---|---|---|---|
| False attribution | confident (high/medium) AND reported range **excludes** true hop, ÷ all trials | confident AND `range.min != expected_hop` (exact start), ÷ all trials | Stricter than spec: a range that includes the true hop but starts earlier counts as FA |
| FA denominator | all trials | all trials (12) | Per-claim view is 1/4 = 25% on Phase 4b. The 8.3% headline is diluted by the 4 clean controls and 4 silent trials |
| Within-±1 | ÷ detected trials | ÷ localized positive trials (n=4) | CI 51–100% cannot support an "≥80%" gate on its own |
| Calibration | reliability by confidence *decile*; top decile statistically > bottom | bins by *level*; `insufficient` bin counts correct abstentions as accuracy 1.0; no significance test | Top-vs-bottom test cannot pass: 4b high 1.0 vs insufficient 1.0 (Phase 4: high 0.5 vs insufficient 1.0, inverted) |
| Detection latency | `t_onset − t_start` | same | Not meaningful: onset is a 500 ms bucket start and `t_start` is logged before `tc` executes. Reported values are negative (mean −0.03 s) |
| Brier | not specified for abstentions | excludes no-claim trials | Reasonable and disclosed; n=4 |
| Hard gate | drop candidates with FP > 5% on clean controls | **not implemented** | With 4 clean controls one FP = 25%, so the 5% gate cannot even be resolved |

### E.6 Failure analysis and per-class breakdown (Phase 4b, held-out; point estimates only)
| Fault class | Trials | Localized | Exact first hop |
|---|---|---|---|
| latency | 1 | 1 | 1 |
| jitter | 3 | 3 | 2 (`p4-held-12`: reported hop 3–5, expected 2, scored FA; the true first-affected hop 2 was itself UNKNOWN) |
| loss | 2 | 0 | — |
| bandwidth | 2 | 0 | — |
| clean | 4 | 0 FP | — |

The "partially localized" showcase trial in the UI (`p4-held-12`) is an *evaluated false attribution*, but its UI blurb reads as a success.

### E.7 Why loss and bandwidth fail (exploratory, tuning data only; consistent with the Phase 4b note)
| Trial (tuning) | ping missing | ping RTT p50 / p95 / max (ms) | hop non-response |
|---|---|---|---|
| clean | 0/400 | 0.36 / 0.97 / 3.6 | 0% everywhere |
| loss 20% @hop1 | 0/700 | 0.43 / **278.5** / **1506.7** | hops 2–5: 5–8% (hop 1: 0%) |
| loss 5% @hop3 | 0/700 | 0.39 / 2.4 / 265.6 | hop4 2.9%, hop5 0.7% |
| bandwidth 100 kbit @hop2 | 0/700 | 0.37 / 1.0 / 3.5 | 0% |
| bandwidth 2 Mbit @hop4 | 0/700 | 0.38 / 1.0 / 4.2 | 0% |
| latency 100 ms @hop3 | 0/700 | 0.93 / 100.9 / 101.4 | ~0% |

- **Loss** is hidden from the app by TCP retransmission (no missing pings; it appears as RTT tail spikes and occasional multi-hundred-ms outliers) and shows as hop-probe non-response at downstream hops. The detector uses only bucket-mean RTT and never uses the response-fraction features it already stores. So loss is observable, but not in the feature the detector reads.
- **Bandwidth**: probe/ping load (my estimate: roughly 10–20 kbit/s, not measured) sits below even the 100 kbit cap, so there is no observable effect at all. These "positive" trials are indistinguishable from clean ones; this is a measurement-design limit, not an algorithm miss. For the held-out bandwidth trials (500 kbit) I did **not** look, to avoid exposure: UNKNOWN, verify on fresh tuning data.

### E.8 Experiment inventory (40 directories; ground truth shown only via the eval workflow)
| Group | Count | Role | Composition | Notes |
|---|---|---|---|---|
| `p3-*` | 6 | Exploratory (Phase 3 provisional) | latency, jitter×2, loss, bandwidth | 2 with `evidence.json`; used for the pilot only |
| `p4-tune-*` | 12 | Tuning (Phase 4) | 4 clean (incl. `-11` unknown-hop), 8 faulted | Fixed `mad` selection |
| `p4-held-*` | 12 | Held-out for Phase 4 → **exposed** by Phase 4b | 4 clean, 8 faulted | VERIFIED: all 36 raw/meta files unmodified since collection (latest mtime 09-16 22:30:15). But derived `evidence_4b.json` / `path_bundle.json` were later written into 3 of these directories (UI fixtures), so the directories were never sealed, and the set is no longer a valid holdout |
| `p4b-tune-*` | 10 | Tuning (Phase 4b) | 4 clean, 6 faulted (loss×2, bandwidth×2, jitter, latency) | Basis of the `mad_sustained` selection (only 2 localized trials) |
| `demo-run-01` | 1 | Demo (not an evaluation trial) | latency 90 ms @hop2 | **Two** ground-truth events share this ID (a discarded first run and the kept second). Raw data of the first run was overwritten; its label remains |

Raw files: every directory has non-empty `hop.jsonl`/`app.jsonl` (hop 290–700 lines, app 428–792). No schema validator exists, so "complete" means present and non-empty only. DB coverage: latency at hops {1,2,3} only; jitter, loss, bandwidth at hops {1,2,3,4}. `p4-held-12`/`p4-tune-12` have only 290/300 hop samples (silent hops stretch the sequential probe rounds, so cadence is not constant). No script reproduces any collection.

**Separation of evidence**
- *Verified results:* Phase 4 held-out failure; 116/116 unit tests; DB isolation; per-trial numbers in the two result files; the fault-physics statement for hop N+1.
- *Exploratory:* `p3-*` pilot; Phase 4b candidate scoreboard (n=10, two localized trials); E.7 raw-statistics check; the single `demo-run-01`.
- *Incomplete/missing:* independent holdout; spec Phase 5/5a; calibration test; collection scripts; Phase 1/2/3 gate artifacts; latency@hop4 coverage.
- *Currently unsupported claims:* "gate PASSED" as an independent result; "generated once"; "isolated import graph"; "No significant degradation" whenever the detector abstains; "healthy" for any hop merely without an onset; "high" confidence as evidence quality.

### E.9 Statistical limitations
n=12 held-out (8 positive, 4 claims); every rate carries a wide Wilson CI (e.g. FA 1.5–35%, within-1 51–100%, clean FP 0–49%). Single trial per cell; no repeated measures; imbalanced classes (1 latency trial); selection among candidates rested on two localized trials. The CIs in the result files are honest, but the gate comparison uses point estimates.

## F. Test and reproduction report

| Suite | Command (inside `su -s /bin/bash hoptrace-engine -c`, repo cwd) | Result |
|---|---|---|
| prober | `PYTHONDONTWRITEBYTECODE=1 python3 -B -m unittest discover -s prober/tests -p 'test_*.py'` | 9 OK |
| app | `… -s app/tests …` | 10 OK |
| correlate | `… -s correlate/tests …` | 38 OK |
| evaluate | `… -s evaluate …` | 16 OK |
| present | `… -s present/tests …` | 28 OK |
| faultctl | `… -s faultctl/tests …` | 15 OK |
| **Total** | | **116/116 pass**; DB mtime unchanged |

Safety assessment before running: `faultctl` tests mock `_run_tc`/`_interface_exists` and patch `gt.DB_PATH` to a temp directory, and I ran them unprivileged so a mis-patch could not write the real DB (it is `0640 hoptrace-truth`). Also run: `bash -n` on all 8 shell scripts (OK; no CRLF), live negative permission tests (denied for engine, readable-not-writable for eval), read-only ground-truth inventory.

**Not executed (and why):** topology build/verify, live prober/app, live fault injection, `demo/run_demo.sh` (mutate network state and the DB; no namespaces exist now). **Test gaps:** no live/integration test for prober or fault controller; no end-to-end pipeline test (`run_pipeline` is only used as a fixture generator); no UI/JS/browser test of any kind; isolation is exercised only inside `run_demo.sh`, not in the suite; `present/tests` depend on absolute paths and on `experiments/` fixtures; no test for the evaluation scripts.

## G. UI and demo gap analysis

| Area | Today (VERIFIED by earlier browser sessions and code reading) | Target | Gap |
|---|---|---|---|
| Data | `fetch('../experiments/.../path_bundle.json')`, 3 hardcoded trials; real numbers, no fabricated measurements | Live evidence per run | No backend/API; `demo-run-01`'s real bundle is not selectable. The live demo ends in a terminal and a JSON file |
| Contract | `EvidenceRecord` documented only in the spec HTML; `path_bundle` has no schema/version | Typed, versioned contract | No JSON Schema or validation |
| Result states | 4 locked states | 5 states incl. "Insufficient data" | No insufficient-data state; hop "healthy" means "no onset", which is not the same as measured healthy |
| Honesty | Limitations visible; evidence-bounded wording enforced | Same, accurate | "PASSED", "generated once", `p4-held-12` blurb, hardcoded "50% recall" / `k_mad` / `δ` copy that would silently go stale |
| Visual | Dark graphite, flat 1-row "3D" | Light mint, thick outlines, real depth, doodles | Full redesign (separate approved plan exists in the conversation) |
| Offline | Google Fonts + GSAP from CDNs; boot handler calls `gsap` first | Works offline | INFERRED: without the CDN the first `gsap` call throws and nothing else renders. Not executed |
| Motion/a11y | CSS blanket reduce-motion rule only; no `matchMedia`; hop-journey nodes have `role=button tabindex=0` but no handler; no `aria-live`; contrast not measured | `prefers-reduced-motion` honoured in JS; keyboard/AT parity | Gaps (contrast: UNKNOWN, run an automated audit) |
| Responsive | Checked at 375 px and 1440 px | Same | Acceptable; re-test after redesign |
| Launch | `.claude/launch.json` only | Documented command | Add to README |

**For a convincing end-to-end demo:** `run_demo.sh` needs a `trap` that removes the qdisc and kills the server on failure, a fresh trial ID per run (currently duplicates events), a manifest not stored in `trial_meta.json`, and a final step that writes the bundle where the UI can load it. The UI needs a "latest run" source. The demo must also be framed honestly: a favourable-regime (minority-fault) latency/jitter scenario, not a general proof.

## H. Prioritized issue register

| ID | Sev | Area | Evidence | Consequence | Recommended action | Depends on |
|---|---|---|---|---|---|---|
| HT-001 | P0 | Evaluation integrity | `diagnose_phase4b.py` L85–101 loads `p4-held-*` + labels; `held_out_evaluation_4b.py` docstring contradicts; same set reused | No independent evidence the frozen detector meets the gate; UI/docs overclaim | Declare `p4-held-*` exposed/exploratory; correct docstring and UI copy; collect a new sealed holdout (hash-manifested, unread until final) | — |
| HT-002 | P0 | Interpretation | `interpret.py` L66–68: no app-onset fact ⇒ "No significant degradation"; first demo run | Real faults can be reported as "no degradation" | Add an "insufficient data / baseline not established" state; distinguish abstention reasons (too few points, majority-window fault, unknown hops) | HT-018 for root cause |
| HT-003 | P1 | Confidence | `corroborating_fraction`=1.0 in 11/11 files; score = f(unknown count) | "High" implies strength it does not measure; spec calibration gate unmet; "Localized" is gated on it | Redefine from signal evidence (effect size, persistence length, alignment spread); calibrate on tuning data only; run the spec's top-vs-bottom test on the sealed holdout | HT-001 |
| HT-004 | P1 | Detection scope | E.6, E.7; 0/4 loss+bandwidth held-out and 0/4 tuning | Two of four classes unsupported; overall 50% recall conceals it | Add response-fraction/tail features for loss; add background load or de-scope bandwidth explicitly; report per-class results | HT-006, HT-009 |
| HT-005 | P1 | UI/doc claims | `index.html` "generated once…", `app.js` "PASSED", `p4-held-12` blurb, hardcoded stats | Overstates evidence | Replace with accurate, data-driven wording tied to the evidence ledger | HT-001 |
| HT-006 | P1 | Reproducibility | No collection scripts; unknown-hop mechanism unscripted; 10 files hardcode `/mnt/c/Users/REDACTED`; no README; GT DB single copy outside repo | Experiments cannot be re-created or moved; a WSL reset loses all labels | Collection harness (unique IDs, trap cleanup, firewall-hop support); relative/env paths; README; sealed label export (via eval) | — |
| HT-007 | P1 | Spec conformance | 12/12 trials vs 120/288; hard 5% FP gate absent; Phase 1/2/3 gate artifacts absent; `latency@hop4` never injected; ±50 ms logging unmeasured | Locked acceptance criteria unmet; scope reduction rationale exists only in `power_calc.py` | Decide and document an explicit scope contract; run the missing gates | — |
| HT-008 | P1 | Demo reliability | UI not wired to live output; CDN dependence; `run_demo.sh` has no cleanup trap, reuses one trial ID (2 events), leaves fault live until step 7 | A failed run leaves qdisc/processes; demo output not viewable | Harden script; vendor GSAP/fonts locally; serve latest bundle | HT-006 |
| HT-018 | P1 | Detector design | Global-window median/MAD (uses future data; fault >50% of window invisible); `onset` = bucket start (±0.5 s) | Retrospective only; blind spot and timing quantization | Baseline from a pre-fault/robust reference window; document precondition; evaluate on new tuning data | HT-001 |
| HT-009 | P2 | Isolation claims | DB isolation VERIFIED; label leakage via dir names, result JSONs, demo `trial_meta`; false "import graph" claim (`_run_engine_pipeline.py` L9, `demo_script.md` L51–52); sudoers `tc *` wildcard | Isolation is real for the DB but narrower than described; not a security audit | Opaque trial IDs + a sealed label manifest; correct the claims; tighten sudoers argument patterns; state threat model | — |
| HT-010 | P2 | Statistics | n tiny, imbalanced, candidate selection on 2 localized trials, manual tie-break | Low power; selection partly arbitrary | Larger/balanced tuning set; pre-register selection rule incl. tie-break | HT-006 |
| HT-011 | P2 | Metrics | E.5 deviations; latency metric invalid; calibration bins reward abstention | Reported metrics diverge from the spec | Align definitions or document them as amendments; fix latency | — |
| HT-012 | P2 | Accessibility/motion | E: no JS reduced-motion; dead `role=button`; no live regions | Fails stated quality bar | Fix in redesign; automated a11y audit | UI work |
| HT-013 | P2 | Git hygiene | `autocrlf=true`, no `.gitattributes`; OneDrive-hosted repo; no remote/tags; baseline commit lumps Phases 0–4; stray `.docx` | CRLF breaks scripts on a fresh Windows checkout; weak provenance; no off-machine backup | Add `.gitattributes` (`*.sh text eol=lf`); tag freezes; add a remote; keep the `.docx` out of the repo | — |
| HT-014 | P2 | Test gaps | F | Regressions in live paths/UI undetected | Add pipeline integration, isolation negative test, UI smoke test | — |
| HT-016 | P2 | Data contract | No schema/version for EvidenceRecord/path_bundle; "healthy" semantics | UI/engine drift; misleading status | JSON Schema + version + validator; rename "healthy" to a no-onset-observed status | — |
| HT-017 | P2 | Alignment | Persistence requires all downstream hops (unknown blocks upstream candidates); δ=1.5 s unvalidated | Partial results sensitive to silent routers | Treat unknown hops as non-informative in persistence; validate δ on tuning data | HT-001 |
| HT-015 | P3 | Code quality | `except Exception: pass` on close; `import select` in a loop; unbounded WS frame length; non-idempotent `setup_topology.sh`; per-probe timestamp captured before socket setup | Minor robustness | Clean up when touching those files | — |

## I. Completion roadmap (dependency-aware)

**Deviations from the order in the brief, and why.** (i) Reproducibility and an *evidence ledger* come first, because every later experiment needs scripts that can recreate it, and the existing holdout must be declared exposed before anyone cites it. (ii) A fresh holdout is **collected early but sealed unread** (hash manifest), so it cannot be contaminated by algorithm work, while algorithm work happens on separate new tuning data. (iii) The data contract/API precedes the UI redesign so the UI is built once against the real interface. (iv) UI work may proceed in parallel with algorithm work only as presentation of existing real bundles, and it must not display any gate claim until WP-6.

| WP | Objective | Files/components | Acceptance criteria | Tests/evidence | Risks/deps |
|---|---|---|---|---|---|
| **WP-1** | Truth-in-claims + reproducible baseline (no algorithm change) | Docs/copy, `.gitattributes`, path handling, README, tag, ledger | Clean clone runs unit tests with no path edits; README steps reproduce the environment; `p4-held-*` marked exposed everywhere; every false/overstated statement in HT-001/005/009 corrected | Fresh-clone test run; grep for absolute paths = 0; reviewer checklist | None; touches no frozen numbers |
| WP-2 | Trial-collection harness | New runner (generalising `run_demo.sh`), firewall-hop support, unique opaque trial IDs, cleanup traps | One command collects a trial end-to-end and leaves no residue; unknown-hop trials scripted; labels stored only in GT DB | Dry-run on 2 trials; verify qdisc/process cleanup after forced failure | WP-1 |
| WP-3 | Evaluation protocol + sealed holdout | Spec-aligned design (classes, magnitudes, load for bandwidth, balanced controls), sealed manifest with SHA-256 | Protocol document approved; holdout collected, hashed, unread; per-class N justified | Manifest verifies; no analysis script touches it | WP-2 |
| WP-4 | Detector/features on **new tuning data only** | `correlate/` (new versioned module, frozen files untouched), loss/bandwidth observables, baseline-robust onset | Pre-registered selection rule; per-class results with CIs; hard 5% FP gate implemented | Unit tests + tuning-set report | WP-3 (separation) |
| WP-5 | Confidence redefinition and calibration | `evidence`-successor, `evaluate/metrics.py` | Score reflects signal evidence; calibration test per spec §10 specified before use | Tuning-set reliability diagram | WP-4 |
| WP-6 | One-shot evaluation on the sealed holdout (spec Phase 5) | Evaluation harness | Metrics per spec §09 incl. unflattering ones; result reported as-is, no retuning | Immutable result + manifest hashes | WP-4, WP-5 |
| WP-7 | Data contract + thin API | JSON Schema, versioning, small stdlib server serving latest evidence/bundle | Schema validation in CI; UI reads only via the contract; "insufficient data" state added | Contract + integration tests | WP-5 (confidence meaning), HT-002 |
| WP-8 | UI redesign and implementation | `ui/` per the approved redesign plan | Real 3D, four hop states, reduced-motion, a11y audit passes, offline-capable (vendored assets) | Browser tests desktop/mobile, a11y tooling, reduced-motion test | WP-7 |
| WP-9 | End-to-end demo + regression | `demo/`, CI script | Demo uses harness, shows live result in UI, cleans up after failure | Full-suite run; demo run log; frozen-file diff | WP-2, WP-8 |
| WP-10 | Final documentation and honest limitations | README, report | All claims traceable to artifacts; limitations list generated from the result files | Claim-to-evidence table | all |

## J. Immediate next action

**WP-1 — "Truth-in-claims and reproducible baseline."** It changes no analysis, touches no frozen numbers, and unblocks everything else. It stops the project overstating its evidence (HT-001/005/009), makes the repo runnable from a clean clone (HT-006/013), and fixes the ground rules (exposed holdout, label handling) before any new data is collected. I would not start WP-2 or any algorithm work until the ledger and README exist, because new experiments would otherwise inherit the same ambiguity.

## Questions for you before WP-1

1. **Scope reduction (12/12 trials instead of 120/288):** disclosed in `power_calc.py`, but I cannot verify from the repo that you approved it. Keep it as an explicit, documented contract, or restore spec scale?
2. **Treat `p4-held-*` as permanently exposed/exploratory?** I recommend yes.
3. **Bandwidth faults:** add real background load to make them observable, or explicitly de-scope them from the localization claim?
4. **Phase naming:** adopt the spec's numbering (5 = evaluation harness, 6 = UI/demo) and rename the interpretability layer, or amend the spec?
