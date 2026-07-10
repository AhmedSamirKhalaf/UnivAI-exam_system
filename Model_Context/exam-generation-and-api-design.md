# Exam Generation & API Layer — Design

Extends `schema-design.md`. That file is now the source of truth for how
book ingestion (Step 13) and on-the-fly question generation (Step 14) work,
including where everything is stored — this file only covers what's
**not** in there: the API endpoint list, and what's dummy vs. real.

Read `schema-design.md` first — this assumes everything in there already
exists, including the fact that `Exam` is a permanent, replaced-in-place
document per `(student, chapter)` for quizzes and per student for mids,
and that `generated_questions`/`student_answers` live directly on `Exam`,
not on `ExamSession`.

---

## Download / next exam

No new storage needed — this reads what's already on the `Exam` document.

```
GET /api/exams/:examId/download
  → fetch Exam (generated_questions, student_answers, mark, passed, etc.)
  → format as PDF or JSON: question, student's answer, correct answer
    (if applicable), mark, pass/fail
  → return as a file download
```

"Go to the next one" is just the client calling "start exam" again for the
next chapter's quiz (or the mid, or the final, whichever is next in the
gating sequence already defined in `schema-design.md`) — no new backend
concept, it's just calling the existing start-exam flow again.

---

## Rate-limiting retakes (LLM cost, not storage)

Storage isn't a growth concern anymore — `Exam` is replaced in place, not
accumulated (`schema-design.md` Step 4). But unlimited retakes still mean
unlimited `generateQuestions` calls, which becomes unlimited LLM cost once
real RAG is wired in. A light cooldown between attempts or a soft daily cap
solves that, if wanted — not required by the schema either way, just worth
deciding before real generation is live.

---

## API endpoints (thin wrappers around existing business-logic functions)

All routes assume Next.js App Router (`app/api/.../route.ts`). Auth is
still mocked (`student_id` passed directly for now — swap for real auth
later without changing these shapes).

| Method | Route | Calls | Notes |
|---|---|---|---|
| POST | `/api/books` | creates `Book`, kicks off `processBook` | body: `{ title, file, student_id? }` — `student_id` set if this book generates a personalized curriculum for one student (schema-design.md Step 1/13) |
| GET | `/api/books/:id` | returns `Book.status` | for polling ingestion progress |
| POST | `/api/enrollments` | creates `Enrollment` | usually auto-created by `processBook` for personalized curricula; also available directly for shared curricula |
| GET | `/api/curricula/:id/chapters` | lists `Chapter`s for a curriculum | |
| POST | `/api/exams/quiz/start` | `canStartExam` → finds-or-creates the one `Exam` doc for `(student_id, chapter_id)`, resets its content, calls `generateQuestions` | body: `{ student_id, chapter_id }`. If an Exam already exists for this pair, this call **replaces** its content (schema-design.md Step 4) |
| POST | `/api/exams/mid` | admin-only `createMid` | body: `{ curriculum_id, title, chapter_ids, passing_mark }` — batch-creates one permanent `Exam` per enrolled student |
| POST | `/api/exams/mid/:examId/start` | resets that student's existing mid `Exam` content, calls `generateQuestions` | for retaking a mid — same replace-in-place behavior as quiz |
| POST | `/api/exams/final/start` | `canStartFinal` → creates the one-and-only final `Exam` doc, calls `generateQuestions` (scope: curriculum) | body: `{ student_id, curriculum_id }`. Blocked if one already exists, unless an `IntegrityAppeal` with `allow_retake: true` applies |
| GET | `/api/exams/:examId` | returns the stored `Exam` doc (questions with `correct_option` stripped if not yet submitted, or full result if `taken: true`) | used to resume/view an in-progress or completed exam |
| POST | `/api/exams/:examId/submit` | grades (auto or pending_review) → triggers `notifyIntegrityInvalidation` if flagged (Step 10) | body: `{ student_answers }` |
| POST | `/api/exams/:examId/proctoring-event` | `recordDiscreteEvent` / `recordCameraEvent` | fired repeatedly during an active session |
| POST | `/api/exams/:examId/grade` (final only) | `gradeFinal` | teacher-only, for essay portions |
| GET | `/api/exams/:examId/download` | see above | |
| POST | `/api/appeals` | `resolveIntegrityAppeal` | admin-only |

---

## What's dummy today vs. real later

| Piece | Today | Later |
|---|---|---|
| `processBook` | fabricates fixed chapters | real chunk/embed/LLM pipeline |
| `generateQuestions` | fixed placeholder questions | RAG-grounded LLM generation |
| Everything else (schema, replace-in-place identity, gating, grading, proctoring, appeals, notifications) | fully real, same as already designed | unchanged |

The point of building the dummy versions first: the entire rest of the
system — enrollment, quiz/mid/final gating, grading, proctoring, appeals —
can be built and tested end-to-end right now, without waiting on a working
RAG pipeline. Swapping the two dummy functions for real ones later is a
contained, low-risk change.
