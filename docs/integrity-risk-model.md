# Integrity risk model

The raw append-only `IntegrityEvent` timeline is the evidence source. The current production policy is deliberately named `univai-integrity-provisional-v1`: it produces a 0-100 **review priority**, not a probability of cheating and not an automatic punishment.

## Why this shape

The target trained model is an Explainable Boosting Machine (EBM) with selected pairwise interactions. Its additive main and pair contributions remain visible to reviewers, while pairs can express that two weak signals together carry more information than their separate effects. The recommendation follows the [InterpretML EBM research](https://arxiv.org/abs/1909.09223). A future probability must be calibrated on held-out UnivAI sessions and checked with reliability bins, Brier score, log loss, false positives, and false negatives. Probability calibration is described in [Predicting Good Probabilities With Supervised Learning](https://proceedings.mlr.press/v1/niculescu-mizil05a.html).

NIST's AI Risk Management Framework calls for documented measurement, monitoring, and human oversight. Accordingly, the implementation preserves model, feature-schema, calibration, and policy versions plus the exact top contributions used for each session. See the [NIST AI RMF](https://www.nist.gov/itl/ai-risk-management-framework).

## Provisional policy

These values are transparent operational heuristics for ordering a human review queue. They are not described as learned or scientifically calibrated. The base logit is `-3.2`; repeated main effects and pair effects are capped.

| Event | Per occurrence | Cap |
|---|---:|---:|
| Visibility hidden | 0.35 | 1.05 |
| Window blur | 0.15 | 0.45 |
| Fullscreen exit | 0.60 | 1.20 |
| Restricted shortcut | 1.40 | 2.80 |
| Context menu attempt | 0.50 | 1.00 |
| Each clipboard attempt kind | 1.10 | 2.20 |
| Drag start / drop attempt | 0.15 / 0.50 | 0.30 / 1.00 |
| Dimension suspicion | 0.00 | 0.00 |
| Duplicate attempt context | 1.80 | 1.80 |
| Print attempt | 1.20 | 2.40 |
| CSP violation | 1.50 | 3.00 |
| Heartbeat missed | 0.50 | 1.50 |
| Invalid heartbeat | 4.00 | 4.00 |
| Telemetry gap | 0.80 | 1.60 |
| Channel close | 0.10 | 0.30 |

| Pair within the stated window | Added contribution | Cap |
|---|---:|---:|
| Restricted shortcut + dimension suspicion, 30 s | 2.00 | 2.00 |
| Fullscreen exit + visibility hidden, 30 s | 1.00 | 2.00 |
| Copy or paste + duplicate attempt, 60 s | 2.20 | 2.20 |
| Invalid heartbeat + telemetry gap, 60 s | 4.00 | 4.00 |
| Missed heartbeat + channel close, 30 s | 1.50 | 3.00 |
| Restricted shortcut + context menu, 30 s | 1.00 | 2.00 |

The transformed priority is `round(100 * sigmoid(logit))`. Under `human-review-v1`, below 35 is observe, 35-69 is review, and 70 or above is high review. These are queue bands only. A noisy resize/dimension signal has zero main effect and cannot independently declare a violation. Only the separate versioned server protocol can lock an attempt for invalid/replayed signed heartbeats, duplicate sessions, or an expired heartbeat grace period.

## Stored explanation

Each refresh stores the feature schema, model, calibration, and policy versions, raw logit, review priority, optional calibrated probability, feature summary, and top main/pair contributions. Features cover counts, session duration, recency, 30-second repetition, recovery events, missed heartbeats, and co-occurrence. Server-side channel and heartbeat facts are written to the same append-only timeline; the client event schema cannot forge them.

## Labels and reproducible evaluation

Serious sessions need two independent reviewers. The adjudicated binary training target is `supported policy violation` versus `not supported`; uncertain or unresolved sessions stay outside model fitting and are reported separately. Splits must be grouped by learner and exam so the same learner cannot leak into training and validation. Browser, device class, network condition, and disclosed accessibility context are evaluation strata, never direct guilt features.

After a trained EBM and held-out calibration set exist, export predictions as:

```json
[
  { "session_id": "review-001", "label": 0, "probability": 0.12, "group": "firefox-desktop" },
  { "session_id": "review-002", "label": 1, "probability": 0.83, "group": "chrome-desktop" }
]
```

Run `npm run risk:evaluate -- labeled-predictions.json`. The deterministic JSON output contains overall and per-group Brier score, log loss, expected calibration error, reliability bins, and threshold confusion counts. Store the labeled-data snapshot hash, learner-grouped split seed, EBM configuration, calibration method, metrics, and selected policy thresholds with the new version before enabling `calibrated_ebm` mode. Until then, `risk_probability` remains unset.
