"""Phase 5 — Result Interpretability Requirement, plain-language layer.

Pure function: EvidenceRecord (dict, exactly as produced by the frozen
correlate/evidence.py -- never recomputed, never re-inferred) ->
{result_state, plain_language}.

This module performs NO detection, NO alignment, NO confidence
computation, and imports nothing from correlate/ or faultctl/. It reads
only the already-frozen EvidenceRecord's own claims. This is what
guarantees it cannot silently invalidate the frozen Phase 4b evaluation
-- there is no code path here that could change a single number in it.

The four required result states and their EXACT locked strings (spec:
Phase 5 Result Interpretability Requirement). "Partially localized"
stays literal per the approved design decision -- no hop numbers in
the plain-language string for that state (the hop_range remains
available in present/technical_view.py's output alongside it).
"""
from __future__ import annotations

from dataclasses import dataclass

RESULT_LOCALIZED = "localized"
RESULT_PARTIALLY_LOCALIZED = "partially_localized"
RESULT_NOT_LOCALIZED = "not_localized"
RESULT_NO_DEGRADATION = "no_degradation"

# Locked, verbatim strings -- do not paraphrase these, and never add
# stronger language (any causal claim, any claim of certainty the
# EvidenceRecord doesn't support) anywhere in this module.
_TEMPLATES = {
    RESULT_LOCALIZED: "Degradation appears to begin at or after Hop {hop}.",
    RESULT_PARTIALLY_LOCALIZED: "We detected degradation, but the exact location is uncertain.",
    RESULT_NOT_LOCALIZED: "We detected application degradation, but couldn't establish a reliable network-path location.",
    RESULT_NO_DEGRADATION: "No significant degradation was detected during this test.",
}

_FORBIDDEN_SUBSTRINGS = ("caused", "is faulty", "is broken", "responsible for the lag")


@dataclass
class Interpretation:
    result_state: str
    plain_language: str
    hop_range: dict | None
    confidence_level: str


def _get_claim(evidence_record: dict, tag: str) -> dict:
    return next(c for c in evidence_record["claims"] if c["tag"] == tag)


def _app_onset_was_detected(evidence_record: dict) -> bool:
    return any(
        c["tag"] == "fact" and "Application ping RTT onset" in c.get("text", "")
        for c in evidence_record["claims"]
    )


def interpret_evidence(evidence_record: dict) -> Interpretation:
    inference = _get_claim(evidence_record, "inference")
    confidence = _get_claim(evidence_record, "confidence")
    hop_range = inference["hop_range"]
    level = confidence["level"]

    if not _app_onset_was_detected(evidence_record):
        state = RESULT_NO_DEGRADATION
        text = _TEMPLATES[state]
    elif hop_range is None:
        state = RESULT_NOT_LOCALIZED
        text = _TEMPLATES[state]
    elif level == "high":
        state = RESULT_LOCALIZED
        text = _TEMPLATES[state].format(hop=hop_range["min"])
    else:  # "medium" or "low"
        state = RESULT_PARTIALLY_LOCALIZED
        text = _TEMPLATES[state]

    result = Interpretation(result_state=state, plain_language=text,
                             hop_range=hop_range, confidence_level=level)
    _assert_no_forbidden_language(result.plain_language)
    return result


def _assert_no_forbidden_language(text: str) -> None:
    lowered = text.lower()
    for phrase in _FORBIDDEN_SUBSTRINGS:
        if phrase in lowered:
            raise AssertionError(
                f"interpret_evidence produced forbidden causal language ({phrase!r}) -- "
                f"this must never happen, refusing to return it: {text!r}"
            )
