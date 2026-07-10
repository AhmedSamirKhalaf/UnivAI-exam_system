# Exam Platform — App Flow & Schema Reasoning (for developers)

This document explains **why** the schema in `schema-design.md` looks the way
it does, and walks through the actual user flows so a new developer can
understand how the pieces fit together without reverse-engineering it from
the field tables alone.

Read this alongside `schema-design.md` — that file is the source of truth for
exact fields/types; this file is the "how it all connects" narrative.

---

## The core idea in one sentence

A student enrolls in a **Curriculum**, must pass a **quiz for every Chapter**
before they can unlock the **Final**, and every exam attempt (quiz, mid, or
final) is proctored and logged as its own document, separately from the
result of that attempt.

---

## 1. Enrollment — the front gate

Nothing exam-related happens for a student until they have an `Enrollment`
document for a `Curriculum`. This is checked first, before any other rule,
in every "can this student start this exam" check.

```
Student wants to start ANY exam (quiz/mid/final)
  → check: does an Enrollment(student, curriculum) exist and status = "active"?
    → no  → reject, student isn't enrolled
    → yes → continue to type-specific checks (below)
```

Why this exists as its own collection instead of a flag on Student: a
student can be enrolled in more than one curriculum, and enrollment has its
own lifecycle (`active`/`completed`/`withdrawn`) independent of exam
progress.

---

## 2. Taking a quiz (per-chapter, retakeable)

```
Student picks a Chapter → starts its quiz
  → new Exam document created:
      type: "quiz", attempt_number: (previous + 1), taken: false
  → new ExamSession document created (1:1 with that Exam):
      status: "in_progress", suspicion_score: 0
  → proctoring starts (face detection interval, tab/fullscreen/devtools listeners)
  → student answers MCQs, submits
  → Exam.mark computed instantly (auto-graded, no human involved)
  → Exam.grading_status = "auto_graded"
  → Exam.passed = (mark >= passing_mark)
  → Exam.taken = true
  → ExamSession.status = "completed", ended_at = now
```

**Retakes:** the student can start the same chapter's quiz again at any
time. This creates a **new** `Exam` document (`attempt_number` incremented),
not an update to the old one. Old attempts are never deleted — they stay as
history.

**"Did the student pass chapter X?"** always means: look at their **most
recent** `Exam` of type `"quiz"` linked (via `ExamChapter`) to chapter X, and
check `passed` on that one document. Earlier attempts don't count, even if
one of them passed and a later retake failed.

---

## 2b. Creating a mid (admin-driven, before students can take it)

Unlike a quiz — which a student spins up themselves for one chapter — a
`"mid"` is set up by an admin ahead of time, covering whatever chapters the
admin explicitly picks.

```
Admin creates a mid:
  → submits: curriculum_id, title, chapter_ids: [explicit list], passing_mark
  → server validates every chapter_id belongs to that curriculum
  → for every actively enrolled student in that curriculum:
        create an Exam (type: "mid", attempt_number: 1, taken: false)
        create one ExamChapter row per chapter_id, linked to that Exam
  → students see the mid appear as available once their Exam doc exists
```

The chapter selection is **explicit**, not a computed range — if the admin
wants "chapters 1 through 5," they pass all five ids directly. There's no
`from`/`to` shortcut baked into the data model; if that convenience is
wanted later, it can be a pure UI/form feature that resolves to the same
explicit `chapter_ids` array server-side, without touching the schema.

---

## Future work (not built yet): student-initiated custom quizzes

Eventually, a student might request their own practice quiz on a set of
chapters they pick themselves (e.g. "just chapters 2 and 4"), separate from
the required one-quiz-per-chapter that gates the final. This is intentionally
**not implemented now** — flagged here so it's easy to pick up later without
relitigating the design:

- Would likely be a new `Exam.type` value (e.g. `"custom_quiz"`), reusing the
  same multi-chapter `ExamChapter` linking pattern as `"mid"`, but
  student-initiated instead of admin-initiated.
- Must NOT count toward the final-unlock check — only the required
  `"quiz"` type does.
- Open question for whenever it's built: auto-graded with its own
  `passing_mark`, or purely informational/no pass-fail?

---

## 3. Unlocking and taking the final

```
Student requests to start the Final for a Curriculum
  → check: enrolled in this curriculum? (see #1)
  → check: for EVERY chapter in the curriculum —
        does the student's most recent quiz attempt for that chapter
        have passed = true?
    → any chapter missing/failed → reject, show which chapters are still needed
    → all chapters passed → allow starting the final
  → new Exam document created:
      type: "final", attempt_number: 1 (always — one-shot), taken: false
  → new ExamSession created, proctoring starts (same as quiz flow)
  → student answers (MCQ + possibly essay questions), submits
  → Exam.taken = true
  → Exam.grading_status = "pending_review"   ← different from quiz!
  → Exam.mark stays null until a teacher grades it
```

The final is **one-shot** — once an `Exam` of type `"final"` exists for a
student, they can't start another one. This is enforced at the application
layer (check before creating), not by a unique DB index, because the
"exists" check also needs to consider things like admin-approved re-sits
later — a hard unique index would make that harder to override.

---

## 4. Grading the final (manual, with regrade support)

This is the one place a human enters the loop.

```
Teacher opens a "pending_review" final → grades it (including essays)
  → insert GradeHistory document:
      exam_id, mark, graded_by, graded_at, is_regrade: false, reason: "initial grade"
  → copy that mark onto Exam.mark
  → Exam.grading_status = "graded"

--- later, if there's an appeal ---

Teacher re-grades the same final
  → insert ANOTHER GradeHistory document:
      exam_id (same), mark (new value), is_regrade: true, reason: "appeal — ..."
  → update Exam.mark to the new value
  → Exam.grading_status stays "graded"
```

**Why `Exam.mark` isn't computed on the fly from `GradeHistory`:** most reads
("what's this student's final grade?") don't care about history — they just
want the current number, fast, without a join. `GradeHistory` exists purely
as an audit trail for *how* the mark changed, not as the source that has to
be queried every time you need the mark.

**Quiz/mid never touch `GradeHistory`** — they're auto-graded instantly, so
`grading_status` is set to `"auto_graded"` the moment they're scored and
nothing further ever happens to that field.

---

## 5. Proctoring, live, during any exam attempt

This runs identically for quiz, mid, and final — it doesn't care about exam
type, only that an `ExamSession` is `"in_progress"`.

```
Every faceDetectionIntervalMs (3000ms):
  → run face-api.js detection
  → 0 faces detected  → fire "no_face" event
  → 2+ faces detected → fire "multiple_faces" event

Browser-level listeners (fire once per occurrence):
  → fullscreen exited     → "fullscreen_exit"
  → tab loses focus       → "tab_switch"
  → copy or paste action  → "copy_paste"
  → devtools opened       → "devtools_open"

For every fired event:
  → look for an existing ProctoringEvent(exam_id, type) whose
    last_seen_at is within duplicateEventWindowMs (5000ms)
    → found     → occurrences++, last_seen_at = now  (score NOT re-added)
    → not found → create new ProctoringEvent, occurrences: 1
                → ExamSession.suspicion_score += weight for this type
  → if ExamSession.suspicion_score >= suspicionThreshold (50):
        → ExamSession.flagged = true
        → (optional, your call) auto-terminate the session:
              status: "terminated", terminated_reason: "suspicion_threshold"
```

**Why events collapse instead of piling up:** without the dedup rule, a
student briefly alt-tabbing could fire dozens of `tab_switch` events in a
couple seconds if the listener re-triggers on focus flicker, and each one
would add to the suspicion score — unfairly inflating it for one real
action. The `occurrences` counter still tells you it happened repeatedly,
it just doesn't get scored repeatedly within the same short window.

---

## 6. Admin review screen (reading the cheating log)

For a given exam attempt:

```
GET all ProctoringEvent WHERE exam_id = X
  ORDER BY createdAt ASC
  → shows: type, weight, occurrences, when first/last seen, metadata
GET the ExamSession for X
  → shows: final suspicion_score, flagged?, status, terminated_reason
```

The indexes on `ProctoringEvent` (`exam_id + student_id`, `exam_id +
createdAt`) exist specifically to make this screen fast without needing to
scan the whole collection.

---

## Quick reference: what creates what

| Action | Documents created/updated |
|---|---|
| Student enrolls in a curriculum | `Enrollment` created |
| Student starts a quiz/mid | `Exam` created (new attempt), `ExamSession` created |
| Student submits a quiz/mid | `Exam.mark/passed/grading_status` set, `ExamSession.status = "completed"` |
| Student starts a final | `Exam` created (type: final, one-shot), `ExamSession` created |
| Student submits a final | `Exam.taken = true`, `grading_status = "pending_review"`, mark stays null |
| Teacher grades a final | `GradeHistory` row inserted, `Exam.mark`/`grading_status` updated |
| Face/tab/devtools event fires | `ProctoringEvent` created or updated (dedup), `ExamSession.suspicion_score` updated |

---

## Things that are intentionally app-layer logic, not DB constraints

These are enforced in code (route handlers / service functions), not via
Mongoose schema validation or unique indexes, because the rules are more
nuanced than a DB constraint can express cleanly:

- Enrollment required before starting any exam
- Final is one-shot per student
- "Passed chapter X" = most recent quiz attempt only, not best-ever
- Final unlock requires all chapters passed
- Event dedup window logic
- Suspicion threshold → auto-flag/terminate

If any of these rules change later, you're editing a function, not
migrating the database.
