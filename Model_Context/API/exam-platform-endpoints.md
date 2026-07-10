# Exam Platform API — Endpoint Reference

Stack: Next.js 16 App Router, MongoDB (Mongoose), Zod.

All 14 endpoints are thin wrappers around business-logic functions in `src/lib/business-logic.ts`. Auth is mocked — `student_id` is passed directly in request bodies.

---

## Books

### `POST /api/books`
Upload a book. Triggers dummy `processBook` which creates a Curriculum + 5 placeholder chapters.

**Request body:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string | yes | |
| `storage_path` | string | yes | file location on disk/blob |
| `original_filename` | string | yes | original upload filename |
| `student_id` | ObjectId | no | set for personalized curriculum; auto-enrolls this student |

**Response `201`:**
```json
{
  "_id": "661f...",
  "title": "Introduction to Physics",
  "original_filename": "physics.pdf",
  "storage_path": "/uploads/physics.pdf",
  "status": "uploaded",
  "requested_by_student_id": "661f...",
  "createdAt": "2026-07-10T12:00:00.000Z",
  "updatedAt": "2026-07-10T12:00:00.000Z"
}
```

> Book is created with `status: "uploaded"` then immediately `processBook` is called (synchronously in the dummy version), which transitions it through `"processing"` → `"ready"`.

---

### `GET /api/books/:id`
Poll book ingestion progress.

**Response `200`:**
```json
{
  "_id": "661f...",
  "status": "ready"
}
```

Status values: `"uploaded"`, `"processing"`, `"ready"`, `"failed"`.

---

## Enrollments

### `POST /api/enrollments`
Enroll a student in a curriculum.

**Request body:**
| Field | Type | Required | Default |
|-------|------|----------|---------|
| `student_id` | ObjectId | yes | — |
| `curriculum_id` | ObjectId | yes | — |
| `enrolled_at` | ISO date | yes | — |
| `status` | enum | no | `"active"` |

Enum: `"active"`, `"completed"`, `"withdrawn"`.

**Response `201`:** the created Enrollment document.

**Response `409`:** duplicate enrollment (unique compound index on `(student_id, curriculum_id)`).

---

## Curricula

### `GET /api/curricula/:id/chapters`
List all chapters for a curriculum, sorted by `number`.

**Response `200`:**
```json
[
  {
    "_id": "661f...",
    "curriculum_id": "661f...",
    "title": "Introduction",
    "number": 1,
    "createdAt": "...",
    "updatedAt": "..."
  },
  {
    "_id": "661f...",
    "curriculum_id": "661f...",
    "title": "Core Concepts",
    "number": 2
  }
]
```

---

## Exams — Quiz

### `POST /api/exams/quiz/start`
Start or retake a per-chapter quiz. **Find-or-reset** — if an Exam already exists for `(student_id, chapter_id, type: "quiz")`, its content is replaced in place (same `_id`). Otherwise a fresh Exam is created.

Guard: student must be enrolled in the chapter's curriculum.

**Request body:**
| Field | Type | Required |
|-------|------|----------|
| `student_id` | ObjectId | yes |
| `chapter_id` | ObjectId | yes |

**Response `201` (fresh) / `200` (retake):**
```json
{
  "_id": "661f...",
  "type": "quiz",
  "title": "Quiz: Introduction",
  "student_id": "661f...",
  "chapter_id": "661f...",
  "attempt_number": 2,
  "generated_questions": [
    {
      "question_id": "q_1",
      "prompt": "Placeholder MCQ question 1?",
      "type": "mcq",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"]
    }
  ],
  "taken": false,
  "passing_mark": 3,
  "grading_status": "auto_graded",
  "integrity_status": "clean"
}
```

> **`correct_option` is stripped from `generated_questions`** — it only exists server-side until grading.
>
> `attempt_number` increments in place on retake (same document, counter only).
>
> Previous `ExamSession` + `ProctoringEvent`s for this `exam_id` are deleted; a fresh session is created.

---

## Exams — Mid

### `POST /api/exams/mid`
Admin batch-creates a mid exam for all actively enrolled students in a curriculum. One permanent `Exam` + `ExamChapter` rows per student.

**Request body:**
| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `curriculum_id` | ObjectId | yes | all `chapter_ids` must belong here |
| `title` | string | yes | |
| `chapter_ids` | string[] | yes | min 1, no duplicates |
| `passing_mark` | number | yes | |

**Response `201`:**
```json
{ "examsCreated": 12 }
```

Validates every `chapter_id` belongs to `curriculum_id`. Throws if any don't match.

---

### `POST /api/exams/mid/:examId/start`
Start or retake a mid exam. Same reset-in-place behavior as quiz — the Exam already exists (admin pre-created it), so this is always the retake/reset branch. Questions are generated from the mid's chapter set (via `ExamChapter` links).

**Response `200`:** same shape as quiz start (`correct_option` stripped, fresh session created).

---

## Exams — Final

### `POST /api/exams/final/start`
Start the one-shot final exam for a curriculum.

**Gating (checked in order):**
1. Student must be enrolled in the curriculum
2. Every chapter's quiz `Exam` must have `passed: true`
3. A final Exam must not already exist for `(student_id, curriculum_id)` — unless a cleared `IntegrityAppeal` with `allow_retake: true` applies

**Request body:**
| Field | Type | Required |
|-------|------|----------|
| `student_id` | ObjectId | yes |
| `curriculum_id` | ObjectId | yes |

**Response `200`:**
```json
{
  "_id": "661f...",
  "type": "final",
  "title": "Final: Introduction to Physics",
  "curriculum_id": "661f...",
  "attempt_number": 1,
  "generated_questions": [
    { "question_id": "q_1", "prompt": "...", "type": "mcq", "options": [...] },
    { "question_id": "q_3", "prompt": "Placeholder essay question 3 — describe a key concept.", "type": "essay" }
  ],
  "taken": false,
  "grading_status": "auto_graded",
  "integrity_status": "clean"
}
```

**Response `403`:** gating failed (reason in `error` field, e.g. `"Chapter \"Advanced Topics\" quiz not yet passed"`).

---

## Exam — Read

### `GET /api/exams/:examId`
Fetch the current state of any Exam document.

**Behavior:**
- If `taken: false`: `correct_option` is stripped from `generated_questions`
- If `taken: true`: full document including `student_answers`, `mark`, `passed`, correct answers included

**Response `200`:** the Exam document.

---

## Exam — Submit

### `POST /api/exams/:examId/submit`
Submit answers and trigger grading.

**Request body:**
| Field | Type | Required |
|-------|------|----------|
| `student_answers` | array | yes |

Each answer object:
```json
{ "question_id": "q_1", "answer": "A" }
```

**Grading behavior:**
- **Quiz / Mid** → `grading_status = "auto_graded"`, `mark` computed by comparing MCQ answers against `correct_option`, `passed = mark >= passing_mark`
- **Final** → `grading_status = "pending_review"`, `mark` stays `null` (teacher grades later via `POST /api/exams/:examId/grade`)

**Integrity invalidation:**
- If `integrity_status === "invalidated"`: `passed` is forced `false` (quiz/mid)
- The invalidation notification fires once at submission time (`invalidation_notified_at` set; stubbed to `console.log`)

**Response `200`:** updated Exam document with `taken: true`, results populated.

---

## Exam — Proctoring

### `POST /api/exams/:examId/proctoring-event`
Log a proctoring event during an active exam session.

**Request body (discrete events — all exam types):**
```json
{ "type": "tab_switch", "student_id": "objectid", "metadata": { "action": "copy", "textLength": 42, "similarity_to_question": 0.85 } }
```

Discrete types: `fullscreen_exit`, `tab_switch`, `copy_paste`, `devtools_open`.

**Request body (camera events — mid/final only):**
```json
{ "type": "no_face", "student_id": "objectid", "detected": true }
```

Camera types: `no_face`, `multiple_faces`.

**Dedup (discrete):** Events of the same `type` within `duplicateEventWindowMs` (5s) increment `occurrences` on the existing doc instead of creating a new one. Suspicion score bumps once per window.

**Duration (camera):** While `detected: true`, extends the same open event (growing `duration_seconds`). When `detected: false`, closes it, computes `weight = faceScoreWeight * floor(duration_seconds / absenceScoreIntervalSeconds)`, capped at `maxAbsenceEventWeight` (60), and bumps suspicion score once at closure.

**Silent invalidation:** When `ExamSession.suspicion_score` crosses `suspicionThreshold` (50):
- `ExamSession.flagged = true`
- `Exam.integrity_status = "invalidated"`, `Exam.invalidated_at = now`
- **Session is NOT interrupted** — `status` stays `"in_progress"`
- No user-visible change

**Response `200`:**
```json
{ "success": true }
```

**Response `400`:** camera event on quiz type.

---

## Exam — Manual Grading

### `POST /api/exams/:examId/grade`
Teacher grades a final exam (essay portion). Only works for `type: "final"`.

**Request body:**
| Field | Type | Required | Default |
|-------|------|----------|---------|
| `mark` | number | yes | — |
| `graded_by` | string | yes | — |
| `reason` | string | no | `"initial grade"` / `"regrade"` |
| `is_regrade` | boolean | no | `false` |

Inserts a `GradeHistory` row (append-only audit trail) and updates `Exam.mark` + `grading_status = "graded"`. A regrade (`is_regrade: true`) inserts another row and overwrites `Exam.mark` — the history is preserved.

**Response `200`:**
```json
{ "success": true }
```

---

## Exam — Download

### `GET /api/exams/:examId/download`
Download a completed exam as a JSON attachment.

**Response `200`:** JSON payload with full exam data (questions, student answers, correct answers, mark, pass/fail). Served with `Content-Disposition: attachment; filename="exam-{examId}.json"`.

---

## Appeals

### `POST /api/appeals`
Admin resolves an integrity appeal. Only works on exams with `integrity_status: "invalidated"`.

**Request body:**
| Field | Type | Required | Default |
|-------|------|----------|---------|
| `exam_id` | ObjectId | yes | — |
| `resolution` | `"upheld"` or `"cleared"` | yes | — |
| `resolved_by` | string | yes | — |
| `note` | string | no | — |
| `allow_retake` | boolean | no | `false` |

**Resolution effects:**

| Resolution | Quiz/Mid | Final |
|------------|----------|-------|
| `"cleared"` | `integrity_status` → `"clean"`, `passed` recomputed from existing `mark` vs `passing_mark` (no forced retake) | `integrity_status` → `"clean"`. If `allow_retake: true`, a new final Exam can be created |
| `"upheld"` | No change to exam data | No change to exam data |

**Response `200`:**
```json
{ "success": true }
```

---

## Error Response (all endpoints)

```json
{ "error": "Descriptive error message" }
```

| Status | Meaning |
|--------|---------|
| `400` | Validation failure or missing field |
| `403` | Gating check failed (not enrolled, quiz not passed, final already exists) |
| `404` | Resource not found (exam, chapter, book, etc.) |
| `409` | Duplicate (e.g. enrollment already exists) |
| `500` | Server error (details in `error` field) |
