# Release Checklist — UAI-M2-S2-06

## Blocking criteria

| Criterion | Status | Evidence |
|---|---|---|
| Dataset has >= 50 valid cases and all required categories | PASS | `validate-dataset.mjs` 56/56, 10 categories |
| Every FR1-FR8 functional gate passes | PASS | 8/8 `tests/e2e/final-release.spec.ts` |
| Every S1-S9 security gate passes | PASS | 10/10 `tests/security/public-release.spec.ts` (S10 annotated NOT VERIFIED, not a claim) |
| No dependency reported as passed without execution | PASS | S8 LIMITED + S10 NOT VERIFIED are explicit; cross-system `NOT VERIFIED` |
| No secrets committed | PASS | S9; `.env` untracked; scan of tracked files clean |
| Repository gates pass | PASS | `npm run lint`, `npm run build`, `git diff --check` exit 0 |
| Only test/documentation/evidence files changed | PASS | `git diff --name-only` limited to `tests/`, `Model_Context/`, `evidence/` |
| Webhook capture verifies the trusted result | PASS | FR6/FR8 capture match by `exam_id` + `student_sid` |

## Non-blocking follow-ups (recorded, not blocking)

- File defect UAI-M2-S2-11-01 (rate limiting) against branch 11 after its CI
  failure is fixed.
- Fix `--mode configured` in the capstone runner (UAI-M2-S2-06-02).
- Verify browser UI (S8) in an environment with a working HMR/hydration path.
- Obtain sibling-repository URLs to execute the configured multi-repo journey.

## Sign-off summary

Final-exam UAT and the recorded-fixture cross-system path pass. The gate
submits with defects/limitations explicitly recorded — none hidden, none
converted into mock passes.
