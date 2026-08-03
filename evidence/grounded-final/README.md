# Grounded Cumulative Final — Evaluation Evidence

## Status

`PASS`

A validated `FinalPackageV1` package was published against the standalone
`univai_exams_standalone` database, republished idempotently, delivered as a
12-question cumulative final, submitted for review, and manually graded. A
corrupted re-submission of the same package was rejected without persisting any
questions. See `tests/e2e/grounded-final.spec.ts`.

## Artifacts

| File | Meaning |
|---|---|
| `publication-accepted.json` | `201` receipt for the valid package (`status: accepted`, 12 `published_ids`, no defects). |
| `publication-rejected.json` | `422` receipt for the corrupted package (`status: rejected`, `published_ids: []`). |
| `final-graded.json` | Manual-grade view after grading (`result.grading_status: graded`). |
| `attempt-graded.json` | Exam attempt view returned by the grade endpoint. |

## Commands reproduced during review

```text
npx playwright test tests/e2e/grounded-final.spec.ts
1 passed

npx vitest run tests/lib/final-publication.test.ts
29 passed

npx vitest run tests/api tests/lib tests/ci
5 files, 55 passed

npm run lint
PASS

npm run build
PASS

git diff --check
PASS
```

## Ownership check

- Question generation is removed from the final path: `startFinal` draws only
  from published `QuestionProvenance` records (approved, learner-scoped,
  curriculum-scoped). An empty bank is an explicit start failure.
- No placeholders, no LLM calls, and no `|| true` fallbacks exist in the
  production diff.
- No secrets are committed.
