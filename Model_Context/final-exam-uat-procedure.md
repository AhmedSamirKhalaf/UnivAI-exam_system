# Sprint 2 — Final Exam UAT Procedure

## Scope

This procedure exercises the final-release exam surface of the standalone
build and records cross-system release evidence for issue UAI-M2-S2-06:

1. the 56-case dataset and mock evaluator path (`tests/capstone`);
2. the functional exam journey (FR1-FR8) in `tests/e2e/final-release.spec.ts`;
3. the public security surface (S1-S10) in `tests/security/public-release.spec.ts`;
4. repository gates (`lint`, `build`, `git diff --check`);
5. an evidence record in `evidence/final-release/` and the submission gate in
   `Model_Context/submission/`.

The complete production `App -> Core/Agent -> Live -> Exam -> App` journey
requires configured service URLs and remains `NOT VERIFIED` when they are
unavailable. FR8 covers the issue's contract-first `recorded_fixture` CI path
against the real Exam HTTP API and is not mocked.

## Prerequisites

- Node.js 20+; `npm ci`.
- MongoDB on `127.0.0.1:27018` (database `univai_exams_standalone`) — start
  manually when Docker is unavailable.
- `npx playwright install chromium`.
- Optional overrides: `BASE_URL` (default `http://127.0.0.1:3200`),
  `DEV_TOKEN`, `UNIVAI_STANDALONE_SECRET`.

## 1. Start the isolated Exam environment

```bash
npm run standalone:seed
UNIVAI_MODE=standalone MONGODB_URI=mongodb://127.0.0.1:27018/univai_exams_standalone npx tsx server.ts dev
```

Wait for `/api/health` to report `ready: true`, `mode: "standalone"`, and
`seededScenarios: 5`.

## 2. Dataset and evaluator

```bash
node tests/capstone/validate-dataset.mjs
node tests/capstone/run-evaluation.mjs --mode mock --output evidence/final-release/evaluation-report-mock.json
```

Expected: 56 valid cases; mock summary `TOTAL 56 / PASS 3 / FAIL 0 / NOT RUN 53`.

Note: `--mode configured` is intentionally not supported; the runner exits 1
with `--mode must be 'mock' or 'real'`. Real runs require
`--mode real --agent-outputs <recorded-output.json>`.

## 3. Functional exam UAT

```bash
npx playwright test tests/e2e/final-release.spec.ts
npx playwright test tests/security/public-release.spec.ts
```

Run each file as its own invocation: the seeded per-student/per-chapter quiz is
shared, so parallel workers across the two files would collide. Expected: 8
passed then 10 passed.

## 4. Repository gates

```bash
npm run lint
npm run build
git diff --check
```

## 5. Record the result

Update `evidence/final-release/README.md` and `acceptance-report.md`, then the
`Model_Context/submission/` documents with the exact commands, counts, and any
new defects.

## Blocking criteria

- any FR1-FR8 or S1-S9 check fails;
- dataset has fewer than 50 valid cases or a missing category;
- a dependency is reported as passed when it was not executed;
- secrets are committed.

S10 (rate limiting) is a `NOT VERIFIED` annotation on this release line, not a
pass claim, and is tracked as a defect against branch 11.
