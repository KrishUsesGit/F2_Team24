"""Phase 4: the five onset-detection candidates named in spec §08, all
behind the same detect_onset(series, t) -> OnsetResult | None contract
(spec §07). This is what the Phase 4 algorithm-selection experiment
compares — none of these is assumed to win going in (C3).

Candidate A (threshold_baseline_v1) is the deliberate strawman: naive
global mean/std, no robustness. Every other candidate must beat it on
the tuning set or it isn't a real improvement.

Candidate B (rolling_mad_v1) and Candidate C (provisional_cusum_v1) are
carried over unmodified from Phase 3 -- provisional_cusum_v1 is
byte-for-byte the same as onset.py's implementation (imported from
there, not reimplemented) so "no tuning based on Phase 3 data" is
structurally true, not just a promise.

Candidate D (bocpd_v1) is a genuine (simplified) Bayesian Online
Changepoint Detection: constant hazard rate, Normal-Gamma conjugate
prior over an unknown Gaussian mean/variance, flagging onset where the
run-length posterior's MAP estimate collapses with sufficient mass.
Pure stdlib (no numpy/scipy available in this environment).

Candidate E (pelt_v1) is an exact single-split dynamic-programming
search minimizing (segment Gaussian negative log-likelihood + BIC-style
penalty per split) -- the same objective PELT optimizes. Unpruned
O(n^2): for our series (40-70 points) this finds the identical answer
true PELT would; only PELT's pruning speedup (relevant for large n) is
absent, and that's a performance optimization, not a different result.

None of the constants below (k_std, k_mad, hazard, penalty multiplier)
were adjusted after seeing any evaluation result -- see the frozen
configuration record for what was actually selected and why.
"""
from __future__ import annotations

import math
import statistics as st

from onset import OnsetResult, MIN_VALID_POINTS, detect_onset as _cusum_detect_onset

METHOD_THRESHOLD = "threshold_baseline_v1"
METHOD_MAD = "rolling_mad_v1"
METHOD_CUSUM = "provisional_cusum_v1"
METHOD_BOCPD = "bocpd_v1"
METHOD_PELT = "pelt_v1"


def _valid(series, t):
    pairs = [(v, tt) for v, tt in zip(series, t) if v is not None]
    return [v for v, _ in pairs], [tt for _, tt in pairs]


# ---------------------------------------------------------------- A ---
def detect_onset_threshold(series, t, k_std: float = 5.0) -> OnsetResult | None:
    """Strawman: single global mean/std over the WHOLE series (including
    any later fault period), fixed k_std multiplier, first point over
    threshold wins. Deliberately non-robust -- this is what a "no
    thresholds without a changepoint model" (C3) rule exists to replace."""
    values, times = _valid(series, t)
    if len(values) < MIN_VALID_POINTS:
        return None
    mean = st.mean(values)
    std = st.pstdev(values) or 1e-9
    threshold = mean + k_std * std
    for v, tt in zip(values, times):
        if v > threshold:
            return OnsetResult(t_onset_ns=tt, confidence_raw=(v - mean) / std, method=METHOD_THRESHOLD)
    return None


# ---------------------------------------------------------------- B ---
def detect_onset_mad(series, t, k_mad: float = 5.0) -> OnsetResult | None:
    """Robust variant of the strawman: median/MAD instead of mean/std,
    still a single global baseline and a direct per-point threshold
    (no cumulative statistic, unlike CUSUM)."""
    values, times = _valid(series, t)
    if len(values) < MIN_VALID_POINTS:
        return None
    med = st.median(values)
    mad = st.median([abs(v - med) for v in values]) or 1e-9
    threshold = med + k_mad * mad
    for v, tt in zip(values, times):
        if v > threshold:
            return OnsetResult(t_onset_ns=tt, confidence_raw=(v - med) / mad, method=METHOD_MAD)
    return None


# ---------------------------------------------------------------- C ---
def detect_onset_cusum(series, t) -> OnsetResult | None:
    """Byte-identical to Phase 3's onset.detect_onset -- imported, not
    reimplemented, so this candidate cannot silently drift from what was
    already reported."""
    return _cusum_detect_onset(series, t)


# ---------------------------------------------------------------- D ---
def detect_onset_bocpd(series, t, hazard_lambda: float = 20.0, collapse_threshold: float = 0.6,
                        min_run_length_ns: int = 0) -> OnsetResult | None:
    """Simplified BOCPD (Adams & MacKay 2007): constant hazard H=1/hazard_lambda,
    Normal-Gamma conjugate prior (unknown mean AND variance), online run-length
    posterior via the standard recursion. Flags onset at the first time step
    where P(run_length <= 1) exceeds collapse_threshold -- i.e. the posterior
    has concentrated on "a changepoint just happened"."""
    values, times = _valid(series, t)
    n = len(values)
    if n < MIN_VALID_POINTS:
        return None

    # Normal-Gamma prior hyperparameters, set from the data's own overall
    # scale (weakly informative), NOT fitted per-trial after seeing results.
    overall_mean = st.mean(values)
    overall_var = st.pvariance(values) or 1e-6
    mu0, kappa0, alpha0, beta0 = overall_mean, 1.0, 1.0, overall_var

    H = 1.0 / hazard_lambda
    log_H = math.log(H)
    log_1mH = math.log(1.0 - H)

    # sufficient statistics per active run-length hypothesis
    mus = [mu0]
    kappas = [kappa0]
    alphas = [alpha0]
    betas = [beta0]
    log_R = [0.0]  # log posterior, run-length=0 at t=0 with prob 1

    def log_pred_prob(x, mu, kappa, alpha, beta):
        # Student-t predictive (from Normal-Gamma posterior), log density
        nu = 2 * alpha
        scale2 = beta * (kappa + 1) / (alpha * kappa)
        z = (x - mu) / math.sqrt(scale2)
        return (math.lgamma((nu + 1) / 2) - math.lgamma(nu / 2)
                - 0.5 * math.log(nu * math.pi * scale2)
                - (nu + 1) / 2 * math.log(1 + z * z / nu))

    for i, x in enumerate(values):
        n_hyp = len(log_R)
        log_pred = [log_pred_prob(x, mus[j], kappas[j], alphas[j], betas[j]) for j in range(n_hyp)]

        log_growth = [log_R[j] + log_pred[j] + log_1mH for j in range(n_hyp)]
        log_cp = _logsumexp([log_R[j] + log_pred[j] + log_H for j in range(n_hyp)])

        new_log_R = [log_cp] + log_growth
        norm = _logsumexp(new_log_R)
        new_log_R = [v - norm for v in new_log_R]

        new_mus = [mu0]
        new_kappas = [kappa0]
        new_alphas = [alpha0]
        new_betas = [beta0]
        for j in range(n_hyp):
            k1 = kappas[j] + 1
            mu1 = (kappas[j] * mus[j] + x) / k1
            a1 = alphas[j] + 0.5
            b1 = betas[j] + kappas[j] * (x - mus[j]) ** 2 / (2 * k1)
            new_mus.append(mu1)
            new_kappas.append(k1)
            new_alphas.append(a1)
            new_betas.append(b1)

        log_R, mus, kappas, alphas, betas = new_log_R, new_mus, new_kappas, new_alphas, new_betas

        # P(run_length <= 1): index 0 = just changed, index 1 = one step old
        p_recent_change = math.exp(_logsumexp(log_R[:2]))
        if i >= MIN_VALID_POINTS and p_recent_change > collapse_threshold:
            return OnsetResult(t_onset_ns=times[i], confidence_raw=p_recent_change, method=METHOD_BOCPD)

    return None


def _logsumexp(xs):
    m = max(xs)
    if m == float("-inf"):
        return m
    return m + math.log(sum(math.exp(v - m) for v in xs))


# ---------------------------------------------------------------- E ---
MIN_SEGMENT_SIZE = 8  # numerical-stability floor for variance estimation, distinct from
                       # MIN_VALID_POINTS ("enough data to run at all") -- a segment shorter
                       # than this gives an unstable variance estimate that can produce a
                       # spuriously low segment cost on pure noise. Fixed after finding exactly
                       # that failure mode on synthetic noise in this module's own unit tests
                       # (correlate/tests/test_onset_candidates.py) -- NOT tuned against any
                       # Phase 3/4 experimental data.


def detect_onset_pelt(series, t, penalty_mult: float = 3.0) -> OnsetResult | None:
    """Exact single-split search minimizing Gaussian segment cost + a
    BIC-style penalty (penalty_mult * log(n)) per split -- the same
    objective true PELT minimizes; unpruned O(n^2) since n is small
    here. No split is reported unless it beats the no-split cost by
    more than the penalty (this is what stops it from just picking
    noise)."""
    values, times = _valid(series, t)
    n = len(values)
    if n < MIN_VALID_POINTS:
        return None

    def seg_cost(vals):
        if len(vals) < 2:
            return 0.0
        var = st.pvariance(vals)
        if var <= 1e-12:
            return 0.0
        return len(vals) * math.log(var)

    penalty = penalty_mult * math.log(n)
    no_split_cost = seg_cost(values)

    min_seg = max(MIN_VALID_POINTS, MIN_SEGMENT_SIZE)
    best_cost = None
    best_split = None
    for split in range(min_seg, n - min_seg + 1):
        left, right = values[:split], values[split:]
        cost = seg_cost(left) + seg_cost(right) + penalty
        if best_cost is None or cost < best_cost:
            best_cost = cost
            best_split = split

    if best_split is None or best_cost >= no_split_cost:
        return None

    before_mean = st.mean(values[:best_split])
    after_mean = st.mean(values[best_split:])
    if after_mean <= before_mean:
        return None  # only interested in degradation onsets (an increase), not arbitrary shifts

    confidence_raw = (no_split_cost - best_cost) / penalty if penalty > 0 else 0.0
    return OnsetResult(t_onset_ns=times[best_split], confidence_raw=confidence_raw, method=METHOD_PELT)


CANDIDATES = {
    "threshold": detect_onset_threshold,
    "mad": detect_onset_mad,
    "cusum": detect_onset_cusum,
    "bocpd": detect_onset_bocpd,
    "pelt": detect_onset_pelt,
}
