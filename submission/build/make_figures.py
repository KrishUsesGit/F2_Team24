#!/usr/bin/env python3
"""Generate the measured-data figures used by the report and the deck.

Everything plotted here is read from files already in the repository
(experiments/*/hop.jsonl, app.jsonl, evaluate/*.json). Nothing is
simulated. The detector is run through the project's own modules
(correlate/synchronize.py, correlate/onset_candidates_v2.py) so the
onsets drawn match what the pipeline stores; the script asserts that the
recomputed onset agrees with the stored evidence file.

Run from the repository root:  python submission/build/make_figures.py
Requires matplotlib (a documentation-only dependency; not needed by the
project itself).
"""
from __future__ import annotations

import json
import os
import statistics as st
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "correlate"))

from synchronize import build_synchronized_timeline, load_app_samples, load_hop_samples  # noqa: E402
from onset_candidates_v2 import detect_onset_mad_sustained  # noqa: E402

OUT = os.path.join(ROOT, "submission", "figures")
os.makedirs(OUT, exist_ok=True)

INK, SOFT = "#14181a", "#3d4d55"
MINT, SIGNAL, STRUCT = "#e7eff2", "#2fd3e0", "#6a4dff"
HEALTHY, DEGRADED, UNKNOWN = "#b4ff3d", "#ff6b4a", "#ffd23f"

plt.rcParams.update({
    "font.family": "DejaVu Sans", "font.size": 10, "axes.edgecolor": INK,
    "axes.labelcolor": INK, "xtick.color": INK, "ytick.color": INK,
    "axes.linewidth": 1.6, "figure.facecolor": "white", "axes.facecolor": "white",
})


def _threshold(series, k=5.0):
    vals = [v for v in series if v is not None]
    med = st.median(vals)
    mad = st.median([abs(v - med) for v in vals]) or 1e-9
    return med + k * mad


def demo_run_figure():
    d = os.path.join(ROOT, "experiments", "demo-run-01")
    hop = load_hop_samples(os.path.join(d, "hop.jsonl"))
    app = load_app_samples(os.path.join(d, "app.jsonl"))
    buckets = build_synchronized_timeline(hop, app)
    t0 = buckets[0].t_start_ns
    t = [(b.t_start_ns - t0) / 1e9 for b in buckets]
    times = [b.t_start_ns for b in buckets]

    series = {"Application ping": [b.app_ping_rtt_ms for b in buckets]}
    for ttl in (2, 3):
        series[f"Hop {ttl} probes"] = [b.hop_rtt_ms[ttl] for b in buckets]

    onsets = {k: detect_onset_mad_sustained(v, times) for k, v in series.items()}

    # cross-check against the evidence file the pipeline stored
    ev = json.load(open(os.path.join(d, "evidence_demo.json")))
    stored = {}
    for c in ev["claims"]:
        if c["tag"] == "fact" and "onset detected" in c["text"]:
            stored[c["data_ref"]["series"]] = c["data_ref"]["t_onset_ns"]
    assert onsets["Application ping"].t_onset_ns == stored["app_ping"], "app onset mismatch"
    assert onsets["Hop 3 probes"].t_onset_ns == stored["hop_3"], "hop 3 onset mismatch"
    assert onsets["Hop 2 probes"] is None and "hop_2" not in stored, "hop 2 should have no onset"

    fig, axes = plt.subplots(3, 1, figsize=(7.4, 6.4), sharex=True)
    colours = [STRUCT, SIGNAL, SIGNAL]
    for ax, (name, ys), col in zip(axes, series.items(), colours):
        pts = [(x, y) for x, y in zip(t, ys) if y is not None]
        ax.plot([p[0] for p in pts], [p[1] for p in pts], color=INK, lw=1.2, marker="o",
                ms=2.6, mfc=col, mec=INK, mew=0.4)
        thr = _threshold(ys)
        ax.axhline(thr, color=SOFT, ls="--", lw=1.1)
        ax.text(0.4, thr * 1.35, f"median + 5·MAD = {thr:.3g} ms", fontsize=8, color=SOFT)
        on = onsets[name]
        if on is not None:
            x_on = (on.t_onset_ns - t0) / 1e9
            ax.axvline(x_on, color=DEGRADED, lw=2.2)
            ax.text(x_on - 0.4, ax.get_ylim()[1] if False else 0.5, "", color=DEGRADED)
            ax.annotate(f"onset +{x_on:.1f} s", (x_on, 0.9), xycoords=("data", "axes fraction"),
                        xytext=(-8, 0), textcoords="offset points", ha="right", va="top",
                        color=DEGRADED, fontsize=9, fontweight="bold")
        else:
            ax.annotate("no onset detected", (0.99, 0.9), xycoords="axes fraction", ha="right",
                        va="top", color=SOFT, fontsize=9, fontweight="bold")
        ax.set_yscale("log")
        ax.set_ylabel("RTT (ms)")
        ax.set_title(f"{name}  (mean per 500 ms bucket)", loc="left", fontsize=10, fontweight="bold")
        ax.grid(True, which="major", color="#d3e3e6", lw=0.8)
    axes[-1].set_xlabel("time into the observation window (s)")
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "fig_demo_run_series.png"), dpi=200)
    plt.close(fig)
    print("wrote fig_demo_run_series.png; onsets:",
          {k: (None if v is None else round((v.t_onset_ns - t0) / 1e9, 2)) for k, v in onsets.items()})


def phase_comparison_figure():
    p4 = json.load(open(os.path.join(ROOT, "evaluate", "held_out_results.json")))["summary"]
    p4b = json.load(open(os.path.join(ROOT, "evaluate", "held_out_results_4b.json")))["summary"]
    rows = [
        ("False attribution\n(target ≤ 10%)", "false_attribution_rate"),
        ("Clean-control\nfalse positives", "clean_control_false_positive_rate"),
    ]
    fig, ax = plt.subplots(figsize=(6.6, 3.3))
    w = 0.34
    for i, (label, key) in enumerate(rows):
        a, b = p4[key], p4b[key]
        ax.bar(i - w / 2, 100 * a["rate"], w, color=DEGRADED, edgecolor=INK, lw=1.6)
        ax.bar(i + w / 2, 100 * b["rate"], w, color=UNKNOWN, edgecolor=INK, lw=1.6, hatch="//")
        ya = 100 * a["rate"] + 1.5
        yb = 100 * b["rate"] + 1.5
        if 6 < yb < 16:          # keep the label clear of the 10% target line
            yb = 12.0
        ax.text(i - w / 2, ya, f'{a["numerator"]}/{a["denominator"]}\n= {100*a["rate"]:.1f}%',
                ha="center", fontsize=8.5, fontweight="bold")
        ax.text(i + w / 2, yb, f'{b["numerator"]}/{b["denominator"]}\n= {100*b["rate"]:.1f}%',
                ha="center", fontsize=8.5, fontweight="bold")
    ax.axhline(10, color=INK, ls="--", lw=1.2)
    ax.text(1.58, 10.6, "10% target", ha="right", fontsize=8.5)
    ax.set_xticks(range(len(rows)))
    ax.set_xticklabels([r[0] for r in rows])
    ax.set_ylabel("% of trials")
    ax.set_ylim(0, 78)
    ax.set_xlim(-0.6, 1.6)
    ax.grid(axis="y", color="#d3e3e6", lw=0.8)
    ax.set_axisbelow(True)
    from matplotlib.patches import Patch
    ax.legend(handles=[Patch(fc=DEGRADED, ec=INK, label="Phase 4, mad: independent run"),
                       Patch(fc=UNKNOWN, ec=INK, hatch="//", label="Phase 4b, mad_sustained: EXPOSED set")],
              loc="upper left", fontsize=8, frameon=True)
    fig.tight_layout()
    fig.savefig(os.path.join(OUT, "fig_phase4_vs_4b.png"), dpi=200)
    plt.close(fig)
    print("wrote fig_phase4_vs_4b.png")


if __name__ == "__main__":
    demo_run_figure()
    phase_comparison_figure()
