# Exam Platform — Data Schema Design

Stack: Next.js + MongoDB + Mongoose + Zod

This document defines the collections, attributes, types, and relationships needed
before implementation. It's meant to be handed to a model (or a dev) to generate
the actual Mongoose schemas + Zod validators.

Read top to bottom — each step builds on decisions made in the previous one.
The final schemas (ready to implement) are collected in one place at the end.

---

## Step 1 — Curriculum grouping

Chapters and the final exam need to belong to something. This introduces a
`Curriculum` collection so the system supports more than one course later
without a redesign.

- A `Curriculum` has many `Chapter`s.
- A `"final"` Exam belongs to exactly one `Curriculum` (it's the overall grade
  for that curriculum, not tied to individual chapters via ExamChapter).
- `"quiz"` and `"mid"` exams stay linked to chapters via `ExamChapter` as
  before; the curriculum is reachable through the chapter.

---

## Step 2 — Student (mock)

No change from before — still a placeholder until real auth exists.

---

## Step 3 — Enrollment gate

A student must be enrolled in a `Curriculum` before they can take **any**
exam belonging to it (quiz, mid, or final). This introduces an `Enrollment`
collection (junction between Student and Curriculum).

`canStartExam(...)` checks (in order): is the student enrolled in this
curriculum? → then applies the existing per-type rules (retake limits,
final-unlock chapter check, etc).

---

## Step 4 — Exam identity: one document per attempt

**The gap:** originally `Exam` looked like a single row per student per exam
(with `student_id`, `taken`, `mark` baked in), while `ExamSession` separately
implied one row per attempt. That's inconsistent once retakes are allowed.

**Resolution:** `Exam` becomes **one document per attempt.** Every time a
student starts a `"quiz"` or `"mid"`, a new `Exam` doc is created
(`attempt_number` increments). `"final"` is capped at one `Exam` doc per
student ever (enforced at the app layer).

Because `Exam` is now itself "one attempt," `ExamSession` is a **1:1**
companion doc to `Exam` — it holds the live proctoring state for that
specific attempt, created the moment the attempt starts and updated until it
ends.

- "Which is the student's current quiz result for chapter X?" → the `Exam`
  doc with the highest `attempt_number` (or latest `createdAt`) among that
  student's `"quiz"` exams linked to chapter X via `ExamChapter`.
- `passed` still means: does that most-recent attempt's `mark >= passing_mark`.

---

## Step 5 — Grading: auto vs. manual (finals only)

`"quiz"`/`"mid"` are MCQ-only → graded instantly, automatically, no human
involved. `"final"` can include essay questions → needs human review, and may
be regraded later (e.g. an appeal).

**Resolution:**
- `Exam` gets a `grading_status` field: `"auto_graded"` | `"pending_review"` |
  `"graded"`. Quiz/mid go straight to `"auto_graded"` the moment they're
  scored. Final starts at `"pending_review"` after submission, moves to
  `"graded"` once a teacher grades it.
- `Exam.mark` always holds the **current official mark**, regardless of type
  — cheap to read without a join, for both auto- and manually-graded exams.
- A new append-only collection, `GradeHistory`, records every manual grading
  event for a final (initial grade + any regrades), so there's an audit
  trail of how `Exam.mark` got to its current value. Quiz/mid never write to
  this collection.

---

## Step 6 — Proctoring: session lifecycle and reason

`ExamSession` gets a `terminated_reason` so the admin review screen can show
*why* a session ended, not just that it did.

---

## Step 7 — Proctoring: event throttling / dedup

Rapid-fire duplicate events (e.g. tab-switch firing 50x in 2 seconds) would
flood `ProctoringEvent` and distort the suspicion score. Rule: within a
configurable debounce window, repeated events of the **same type** in the
**same session** update the existing event doc (`occurrences++`,
`last_seen_at` updated) instead of creating a new one. The suspicion score
only increases once per debounce window per type, not once per raw firing.

---

## Step 8 — Timestamps, standardized

Every collection below uses Mongoose `{ timestamps: true }` (`createdAt` /
`updatedAt`) rather than defining `createdAt` ad hoc per collection.

---

## Step 9 — Mid creation: admin-picked chapters (explicit list)

The admin decides which chapters a `"mid"` covers — not the student, and not
a computed range. This uses **Mode A**: an explicit `chapter_ids` array
supplied by the admin when creating the mid, rather than a `from`/`to`
chapter-number range.

```
Admin creates a mid:
  input: { curriculum_id, title, chapter_ids: [id1, id2, id3, ...], passing_mark }
  → validate (Zod): every id in chapter_ids belongs to curriculum_id
  → validate: chapter_ids has at least 1 entry, no duplicates
  → create Exam doc(s) of type "mid" (one per student, same as any attempt —
    see Step 4). Typically batch-created for every actively enrolled student
    at once, rather than the admin repeating this per student.
  → for each created Exam, create one ExamChapter row per id in chapter_ids
```

No new collection is needed for this — `ExamChapter` already models "N
chapters linked to one Exam"; the admin is just the one supplying that list
instead of it being inferred from a single chapter (as with `"quiz"`).

This also means the admin — not the schema — is the source of truth for
"which chapters are in this mid." Nothing in the DB enforces contiguity or
any particular chapter count; validation only confirms the ids are real and
belong to the right curriculum.

---

## Future work — student-initiated custom quizzes (not building yet)

A student may eventually be able to pick their own set of chapters (e.g. "a
practice quiz on chapters 2 and 4 only") and request a custom quiz generated
just for them, separate from the required per-chapter `"quiz"` that gates
the final.

This is **out of scope for now** — noted here so it isn't forgotten and so
the current design doesn't accidentally block it later. Rough shape if/when
it's built:
- Likely a new `type` value on `Exam`, e.g. `"custom_quiz"`, using the same
  `ExamChapter` multi-link pattern as `"mid"` (Mode A), but student-initiated
  instead of admin-initiated.
- Would NOT count toward the final-unlock check (only the required per-chapter
  `"quiz"` type does) — needs an explicit rule to keep it "practice only."
- Question to answer later: is it auto-graded like `"quiz"`, and does it get
  its own `passing_mark`, or is it ungated/informational only (no pass/fail)?

---

## Final Schemas

### Curriculum

| Field   | Type     | Required | Notes |
|---------|----------|----------|-------|
| _id     | ObjectId | auto     |       |
| title   | String   | yes      |       |
| description | String | no    |       |

---

### Student (mock for now)

| Field | Type     | Required | Notes |
|-------|----------|----------|-------|
| _id   | ObjectId | auto     |       |
| name  | String   | yes      |       |

> Marked "mock" — no real auth/user system yet; likely merged with a real
> User model later.

---

### Chapter

| Field         | Type                        | Required | Notes |
|---------------|-----------------------------|----------|-------|
| _id           | ObjectId                    | auto     |       |
| curriculum_id | ObjectId (ref: Curriculum)  | yes      |       |
| title         | String                      | yes      |       |
| number        | Number                      | yes      | order/sequence within curriculum |

---

### Enrollment (junction: Student ↔ Curriculum)

| Field         | Type                        | Required | Notes |
|---------------|-----------------------------|----------|-------|
| _id           | ObjectId                    | auto     |       |
| student_id    | ObjectId (ref: Student)     | yes      |       |
| curriculum_id | ObjectId (ref: Curriculum)  | yes      |       |
| enrolled_at   | Date                        | yes      |       |
| status        | String (enum)               | yes (default: `"active"`) | `"active"`, `"completed"`, `"withdrawn"` |

> Unique compound index on `(student_id, curriculum_id)` — a student can't
> enroll in the same curriculum twice.

---

### Exam

One document per attempt.

| Field           | Type                          | Required | Notes |
|-----------------|-------------------------------|----------|-------|
| _id             | ObjectId                      | auto     |       |
| type            | String (enum)                 | yes      | `"quiz"` (per-chapter), `"mid"` (subset of chapters), `"final"` (whole curriculum) |
| title           | String                        | yes      |       |
| student_id      | ObjectId (ref: Student)       | yes      |       |
| curriculum_id   | ObjectId (ref: Curriculum)    | yes (for `"final"`) | which curriculum this final belongs to |
| attempt_number  | Number                        | yes (default: 1) | increments per retake for `"quiz"`/`"mid"`; always `1` for `"final"` |
| taken           | Boolean                       | yes (default: false) | whether this attempt was completed/submitted |
| mark            | Number                        | no       | current official score for this attempt, null until graded |
| passing_mark    | Number                        | yes (for `"quiz"`) | minimum `mark` needed to pass |
| passed          | Boolean                       | yes (default: false) | `true` once `mark >= passing_mark` |
| grading_status  | String (enum)                 | yes (default: `"auto_graded"`) | `"auto_graded"`, `"pending_review"`, `"graded"` — see GradeHistory |

> **Type semantics:**
> - `"quiz"` → linked to exactly one Chapter via ExamChapter, MCQ-only,
>   `grading_status` always `"auto_graded"`. Must be passed (on the
>   student's most recent attempt) to clear that chapter.
> - `"mid"` → linked to an admin-selected set of Chapters via ExamChapter
>   (explicit list, not a range — see Step 9), MCQ-only, `grading_status`
>   always `"auto_graded"`. Not required for gating unless decided otherwise
>   later.
> - `"final"` → linked directly to a Curriculum (not via ExamChapter), may
>   include essays. Starts `grading_status: "pending_review"` on submission,
>   becomes `"graded"` once a teacher grades it via GradeHistory. `mark` is
>   the overall curriculum grade.

**Index:** compound index on `(student_id, type, attempt_number)` — supports
"give me this student's latest attempt of type X" queries efficiently.

### Unlocking the final

Before allowing a student to start a `"final"` ExamSession, check at the
application layer:

```
if student is not enrolled in this curriculum → block

for every Chapter in the curriculum:
  find the student's most recent Exam where type = "quiz"
    AND linked (via ExamChapter) to that Chapter
  if no such Exam exists, OR passed !== true → block access to the final

if all chapters have a passed quiz (most recent attempt) → allow starting the final
```

---

### ExamChapter (join table)

| Field       | Type                     | Required | Notes |
|-------------|--------------------------|----------|-------|
| _id         | ObjectId                 | auto     |       |
| chapter_id  | ObjectId (ref: Chapter)  | yes      |       |
| exam_id     | ObjectId (ref: Exam)     | yes      |       |

> Unique compound index on `(chapter_id, exam_id)` to prevent duplicate links.
> `"quiz"` exams link to exactly one Chapter; `"mid"` exams can link to
> several; `"final"` exams don't use this table at all (they reference
> `curriculum_id` directly on `Exam`).

---

### GradeHistory (final exams only — audit trail for manual grading)

| Field       | Type                          | Required | Notes |
|-------------|-------------------------------|----------|-------|
| _id         | ObjectId                      | auto     |       |
| exam_id     | ObjectId (ref: Exam)          | yes      | must reference an Exam with type = `"final"` |
| mark        | Number                        | yes      | mark assigned in this grading event |
| graded_by   | String (or ref to a future Teacher model) | yes | who graded it |
| graded_at   | Date                          | yes      |       |
| is_regrade  | Boolean                       | yes (default: false) | |
| reason      | String                        | no       | e.g. `"initial grade"`, `"appeal — question 3 re-reviewed"` |

**Flow:** grading a final inserts one row here and copies `mark` +
`grading_status: "graded"` onto the `Exam` doc. A regrade inserts another row
(`is_regrade: true`) and updates `Exam.mark` again. `Exam.mark` is always the
current truth; this collection is the history of how it got there.

---

### ExamSession

1:1 companion to an `Exam` doc — the live proctoring state for that attempt.

| Field              | Type                       | Required | Notes |
|--------------------|-----------------------------|----------|-------|
| _id                | ObjectId                   | auto     |       |
| exam_id            | ObjectId (ref: Exam), unique | yes    | 1:1 — one session per Exam attempt |
| student_id         | ObjectId (ref: Student)     | yes      |       |
| started_at         | Date                        | yes      |       |
| ended_at           | Date                        | no       |       |
| suspicion_score    | Number                      | yes (default: 0) | running total |
| flagged            | Boolean                     | yes (default: false) | true once score >= suspicionThreshold |
| status             | String (enum)               | yes      | `"in_progress"`, `"completed"`, `"terminated"` |
| terminated_reason  | String (enum)               | no       | `"suspicion_threshold"`, `"manual_admin_stop"`, `"student_submitted"`, `"timeout"` — only set when status is `"completed"`/`"terminated"` |

---

### ProctoringEvent (the "cheating log")

| Field           | Type                          | Required | Notes |
|-----------------|-------------------------------|----------|-------|
| _id             | ObjectId                      | auto     |       |
| exam_id         | ObjectId (ref: Exam)          | yes      | which attempt this belongs to |
| student_id      | ObjectId (ref: Student)       | yes      | denormalized for fast querying |
| type            | String (enum)                 | yes      | see event types below |
| weight          | Number                        | yes      | points added to suspicion score (per debounce window, not per raw firing) |
| score_at_event  | Number                        | yes      | cumulative suspicion score at the moment this event (or its latest occurrence) fired |
| occurrences     | Number                        | yes (default: 1) | raw firing count collapsed into this doc within the debounce window |
| last_seen_at    | Date                          | yes      | updated each time a duplicate occurrence is collapsed in |
| metadata        | Mixed / Object                | no       | event-specific extra data |

**Dedup rule:** if a new raw event of the same `type` fires for the same
`(exam_id, type)` within `duplicateEventWindowMs` of the existing doc's
`last_seen_at`, update that doc (`occurrences++`, `last_seen_at` = now)
instead of inserting a new one. The suspicion score only increments once per
window, using this doc's `weight`.

#### Event types → maps to your weights

| Enum value          | Weight source              | Example metadata |
|----------------------|-----------------------------|-------------------|
| `no_face`            | `faceScoreWeight`           | `{ confidence }` |
| `multiple_faces`     | `multipleFacesWeight`       | `{ faceCount }` |
| `fullscreen_exit`    | `fullscreenExitWeight`      | `{}` |
| `tab_switch`         | `tabSwitchWeight`           | `{}` |
| `copy_paste`         | `copyPasteWeight`           | `{ action: "copy" \| "paste", textLength }` |
| `devtools_open`      | `devtoolsWeight`            | `{}` |

**Indexes (for the admin review screen):**
- Compound index on `(exam_id, student_id)` — fetch all events for one attempt
- Index on `(exam_id, createdAt)` — chronological order per attempt
- Index on `type` — optional, filter/count by event type across exams

---

### ProctoringConfig (plain config module, not a DB collection)

```js
{
  faceDetectionIntervalMs: 3000,
  suspicionThreshold: 50,
  faceScoreWeight: 15,
  fullscreenExitWeight: 30,
  tabSwitchWeight: 25,
  copyPasteWeight: 20,
  devtoolsWeight: 35,
  multipleFacesWeight: 25,
  duplicateEventWindowMs: 5000,
}
```

Keep as a static module for now, not per-exam DB data. Can migrate to DB later
if you want per-exam custom thresholds.

---

## Relationships summary

```
Curriculum 1---N Chapter
Curriculum 1---N Exam (type = "final" only)
Curriculum 1---N Enrollment N---1 Student
Student    1---N Exam
Exam       1---N ExamChapter N---1 Chapter   (type = "quiz" / "mid")
Exam       1---1 ExamSession
Exam       1---N ProctoringEvent
Exam       1---N GradeHistory              (type = "final" only)
Student    1---N ProctoringEvent (denormalized)
```
