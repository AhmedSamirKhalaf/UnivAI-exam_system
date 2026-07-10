# Endpoint Build Plan — Phased, With Verification At Each Step

## Why phased, not all-at-once

The last build produced all 14 endpoints in one pass. That's fine for
getting something to compile, but it means if something's subtly wrong
(e.g. retake doesn't actually replace in place, or invalidation
accidentally interrupts the exam), it's buried in 28 files with nothing
isolating which piece broke. This plan builds and **verifies in small
groups**, in dependency order, so any bug shows up immediately next to the
piece that caused it.

**Follow the phases in order. Do not start a phase until the previous
one's checklist passes.** Each phase ends with real requests to run
against the running dev server — not just "does it compile."

Specs to follow (unchanged): `schema-design.md`, `app-flow-guide.md`,
`exam-generation-and-api-design.md`. This file only sequences the work —
it adds no new requirements beyond those three.

---

## Phase 0 — Confirm the foundation is real

Before touching endpoints, confirm what's already built actually matches
spec. Don't assume the previous build got everything right.

- [ ] Every model in `schema-design.md`'s Final Schemas section exists,
      with exact field names/types/enums
- [ ] `Exam` has the partial unique index on `(student_id, chapter_id)`
      where `type: "quiz"` — confirm by inspecting the index definition,
      not just that it doesn't error
- [ ] `tsc --noEmit` and `eslint .` both pass
- [ ] `MONGODB_URI` is set and `lib/db.ts` actually connects (log a
      successful connection on dev server start)

**Do not proceed until this is confirmed clean.**

---

## Phase 1 — Foundation: books, curricula, chapters, enrollment

**Build:** `POST /api/books`, `GET /api/books/:id`, `GET
/api/curricula/:id/chapters`, `POST /api/enrollments`

**Test:**
```
POST /api/books { title, student_id }
  → 201, status: "uploaded"
GET /api/books/:id repeatedly
  → eventually status: "ready", 5 dummy chapters exist
GET /api/curricula/:id/chapters
  → returns the 5 chapters, correct curriculum_id
POST /api/enrollments { student_id, curriculum_id }
  → 201 (or already-exists if processBook auto-created one — confirm which)
```

**Checklist before moving on:**
- [ ] A `Curriculum` + 5 `Chapter`s exist in the DB after book processing
- [ ] `Enrollment` exists for the student (whether auto-created or
      manually posted — confirm no duplicate got created if both happened)
- [ ] Posting the same enrollment twice is rejected (unique index working)

---

## Phase 2 — Quiz flow: start, submit, retake-in-place

This is the highest-risk phase — the find-or-reset logic is new and easy
to get subtly wrong (e.g. accidentally inserting a second document).

**Build:** `POST /api/exams/quiz/start`, `GET /api/exams/:examId`, `POST
/api/exams/:examId/submit`

**Test, in this exact order:**
```
POST /api/exams/quiz/start { student_id, chapter_id: chapter1 }
  → 201, note the returned examId (call it A)
  → GET /api/exams/A → generated_questions present, correct_option NOT present
POST /api/exams/A/submit { student_answers: [...wrong answers...] }
  → mark computed, passed: false, taken: true

POST /api/exams/quiz/start { student_id, chapter_id: chapter1 }  ← SAME chapter again
  → 201 (or 200), examId returned should be THE SAME "A" — verify this explicitly
  → attempt_number should now be 2
  → generated_questions should be a NEW set (or at least regenerated, per dummy logic)
POST /api/exams/A/submit { student_answers: [...correct answers...] }
  → mark computed, passed: true
```

**Checklist before moving on:**
- [ ] Confirmed via direct DB query (not just API response) that only ONE
      `Exam` document exists for `(student_id, chapter_id, type: "quiz")`
      after both attempts — this is the one that matters most
- [ ] `ExamSession`/`ProctoringEvent`s from the first attempt are gone
      after the retake (query directly, don't trust the API alone)
- [ ] Starting a quiz for a **different** chapter creates a genuinely
      separate `Exam` document

---

## Phase 3 — Mid flow: admin create, batch, start/retake

**Build:** `POST /api/exams/mid`, `POST /api/exams/mid/:examId/start`

**Test:**
```
POST /api/exams/mid { curriculum_id, title, chapter_ids: [ch2, ch3], passing_mark }
  → one Exam created per enrolled student — confirm count matches enrolled students
GET /api/exams/:examId (the created mid Exam for your test student)
  → type: "mid", taken: false, no questions yet
POST /api/exams/mid/:examId/start
  → generated_questions populated now
POST /api/exams/:examId/submit { student_answers }
  → graded same as quiz

Retake: POST /api/exams/mid/:examId/start again
  → SAME examId, content reset, attempt_number incremented
```

**Checklist before moving on:**
- [ ] Exactly one `Exam` per enrolled student was created by the mid-create
      call — not one for every student in the system, only enrolled ones
- [ ] `ExamChapter` rows exist linking the mid to chapters 2 and 3, for
      every one of those Exam documents
- [ ] Retake reuses the same document (same check as Phase 2)

---

## Phase 4 — Final flow: unlock gate, one-shot, manual grading

**Build:** `POST /api/exams/final/start`, `POST /api/exams/:examId/grade`

**Test:**
```
(Using a student who has NOT passed all chapter quizzes yet)
POST /api/exams/final/start
  → should be REJECTED — confirm the error identifies which chapters are missing

(Now pass every chapter's quiz for this student)
POST /api/exams/final/start
  → 201, examId returned
POST /api/exams/:examId/submit { student_answers }
  → grading_status: "pending_review", mark: null  ← NOT auto-graded

POST /api/exams/final/start again (same student, same curriculum)
  → should be REJECTED — one-shot, already exists

POST /api/exams/:examId/grade { mark: 78, graded_by, reason: "initial grade" }
  → Exam.mark = 78, grading_status: "graded"
  → GradeHistory has one row, is_regrade: false

POST /api/exams/:examId/grade { mark: 82, ..., is_regrade: true }
  → Exam.mark = 82
  → GradeHistory now has TWO rows
```

**Checklist before moving on:**
- [ ] Final is genuinely blocked before all chapters are passed, and the
      rejection is informative
- [ ] Final is genuinely blocked on a second attempt (one-shot enforced)
- [ ] `GradeHistory` accumulates rows correctly across grade + regrade
- [ ] `Exam.mark` always reflects the latest `GradeHistory` entry

---

## Phase 5 — Proctoring: discrete events, camera duration, silent invalidation

This is the second highest-risk phase. The exam must NOT be interrupted
when the threshold crosses.

**Build:** `POST /api/exams/:examId/proctoring-event`

**Test, discrete events (any exam type):**
```
Fire "tab_switch" 5 times within duplicateEventWindowMs of each other
  → ONE ProctoringEvent doc, occurrences: 5, suspicion_score increased ONCE
```

**Test, camera events (mid/final only — start a mid or final for this):**
```
Fire "no_face" detected: true, three times in a row (simulating 9+ seconds absent)
  → ONE open ProctoringEvent (ended_at: null), duration growing
Fire "no_face" detected: false (face returns)
  → that event closes: ended_at set, duration_seconds finalized, weight computed,
    suspicion_score bumped ONCE

Try firing "no_face" for a QUIZ exam_id
  → should be REJECTED (camera events not allowed for quiz type)
```

**Test, crossing the threshold:**
```
Keep firing events until suspicion_score >= suspicionThreshold
  → check the ExamSession: status should STILL be "in_progress" ← critical
  → check the Exam: integrity_status should now be "invalidated", invalidated_at set
  → invalidation_notified_at should still be null (not sent yet)

Now submit the exam (POST /api/exams/:examId/submit)
  → invalidation_notified_at should now be set
  → check your notification stub (console.log) — should have fired exactly once,
    with the FULL event history, not a partial one
  → passed should be forced false (if quiz/mid) even if the raw mark would have passed
```

**Checklist before moving on:**
- [ ] Confirmed the exam session status never changes to "terminated" purely
      from crossing the threshold
- [ ] Confirmed the notification fires exactly once, at submission
- [ ] Confirmed camera events are rejected for quiz-type exams

---

## Phase 6 — Appeals

**Build:** `POST /api/appeals`

**Test:**
```
(Using the invalidated exam from Phase 5)
POST /api/appeals { exam_id, resolution: "cleared", resolved_by, allow_retake: false }
  → Exam.integrity_status back to "clean"
  → if it was a quiz/mid: passed recomputed from existing mark vs passing_mark
    (confirm it did NOT force a retake)

(Using an invalidated FINAL)
POST /api/appeals { exam_id, resolution: "cleared", resolved_by, allow_retake: true }
  → Exam.integrity_status: "clean" for the old one
POST /api/exams/final/start (same student, same curriculum)
  → should now be ALLOWED — confirm this creates a genuinely new Exam
    document, not a reuse of the old one
```

**Checklist before moving on:**
- [ ] Cleared quiz/mid appeal does NOT force a retake, just recomputes passed
- [ ] Cleared final appeal with `allow_retake: true` is the ONLY way a
      second final Exam document gets created for the same student+curriculum
- [ ] Without `allow_retake: true`, a cleared final appeal does NOT unlock
      a new attempt

---

## Phase 7 — Download

**Build:** `GET /api/exams/:examId/download`

**Test:**
```
GET /api/exams/A/download (a completed, graded exam)
  → returns a file (PDF or JSON) with questions, student answers, correct
    answers, mark, pass/fail
```

**Checklist:**
- [ ] Works for a completed quiz, a completed mid, and a graded final
- [ ] Does NOT expose `correct_option` for an exam that hasn't been
      submitted yet (only for completed/graded ones)

---

## Phase 8 — Full end-to-end smoke test

Run one complete student journey start to finish, in a single script:
upload book → enroll → fail then pass every chapter quiz (confirming
replace-in-place each time) → unlock and take the final → grade it →
trigger an invalidation on one exam along the way → resolve it via appeal
→ download the final result.

If this full run passes without manual intervention, the backend is done.
Frontend work can start after this, and real RAG can be wired in later by
swapping only `processBook` and `generateQuestions` — nothing else in this
plan should need to change when that happens.
