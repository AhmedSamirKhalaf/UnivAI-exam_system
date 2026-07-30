# Sprint 1 — Evaluation Evidence

## Status

`PARTIAL`

The dataset, evaluator fixture path, and Exam HTTP boundary passed. A real
56-case Agent run and the complete App/Core/Agent/Live journey were not executed,
so this file does not claim full cross-system acceptance.

## Dataset

- File: `tests/capstone/grounded-v1.jsonl`
- Introduced by contributor commit: `541a59b513ea611e6328ef358ed3042db600f7d6`
- SHA-256: `7E88FC68D3B3EFEC611AFB7F61CFC57A5B2EBD46C777A646A3689F2A92E160EF`
- Cases: 56
- Categories: 10

| Category | Cases |
|---|---:|
| answerable_source_grounded | 22 |
| absent_from_books_must_refuse | 8 |
| wrong_missing_citation | 5 |
| duplicate_conflicting_sources | 3 |
| overlap_prerequisite | 3 |
| malformed_structured_output | 3 |
| direct_prompt_injection | 3 |
| indirect_prompt_injection | 3 |
| arabic_sample | 3 |
| question_provenance_trusted_grading | 3 |

## Commands reproduced during review

### Dataset validation

```text
node tests/capstone/validate-dataset.mjs
Valid: 56
Invalid: 0
Categories covered: 10
Result: PASS
```

### Recorded mock fixture evaluation

```text
node tests/capstone/run-evaluation.mjs --mode mock
TOTAL: 56
PASS: 3
FAIL: 0
NOT RUN: 53
Result: PASS for the three recorded fixture outputs
```

The original runner generated every answer from the case's expected answer,
which guaranteed 56/56. The reviewed runner now consumes recorded outputs and
marks missing outputs `NOT RUN`.

### Exam-facing Playwright journey

The reviewer used port 3214 because the user's existing checkout was already
serving port 3200:

```text
BASE_URL=http://127.0.0.1:3214 npx playwright test tests/e2e/final-mvp-sprint1.spec.ts
7 passed
Result: PASS
```

Covered gates:

1. standalone health and seed readiness;
2. book ingestion reaches ready;
3. quiz opens without answer leakage;
4. submission is accepted and graded;
5. proctoring observation is accepted for an active session;
6. final remains locked before all quizzes pass;
7. submission produces a trusted-result webhook capture.

### Repository checks

```text
npm test
5 passed

npm run lint
PASS

npm run build
PASS

git diff --check
PASS
```

## NOT RUN

- Real Agent responses for all 56 dataset cases.
- Complete `App → Core/Agent → Live → Exam → App` journey.
- Manual citation verification against the original book pages.

These need configured service URLs, approved source documents, and recorded
Agent outputs. They are not converted into mock passes.

## Defects and corrections

- PR harness used Mongo port 27017 instead of isolated standalone port 27018:
  corrected in review.
- Invalid placeholder development token caused protected calls to fail:
  corrected by deriving the standalone token.
- Two E2E gates could return early and appear passed:
  corrected; every unavailable or unexpected response now fails.
- Fixture curriculum IDs did not match the canonical seed:
  corrected.
- No production API/model/schema defect was found by the seven executed gates.

## Ownership check

- No `src/app/api/**`, `src/lib/**`, `src/models/**`, or `src/schemas/**` file
  was changed by PR #14.
- `@playwright/test` remains a dev dependency because the issue mandates
  `npm ci` followed by Playwright execution. This is the only package-manifest
  exception to the issue's test/documentation write set.
- No secrets are committed.
