# Exam Platform — App Flow & Schema Reasoning (for developers)

This document explains **why** the schema in `schema-design.md` looks the way
it does, and walks through the actual user flows so a new developer can
understand how the pieces fit together without reverse-engineering it from
the field tables alone.

Read this alongside `schema-design.md` — that file is the source of truth for
exact fields/types; this file is the "how it all connects" narrative.

---

## The core idea in one sentence

A student enrolls in a (possibly personalized) **Curriculum**, must pass a
**quiz for every Chapter** before they can unlock the **Final**, and every
exam — quiz, mid, or final — is one **permanent record** that's proctored
live and holds its own freshly-generated questions, replaced wholesale on
retake (except the final, which is one-shot).

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
progress. When a curriculum is personalized (generated from a book just for
one student — see `schema-design.md` Step 13), the `Enrollment` is usually
auto-created at that moment rather than requested separately.

---

## 2. Taking a quiz (per-chapter, retakeable — replaces in place)

```
Student picks a Chapter → starts its quiz
  → look for an existing Exam where (student_id, chapter_id, type: "quiz")
    → found     → this IS a retake: reset its fields (see below)
    → not found → create it fresh: type: "quiz", attempt_number: 1

  → generateQuestions(chapter, count, "quiz") called
  → Exam.generated_questions = result (server-side, includes correct answers)
  → Exam.student_answers = [], Exam.taken = false,
    Exam.mark = null, Exam.passed = false,
    Exam.grading_status = "auto_graded", Exam.integrity_status = "clean"
  → attempt_number incremented (in place — same document, just a counter)

  → any PREVIOUS ExamSession/ProctoringEvents for this exam_id are deleted
  → new ExamSession created (1:1 with this Exam): status: "in_progress"
  → proctoring starts (no camera for quiz — see #5)

  → student answers MCQs (client never sees correct_option), submits
  → Exam.student_answers = what they submitted
  → Exam.mark computed instantly (auto-graded, no human involved)
  → Exam.passed = (mark >= passing_mark)
  → Exam.taken = true
  → ExamSession.status = "completed", ended_at = now
```

**There is only ever ONE `Exam` document per `(student, chapter)` quiz.**
Retaking it doesn't create a second document — it overwrites the same one,
including a fresh set of generated questions. Nothing "most recent" needs
resolving anywhere downstream, because there's nothing else to be recent
relative to.

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
        create ONE permanent Exam (type: "mid", attempt_number: 1, taken: false)
        create one ExamChapter row per chapter_id, linked to that Exam
  → students see the mid appear as available once their Exam doc exists
```

The chapter selection is **explicit**, not a computed range. There's no
`from`/`to` shortcut baked into the data model; if that convenience is
wanted later, it can be a pure UI/form feature that resolves to the same
explicit `chapter_ids` array server-side, without touching the schema.

**Taking/retaking that mid** works exactly like the quiz flow in #2:
`generateQuestions` is called against the mid's chapter set, the same
`Exam` document's content is reset and overwritten, and its `ExamSession`/
`ProctoringEvent`s are deleted and recreated fresh — just like a quiz
retake, just pre-created by the admin instead of student-initiated.

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

## 3. Unlocking and taking the final (one-shot, never replaced)

```
Student requests to start the Final for a Curriculum
  → check: enrolled in this curriculum? (see #1)
  → check: for EVERY chapter in the curriculum —
        does the student's quiz Exam for that chapter have passed = true?
    → any chapter missing/failed → reject, show which chapters are still needed
    → all chapters passed → allow starting the final

  → check: does a final Exam already exist for (student, curriculum)?
    → yes, and no cleared IntegrityAppeal with allow_retake: true → reject,
      "final already attempted"
    → no (or a cleared appeal authorizes a new one) → proceed

  → create the final Exam: type: "final", attempt_number: 1, taken: false
  → generateQuestions(curriculum, count, "final") called
  → Exam.generated_questions = result
  → new ExamSession created, proctoring starts WITH camera (see #5)
  → student answers (MCQ + possibly essay questions), submits
  → Exam.student_answers = what they submitted, Exam.taken = true
  → Exam.grading_status = "pending_review"   ← different from quiz/mid!
  → Exam.mark stays null until a teacher grades it
```

Unlike quiz/mid, **the final `Exam` document is never replaced in place.**
It's created once and stays exactly as submitted. The one exception — a
genuinely new document for the same student+curriculum — only happens via
the explicit, audited `IntegrityAppeal.allow_retake: true` path (see
`schema-design.md` Step 10), which is a rare, logged exception, not a
routine retake.

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
`grading_status` is set to `"auto_graded"` the moment they're scored (and
reset to it again on every retake).

---

## 5. Proctoring, live, during an exam session

Camera-based checks only run for `"mid"`/`"final"` (`schema-design.md` Step
11) — `"quiz"` never starts face-api.js at all. Non-camera checks
(fullscreen/tab/copy-paste/devtools) run for every type.

```
[mid/final only] Every faceDetectionIntervalMs (3000ms):
  → run face-api.js detection
  → 0 faces detected  → "no_face" condition
  → 2+ faces detected → "multiple_faces" condition
  → these are tracked as CONTINUOUS conditions, not discrete ticks:
        while the condition persists, extend the same open ProctoringEvent
        (duration_seconds growing); when it clears, finalize duration and
        compute weight = faceScoreWeight * floor(duration / absenceScoreIntervalSeconds),
        capped at maxAbsenceEventWeight, added to suspicion_score ONCE at closure

[all types] Browser-level listeners (fire once per occurrence):
  → fullscreen exited     → "fullscreen_exit"
  → tab loses focus       → "tab_switch"
  → copy or paste action  → "copy_paste" (includes similarity_to_question in metadata)
  → devtools opened       → "devtools_open"
  → these use the discrete dedup rule: repeats of the same type within
    duplicateEventWindowMs collapse into one doc (occurrences++), scored once

Whenever ExamSession.suspicion_score crosses suspicionThreshold:
  → ExamSession.flagged = true
  → Exam.integrity_status = "invalidated", Exam.invalidated_at = now
  → the exam is NOT interrupted — status stays "in_progress", student
    keeps going normally, no visible sign anything happened

At submission (student clicks "finish exam"):
  → if Exam.integrity_status === "invalidated":
        gather the FULL ProctoringEvent history for this exam_id
        send a notification (email/etc.) with the score + breakdown
        Exam.invalidation_notified_at = now (idempotency guard)
  → passed is force-set false for quiz/mid; for final, mark is not
    treated as the official grade until an appeal clears it
```

**Why camera events are duration-based, not per-tick:** a 3-second glitch
and a 2-minute walk-away shouldn't score the same just because both
triggered a "no face" check.

**Why discrete events still dedup by count, not duration:** actions like
tab-switching don't have a meaningful "duration" — what matters is that it
happened, not how long, so rapid repeats just collapse to avoid inflating
the score from one real action.

**Why invalidation doesn't stop the exam:** there's no live human watching
to sanity-check a false positive in the moment, so interrupting the student
mid-exam on an automated signal is riskier than just letting it finish and
sorting it out afterward if they dispute it.

---

## 6. Admin review screen (reading the cheating log)

For a given exam:

```
GET all ProctoringEvent WHERE exam_id = X
  ORDER BY createdAt ASC
  → shows: type, weight, occurrences/duration, when first/last seen, metadata
GET the ExamSession for X
  → shows: final suspicion_score, flagged?, status
GET the Exam for X
  → shows: integrity_status, invalidated_at, invalidation_notified_at
GET any IntegrityAppeal for X
  → shows: how it was resolved, if it has been
```

The indexes on `ProctoringEvent` (`exam_id + student_id`, `exam_id +
createdAt`) exist specifically to make this screen fast without needing to
scan the whole collection.

---

## 7. Book ingestion & on-the-fly questions (see schema-design.md Steps 13–14)

Briefly, since this is the part most different from a typical exam app:
there's no admin typing in a curriculum by hand, and no question bank.

```
Book uploaded → processBook() (dummy today, real RAG later) generates a
  Curriculum + Chapters (possibly personalized to one student) + auto-Enrollment

Student starts ANY exam → generateQuestions() (dummy today, real RAG later)
  generates that exam's questions fresh, stored directly on the Exam
  document itself — server-side only, correct answers stripped before
  reaching the client
```

Full detail on both is in `schema-design.md` — this file just anchors where
they fit into the overall flow.

---

## Quick reference: what creates/updates what

| Action | Documents created/updated |
|---|---|
| Student enrolls in a curriculum | `Enrollment` created |
| Book uploaded | `Book` created, then (async) `Curriculum` + `Chapter`s + `Enrollment` |
| Student starts/retakes a quiz | Existing `Exam` found-or-created, content reset + `generated_questions` regenerated; old `ExamSession`/`ProctoringEvent`s deleted, fresh ones created |
| Admin creates a mid | One permanent `Exam` + `ExamChapter` rows per enrolled student |
| Student starts/retakes a mid | Same as quiz retake — that student's existing mid `Exam` content reset |
| Student submits a quiz/mid | `Exam.mark/passed/grading_status` set, `ExamSession.status = "completed"` |
| Student starts a final | New `Exam` created (one-shot; blocked if one already exists), `ExamSession` created |
| Student submits a final | `Exam.taken = true`, `grading_status = "pending_review"`, mark stays null |
| Teacher grades a final | `GradeHistory` row inserted, `Exam.mark`/`grading_status` updated |
| Face/tab/devtools event fires | `ProctoringEvent` created or updated, `ExamSession.suspicion_score` updated |
| Suspicion threshold crossed | `ExamSession.flagged = true`, `Exam.integrity_status = "invalidated"` — exam continues uninterrupted |
| Student submits an invalidated exam | Notification sent once, `Exam.invalidation_notified_at` set |
| Admin resolves an appeal | `IntegrityAppeal` created; if cleared, `Exam.integrity_status` reset (and `passed` recomputed for quiz/mid) |

---

## Things that are intentionally app-layer logic, not DB constraints

These are enforced in code (route handlers / service functions), not via
Mongoose schema validation or unique indexes, because the rules are more
nuanced than a DB constraint can express cleanly:

- Enrollment required before starting any exam
- Quiz/mid retakes replace the existing Exam's content rather than
  inserting a new document
- Final is one-shot per student, except via a cleared, `allow_retake`
  IntegrityAppeal
- Final unlock requires every chapter's quiz to be passed
- Event dedup window logic (discrete) / duration accumulation (camera)
- Suspicion threshold → silent invalidation, notification deferred to
  submission
- Appeal resolution → integrity_status reset, passed recomputed for
  quiz/mid only

If any of these rules change later, you're editing a function, not
migrating the database.
