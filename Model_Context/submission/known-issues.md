# Known Issues & Limitations — UAI-M2-S2-06

These are recorded facts about the release line and environment. None is
reported as a pass without execution.

## 1. Browser-rendered exam UI does not hydrate in this dev environment

Under `npx tsx server.ts dev` the Next/Turbopack dev client cannot establish
its `/_next/webpack-hmr` WebSocket (observed `ERR_INVALID_HTTP_RESPONSE`), so
the client bundle loads but hydration never completes and the exam page stalls
at "Preparing your exam…". No `pageerror` is raised; no API request is issued
by the component.

- Impact: the public exam page cannot be screenshot-tested here.
- Proof it is pre-existing, not a regression: `tests/e2e/exam-ui.spec.ts`
  (committed before this branch) fails identically at its first assertion, and
  `evidence/exam-ui/*.png` were produced in a working environment.
- Handling: S8 verifies the API contract that drives the non-accusatory UI and
  the rendered copy in `src/app/exam/[examId]/ExamRunner.tsx`, and records an
  `environment-limitation` annotation. The `/dev` scenario dashboard (server
  rendered) is captured in `evidence/final-release/scenario-dashboard.png`.
- Recommendation: run browser UI checks in CI or with a working HMR path
  (`next dev` directly, or a production build outside standalone mode).

## 2. Rate-limit and audit hardening is not on this release line

The Sprint 2 hardening branch `11-uai-m2-s2-05` (commit `f122290`: rate
limit, audit log, idempotency, request validation, Dockerfile,
`docs/deployment.md`) is **not merged** into `main`/branch 12. Its CI run
<https://github.com/AhmedSamirKhalaf/UnivAI-exam_system/actions/runs/30754383197>
**failed** at "Run API integration tests". Therefore:

- No observable 429 throttling on the Exam API (S10 `not-verified`).
- No audit record endpoint on this release line.
- Not converted into a mock pass; tracked as defect UAI-M2-S2-11-01.

## 3. Standalone dev identity is bound to the seeded student

`assertStandaloneRequest` verifies the HMAC token against the default
`STANDALONE_STUDENT_ID` (`64b000000000000000000001`). Attempt, answer, submit,
proctoring, and webhook routes reject any other identity with HTTP 500
`Valid standalone development identity is required`. This is why the UAT
drives the seeded student. It also means "fresh student" end-to-end flows
cannot be exercised in standalone mode without a server change.

## 4. Exam API contract is intentionally minimal in the launch view

The launch view exposes `current_question` (one at a time), `progress`,
`answer_revision`, `can_submit`, `attempt_token`, and `launch_url`. It never
exposes `generated_questions`, `correct_option`, `student_sid`, or
`chapter_id`. Submission takes no body; answers are read server-side.

## 5. Pre-existing stale acceptance spec

`tests/e2e/final-mvp-sprint1.spec.ts` (from Sprint 1) targets the old contract
and fails at G3 (`exam.generated_questions.length` is undefined); the serial
group then skips G4-G8. G1/G2 pass. It is out of scope for this branch but is
documented here so the failure is not mistaken for a regression.

## 6. Dev identity vs. route behavior notes

- `POST /api/exams/quiz/start` is not token-protected (200 without any dev
  identity) and requires `student_id` + `chapter_id` (400 otherwise); a numeric
  `student_id` yields a 500 Cast error rather than a clean 400.
- `GET /api/exams/:id` returns 500 (not 401/403) when the dev identity is
  missing or invalid; `GET /api/dev/webhooks` returns 403 in that case.
- Re-submitting a taken exam returns 409 `Exam session is not active`
  (guarded in `getServerStoredAnswers` before the "already submitted" branch).

## 7. Parallel-run caution

The seeded per-student/per-chapter quiz is a single document; `startQuiz`
resets it on each call. Running multiple Playwright files in parallel workers
that share a student+chapter collides, so the UAT runs each spec file as its
own invocation.
