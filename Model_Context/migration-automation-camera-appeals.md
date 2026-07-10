# Migration Notes — Full Automation, Camera Scoping, Duration-Based Scoring

**Purpose:** if a model already generated code from the original
`schema-design.md` build prompt, this document tells it exactly what to add
or change to match Steps 10–12 (now in `schema-design.md`). Don't regenerate
the whole project — apply these as targeted edits.

If no code exists yet, ignore this file and just build from the current
`schema-design.md` directly — everything below is already reflected in it.

> **Also apply section 0 below even if you think you've already covered
> Steps 10–12.** It corrects a deeper assumption from the *original* build
> (before Step 10 even existed) that's since changed: how `Exam` documents
> get created on retake. If your existing code inserts a new `Exam`
> document every time a student retakes a quiz/mid, that no longer matches
> the current schema and needs to change regardless of the automation work
> below.

---

## 0. IMPORTANT — Exam creation logic must change (Step 4 revision)

**Original assumption (now outdated):** every quiz/mid retake created a
**new** `Exam` document, with `attempt_number` distinguishing them, and
"the student's result" meant querying for the most recent one.

**Current design:** there is exactly **one permanent `Exam` document** per
`(student, chapter)` for quizzes, and one per student for each mid
(pre-created by the admin — unchanged from before). A retake **finds that
existing document and overwrites its content** — it does not insert a new
row. `attempt_number` now increments in place on that same document, as a
counter, not a discriminator.

**What this means for existing code:**

1. **`Exam.ts` model** — add a `chapter_id` field (only used for `"quiz"`):
```ts
chapter_id: { type: ObjectId, ref: "Chapter", required: false },
```
Add a partial unique index:
```ts
examSchema.index(
  { student_id: 1, chapter_id: 1 },
  { unique: true, partialFilterExpression: { type: "quiz" } }
);
```
This is both the uniqueness guarantee and the lookup key for "does this
student already have a quiz Exam for this chapter."

2. **Whatever function currently does `Exam.create(...)` for a quiz start**
needs to become a find-or-reset:
```ts
async function startQuiz(studentId, chapterId) {
  // ...enrollment check...

  let exam = await Exam.findOne({ student_id: studentId, chapter_id: chapterId, type: "quiz" });

  if (exam) {
    // RETAKE: reset in place, don't insert
    exam.attempt_number += 1;
    exam.generated_questions = undefined;
    exam.student_answers = undefined;
    exam.taken = false;
    exam.mark = null;
    exam.passed = false;
    exam.grading_status = "auto_graded";
    exam.integrity_status = "clean";
    exam.invalidated_at = undefined;
    exam.invalidation_notified_at = undefined;
  } else {
    // FIRST ATTEMPT: create fresh
    exam = new Exam({
      type: "quiz", student_id: studentId, chapter_id: chapterId,
      attempt_number: 1, passing_mark: /* from chapter/curriculum config */,
    });
  }

  // clean up any previous session/events tied to this exam_id (retake case)
  const oldSession = await ExamSession.findOne({ exam_id: exam._id });
  if (oldSession) {
    await ProctoringEvent.deleteMany({ exam_id: exam._id });
    await ExamSession.deleteOne({ _id: oldSession._id });
  }

  exam.generated_questions = await generateQuestions(/* chapter */, count, "quiz");
  await exam.save();

  await ExamSession.create({ exam_id: exam._id, student_id: studentId, started_at: new Date(), status: "in_progress" });

  return exam; // strip correct_option from generated_questions before returning to client
}
```

3. **Mid retakes** follow the identical reset pattern, except there's no
find-or-create branch — the `Exam` doc always already exists (admin
pre-created it in `createMid`), so it's always the "retake" branch above,
just triggered by the student instead of by chapter lookup.

4. **`Exam.mark`/`Exam.passed` reads elsewhere** (e.g. `canStartFinal`'s
chapter-pass check) get simpler, not harder — replace any "find most
recent attempt" query with a direct `Exam.findOne({ student_id, chapter_id,
type: "quiz" })`, since there's only ever one.

5. **`generated_questions`/`student_answers` fields** — add to `Exam.ts` if
not already present (may already exist if `exam-generation-and-api-design.md`
was built first):
```ts
generated_questions: { type: Schema.Types.Mixed, required: false },
student_answers: { type: Schema.Types.Mixed, required: false },
```

---

## 1. Models — new fields

### `models/Exam.ts`
Add:
```ts
integrity_status: {
  type: String,
  enum: ["clean", "invalidated"],
  default: "clean",
  required: true,
},
invalidated_at: { type: Date, required: false },
invalidation_notified_at: { type: Date, required: false },
```

> **Correcting a prior assumption:** your earlier build's assumption #4 said
> threshold-crossing sets `flagged = true` but leaves termination "for a
> future caller to decide." That's now finalized, but in the opposite
> direction from a default auto-terminate: **the session must never be
> auto-terminated on threshold cross.** It stays `"in_progress"` and the
> exam continues normally. Only `ExamSession.flagged`, `Exam.integrity_status`,
> and the two new timestamp fields change automatically — see section 5.

### `models/ProctoringEvent.ts`
Add:
```ts
duration_seconds: { type: Number, required: false }, // camera events only
ended_at: { type: Date, required: false },            // camera events only, null while ongoing
```
Keep `occurrences` and `last_seen_at` — they're still used, but now only by
the **discrete** event types (`fullscreen_exit`, `tab_switch`, `copy_paste`,
`devtools_open`). Camera events (`no_face`, `multiple_faces`) use
`duration_seconds` + `ended_at` instead — see section 3 below.

### New model: `models/IntegrityAppeal.ts`
```ts
{
  exam_id: { type: ObjectId, ref: "Exam", required: true },
  submitted_note: { type: String, required: false },
  resolved_by: { type: String, required: true },
  resolution: { type: String, enum: ["upheld", "cleared"], required: true },
  allow_retake: { type: Boolean, default: false },
  resolved_at: { type: Date, required: true },
}
```
`{ timestamps: true }` as usual.

### `models/ExamSession.ts`
**No change.** Whether a session runs the camera is derived from
`Exam.type` at the moment the session starts (see section 4) — it's not
stored on the session itself.

---

## 2. Zod schemas — matching updates

- `schemas/exam.ts` → add `integrity_status` (enum, same values as above).
- `schemas/proctoringEvent.ts` → add optional `duration_seconds` (number),
  `ended_at` (date, nullable). Add `similarity_to_question` (number, 0–1,
  optional) inside the metadata schema used for `copy_paste` events.
- New `schemas/integrityAppeal.ts` for the fields above — this is the input
  shape for the admin's manual resolution action, not a student-facing form.

---

## 3. `lib/proctoring/recordProctoringEvent.ts` — split by event category

The single dedup function from the original prompt now needs to branch by
event type. Recommended structure: keep one exported entry point, route
internally.

```ts
const CAMERA_EVENT_TYPES = ["no_face", "multiple_faces"];
const DISCRETE_EVENT_TYPES = ["fullscreen_exit", "tab_switch", "copy_paste", "devtools_open"];

export async function recordProctoringEvent(examId, studentId, type, payload) {
  if (CAMERA_EVENT_TYPES.includes(type)) {
    return recordCameraEvent(examId, studentId, type, payload); // new
  }
  return recordDiscreteEvent(examId, studentId, type, payload); // existing logic, unchanged
}
```

**`recordDiscreteEvent`** — this is the function that already existed in the
original build. No logic change needed, just rename/isolate it if it wasn't
already its own function.

**`recordCameraEvent`** (new) — implements Step 12's open/close duration
pattern:
```ts
async function recordCameraEvent(examId, studentId, type, { detected }) {
  const open = await ProctoringEvent.findOne({ exam_id: examId, type, ended_at: null });

  if (detected) {
    // condition still present (no face / multiple faces) → extend
    if (open) {
      open.last_seen_at = new Date();
      open.duration_seconds = (Date.now() - open.createdAt.getTime()) / 1000;
      await open.save();
    } else {
      await ProctoringEvent.create({
        exam_id: examId, student_id: studentId, type,
        weight: 0, score_at_event: /* current session score */,
        duration_seconds: 0, last_seen_at: new Date(),
      });
    }
    return;
  }

  // condition cleared → close and score
  if (open) {
    const durationSeconds = (Date.now() - open.createdAt.getTime()) / 1000;
    const weightSource = type === "no_face" ? config.faceScoreWeight : config.multipleFacesWeight;
    const computedWeight = Math.min(
      weightSource * Math.floor(durationSeconds / config.absenceScoreIntervalSeconds),
      config.maxAbsenceEventWeight
    );

    open.ended_at = new Date();
    open.duration_seconds = durationSeconds;
    open.weight = computedWeight;
    await open.save();

    if (computedWeight > 0) {
      await bumpSuspicionScore(examId, computedWeight); // updates ExamSession + calls checkIntegrityThreshold, see section 5
    }
  }
}
```

> This is illustrative pseudocode, not final implementation — get the exact
> field/query details right against the actual Mongoose models, but the
> control flow (open → extend → close → score-once) is the part that must
> match Step 12.

---

## 4. Camera gating — client + session start

Wherever the exam-taking client currently initializes face-api.js
unconditionally, gate it:

```ts
if (config.faceDetectionExamTypes.includes(exam.type)) {
  // start face-api.js detection loop
}
```
For `"quiz"`, this block simply never runs — no camera permission prompt,
no detection interval, no camera-type ProctoringEvents possible. This is a
**client-side and config check only** (`ProctoringConfig.faceDetectionExamTypes`)
— confirmed in schema-design.md Step 11 that no new DB field is needed for
this.

Also double check: any server-side event-ingestion endpoint should reject
`no_face`/`multiple_faces` events for an `Exam` whose `type` is `"quiz"`, as
a safety check against a tampered client still sending them.

---

## 5. New function: automatic invalidation on threshold cross

This didn't exist in the original build prompt — it's the automation piece
from Step 10. Add it as its own function, called from both
`recordDiscreteEvent` and `recordCameraEvent` (via `bumpSuspicionScore`)
right after `ExamSession.suspicion_score` is updated:

```ts
async function bumpSuspicionScore(examId, weightToAdd) {
  const session = await ExamSession.findOneAndUpdate(
    { exam_id: examId },
    { $inc: { suspicion_score: weightToAdd } },
    { new: true }
  );

  if (session.suspicion_score >= config.suspicionThreshold && !session.flagged) {
    await invalidateExamSilently(session);
  }
  return session;
}

// The exam is NOT interrupted. The student keeps taking it normally.
// This only flips background state — notification happens later, at
// submission (see section 5b), not here.
async function invalidateExamSilently(session) {
  session.flagged = true;
  await session.save();
  // status/terminated_reason are untouched — session stays "in_progress"

  await Exam.findByIdAndUpdate(session.exam_id, {
    integrity_status: "invalidated",
    invalidated_at: new Date(),
    passed: false, // force-fail regardless of raw mark, per Step 10
  });
}
```

### 5b. Notification hook — fires at submission, not at invalidation

The invalidation itself happens silently in the background the moment the
threshold is crossed (5a above). The **notification** is separate and only
fires once the student actually finishes and submits the exam — by then,
every `ProctoringEvent` for the full attempt exists, so the notification
reflects the complete picture rather than a partial snapshot from whenever
the threshold happened to be crossed mid-exam.

Hook this into whatever function already handles exam submission (marks
`Exam.taken = true`, closes the `ExamSession`, etc.):

```ts
async function submitExam(examId) {
  // ...existing submission logic: grade if auto-gradable, set taken = true,
  //    close ExamSession (status: "completed", ended_at: now)...

  const exam = await Exam.findById(examId);
  if (exam.integrity_status === "invalidated") {
    await notifyIntegrityInvalidation(exam);
  }
}
```

```ts
async function notifyIntegrityInvalidation(exam) {
  if (exam.invalidation_notified_at) return; // already sent, don't duplicate

  const session = await ExamSession.findOne({ exam_id: exam._id });
  const events = await ProctoringEvent.find({ exam_id: exam._id }).sort({ createdAt: 1 });

  const payload = {
    examId: exam._id,
    studentId: exam.student_id,
    finalScore: session.suspicion_score, // full-attempt total, not a snapshot
    breakdown: events.map(e => ({
      type: e.type,
      weight: e.weight,
      occurrences: e.occurrences ?? null,
      duration_seconds: e.duration_seconds ?? null,
    })),
  };

  await sendNotification(payload); // plug in your actual email/notification service here

  await Exam.findByIdAndUpdate(exam._id, { invalidation_notified_at: new Date() });
}
```

---

## 6. Update: reading `passed`/`mark` anywhere downstream

Any function that reads `Exam.passed` or `Exam.mark` to make a decision
(most importantly `canStartFinal`'s chapter-check, and anywhere a grade is
displayed) must treat `integrity_status: "invalidated"` as an automatic
fail, not just look at `passed` directly. Since `passed` is force-set to
`false` at invalidation time (section 5 above), most read sites don't need
extra logic — but for `"final"`, where `mark` is separately gated ("not
treated as the official grade"), add an explicit check:

```ts
function isOfficialResult(exam) {
  return exam.integrity_status === "clean";
}
```

Use this anywhere a final's `mark` is surfaced as the curriculum's official
grade (transcripts, dashboards) — an invalidated final's `mark` (if it has
one) should never be presented as official until an `IntegrityAppeal`
clears it.

---

## 7. New function: `resolveIntegrityAppeal`

Admin-only, called manually after receiving an out-of-band email:

```ts
async function resolveIntegrityAppeal(examId, resolution, resolvedBy, note, allowRetake = false) {
  await IntegrityAppeal.create({
    exam_id: examId,
    submitted_note: note,
    resolved_by: resolvedBy,
    resolution,
    allow_retake: allowRetake,
    resolved_at: new Date(),
  });

  if (resolution === "cleared") {
    await Exam.findByIdAndUpdate(examId, { integrity_status: "clean" });
    // note: this does NOT restore `passed` automatically if it was force-set
    // false — decide whether clearing should also recompute `passed` from
    // the original mark, or require a fresh attempt. Flagged as an open
    // question below.
  }
}
```

## 8. `canStartFinal` — handle the one-shot exception

Add the `allow_retake` escape hatch to the existing one-shot check:

```ts
async function canStartFinal(studentId, curriculumId) {
  // ...existing enrollment + chapter-pass checks...

  const existingFinal = await Exam.findOne({ student_id: studentId, curriculum_id: curriculumId, type: "final" });
  if (existingFinal) {
    const clearedAppeal = await IntegrityAppeal.findOne({
      exam_id: existingFinal._id,
      resolution: "cleared",
      allow_retake: true,
    });
    if (!clearedAppeal) return { allowed: false, reason: "final already attempted" };
    // allowed to proceed — this is the one logged exception
  }

  // ...create new final Exam doc...
}
```

---

## Resolved: clearing behavior for quiz/mid appeals

Decision: clearing a `"quiz"`/`"mid"` appeal recomputes `passed` from the
exam's original `mark` against `passing_mark` — no forced retake. Retakes
stay available regardless (unchanged, unlimited), but the student isn't
required to redo work the admin already confirmed wasn't cheating. Update
`resolveIntegrityAppeal` (section 7) accordingly:

```ts
if (resolution === "cleared") {
  const exam = await Exam.findByIdAndUpdate(examId, { integrity_status: "clean" }, { new: true });
  if (exam.type !== "final" && exam.mark != null) {
    await Exam.findByIdAndUpdate(examId, { passed: exam.mark >= exam.passing_mark });
  }
}
```
