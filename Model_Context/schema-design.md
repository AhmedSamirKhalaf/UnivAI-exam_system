# Exam Platform — Data Schema Design

Stack: Next.js + MongoDB + Mongoose + Zod

This document defines the collections, attributes, types, and relationships needed
before implementation. It's meant to be handed to a model (or a dev) to generate
the actual Mongoose schemas + Zod validators.

Read top to bottom — each step builds on decisions made in the previous one.
The final schemas (ready to implement) are collected in one place at the end.

---

## Step 1 — Curriculum grouping (per-student, not shared)

Chapters and the final exam need to belong to something. This introduces a
`Curriculum` collection so the system supports more than one course without
a redesign.

A `Curriculum` can be **personalized per student** — generated from a book
specifically for whoever requested it — rather than one shared curriculum
used by everyone. The schema supports both without forcing either:
- `Curriculum.owner_student_id` (optional): set when it's a personalized
  curriculum belonging to one student; left null for a generic/shared one.
- `Curriculum.book_id`: which `Book` (Step 13) it was generated from.

Everything downstream (chapters, exams, gating) works identically either
way — a curriculum is a curriculum, whether one student has it or many.

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
curriculum? → then applies the existing per-type rules (final-unlock
chapter check, etc).

> When a curriculum is personalized (Step 1), an `Enrollment` is typically
> auto-created for that one student the moment the curriculum is generated
> — the collection itself doesn't change, it's just usually 1:1 in this
> flow instead of many students sharing one curriculum.

---

## Step 4 — Exam identity: one document per (student, exam target), replaced in place on retake

**The gap:** originally `Exam` looked like a single row per student per exam,
while `ExamSession` separately implied one row per attempt — inconsistent
once retakes were introduced.

**Resolution:** each exam type has exactly **one permanent `Exam` document**
per student, identified by what it's *for* — not one new document per
attempt. Retaking a `"quiz"` or `"mid"` **replaces the content of that same
document** (same `_id`) rather than creating a new one. `"final"` is the one
exception: it's one-shot and that single document is never replaced.

- **`"quiz"`** → identity is `(student_id, chapter_id)`. First attempt
  creates the `Exam` doc; every retake finds that same doc and overwrites
  its content (new questions, new answers, `mark`/`passed`/`taken`/
  `grading_status`/`integrity_status` all reset and recomputed).
  `attempt_number` increments **in place** on that same document — it's a
  counter ("this is their 3rd try"), not a way to find multiple documents.
- **`"mid"`** → identity is the `Exam` doc itself, created once per enrolled
  student when the admin defines the mid (Step 9). Retaking it means the
  student re-does that same document; same replace-in-place behavior as
  quiz.
- **`"final"`** → identity is `(student_id, curriculum_id)`, created once,
  ever. Never replaced. The only way a second final `Exam` doc gets created
  for the same student+curriculum is the explicit, audited
  `IntegrityAppeal` → `allow_retake: true` exception (Step 10) — and that's
  a genuinely new document, not a replacement, since it's a rare exception
  worth keeping full history for.

Because `Exam` now persists (permanently, for quiz/mid, replaced-in-place;
permanently and singularly for final), `ExamSession` stays a **1:1**
companion — but on a quiz/mid retake, the *previous* `ExamSession` (and its
`ProctoringEvent`s) for that `exam_id` get deleted and a fresh one created,
since they belonged to the now-overwritten attempt and the unique
`exam_id` constraint on `ExamSession` means only one can exist per `Exam`
document at a time.

- "What's the student's result for chapter X's quiz?" → simply the one
  `Exam` doc for `(student_id, chapter_id)` — no "most recent attempt"
  query needed anymore, there's only ever one.
- `passed` means: does the current (only) `mark >= passing_mark`.

---

## Step 5 — Grading: auto vs. manual (finals only)

`"quiz"`/`"mid"` are MCQ-only → graded instantly, automatically, no human
involved. `"final"` can include essay questions → needs human review, and may
be regraded later (e.g. an appeal).

**Resolution:**
- `Exam` gets a `grading_status` field: `"auto_graded"` | `"pending_review"` |
  `"graded"`. Quiz/mid go straight to `"auto_graded"` the moment they're
  scored (and reset to it again on every retake). Final starts at
  `"pending_review"` after submission, moves to `"graded"` once a teacher
  grades it.
- `Exam.mark` always holds the **current official mark** — cheap to read
  without a join, for both auto- and manually-graded exams.
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
  → create ONE Exam doc per actively enrolled student (type: "mid") —
    this is the permanent, replace-in-place document for that student's
    mid (see Step 4); retaking it later reuses this same document.
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

## Step 10 — Full automation: invalidate silently, exam continues, notify after

No one reviews the suspicion score in the normal flow, and **the exam is not
interrupted** when the threshold is crossed — the student keeps taking it
normally, with no visible sign anything happened. The system just marks it
as invalidated in the background and notifies (email or whatever channel)
separately, after the fact. A human only gets involved if the student later
emails the admin disputing it — an out-of-band process, not an in-app
feature.

**Resolution:**
- `Exam` gets an `integrity_status` field: `"clean"` | `"invalidated"`,
  default `"clean"` (reset to `"clean"` on every quiz/mid retake, along with
  everything else — see Step 4).
- The moment an `ExamSession.suspicion_score` crosses `suspicionThreshold`,
  the system **automatically**, in the background: sets
  `ExamSession.flagged = true`, sets `Exam.integrity_status =
  "invalidated"`, and stamps `Exam.invalidated_at = now`. **The session is
  NOT terminated** — `status` stays `"in_progress"` and the student
  continues the exam uninterrupted through normal submission.
  `terminated_reason: "suspicion_threshold"` is no longer something the
  system sets automatically; that enum value stays available only for a
  human (e.g. `"manual_admin_stop"`) to use if they choose to intervene
  live, which is a separate, optional path — not the default one.
- An invalidated `Exam` is always treated as failed once finished,
  regardless of its raw `mark`: `passed` is forced `false` for
  `"quiz"`/`"mid"` (so it does NOT count toward the final-unlock check),
  and for `"final"` the `mark` is not treated as the official grade.
- **Notification, sent at submission — not the moment of invalidation.**
  `integrity_status` flips to `"invalidated"` immediately when the
  threshold is crossed (background only, exam keeps running), but the
  notification itself only fires once the student actually **finishes and
  submits** the exam. At that point it includes the full picture — every
  `ProctoringEvent` logged across the whole attempt, not just what existed
  at the moment of invalidation. Implementation (email, in-app, whatever)
  is up to you; the schema just needs to support it not firing twice.
  `Exam.invalidation_notified_at` records when that notification was
  actually sent.
- A new collection, `IntegrityAppeal`, is where an admin manually logs the
  outcome after a student emails in disputing a flag. This is the only way
  `integrity_status` ever moves from `"invalidated"` back to `"clean"` — it
  never happens automatically.
- Special case: a `"final"` is one-shot. If it gets auto-invalidated and the
  appeal is upheld (admin agrees it was a false flag, `resolution:
  "cleared"`), the admin can optionally set `allow_retake: true` on the
  `IntegrityAppeal`, which is the one explicit, logged exception that lets
  `canStartFinal` create a genuinely new final `Exam` document despite the
  one-shot rule.
- For `"quiz"`/`"mid"`, clearing an appeal simply recomputes `passed` from
  the exam's existing `mark` against `passing_mark` (no forced retake) —
  since retakes are already unlimited and cheap for these types, forcing
  one after the admin already ruled it wasn't cheating would be
  unnecessarily punitive. `mark` itself is never touched by an appeal; only
  `integrity_status` and, for quiz/mid, `passed` are recomputed.

---

## Step 11 — Camera only for mid and final, not quiz

Face detection (and therefore `no_face`/`multiple_faces` events) only runs
for `"mid"` and `"final"` exam types. `"quiz"` attempts are not
camera-monitored at all — no face-api.js session starts, no camera-related
events are ever created for a `"quiz"` `ExamSession`.

All non-camera proctoring (`fullscreen_exit`, `tab_switch`, `copy_paste`,
`devtools_open`) still applies to every exam type, including `"quiz"`. This
is a client-side + config-level decision (which detector to initialize),
not a schema change — no new field is needed on `Exam`, since `type` alone
determines whether the camera starts.

---

## Step 12 — Duration-based absence scoring, and paste-content similarity

**Absence duration instead of flat per-firing weight.** A 3-second camera
glitch and a 2-minute walk-away shouldn't score the same just because both
fired a `no_face` check. Instead of scoring every discrete detection tick,
track how long the face was continuously missing (or how long multiple
faces were continuously visible), and score based on that duration:

```
Face check fires "no face" at interval N
  → if a no_face ProctoringEvent is already open for this exam_id (no ended_at set)
        → extend it: update last_seen_at, recompute duration_seconds
  → else → create a new no_face ProctoringEvent, duration_seconds = 0

Face check fires "face detected" (condition cleared)
  → close the open no_face ProctoringEvent for this exam_id: set ended_at,
    finalize duration_seconds
  → compute weight for this event:
        weight = faceScoreWeight * floor(duration_seconds / absenceScoreIntervalSeconds),
        capped at maxAbsenceEventWeight
  → add that weight to ExamSession.suspicion_score once, at closure
```

Same pattern applies to `multiple_faces`. This replaces the old
"debounce-and-collapse" dedup approach (Step 7) specifically for camera
events — Step 7's dedup rule still applies as-is to the non-camera discrete
events (`fullscreen_exit`, `tab_switch`, `copy_paste`, `devtools_open`),
since those don't have a meaningful "duration."

**Paste-content similarity.** A generic copy/paste is a weak signal; pasting
text that closely matches the current question's wording is a much stronger
one (suggests searching the question elsewhere or using another AI). Add a
`similarity_to_question` field inside `copy_paste` event metadata — a 0–1
score computed client- or server-side comparing pasted text against the
current question text. Doesn't change the weight automatically, but is
available on the event for the admin to see if an appeal is being reviewed,
and can optionally be used to bump the weight for high-similarity pastes
later.

---

## Step 13 — Book ingestion produces a Curriculum (dummy today, RAG later)

A book gets uploaded, and instead of an admin manually creating a
`Curriculum` and typing out `Chapter`s, the system generates them.

**Flow (today — dummy):**
```
Book uploaded
  → Book created, status: "uploaded"
  → processBook(bookId, studentId?) runs (today: a stub that fabricates
    fixed dummy chapters instead of actually parsing the book)
  → creates one Curriculum (owner_student_id set if personalized — see
    Step 1) + N Chapter docs
  → Book.status = "ready"
  → an Enrollment is created linking the requesting student to the new
    Curriculum, if personalized
```

**Flow (later — real RAG):** `processBook` is replaced internally with:
chunk the book → embed chunks into a vector store → LLM proposes a chapter
breakdown from the chunks → same Curriculum/Chapter/Enrollment creation as
above. The function signature doesn't need to change — only its internals.

Since a `Curriculum` can be personalized (Step 1), the same book may
produce a **different** `Curriculum` per student who requests it — one
`Book` can be the source for many `Curriculum` documents, not just one.

---

## Step 14 — Questions are generated on the fly and stored on the Exam itself

There is intentionally **no separate `Question` bank collection.** A quiz,
mid, or final's questions are generated at the moment a student starts (or
retakes) it, and stored directly on that `Exam` document — fetchable later,
replaced wholesale on the next retake (per Step 4).

**New function (dummy today, RAG later):**
```
generateQuestions(scope, count, examType) → Question[]

scope: a single Chapter (for "quiz"), a list of Chapters (for "mid"),
       or a Curriculum (for "final")
count: how many questions to generate
examType: affects whether MCQ-only (quiz/mid) or MCQ+essay (final)

returns: array of { question_id, prompt, type: "mcq" | "essay",
                     options?: string[], correct_option?: string }
```

**Dummy implementation today:** returns a fixed set of placeholder
questions — enough to exercise the full flow end-to-end without depending
on a working RAG pipeline yet. **Real implementation later:** retrieves
relevant chunks for the scope from the vector store and prompts an LLM to
generate grounded questions. Same function signature and return shape
either way — the rest of the system never needs to know which.

**Storage — directly on `Exam`, not `ExamSession`:**
```
Student starts (or retakes) an exam
  → generateQuestions(scope, count, examType) called
  → Exam.generated_questions = the result (server-side only — includes
    correct_option, never sent to the client as-is)
  → client receives the same questions with correct_option stripped out

Student answers, submits
  → Exam.student_answers = whatever they submitted
  → grading compares student_answers against generated_questions
    (auto for MCQ; essay portions of a final go to
    grading_status: "pending_review" as already specified)
```

For `"quiz"`/`"mid"`, a retake **overwrites** `generated_questions` and
`student_answers` on the same `Exam` document (along with `mark`, `passed`,
`taken`, `grading_status`, `integrity_status` — all reset per Step 4). For
`"final"`, these fields are set once and never overwritten, since the
document itself is never replaced.

**Fetching a stored exam:** `GET /api/exams/:examId` returns the current
`generated_questions` + `student_answers` + result fields directly off the
one `Exam` document — no join, no "which attempt" ambiguity, since only one
exists per identity.

---

## Final Schemas

### Curriculum

| Field            | Type                        | Required | Notes |
|------------------|-----------------------------|----------|-------|
| _id              | ObjectId                    | auto     |       |
| title            | String                      | yes      |       |
| description      | String                      | no       |       |
| book_id          | ObjectId (ref: Book)        | no       | which book this was generated from, if any |
| owner_student_id | ObjectId (ref: Student)     | no       | set for a personalized curriculum belonging to one student; null for a generic/shared one |

> Index on `owner_student_id` — fast "give me this student's curriculum" lookups.

---

### Book

| Field              | Type                          | Required | Notes |
|--------------------|-------------------------------|----------|-------|
| _id                | ObjectId                      | auto     |       |
| title              | String                        | yes      |       |
| original_filename  | String                        | yes      |       |
| storage_path       | String                        | yes      | wherever the raw file lives (local disk today, S3/blob later) |
| status             | String (enum)                 | yes (default: `"uploaded"`) | `"uploaded"`, `"processing"`, `"ready"`, `"failed"` |
| requested_by_student_id | ObjectId (ref: Student) | no       | set if this upload/ingestion was for one specific student's personalized curriculum |
| error_message      | String                        | no       | set if `status: "failed"` |

> One `Book` can be the source for **multiple** `Curriculum` documents
> (e.g. re-processed per student who requests it) — no `curriculum_id`
> lives on `Book` itself; `Curriculum.book_id` points back instead.

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

One **permanent** document per `(student, exam target)` — replaced in place
on quiz/mid retake, never replaced for final (see Step 4).

| Field               | Type                          | Required | Notes |
|---------------------|-------------------------------|----------|-------|
| _id                 | ObjectId                      | auto     |       |
| type                | String (enum)                 | yes      | `"quiz"` (per-chapter), `"mid"` (subset of chapters), `"final"` (whole curriculum) |
| title               | String                        | yes      |       |
| student_id          | ObjectId (ref: Student)       | yes      |       |
| curriculum_id       | ObjectId (ref: Curriculum)    | yes (for `"final"`) | which curriculum this final belongs to |
| chapter_id          | ObjectId (ref: Chapter)       | yes (for `"quiz"` only) | denormalized identity field for quiz lookups/uniqueness — see index below. Not used for `"mid"`/`"final"` (they use ExamChapter / curriculum_id instead) |
| attempt_number      | Number                        | yes (default: 1) | increments **in place** on retake for `"quiz"`/`"mid"` — a counter, not a document discriminator; always `1` for `"final"` |
| generated_questions | Mixed / Array                 | no       | full question set for the current content of this exam, including correct answers (server-side only — see Step 14). Overwritten on quiz/mid retake |
| student_answers     | Mixed / Array                 | no       | the student's submitted answers for the current content. Overwritten on quiz/mid retake |
| taken               | Boolean                       | yes (default: false) | whether the current content was completed/submitted |
| mark                | Number                        | no       | current official score, null until graded |
| passing_mark        | Number                        | yes (for `"quiz"`) | minimum `mark` needed to pass |
| passed              | Boolean                       | yes (default: false) | `true` once `mark >= passing_mark` |
| grading_status      | String (enum)                 | yes (default: `"auto_graded"`) | `"auto_graded"`, `"pending_review"`, `"graded"` — see GradeHistory |
| integrity_status    | String (enum)                 | yes (default: `"clean"`) | `"clean"`, `"invalidated"` — auto-set to `"invalidated"` when its ExamSession crosses `suspicionThreshold`; only reversible via IntegrityAppeal |
| invalidated_at      | Date                          | no       | timestamp of when `integrity_status` flipped to `"invalidated"`; null while clean |
| invalidation_notified_at | Date                     | no       | timestamp the invalidation notification was actually sent; null until sent |

> **Type semantics:**
> - `"quiz"` → identity = `(student_id, chapter_id)`, MCQ-only,
>   `grading_status` always `"auto_graded"`. Must be passed (current
>   content) to clear that chapter.
> - `"mid"` → identity = the Exam document itself, created once per
>   enrolled student when the admin defines the mid (Step 9), linked to an
>   admin-selected set of Chapters via ExamChapter (explicit list — Step
>   9). MCQ-only, `grading_status` always `"auto_graded"`. Not required
>   for gating unless decided otherwise later.
> - `"final"` → identity = `(student_id, curriculum_id)`, linked directly
>   to a Curriculum (not via ExamChapter), may include essays. Starts
>   `grading_status: "pending_review"` on submission, becomes `"graded"`
>   once a teacher grades it via GradeHistory. `mark` is the overall
>   curriculum grade. Never replaced.

**Indexes:**
- Unique compound index on `(student_id, chapter_id)`, partial (only where
  `type: "quiz"`) — this is both the lookup for "does a quiz Exam already
  exist for this student+chapter" (replace vs. create) and the uniqueness
  guarantee.
- Index on `(student_id, type)` — general lookups (e.g. "all this
  student's mids").

### Unlocking the final

Before allowing a student to start a `"final"` ExamSession, check at the
application layer:

```
if student is not enrolled in this curriculum → block

for every Chapter in the curriculum:
  find the student's Exam where type = "quiz" AND chapter_id = that Chapter
  if no such Exam exists, OR passed !== true → block access to the final

if every chapter has a passed quiz → allow starting the final
```

(No "most recent attempt" resolution needed anymore — there's only ever
one quiz `Exam` per student per chapter, per Step 4.)

---

### ExamChapter (join table — mid and, historically, quiz linkage)

| Field       | Type                     | Required | Notes |
|-------------|--------------------------|----------|-------|
| _id         | ObjectId                 | auto     |       |
| chapter_id  | ObjectId (ref: Chapter)  | yes      |       |
| exam_id     | ObjectId (ref: Exam)     | yes      |       |

> Unique compound index on `(chapter_id, exam_id)` to prevent duplicate links.
> `"mid"` exams link to several chapters this way (Step 9); `"final"` exams
> don't use this table at all (they reference `curriculum_id` directly on
> `Exam`). `"quiz"` exams primarily use the denormalized `Exam.chapter_id`
> field now (Step 4/14) for fast identity lookups — an ExamChapter row for
> a quiz is optional/redundant and not required by any other part of the
> system.

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

### IntegrityAppeal (manual override log — the only path back from "invalidated")

| Field         | Type                          | Required | Notes |
|---------------|-------------------------------|----------|-------|
| _id           | ObjectId                      | auto     |       |
| exam_id       | ObjectId (ref: Exam)          | yes      | must currently have `integrity_status: "invalidated"` |
| submitted_note| String                        | no       | what the admin transcribed from the student's email |
| resolved_by   | String (or ref to a future Admin/Teacher model) | yes | who made the call |
| resolution    | String (enum)                 | yes      | `"upheld"` (flag stands) or `"cleared"` (false positive, flag reversed) |
| allow_retake  | Boolean                       | yes (default: false) | only meaningful when `resolution: "cleared"` AND the Exam's `type` is `"final"` — explicitly authorizes one new final Exam document despite the one-shot rule |
| resolved_at   | Date                          | yes      |       |

**Flow:** admin receives an email, manually creates one `IntegrityAppeal`
row per resolved case. If `resolution: "cleared"` → set the linked
`Exam.integrity_status` back to `"clean"`. Nothing else in the system writes
to `IntegrityAppeal` or reverses `integrity_status` — it's a fully manual,
logged action.

---

### ExamSession

1:1 companion to an `Exam` doc — the live proctoring state for its current
content. On a quiz/mid retake, the previous `ExamSession` (and its
`ProctoringEvent`s) for that `exam_id` are deleted and a fresh one created,
since `Exam._id` stays fixed but its content is wholesale replaced.

| Field              | Type                       | Required | Notes |
|--------------------|-----------------------------|----------|-------|
| _id                | ObjectId                   | auto     |       |
| exam_id            | ObjectId (ref: Exam), unique | yes    | 1:1 — one session per Exam's current content |
| student_id         | ObjectId (ref: Student)     | yes      |       |
| started_at         | Date                        | yes      |       |
| ended_at           | Date                        | no       |       |
| suspicion_score    | Number                      | yes (default: 0) | running total for the current content |
| flagged            | Boolean                     | yes (default: false) | true once score >= suspicionThreshold |
| status             | String (enum)               | yes      | `"in_progress"`, `"completed"`, `"terminated"` — crossing `suspicionThreshold` no longer changes this; the exam continues, only `flagged`/`Exam.integrity_status` change (see Step 10) |
| terminated_reason  | String (enum)               | no       | `"suspicion_threshold"` (manual admin stop only, not automatic), `"manual_admin_stop"`, `"student_submitted"`, `"timeout"` — only set when status is `"completed"`/`"terminated"` |

---

### ProctoringEvent (the "cheating log")

Belongs to one `Exam`'s current content — deleted and recreated fresh on a
quiz/mid retake, same as `ExamSession`.

| Field           | Type                          | Required | Notes |
|-----------------|-------------------------------|----------|-------|
| _id             | ObjectId                      | auto     |       |
| exam_id         | ObjectId (ref: Exam)          | yes      | which exam's current content this belongs to |
| student_id      | ObjectId (ref: Student)       | yes      | denormalized for fast querying |
| type            | String (enum)                 | yes      | see event types below |
| weight          | Number                        | yes      | points added to suspicion score — flat (discrete events) or duration-computed (camera events), see below |
| score_at_event  | Number                        | yes      | cumulative suspicion score at the moment this event's weight was added |
| occurrences     | Number                        | yes (default: 1) | discrete events only — raw firing count collapsed within the debounce window |
| last_seen_at    | Date                          | yes      | discrete events: updated on each collapsed occurrence. Camera events: updated on each continued-absence tick |
| duration_seconds| Number                        | no       | camera events (`no_face`/`multiple_faces`) only — continuous duration of the condition, finalized when it clears |
| ended_at        | Date                          | no       | camera events only — when the condition cleared and duration/weight were finalized; null while still ongoing |
| metadata        | Mixed / Object                | no       | event-specific extra data |

**Dedup rule (discrete events only** — `fullscreen_exit`, `tab_switch`,
`copy_paste`, `devtools_open`): if a new raw event of the same `type` fires
for the same `(exam_id, type)` within `duplicateEventWindowMs` of the
existing doc's `last_seen_at`, update that doc (`occurrences++`,
`last_seen_at` = now) instead of inserting a new one. The suspicion score
only increments once per window, using this doc's `weight`.

**Duration rule (camera events only** — `no_face`, `multiple_faces`, and
only during `"mid"`/`"final"` — see Step 11): while the condition persists,
extend the same open document (`ended_at: null`) instead of creating new
ones. When it clears, finalize `duration_seconds`, compute
`weight = faceScoreWeight (or multipleFacesWeight) * floor(duration_seconds
/ absenceScoreIntervalSeconds)`, capped at `maxAbsenceEventWeight`, and add
that weight to `ExamSession.suspicion_score` once.

#### Event types → maps to your weights

| Enum value          | Weight source              | Applies to           | Example metadata |
|----------------------|-----------------------------|-----------------------|-------------------|
| `no_face`            | `faceScoreWeight` (duration-scaled) | `"mid"`, `"final"` only | `{ confidence }` |
| `multiple_faces`     | `multipleFacesWeight` (duration-scaled) | `"mid"`, `"final"` only | `{ faceCount }` |
| `fullscreen_exit`    | `fullscreenExitWeight`      | all types | `{}` |
| `tab_switch`         | `tabSwitchWeight`           | all types | `{}` |
| `copy_paste`         | `copyPasteWeight`           | all types | `{ action: "copy" \| "paste", textLength, similarity_to_question }` |
| `devtools_open`      | `devtoolsWeight`            | all types | `{}` |

**Indexes (for the admin review screen):**
- Compound index on `(exam_id, student_id)` — fetch all events for one attempt
- Index on `(exam_id, createdAt)` — chronological order per attempt
- Index on `type` — optional, filter/count by event type across exams

---

### ProctoringConfig (plain config module, not a DB collection)

```js
{
  faceDetectionIntervalMs: 3000,
  faceDetectionExamTypes: ["mid", "final"], // "quiz" never starts the camera
  suspicionThreshold: 50,
  faceScoreWeight: 15,
  fullscreenExitWeight: 30,
  tabSwitchWeight: 25,
  copyPasteWeight: 20,
  devtoolsWeight: 35,
  multipleFacesWeight: 25,
  duplicateEventWindowMs: 5000,       // discrete events only (Step 7)
  absenceScoreIntervalSeconds: 15,    // camera events: one weight increment per N continuous seconds
  maxAbsenceEventWeight: 60,          // camera events: cap per single continuous absence
}
```

Keep as a static module for now, not per-exam DB data. Can migrate to DB later
if you want per-exam custom thresholds.

---

## Relationships summary

```
Book       1---N Curriculum
Curriculum 1---N Chapter
Curriculum 1---N Exam (type = "final" only)
Curriculum 1---N Enrollment N---1 Student
Student    1---N Exam
Exam       1---1 Chapter                     (type = "quiz", via Exam.chapter_id)
Exam       1---N ExamChapter N---1 Chapter   (type = "mid" only)
Exam       1---1 ExamSession                 (recreated on quiz/mid retake)
Exam       1---N ProctoringEvent             (recreated on quiz/mid retake)
Exam       1---N GradeHistory                (type = "final" only)
Exam       1---N IntegrityAppeal             (only when integrity_status = "invalidated")
Student    1---N ProctoringEvent (denormalized)
```

Note: for `"quiz"`, `Exam` is permanent per `(student, chapter)` and
*replaced in place* on retake — not accumulated as separate documents. Only
`"final"` accumulates a second document, and only via the explicit
appeal-authorized exception.
