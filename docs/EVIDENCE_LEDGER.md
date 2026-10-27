# HOPTRACE evidence ledger

Purpose: one place that says what each experiment set is, what it may and may
not be used for, and how the existing results may be cited. It records status;
it **does not change any result, label, raw file or frozen configuration**.
Everything here can be checked against `evaluate/*.json`, `experiments/` and
`git log`.

Decisions recorded 2026-10-14 (project owner):

1. The 12 tuning + 12 held-out trials are **not** the final research contract.
   All existing results are kept as historical evidence. A feasible evaluation
   scope (against the locked specification, with runtime and statistical
   limits) will be *proposed later*; no large evaluation is authorized.
2. `p4-held-*` is permanently **EXPOSED** for algorithm-development purposes.
   It is preserved unchanged and may be used for historical analysis and
   transparent reporting, but never to claim independent validation of a
   revised algorithm.
3. Bandwidth localization is not de-scoped, but is **unproven**: whether
   controlled background traffic plus a throughput-sensitive measurement can
   make bandwidth impairment observable is a future investigation (not
   authorized yet). Bandwidth claims stay qualified until implemented and
   independently validated.
4. Phase numbering follows the locked specification
   (`hoptrace-phase-0-5-spec.html`).

## Phase numbering

| Spec phase (authoritative) | What it is | State |
|---|---|---|
| 0 | Controlled testbed | Implemented; live gate log not persisted |
| 1 | Path probing | Implemented; spec gate artifacts not persisted |
| 2 | Application telemetry | Implemented; spec gate artifacts not persisted |
| 3 | Fault controller + ground truth | Implemented; isolation verified (OS permissions) |
| 4 | Correlation engine + algorithm selection | Engine implemented. **Phase 4 independent gate FAILED** (below). Frozen configuration exists but is not independently validated |
| 5a | Repeat-count pilot | Not done as specified (5-trial exploratory pilot only) |
| **5** | **Evaluation harness (full matrix) + calibration check** | **Not started** |
| **6** | **UI and demo** | Built early; the spec says Phase 6 must not start until the Phase 5 calibration check passes, which has not happened |

Labels used inside the code and commit history that do **not** match the spec
(historical; code comments are left as written):

| Label in code / commits | Meaning |
|---|---|
| "Phase 4b" | A diagnostic-and-retuning iteration run after the Phase 4 gate failed. Not a spec phase. |
| "Phase 5" in `present/*` and commit `c202be0` | The *result interpretability layer* (plain-language result states + technical view). **Not** spec Phase 5. |
| "Phase 6" in `present/path_bundle.py`, `ui/`, `demo/` | UI and demo — this one does match the spec's Phase 6. |
| "Phase 3" in `correlate/*` docstrings | The first provisional correlation pipeline (spec Phase 4 groundwork). |

## Experiment sets

| Set | Trials | Role | Status | May be used for | Must not be used for |
|---|---|---|---|---|---|
| `p3-*` | 6 | Exploratory (provisional pipeline, pilot) | EXPLORATORY | Sanity checks, effect-size intuition | Any reported accuracy |
| `p4-tune-*` | 12 | Tuning for Phase 4 (`mad` selected) | TUNING (historical) | Historical record | New validation |
| `p4-held-*` | 12 | Held-out for Phase 4 | **Phase 4: independent and clean. From Phase 4b on: EXPOSED** | Historical analysis; transparent reporting; illustrative UI/demo fixtures | Selecting, tuning or *validating* any algorithm after Phase 4 |
| `p4b-tune-*` | 10 | Tuning for Phase 4b (`mad_sustained` selected) | TUNING (historical) | Historical record | New validation |
| `demo-run-01` | 1 | Live demo run | DEMO | Demonstrating the pipeline | Evaluation (two ground-truth events share this ID; the first run's raw data was overwritten) |

Why `p4-held-*` is exposed (verifiable): `evaluate/diagnose_phase4b.py`
loads `p4-held-01..03, 06, 07, 09, 10, 11, 12` raw traces together with their
ground-truth labels. It was written before the Phase 4b detector variants
(`correlate/onset_candidates_v2.py`) existed (file times recorded by the
2026-10-14 audit: diagnose script 2026-09-16 22:37:32, variants 22:40:04). The
Phase 4b configuration was then scored on that same set
(`evaluate/held_out_evaluation_4b.py`). Note: the 2026-10-14 portability edit
(WP-1) changed the modification time of the `evaluate/` scripts; the times
above are from the audit, taken before that edit, and the history cannot be
reconstructed from git alone because the Phase 4b commits were created
within two minutes of each other after the work was done.

Integrity of the raw evidence: all 36 raw/meta files under `p4-held-*` have
modification times of 2026-09-16 22:22–22:30 (collection time) and were never
rewritten. Derived files (`evidence_4b.json`, `path_bundle.json`) were later
added inside three of those directories as UI fixtures; they are kept
unchanged. The directories were never sealed or read-only.

## Result ledger

| Result file | Configuration | Set | Status | Numbers (verbatim from the file) |
|---|---|---|---|---|
| `evaluate/held_out_results.json` | Phase 4, `mad` | `p4-held-*` (clean at the time) | **Independent. Gate FAILED** | false attribution 3/12 = 25% (limit ≤10%); clean-control false positives 2/4; exact first hop 2/3; within ±1 hop 3/3; recall 3/8; Brier 0.432 (n=5) |
| `evaluate/held_out_results_4b.json` | Phase 4b, `mad_sustained` (`k_mad=5.0`, `min_run=3`, δ=1.5 s) | same set, **exposed** | **Not independent.** Numeric thresholds met; `gate_check.overall_pass=true` is a computed field, not a validation | false attribution 1/12 = 8.3%; clean-control false positives 0/4; exact 3/4; within ±1 hop 4/4 (95% CI 51–100%); recall 4/8; Brier 0.04 (n=4) |

Per-class outcome of the Phase 4b configuration on the exposed set (from
`per_trial_detail`): latency 1 localized of 1; jitter 3 of 3 (one scored a
false attribution, `p4-held-12`, whose true first-affected hop was itself
UNKNOWN); loss 0 of 2; bandwidth 0 of 2. On the Phase 4b tuning set
(`frozen_config_4b.json`) loss and bandwidth were also 0 of 2 each.

## Claims: allowed and not allowed

Allowed (each is supported by the files above):
- "In Phase 4, before any retuning, the independent held-out run missed the false-attribution limit (3/12 = 25% vs ≤10%)."
- "The Phase 4b configuration scored 1/12 false attribution and 4/4 within ±1 hop on the original held-out set, which had been inspected during Phase 4b design; this is a historical record, not independent validation."
- "The detector localized latency and jitter trials in the exposed set and none of the loss or bandwidth trials."
- "Degradation appears to begin at or after Hop N." (evidence-bounded, as produced by the interpretability layer)

Not allowed:
- That the frozen detector "passed" or "was validated" on held-out/unseen data.
- That the held-out set was "never touched" or the result "generated once" in a sense implying independence.
- That a confidence level is a probability or is calibrated (it is a fixed heuristic; see `correlate/evidence.py`).
- That bandwidth impairments can be localized, or that loss can.
- That a specific router caused any degradation.

## Known limitations that change how results must be read (not fixed in WP-1)

- "No significant degradation was detected" means the detector found no onset. It can also occur for a real fault covering most of the observation window (global median/MAD baseline) or with too little data; there is no "insufficient data" state yet.
- `corroborating_fraction` is 1.0 whenever a range is reported, so the confidence level depends only on how many hops were UNKNOWN.
- The 12-trial sets are far below the spec's 120-trial tuning set and 288-cell evaluation matrix; the reduction is disclosed in `evaluate/power_calc.py`.
- The `evaluate/` scripts that produced the result files read ground truth and **overwrite** those files when run. They are historical and must not be re-run.

## Future work (recorded, **not authorized**)

- Propose a feasible evaluation scope against the locked specification, with expected runtime and statistical limitations (needs approval before any large run).
- Investigate whether controlled background traffic and a throughput-sensitive measurement make bandwidth impairment observable.
- Spec Phase 5: sealed evaluation set, evaluation harness, calibration check.
