# Integrity policy

Policy version: `univai-integrity-provisional-v1`

## Principle

The platform records observable events and risk, and may enforce the configured
session policy. It does **not** independently declare cheating. No API response
contains an autonomous model verdict such as "cheating detected". The closest
automated outcome is a configured session rule being applied
(`integrity_status=invalidated`, `policy_action=session_invalidated`) followed
by human review.

## Evidence and risk

- Raw observable events (`no_face`, `multiple_faces`, `fullscreen_exit`,
  `tab_switch`, `copy_paste`, `devtools_open`) are recorded in the append-only
  `IntegrityEvent` timeline and aggregated into `ProctoringEvent` documents with
  weights from `src/lib/proctoring-config.ts`.
- A session suspicion score crosses `suspicionThreshold` only by configured
  weights. Crossing it invalidates the session for **review**; it is not a
  finding of guilt.
- The separate versioned risk model
  (`docs/integrity-risk-model.md`) produces a 0-100 review-priority band
  (observe / review / high_review / protocol_lock), never a verdict.

## Audit trail

Every meaningful state change is written to the append-only `audit_logs`
collection via `src/lib/audit-log.ts`. Each entry is schema-validated and
records actor, action, resource, occurred-at time and the active policy version:

| Action | Trigger |
|---|---|
| `question.published` | Blueprint-grounded questions published against an approved blueprint. |
| `attempt.start` | Quiz / mid / final session started. |
| `attempt.submit` | Attempt submitted and graded (server-computed marks). |
| `grading.final` | Manual final grading recorded with the grader identity. |
| `integrity.session_invalidated` | Configured session rule applied at the threshold. |
| `integrity.appeal_resolved` | Appeal resolved (upheld / cleared) with the resolver identity. |

Entries never include answers, access tokens, attempt tokens or other secrets;
`writeAudit` refuses metadata keys that could carry them.

## Appeals boundary

A student whose session was invalidated may appeal. Only a person can resolve
the appeal (`resolveIntegrityAppeal`, reviewed by an admin/instructor). A
`cleared` resolution restores the attempt (`integrity_status=clean`) and, for
quiz/mid, recomputes pass/fail from the existing server grade. An `upheld`
resolution keeps the invalidation. Resolution is itself audited.

## Grades stay server-computed

Final grades are computed on the server from the stored question set and the
server-held answers. The client sends no grade; the browser cannot influence
the mark except through its legitimate answers. `gradeFinal` is the only manual
grade path and records the grader and regrade flag in the audit log.

## Known false-positive limitations

- **Browser signals are noisy.** Window blur, resize and fullscreen exits can be
  caused by OS focus changes, browser updates, popup blockers, or accessibility
  tooling, not by misconduct. Individual events are weighted, not accusatory.
- **Camera events are approximate.** Face detection is a coarse heuristic;
  lighting, occluded faces and camera permissions produce false `no_face`
  intervals. Duration-based camera events are capped
  (`maxAbsenceEventWeight`) and never label the learner.
- **Dedup windows hide repeats.** Discrete events are deduped within
  `duplicateEventWindowMs` (5 s), so the count of occurrences is a floor, not a
  ceiling, and does not measure intent.
- **Policy is provisional.** Weights and thresholds are operational heuristics
  for queue ordering, not calibrated probabilities. See
  `docs/integrity-risk-model.md` for the calibration plan.
- **Review before action.** Invalidation flags a session for a person; nothing
  in this repository permanently penalises a learner without human review.
