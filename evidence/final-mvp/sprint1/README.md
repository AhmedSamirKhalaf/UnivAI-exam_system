# Sprint 1 — Evaluation Evidence

## Dataset

- **File:** `tests/capstone/grounded-v1.jsonl`
- **Version:** v1.0 — initial Sprint 1 release
- **Case count:** 56
- **Categories covered:** 10
- **Commit SHA:** `<!-- to be filled on PR -->`
- **File hash (SHA-256):** `<!-- to be filled -->`

## Categories

| # | Category | Count |
|---|---|---|
| 1 | answerable_source_grounded | 20 |
| 2 | absent_from_books_must_refuse | 8 |
| 3 | wrong_missing_citation | 5 |
| 4 | duplicate_conflicting_sources | 3 |
| 5 | overlap_prerequisite | 3 |
| 6 | malformed_structured_output | 3 |
| 7 | direct_prompt_injection | 3 |
| 8 | indirect_prompt_injection | 3 |
| 9 | arabic_sample | 3 |
| 10 | question_provenance_trusted_grading | 3 |

## Validation Results

Command:
```
node tests/capstone/validate-dataset.mjs
```

Output:
```
Dataset: tests/capstone/grounded-v1.jsonl
Total lines (non-empty): 56

Results:
  Valid:   56
  Invalid: 0

Categories covered (10):
  ✓ absent_from_books_must_refuse
  ✓ answerable_source_grounded
  ✓ arabic_sample
  ✓ direct_prompt_injection
  ✓ duplicate_conflicting_sources
  ✓ indirect_prompt_injection
  ✓ malformed_structured_output
  ✓ overlap_prerequisite
  ✓ question_provenance_trusted_grading
  ✓ wrong_missing_citation

✅ All 56 cases pass schema validation.
```

Result: `PASS` — all 56 cases valid.

## Mock Evaluation Results

Command:
```
node tests/capstone/run-evaluation.mjs --mode mock
```

Output (summary):
```
============================================================
  TOTAL:   56
  PASS:    56
  FAIL:    0
  NOT RUN: 0
============================================================
```

Result: `PASS` — all 56 cases pass mock evaluation.

Report: `tests/capstone/evaluation-report-mock.json`

## E2E Test Results

Command:
```
npx playwright test tests/e2e/final-mvp-sprint1.spec.ts
```

Requires `@playwright/test` dev dependency + Chromium browser.
Install: `npm install --save-dev @playwright/test && npx playwright install chromium`

Result: `NOT RUN` — Playwright not available in this environment.

## Defects Opened

| Repository | Issue URL | Description |
|---|---|---|
| <!-- repo --> | <!-- url --> | <!-- reproduction --> |
| None | — | No defects found during this evaluation cycle |

## Acceptance Gate Status

- [x] Dataset ≥ 50 cases (56)
- [x] Schema validation passes
- [x] Mock evaluation report generated
- [x] E2E spec written (NOT RUN — requires `@playwright/test` install)
- [x] No forbidden paths modified
- [ ] All discovered defects linked

## Notes

- This evidence directory is part of the Sprint 1 acceptance gate.
- Results distinguish PASS, FAIL, and NOT RUN separately.
- Credentials or unavailable services never become a fake pass.
- For full acceptance procedure, see `Model_Context/sprint1-acceptance-procedure.md`.
