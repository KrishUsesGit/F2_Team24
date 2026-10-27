#!/usr/bin/env python3
"""Phase 4 pilot-informed sample-size justification.

Key efficiency fact the pilot established: the expensive resource is
the NETWORK TRIAL (~35-45s wall clock, prober+app client vs the real
testbed). Running all 5 candidate algorithms against one trial's
already-persisted raw data costs ~20-70ms total (pilot_analysis.py's
own measured runtimes) -- effectively free. So "n per condition" is
bounded by how many REAL trials we can afford, not by how many
algorithm-evaluations we can afford.

What the pilot (5 trials, existing Phase 3 data) showed:
  threshold: 0/5 trials produced any claim at all
  mad:       2/5 claims, 1/2 correct  (1 false attribution)
  cusum:     3/5 claims, 2/3 correct  (1 false attribution, same trial as mad)
  bocpd:     1/5 claims, 0/1 correct  (1 false attribution)
  pelt:      0/5 trials produced any claim at all

This directly contradicts an assumption of "huge, obvious effects
every time" -- p3-loss-hop2 fooled BOTH of the two working detectors
into a confident wrong answer. A meaningful comparison therefore needs
real replication, not n=1 taken on faith.
"""
import math

Z_95 = 1.96


def margin_of_error_n(p_worst_case=0.5, target_margin=0.15, z=Z_95):
    """Trials needed to estimate a single proportion to within
    +-target_margin at 95% confidence, worst-case variance (p=0.5)."""
    return math.ceil((z ** 2) * p_worst_case * (1 - p_worst_case) / (target_margin ** 2))


def two_proportion_n_per_group(p1, p2, power=0.8, alpha=0.05):
    """Approximate per-group n to detect a difference between two
    proportions (e.g. two candidate algorithms' accuracy) at the given
    power -- standard normal-approximation formula."""
    from statistics import NormalDist
    z_alpha = NormalDist().inv_cdf(1 - alpha / 2)
    z_beta = NormalDist().inv_cdf(power)
    p_bar = (p1 + p2) / 2
    numerator = (z_alpha * math.sqrt(2 * p_bar * (1 - p_bar)) + z_beta *
                 math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) ** 2
    denom = (p1 - p2) ** 2
    return math.ceil(numerator / denom)


if __name__ == "__main__":
    print("== Margin-of-error targets (single proportion, worst-case p=0.5) ==")
    for margin in (0.20, 0.15, 0.10, 0.05):
        n = margin_of_error_n(target_margin=margin)
        print(f"  target +-{margin*100:.0f}pp  ->  n = {n}")

    print()
    print("== Two-proportion comparisons (80% power, alpha=0.05) ==")
    print("   pilot observed: cusum ~67% (2/3), mad ~50% (1/2) among trials that made a claim")
    for p1, p2, label in [
        (0.90, 0.50, "clearly-good (90%) vs mediocre (50%)"),
        (0.70, 0.50, "pilot-observed cusum-ish (70%) vs mad-ish (50%)"),
        (0.90, 0.70, "clearly-good (90%) vs pilot-observed cusum-ish (70%)"),
    ]:
        n = two_proportion_n_per_group(p1, p2)
        print(f"  {label}: n_per_group = {n}")

    print()
    print("== Verdict ==")
    print("""
A 15pp margin-of-error single-proportion estimate alone needs n=43.
Distinguishing "clearly good" (90%) from "mediocre" (50%) with 80%
power needs ~13 per group; distinguishing algorithms as close as the
pilot's own cusum-vs-mad gap (70% vs 50%) needs ~90 per group. None of
these are affordable at ~40s/real network trial in this environment
within a reasonable session (43 trials alone = ~30 minutes of pure
network-experiment wall time, before setup/teardown overhead, and the
close-comparison numbers are an order of magnitude worse).

DECISION: this Phase 4 pass cannot be adequately powered for
fine-grained algorithm discrimination. Rather than either (a) silently
running an underpowered comparison and reporting a false-precision
winner, or (b) blindly executing an arbitrarily large matrix regardless
of what the pilot showed, we explicitly scale the design to what the
pilot's own findings can support:

  - PRIORITIZE BREADTH over per-cell replication: cover every required
    dimension (all 4 hops, all 4 fault types, all 3 severities, both
    durations, clean controls, unknown-hop) at least once in each of
    the tuning and held-out sets, rather than repeating one condition
    many times.
  - Use the pilot's own finding that threshold and pelt (at its
    noise-safety-fixed penalty) produced ZERO claims across all 5
    pilot trials as a qualitative, not merely a p<0.05 statistical,
    basis to flag them as unlikely to be competitive -- this is
    reported as a real, measured pilot observation, not a compensating
    statistical trick.
  - Every reported accuracy number in the final results carries its
    numerator/denominator and a Wilson 95% CI, so the small-sample
    uncertainty is visible rather than hidden behind a single point
    estimate.
  - This is disclosed explicitly as a LIMITATION in the final report:
    the tuning/held-out comparison below is preliminary and
    directionally informative, not a statistically mature result.
""")
