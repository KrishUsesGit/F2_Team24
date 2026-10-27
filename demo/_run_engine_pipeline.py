#!/usr/bin/env python3
"""Runs INSIDE the hoptrace-engine identity during demo/run_demo.sh.

Reproduces exactly the frozen Phase 4b invocation (mad_sustained,
k_mad=5.0, min_run=3 -- onset_candidates_v2.detect_onset_mad_sustained's
own defaults, unmodified) via evaluate/tuning_analysis_4b.run_pipeline_with,
the same helper used for the Phase 4b held-out scoring (an EXPOSED set;
see docs/EVIDENCE_LEDGER.md). Takes only file paths on the command line
and never opens the ground-truth DB. Note: evaluate/tuning_analysis_4b
does `import groundtruth` (module import only, no connection), so this
process's import graph is NOT free of that module -- isolation here is
the OS permission on the DB file, verified live by run_demo.sh step 0.
"""
import json
import sys

hop_path, app_path, trial_id, correlate_dir, evaluate_dir, out_path = sys.argv[1:7]
sys.path.insert(0, correlate_dir)
sys.path.insert(0, evaluate_dir)

from onset_candidates_v2 import detect_onset_mad_sustained
from tuning_analysis_4b import run_pipeline_with

record = run_pipeline_with(hop_path, app_path, trial_id, detect_onset_mad_sustained)
with open(out_path, "w") as f:
    json.dump(record, f, indent=2, default=str)
print(f"evidence record written by hoptrace-engine: {out_path}")
