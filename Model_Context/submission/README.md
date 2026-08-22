# Submission Gate — UAI-M2-S2-06

Issue: **Run final Exam UAT + cross-system release evidence + submission gate**

## Result

`SUBMIT WITH DEFECTS`

- Final-exam UAT **passed** on the standalone release (FR1-FR8 8/8,
  S1-S10 10/10).
- The recorded-fixture cross-system path (FR8) crossed the real Exam HTTP
  boundary end to end and produced a trusted-result webhook capture.
- Repository gates (`lint`, `build`, `git diff --check`) passed.
- Two items are **not** passed as if they were: browser-rendered exam UI
  (hydration limitation in this dev environment) and rate-limit enforcement
  (Sprint 2 hardening branch not merged). Both are recorded as defects /
  limitations with exact reasons — see `defect-list.md`, `known-issues.md`.

## Documents

| Document | Content |
|---|---|
| `test-execution-report.md` | Exact commands, environments, and outputs |
| `acceptance-map.md` | Requirement-to-result map (VERIFIED / FAILED / NOT VERIFIED) |
| `known-issues.md` | Environment limitations and release-line facts |
| `defect-list.md` | Defects to file/own (with owning branch where known) |
| `release-checklist.md` | Blocking criteria and satisfaction |
| `cross-system-status.md` | App/Core/Agent/Live status |

## Ownership

- Only `tests/`, `Model_Context/`, and `evidence/` files were written by this
  branch; no `src/` change.
- `@playwright/test` remains a dev dependency (required by the issue).
- No secrets are committed.
