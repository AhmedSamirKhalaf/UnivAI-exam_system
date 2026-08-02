# Cross-System Status — UAI-M2-S2-06

## Paths

The full product journey is `App -> Core/Agent -> Live -> Exam -> App` across
multiple repositories. This gate can only exercise the Exam repository
directly, so it splits the journey into two verifiable claims.

## Recorded-fixture CI path (VERIFIED)

Issue-allowed `recorded_fixture` provider (`programme-plan-v1`,
`provider_mode: recorded_fixture`), driven by
`tests/e2e/fixtures/seed-state.json`:

1. source collection of ready PDF documents;
2. approved programme with courses referencing those documents;
3. a completed grounded lecture Q&A with cited sources;
4. an exam handoff (student, student_sid, chapter) crossing into the **real**
   Exam HTTP boundary:
   - `POST /api/exams/quiz/start` with the handoff;
   - the one-question-at-a-time answer flow through every question;
   - `POST /api/exams/:id/submit`;
   - trusted-result capture in `GET /api/dev/webhooks` matched by `exam_id`
     with `student_sid` and `chapter_id`.

Result: **VERIFIED** (FR8, 1/1).

## Configured production journey (NOT VERIFIED)

The configured `App -> Core/Agent -> Live -> Exam -> App` journey requires:

- the UnivAI App URL (tenant + grade routing), expected `UNIVAI_APP_URL`;
- the Core/Agent service URL (book ingestion, grounding), expected
  `RESULT_WEBHOOK_URL` counterpart and agent endpoints;
- a Live/agent provider with real recorded outputs (currently only the three
  recorded fixture outputs exist in `tests/e2e/fixtures/mock-agent-outputs.json`);
- a TLS/production deployment of the Exam service.

None of these URLs or a production deployment was available to this run, so:

- real 56-case Agent run: `NOT VERIFIED` (`--mode real` requires
  `--agent-outputs`);
- production App/Core/Agent/Live journey: `NOT VERIFIED`;
- TLS/production deployment checks: `NOT VERIFIED`.

These are recorded as `NOT VERIFIED`, never as passes. The webhook capture
mechanism the journey depends on is verified locally via
`GET /api/dev/webhooks`.
