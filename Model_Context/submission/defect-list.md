# Defect List — UAI-M2-S2-06

Defects observed during this gate, or previously observed and relevant to this
release line. Owning branch is noted where known. None blocks the submission;
all are recorded honestly instead of being converted into passes.

| ID | Defect | Evidence / Repro | Owning branch |
|---|---|---|---|
| UAI-M2-S2-11-01 | Rate limiting is not implemented on this release line; no 429 observed. Sprint 2 hardening (RateLimiter + audit log) exists on `11-uai-m2-s2-05` but is not merged. | S10 `not-verified`; branch 11 CI run 30754383197 failed at "Run API integration tests". | 11-uai-m2-s2-05 |
| UAI-M2-S2-06-02 | `run-evaluation.mjs --mode configured` exits 1 with `--mode must be 'mock' or 'real'`; no configured mode exists. | `node tests/capstone/run-evaluation.mjs --mode configured` -> EXIT 1. | exam_system (capstone runner) |
| UAI-M2-S2-06-03 | `GET /api/exams/:id` returns HTTP 500 (not 401/403) when the dev identity is missing or invalid. | `curl GET /api/exams/64b000000000000000000022` without token -> 500. | exam_system (exam route error mapping) |
| UAI-M2-S2-06-04 | `POST /api/exams/quiz/start` with a numeric `student_id` returns HTTP 500 Cast error instead of a clean 400. | `data: { student_id: 123, chapter_id: "64b..." }` -> 500. | exam_system (start route input validation) |
| UAI-M2-S2-06-05 | Re-submitting a taken exam reports 409 `Exam session is not active` (guard order) rather than the intended "already submitted" conflict; the intent (409) is met but the message is misleading. | S6 (resubmit -> 409). | exam_system (submit path) |
| UAI-M2-S2-06-06 | Browser-rendered exam page cannot be verified in this environment (hydration stalls; `/_next/webpack-hmr` handshake fails under the custom `server.ts`). | `tests/e2e/exam-ui.spec.ts` and S8 page variant fail identically; no pageerror. | exam_system (dev server/tooling) |
| UAI-M2-S2-06-07 | Pre-existing stale Sprint 1 acceptance spec `tests/e2e/final-mvp-sprint1.spec.ts` fails at G3 on the one-question-at-a-time contract (then serial-skips G4-G8). | `npx playwright test tests/e2e/final-mvp-sprint1.spec.ts` -> G3 fails. | exam_system (Sprint 1 tests) |
| UAI-M2-S2-06-08 | Configured production App/Core/Agent/Live journey and TLS deployment are not verifiable: sibling-repository URLs and a production deployment are unavailable. | Cross-system status (see `cross-system-status.md`). | Multi-repo |
