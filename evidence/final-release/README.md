# Sprint 2 — Final Exam UAT + Cross-System Release Evidence

## Status

`VERIFIED WITH LIMITATIONS`

The final-exam UAT ran green on the standalone release (8/8 functional
requirements, 10/10 security checks) and the recorded-fixture cross-system
path crossed the real Exam HTTP boundary end to end. The browser-rendered
exam UI could not be exercised in this environment (see
`Model_Context/submission/known-issues.md`), so the UI checks verify the API
contract and the rendered source copy instead of a hydrated page. Rate-limit
enforcement is `NOT VERIFIED` on this release line because the Sprint 2
hardening branch (`11-uai-m2-s2-05`) is not merged here.

## Evidence index

| Artifact | What it shows |
|---|---|
| `evaluation-report-mock.json` | 56-case dataset scored with the three recorded fixture outputs: TOTAL 56 / PASS 3 / FAIL 0 / NOT RUN 53 |
| `playwright-final-release.json` | FR1-FR8 Playwright run: 8 expected, 0 unexpected |
| `playwright-security.json` | S1-S10 Playwright run: 10 expected, 0 unexpected |
| `scenario-dashboard.png` | Rendered `/dev` scenario dashboard (5 seeded scenarios) |
| `health.json` | `/api/health` live response |

## Environment

- No Docker: standalone MongoDB started manually on `127.0.0.1:27018`
  (`univai_exams_standalone`), seed `exam-standalone-v1`.
- Server: `UNIVAI_MODE=standalone MONGODB_URI=mongodb://127.0.0.1:27018/univai_exams_standalone npx tsx server.ts dev` on port 3200.
- Chromium headless shell 151.0.7922.34 via `npx playwright install chromium`.

## Commands and results

```text
node tests/capstone/validate-dataset.mjs
-> All 56 cases pass schema validation. (EXIT 0)

node tests/capstone/run-evaluation.mjs --mode configured
-> "--mode must be 'mock' or 'real'" (EXIT 1)

node tests/capstone/run-evaluation.mjs --mode mock --output evidence/final-release/evaluation-report-mock.json
-> TOTAL 56 / PASS 3 / FAIL 0 / NOT RUN 53 (EXIT 0)

npx playwright test tests/e2e/final-release.spec.ts
-> 8 passed (EXIT 0)

npx playwright test tests/security/public-release.spec.ts
-> 10 passed (EXIT 0)

npm run lint -> EXIT 0
npm run build -> EXIT 0
git diff --check -> EXIT 0
```

## Functional requirements (FR1-FR8)

1. standalone release healthy, five scenarios seeded;
2. book ingestion reaches ready;
3. quiz opens one question at a time, `correct_option` never leaks;
4. one-question answer flow accepted and idempotent (`idempotent` flag);
5. current-question contract: only the current question is exposed, future
   answers stay server-side (`progress.answered` and `answer_revision` agree);
6. submission is accepted, graded, and produces a trusted-result webhook
   capture (`/api/dev/webhooks`);
7. final exam stays locked (403) until every quiz is passed;
8. a versioned recorded upstream fixture (`programme-plan-v1`) crosses into a
   real Exam start, full one-question submission, and trusted-result capture.

## Security checks (S1-S10)

1. protected capture/attempt routes reject missing or invalid dev identity;
2. malformed start payloads -> 400;
3. malformed answer payloads -> 400 without advancing the attempt;
4. stale revision / non-current question -> 409;
5. idempotency-key replay does not double-advance;
6. re-submitting a taken exam -> 409;
7. unknown proctoring event type -> 400;
8. integrity messaging is non-accusatory (contract + UI source copy);
9. no secrets committed in tracked source/workflow files;
10. rate-limit enforcement `NOT VERIFIED` on this release line (annotated).

## NOT VERIFIED

- Configured production `App -> Core/Agent -> Live -> Exam -> App` journey
  (service URLs unavailable). The recorded-fixture CI path (FR8) is verified.
- Browser-rendered exam page (hydration stalls in this dev environment).
- Rate limiting / audit records (branch 11 hardening not merged).

See `acceptance-report.md` and `Model_Context/submission/` for the full
requirement-to-result map and defect list.
