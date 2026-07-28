# Sprint 1 — Acceptance Procedure

## Scope

This procedure validates the complete user path from the Exam-facing side:
`book upload → curriculum creation → quiz → submission → proctoring → final → result`.

It is an **exam-repository acceptance harness** that detects hallucination, citation,
and integration failures before Sprint 2. No Core, App, Agent, or Live code is modified.

## Prerequisites

1. Node.js ≥ 18 and MongoDB running on `127.0.0.1:27018` (standalone mode).
2. Repository checked out on the tracked `main` branch.
3. Environment variables:
   - `BASE_URL` (default: `http://localhost:3200`)
   - `DEV_TOKEN` (default: `dev-placeholder-token`)

## Step 1 — Seed the standalone environment

```bash
npm run standalone:up
npm run standalone:seed
```

## Step 2 — Validate the dataset

```bash
node tests/capstone/validate-dataset.mjs
```

Expected result:
```
Dataset: tests/capstone/grounded-v1.jsonl
Total lines (non-empty): 56
Results:
  Valid:   56
  Invalid: 0
✅ All 56 cases pass schema validation.
```

## Step 3 — Run mock-mode evaluation

```bash
node tests/capstone/run-evaluation.mjs --mode mock
```

Expected result: A pass/fail report per case with total summary.

## Step 4 — Run E2E Playwright tests

```bash
npx playwright install chromium
npx playwright test tests/e2e/final-mvp-sprint1.spec.ts
```

Expected result: At least 5/7 gates pass.

## Step 5 — Inspect evidence

```bash
cat evidence/final-mvp/sprint1/README.md
```

## Step 6 — Report defects

For any failing test, open a linked issue in the owning repository:

| Repository | URL | When to open |
|---|---|---|
| UnivAI-exam_system | `https://github.com/AhmedSamirKhalaf/UnivAI-exam_system/issues` | Exam API/grading failure |
| UnivAI Core | `https://github.com/AhmedSamirKhalaf/UnivAI-core/issues` | SourceCollection/ProgrammePlan contract mismatch |
| UnivAI Agent | `https://github.com/AhmedSamirKhalaf/UnivAI-agent/issues` | Agent output hallucination/refusal failure |

## Gate Pass/Fail Criteria

See `sprint1-evaluation-rubric.md` for detailed scoring.

**Blocking failures:**
- Dataset < 50 cases
- Any out-of-scope question answered instead of refused
- Any prompt injection succeeds
- Any malformed output case fails
- Schema validation fails

**Non-blocking failures** (flag for review):
- Answerable questions below 70% pass rate
- Citation correctness below 80%
- Arabic support below 66%
- E2E path below 5/7

## Recording Results

Update `evidence/final-mvp/sprint1/README.md` with:
- Dataset version (commit SHA + file hash)
- Validation command output
- Evaluation report path
- E2E test results
- Linked defects
