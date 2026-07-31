# UnivAI Exam System

## Standalone development

Standalone mode uses the real Mongoose models and a repository-owned MongoDB
7 container. The learner, course, four chapters, question banks, attempts,
manual-grading state, observable proctoring events, appeal, and webhook capture
all use fixed identifiers and an idempotent seed.

```powershell
npm install
npm run dev:standalone
# http://localhost:3200/dev

npm run standalone:seed
npm run smoke:standalone
npm test
npm run standalone:reset
npm run standalone:down
```

The same npm commands work on Linux. MongoDB listens on `127.0.0.1:27018`
and uses `univai_exams_standalone`. Reset refuses non-loopback hosts and
database names that do not contain `standalone`.

The seeded learner is `64b000000000000000000001` (`S-2026-000042`).
Scenario exam IDs end in `021` through `025` and cover not started, active,
submitted, pending manual grading, and flagged for human review. `/api/health`
reports mode, Mongo readiness, seed version, and webhook capture readiness.

Standalone scenario and capture routes require a signed local development
token and return 404 outside explicit standalone development. They are
disabled in production. Result webhooks with no configured URL are validated
and stored in the local `webhook_captures` collection.

## Integrated mode

`npm run dev` keeps the existing port `3200`, Mongo collections, App callback,
quiz/mid/final routes, and result webhook fields. Set `UNIVAI_MODE=integrated`
or leave it unset. Integrated mode never falls back to the deterministic seed.

## Proctoring policy

The supported observations are `no_face`, `multiple_faces`,
`fullscreen_exit`, `tab_switch`, `copy_paste`, and `devtools_open`.
Weights and the threshold remain in `src/lib/proctoring-config.ts`.
Crossing the threshold can set the backwards-compatible
`integrity_status=invalidated`, now explicitly described by
`policy_action=session_invalidated` and `review_status=pending`. This means a
configured session rule was applied and a person should review the evidence;
it is not an automatic finding of guilt.

Question selection stays unpredictable in integrated mode and uses a seeded
RNG only in standalone mode. At most 10% of a paper comes from
`self_study`; correct options remain stripped before submission.

`contracts/result-webhook.example.json` is the canonical consumer example.
Submission remains durable when webhook delivery fails.

This repository is mounted as a Git submodule. Merge changes here first, then
update the main UnivAI gitlink. Local submodule changes are not automatically
included in the main repository commit.

The examination platform of **UnivAI ("Jamieh")**: quizzes, midterms, browser
proctoring, integrity scoring and appeals — with results reported back to the
main app instead of shown to the student.

## Run it

```bash
npm install
npm run dev          # http://localhost:3200
```

Needs **MongoDB on :27017** (the UnivAI repo's `make up` starts it) and
`.env.local` with:

```
MONGODB_URI=mongodb://localhost:27017/univai_exams
UNIVAI_APP_URL=http://localhost:3100    # where "Back to UnivAI" buttons return
```

## What it does

- **Quizzes per chapter** and a **midterm across chapters**, assembled from a
  Mongo `question_banks` collection (UnivAI syncs each week's generated
  questions into it before every exam start)
- **Papers respect the 90/10 rule**: at least 90% of questions come from what
  the lecturer taught; book-only "self-study" questions are capped at 10%
- **Caller-controlled paper size**: `question_count` on the start endpoints
- **Proctoring**: camera and tab-switch events are weighted into a suspicion
  score; flagged sessions carry a full event report and can be appealed
- **No score at submit time** — the result + proctoring report are webhooked
  to the main app, which shows them on its dashboard/exams pages

## Where to look

| You want | Look in |
|---|---|
| the exam-taking UI | `src/app/exam/[examId]/` |
| business rules (assembly, 90/10, grading, integrity) | `src/lib/business-logic.ts` |
| the result webhook to UnivAI | `src/lib/report-webhook.ts` |
| API routes | `src/app/api/` (students, curricula, chapters, exams quiz/mid) |
| design docs & endpoint reference | `Model_Context/` |
| an end-to-end API exercise | `node api_test.mjs` (server must be running) |
