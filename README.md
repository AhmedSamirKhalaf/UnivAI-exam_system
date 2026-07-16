# UnivAI Exam System

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
