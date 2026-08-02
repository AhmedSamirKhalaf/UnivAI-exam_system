# Acceptance Map — UAI-M2-S2-06

Legend: VERIFIED = executed and passed; FAILED = executed and did not pass;
NOT VERIFIED = not executed or not observable; LIMITED = verified via an
equivalent check because the primary check is unavailable (reason given).

## Functional requirements

| Req | Result | Evidence |
|---|---|---|
| FR1 health + 5 seeded scenarios | VERIFIED | `playwright-final-release.json` FR1 |
| FR2 book ingestion ready | VERIFIED | FR2 |
| FR3 one-question-at-a-time, no answer leak | VERIFIED | FR3 |
| FR4 answer flow accepted + idempotent | VERIFIED | FR4 |
| FR5 current-question contract | VERIFIED | FR5 |
| FR6 submit + graded + webhook capture | VERIFIED | FR6 |
| FR7 final locked until quizzes passed (403) | VERIFIED | FR7 |
| FR8 recorded upstream -> real Exam -> capture | VERIFIED | FR8 |

## Security requirements

| Req | Result | Evidence |
|---|---|---|
| S1 protected routes reject missing/invalid identity | VERIFIED | S1 |
| S2 malformed start payloads -> 400 | VERIFIED | S2 |
| S3 malformed answers -> 400, no advance | VERIFIED | S3 |
| S4 stale revision / non-current question -> 409 | VERIFIED | S4 |
| S5 idempotency replay no double-advance | VERIFIED | S5 |
| S6 resubmit taken exam -> 409 | VERIFIED | S6 |
| S7 unknown proctoring event -> 400 | VERIFIED | S7 |
| S8 non-accusatory integrity messaging | LIMITED | exam UI hydration unavailable in this dev env; verified the API contract (`integrity_status=invalidated`, `review_status=pending`) and the rendered source copy |
| S9 no secrets in tracked files | VERIFIED | S9 |
| S10 rate-limit enforcement | NOT VERIFIED | no 429 on this release line; branch 11 hardening not merged (defect UAI-M2-S2-11-01) |

## Evaluator

| Item | Result |
|---|---|
| Dataset schema-valid 56/56, 10 categories | VERIFIED |
| Mock evaluator (3 recorded outputs) | VERIFIED — PASS 3 / FAIL 0 / NOT RUN 53 |
| `--mode configured` | FAILED — exits 1 with usage error (not implemented) |
| Real Agent outputs | NOT VERIFIED — requires `--agent-outputs` recorded file |

## Cross-system / release evidence

| Item | Result |
|---|---|
| Recorded-fixture App/Core/Agent/Live CI path (FR8) | VERIFIED |
| Configured production multi-repo journey | NOT VERIFIED — service URLs unavailable |
| TLS/production deployment | NOT VERIFIED — local dev server only |
| Repository gates (ci/lint/build/diff) | VERIFIED |

## Non-goals turned into annotations

- Browser-rendered exam page: `environment-limitation` annotation in S8;
  pre-existing `tests/e2e/exam-ui.spec.ts` fails identically, so this is not a
  regression introduced by this branch.
- Rate limiting: `not-verified` annotation in S10.
