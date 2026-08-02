# Sprint 2 — Final Exam UAT Results

Date: 2026-08-02
Environment: standalone, seed `exam-standalone-v1`, server on port 3200,
chromium headless shell 151.0.7922.34.

## Summary

- Dataset validation: **PASS** — 56/56 valid cases, 10 categories.
- Mock evaluator: **PASS** — TOTAL 56 / PASS 3 / FAIL 0 / NOT RUN 53 (EXIT 0).
- Functional UAT: **PASS** — `tests/e2e/final-release.spec.ts` 8/8.
- Security UAT: **PASS** — `tests/security/public-release.spec.ts` 10/10.
- Repository gates: `npm run lint`, `npm run build`, `git diff --check` — PASS.

## Commands

```text
node tests/capstone/validate-dataset.mjs
-> ✅ All 56 cases pass schema validation.  (exit 0)

node tests/capstone/run-evaluation.mjs --mode configured
-> --mode must be 'mock' or 'real'         (exit 1, expected)

node tests/capstone/run-evaluation.mjs --mode mock --output evidence/final-release/evaluation-report-mock.json
-> TOTAL: 56  PASS: 3  FAIL: 0  NOT RUN: 53  (exit 0)

npx playwright test tests/e2e/final-release.spec.ts
-> 8 passed (1.3s)

npx playwright test tests/security/public-release.spec.ts
-> 10 passed (2.6s)

npm run lint   -> exit 0
npm run build  -> exit 0
git diff --check -> exit 0
```

## FR1-FR8 (functional)

| Gate | Outcome |
|---|---|
| FR1 health + 5 scenarios | PASS |
| FR2 book ingestion ready | PASS |
| FR3 one question at a time, no answer leak | PASS |
| FR4 answer flow accepted + idempotent | PASS |
| FR5 current-question contract | PASS |
| FR6 submit + graded + webhook capture | PASS |
| FR7 final locked until quizzes passed | PASS |
| FR8 recorded upstream -> real Exam boundary | PASS |

## S1-S10 (security)

| Gate | Outcome |
|---|---|
| S1 protected routes reject missing/invalid identity | PASS |
| S2 malformed start payloads -> 400 | PASS |
| S3 malformed answers -> 400, no advance | PASS |
| S4 stale revision / non-current question -> 409 | PASS |
| S5 idempotency replay no double-advance | PASS |
| S6 resubmit taken exam -> 409 | PASS |
| S7 unknown proctoring event -> 400 | PASS |
| S8 non-accusatory integrity messaging | PASS (LIMITED: contract + UI source; browser hydration unavailable) |
| S9 no secrets in tracked files | PASS |
| S10 rate-limit enforcement | NOT VERIFIED (annotated; no 429 on release line) |

## Machine-readable evidence

- `evidence/final-release/playwright-final-release.json` (8 expected, 0 unexpected)
- `evidence/final-release/playwright-security.json` (10 expected, 0 unexpected)
- `evidence/final-release/evaluation-report-mock.json`
- `evidence/final-release/health.json`
- `evidence/final-release/scenario-dashboard.png`

## Defects and limitations recorded

See `Model_Context/submission/defect-list.md` and `known-issues.md`.
