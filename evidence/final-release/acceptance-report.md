# Sprint 2 Final Release — Acceptance Report

Date: 2026-08-02
Branch: `12-uai-m2-s2-06-run-final-exam-uat-cross-system-release-evidence-and-submission-gate`
Base: `main` at `adb098c`
Mode: `standalone` (seed `exam-standalone-v1`)

## Legend

- `VERIFIED` — executed and passed in this run.
- `FAILED` — executed and did not pass.
- `NOT VERIFIED` — not executed or not observable on this release line.
- `LIMITED` — verified through an equivalent check because the primary check
  is unavailable in this environment (reason stated).

## Functional requirements

| Req | Result | Evidence |
|---|---|---|
| FR1 standalone health + 5 scenarios | VERIFIED | `playwright-final-release.json`; `health.json` |
| FR2 book ingestion ready | VERIFIED | same run, FR2 |
| FR3 one-question-at-a-time, no answer leak | VERIFIED | FR3: `current_question` only, `correct_option` undefined |
| FR4 answer flow accepted + idempotent | VERIFIED | FR4: `idempotent: false` then `true` on replay, answered unchanged |
| FR5 current-question contract | VERIFIED | FR5: server keeps future answers; `answer_revision` advanced |
| FR6 submit + graded + webhook capture | VERIFIED | FR6: `result.grading_status` + capture by `exam_id` |
| FR7 final locked until quizzes passed | VERIFIED | FR7: `POST /api/exams/final/start` -> 403 |
| FR8 recorded upstream -> real Exam | VERIFIED | FR8: `programme-plan-v1` fixture -> start -> submit -> capture with `student_sid`/`chapter_id` |

## Security requirements

| Req | Result | Evidence |
|---|---|---|
| S1 protected routes reject missing/invalid identity | VERIFIED | S1: webhooks 403, attempt not ok |
| S2 malformed start payloads -> 400 | VERIFIED | S2 |
| S3 malformed answers -> 400, no advance | VERIFIED | S3: answered stays 0, revision 0 |
| S4 stale revision / non-current question -> 409 | VERIFIED | S4 |
| S5 idempotency replay no double-advance | VERIFIED | S5 |
| S6 resubmit taken exam -> 409 | VERIFIED | S6 |
| S7 unknown proctoring event -> 400 | VERIFIED | S7 |
| S8 non-accusatory integrity messaging | LIMITED | API contract (`integrity_status=invalidated`, `review_status=pending`) + rendered UI source copy; browser hydration unavailable in this dev environment (see known-issues) |
| S9 no secrets in tracked files | VERIFIED | S9 |
| S10 rate-limit enforcement | NOT VERIFIED | No 429 observable; branch 11 hardening (`f122290`) not merged. Annotated `not-verified` with defect UAI-M2-S2-11-01 |

## Cross-system / release evidence

| Requirement | Result | Evidence |
|---|---|---|
| 56-case dataset schema-valid | VERIFIED | `validate-dataset.mjs` 56/56, 10 categories |
| Mock evaluator path | VERIFIED | `--mode mock` TOTAL 56 / PASS 3 / FAIL 0 / NOT RUN 53 |
| `--mode configured` | FAILED | throws `--mode must be 'mock' or 'real'` (EXIT 1) — defect |
| Recorded-fixture App/Core/Agent/Live CI path | VERIFIED | FR8 (real Exam HTTP, recorded provider) |
| Configured production multi-repo journey | NOT VERIFIED | Core/App/Agent/Live service URLs unavailable |
| Repository gates | VERIFIED | `npm ci`, `npm run lint`, `npm run build`, `git diff --check` all EXIT 0 |

## Overall gate

All blocking functional and security checks passed or are explicitly
annotated as `NOT VERIFIED`/`LIMITED` with the reason. No requirement is
reported as passed without execution. The release is **clear to submit**
with the defects and limitations recorded in `Model_Context/submission/`.
