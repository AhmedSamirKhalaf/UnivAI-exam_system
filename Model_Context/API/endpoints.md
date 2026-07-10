# Exam Platform — Frontend Documentation

**Stack:** Next.js 16 App Router, MongoDB (Mongoose), Zod  
**Auth:** Mocked — `student_id` is passed directly in request bodies  
**Base URL:** `http://localhost:3000`

---

## Table of Contents

1. [Books](#1-books)
   - [POST /api/books](#11-post-apibooks)
   - [GET /api/books/:id](#12-get-apibooksid)
2. [Enrollments](#2-enrollments)
   - [POST /api/enrollments](#21-post-apienrollments)
3. [Curricula](#3-curricula)
   - [GET /api/curricula/:id/chapters](#31-get-apicurriculaidchapters)
4. [Exams — Quiz](#4-exams--quiz)
   - [POST /api/exams/quiz/start](#41-post-apiexamsquizstart)
5. [Exams — Mid](#5-exams--mid)
   - [POST /api/exams/mid](#51-post-apiexamsmid)
   - [POST /api/exams/mid/:examId/start](#52-post-apiexamsmidexamidstart)
6. [Exams — Final](#6-exams--final)
   - [POST /api/exams/final/start](#61-post-apiexamsfinalstart)
7. [Exam — Read / Submit / Grade / Download](#7-exam--read--submit--grade--download)
   - [GET /api/exams/:examId](#71-get-apiexamsexamid)
   - [POST /api/exams/:examId/submit](#72-post-apiexamsexamidsubmit)
   - [POST /api/exams/:examId/grade](#73-post-apiexamsexamidgrade)
   - [GET /api/exams/:examId/download](#74-get-apiexamsexamiddownload)
8. [Proctoring](#8-proctoring)
   - [POST /api/exams/:examId/proctoring-event](#81-post-apiexamsexamidproctoring-event)
9. [Integrity Appeals](#9-integrity-appeals)
   - [POST /api/appeals](#91-post-apiappeals)

---

## 1. Books

### 1.1 POST /api/books

**Purpose:** Upload a book. Triggers auto-processing that creates a Curriculum with 5 chapters and optionally enrolls a student.

**Request:**
```json
{
  "title": "Introduction to Physics",
  "original_filename": "physics.pdf",
  "storage_path": "/uploads/physics.pdf",
  "student_id": "661f1a2b3c4d5e6f7a8b9c0d"
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `title` | string | yes | Book title |
| `original_filename` | string | yes | Original upload filename |
| `storage_path` | string | yes | File path on disk/blob |
| `student_id` | ObjectId | no | If provided, auto-enrolls this student + marks as `requested_by_student_id` |

**Response 201:**
```json
{
  "_id": "661f1a2b3c4d5e6f7a8b9c0e",
  "title": "Introduction to Physics",
  "original_filename": "physics.pdf",
  "storage_path": "/uploads/physics.pdf",
  "status": "ready",
  "requested_by_student_id": "661f1a2b3c4d5e6f7a8b9c0d",
  "createdAt": "2026-07-10T12:00:00.000Z",
  "updatedAt": "2026-07-10T12:00:00.000Z"
}
```

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | File upload form — after user selects a file and clicks "Upload" |
| Loading state | Show a progress bar / spinner while the endpoint processes (it runs `processBook` synchronously which creates curriculum + chapters) |
| Response handling | Store `book._id` in local state. Navigate to the book detail page or curriculum page |
| Error handling | If 400: show validation message. If 500: show "Processing failed" with retry button |
| Re-fetching | The response is final — no need to poll unless you want to see updatedAt |

**UI suggestions:**
- Upload page with drag-and-drop file zone
- After upload, show the book card with title, filename, status badge (green "ready"), link to view chapters
- If `status` is "failed", show a red badge and retry button

---

### 1.2 GET /api/books/:id

**Purpose:** Fetch a single book by ID (check status after processing).

**Response 200:**
```json
{
  "_id": "661f1a2b3c4d5e6f7a8b9c0e",
  "title": "Introduction to Physics",
  "status": "ready",
  "original_filename": "physics.pdf",
  "storage_path": "/uploads/physics.pdf",
  "requested_by_student_id": "661f1a2b3c4d5e6f7a8b9c0d",
  "createdAt": "2026-07-10T12:00:00.000Z",
  "updatedAt": "2026-07-10T12:00:00.000Z"
}
```

**Status values:** `"uploaded"`, `"processing"`, `"ready"`, `"failed"`

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | After `POST /api/books`, or to render a book detail page |
| Polling | Only poll if the previous POST response showed `status: "uploaded"` or `"processing"`. Poll every 2-3s until `"ready"` or `"failed"` |
| Response handling | Show book title, status badge, download link for the file |

**UI suggestions:**
- Breadcrumb: Books > Book Title
- Status badge component that auto-refreshes when polling
- "View Curriculum" button that links to the curriculum detail page (you can get `curriculum_id` by querying `/api/curricula?book_id=:id` — not implemented yet, or via the book's internally-created curriculum)

---

## 2. Enrollments

### 2.1 POST /api/enrollments

**Purpose:** Manually enroll a student in a curriculum (also happens automatically when a book is uploaded with `student_id`).

**Request:**
```json
{
  "student_id": "661f1a2b3c4d5e6f7a8b9c0d",
  "curriculum_id": "661f1a2b3c4d5e6f7a8b9c0f",
  "enrolled_at": "2026-07-10T12:00:00.000Z",
  "status": "active"
}
```

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `student_id` | ObjectId (24 hex) | yes | — | Must be a valid MongoDB ObjectId |
| `curriculum_id` | ObjectId (24 hex) | yes | — | Must be a valid MongoDB ObjectId |
| `enrolled_at` | ISO date string | yes | — | |
| `status` | enum | no | `"active"` | `"active"` \| `"completed"` \| `"withdrawn"` |

**Response 201:** the created Enrollment document
```json
{
  "_id": "661f...",
  "student_id": "661f1a2b3c4d5e6f7a8b9c0d",
  "curriculum_id": "661f1a2b3c4d5e6f7a8b9c0f",
  "enrolled_at": "2026-07-10T12:00:00.000Z",
  "status": "active",
  "createdAt": "...",
  "updatedAt": "..."
}
```

**Response 409:**
```json
{ "error": "Student is already enrolled in this curriculum" }
```

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | Admin panel — "Enroll Student" form selecting student + curriculum |
| Loading | Show button spinner |
| Response | Show success toast, add enrollment to the list |
| Error 409 | Show "Already enrolled" toast (informational, not an error) |

**UI suggestions:**
- Admin-only page with student dropdown + curriculum dropdown
- List current enrollments with status badges (green = active, grey = completed, red = withdrawn)
- "Withdraw" button to change status (PATCH endpoint not implemented — use the update pattern if needed)

---

## 3. Curricula

### 3.1 GET /api/curricula/:id/chapters

**Purpose:** List all chapters for a curriculum, sorted by number. Chapters are auto-created when a book is uploaded.

**Response 200:**
```json
[
  {
    "_id": "661f1a2b3c4d5e6f7a8b9c10",
    "curriculum_id": "661f1a2b3c4d5e6f7a8b9c0f",
    "title": "Introduction",
    "number": 1,
    "createdAt": "2026-07-10T12:00:00.000Z",
    "updatedAt": "2026-07-10T12:00:00.000Z"
  },
  {
    "_id": "661f1a2b3c4d5e6f7a8b9c11",
    "curriculum_id": "661f1a2b3c4d5e6f7a8b9c0f",
    "title": "Core Concepts",
    "number": 2,
    "createdAt": "2026-07-10T12:00:00.000Z",
    "updatedAt": "2026-07-10T12:00:00.000Z"
  },
  {
    "_id": "661f1a2b3c4d5e6f7a8b9c12",
    "curriculum_id": "661f1a2b3c4d5e6f7a8b9c0f",
    "title": "Advanced Topics",
    "number": 3,
    "createdAt": "2026-07-10T12:00:00.000Z",
    "updatedAt": "2026-07-10T12:00:00.000Z"
  },
  {
    "_id": "661f1a2b3c4d5e6f7a8b9c13",
    "curriculum_id": "661f1a2b3c4d5e6f7a8b9c0f",
    "title": "Practical Applications",
    "number": 4,
    "createdAt": "2026-07-10T12:00:00.000Z",
    "updatedAt": "2026-07-10T12:00:00.000Z"
  },
  {
    "_id": "661f1a2b3c4d5e6f7a8b9c14",
    "curriculum_id": "661f1a2b3c4d5e6f7a8b9c0f",
    "title": "Review & Summary",
    "number": 5,
    "createdAt": "2026-07-10T12:00:00.000Z",
    "updatedAt": "2026-07-10T12:00:00.000Z"
  }
]
```

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | When user opens a curriculum detail page |
| Response handling | Render as a chapter list. Use `number` for ordering, `title` for display |
| Empty state | Show "No chapters yet" message |

**UI suggestions:**
- Chapters displayed as a vertical timeline with numbers
- Each chapter card shows: title, number, quiz status (passed/not started/retake available)
- Click a chapter → navigate to quiz page for that chapter
- A progress bar at the top showing how many chapters' quizzes are passed (this is the gate for the final)

---

## 4. Exams — Quiz

### 4.1 POST /api/exams/quiz/start

**Purpose:** Start or retake a per-chapter quiz. Uses **find-or-reset**: if a quiz already exists for this (student + chapter), questions are regenerated and all previous answers/proctoring data is wiped. If not, a fresh exam is created.

**Gating:** Student must be enrolled in the chapter's curriculum. Returns 500 with "not enrolled" if not.

**Request:**
```json
{
  "student_id": "661f1a2b3c4d5e6f7a8b9c0d",
  "chapter_id": "661f1a2b3c4d5e6f7a8b9c10"
}
```

**Response 200 (retake) or 201 (fresh):**
```json
{
  "exam": {
    "_id": "661f1a2b3c4d5e6f7a8b9c20",
    "type": "quiz",
    "title": "Quiz: Introduction",
    "student_id": "661f1a2b3c4d5e6f7a8b9c0d",
    "chapter_id": "661f1a2b3c4d5e6f7a8b9c10",
    "attempt_number": 2,
    "generated_questions": [
      {
        "question_id": "q_1",
        "prompt": "Placeholder MCQ question 1?",
        "type": "mcq",
        "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"]
      },
      {
        "question_id": "q_2",
        "prompt": "Placeholder MCQ question 2?",
        "type": "mcq",
        "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"]
      }
    ],
    "taken": false,
    "passing_mark": 3,
    "grading_status": "auto_graded",
    "integrity_status": "clean"
  },
  "created": false
}
```

| Field | Notes |
|-------|-------|
| `exam._id` | Exam document ID — use this for submit and proctoring |
| `exam.generated_questions` | Questions WITHOUT `correct_option` (hidden server-side until submitted) |
| `exam.passing_mark` | Number of correct answers needed to pass (here: 3 out of 5) |
| `exam.taken` | Always `false` after start — set to `true` only after submit |
| `created` | `true` if this is a fresh exam, `false` if it's a retake |

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | User clicks "Start Quiz" on a chapter card |
| Loading | Full-page loader while questions generate |
| Response handling | Navigate to the quiz-taking screen with the questions displayed |
| Error "not enrolled" | Show "You must be enrolled in this curriculum first" |

**UI suggestions:**
- Quiz page: question-by-question or all-at-once layout
- Show question number (e.g., "Question 3 of 5")
- Show `attempt_number` as "Attempt 2 of 3" if you implement max attempts
- Each MCQ: radio buttons for A/B/C/D
- Timer component (optional — the backend doesn't enforce time, but you could add a frontend timer)
- "Submit" button at the bottom — do NOT show correct answers yet

---

## 5. Exams — Mid

### 5.1 POST /api/exams/mid

**Purpose:** Admin batch-creates a mid-term exam for ALL actively enrolled students in a curriculum. Creates one Exam + ExamChapter documents per student.

**Request:**
```json
{
  "curriculum_id": "661f1a2b3c4d5e6f7a8b9c0f",
  "title": "Mid Term Exam - Physics",
  "chapter_ids": [
    "661f1a2b3c4d5e6f7a8b9c10",
    "661f1a2b3c4d5e6f7a8b9c11",
    "661f1a2b3c4d5e6f7a8b9c12",
    "661f1a2b3c4d5e6f7a8b9c13",
    "661f1a2b3c4d5e6f7a8b9c14"
  ],
  "passing_mark": 3
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `curriculum_id` | string | yes | Must match the curriculum |
| `title` | string | yes | Mid exam title |
| `chapter_ids` | string[] | yes | Min 1, no duplicates. All must belong to the curriculum |
| `passing_mark` | number | yes | Number of correct answers needed to pass |

**Response 201:**
```json
{ "examsCreated": 12 }
```

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | Admin "Create Mid Exam" form |
| Loading | Show button spinner with "Creating exams for N students…" |
| Response handling | Show success toast with count of exams created |
| Error | If a chapter doesn't belong to the curriculum, the error lists the missing chapter IDs |

**UI suggestions:**
- Admin-only page: select curriculum → show chapter checkboxes → enter passing mark → click "Create"
- Preview: "This will create exams for N enrolled students"
- After creation, show link to view the created exams (though there's no "list exams by curriculum" endpoint yet — you'd need to query the DB or navigate to student dashboard)

---

### 5.2 POST /api/exams/mid/:examId/start

**Purpose:** Student starts or retakes their pre-created mid exam. Generates questions from the mid's linked chapters, creates a fresh exam session. Always a "retake/reset" since the exam is pre-created by admin.

**Gating:** Student must be enrolled in the curriculum. Returns 500 with "not enrolled" if not.

**Request:**
```json
{
  "student_id": "661f1a2b3c4d5e6f7a8b9c0d"
}
```

**Response 200:**
```json
{
  "_id": "661f1a2b3c4d5e6f7a8b9c30",
  "type": "mid",
  "title": "Mid Term Exam - Physics",
  "student_id": "661f1a2b3c4d5e6f7a8b9c0d",
  "attempt_number": 1,
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

Same shape as quiz start — `correct_option` is stripped.

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | Student clicks "Start Mid Exam" on their mid exam card |
| Loading | Full-page loader during question generation |
| Response | Navigate to mid exam taking screen (same quiz UI but labeled "Mid Term") |
| Note | Mid exams have longer question sets — consider a scrollable layout |

**UI suggestions:**
- Same quiz-taking UI component, but with "Mid Term Exam" header
- Display chapter coverage: "Covers chapters: Introduction, Core Concepts, Advanced Topics"
- Option to flag questions for review (frontend-only, no backend support yet)

---

## 6. Exams — Final

### 6.1 POST /api/exams/final/start

**Purpose:** Start the one-shot final exam for a curriculum. Cannot be retaken unless an integrity appeal with `allow_retake: true` has been cleared.

**Gating (all must pass):**
1. Student must be enrolled in the curriculum
2. Every chapter's quiz must exist and have `passed: true`
3. A final exam must not already exist for this (student + curriculum) — unless a cleared IntegrityAppeal with `allow_retake: true` exists

**If gate fails, response is 500 with a reason string** (e.g. `"Chapter "Advanced Topics" quiz not yet passed"`).

**Request:**
```json
{
  "student_id": "661f1a2b3c4d5e6f7a8b9c0d",
  "curriculum_id": "661f1a2b3c4d5e6f7a8b9c0f"
}
```

**Response 200:**
```json
{
  "_id": "661f1a2b3c4d5e6f7a8b9c40",
  "type": "final",
  "title": "Final: Introduction to Physics",
  "student_id": "661f1a2b3c4d5e6f7a8b9c0d",
  "curriculum_id": "661f1a2b3c4d5e6f7a8b9c0f",
  "attempt_number": 1,
  "generated_questions": [
    {
      "question_id": "q_1",
      "prompt": "Placeholder MCQ question 1?",
      "type": "mcq",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"]
    },
    {
      "question_id": "q_3",
      "prompt": "Placeholder essay question 3 — describe a key concept.",
      "type": "essay"
    }
  ],
  "taken": false,
  "grading_status": "auto_graded",
  "integrity_status": "clean"
}
```

**Note:** Every 3rd question is an `"essay"` type (no options, no `correct_option`). The student types a free-text response. Essay answers are NOT auto-graded — the final goes to `"pending_review"` on submit for teacher grading.

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | Student clicks "Start Final Exam" — but first show a gating checklist |
| Pre-check | Before calling the endpoint, show chapter progress: "You have passed 5/5 quizzes" — this avoids a failed request |
| Loading | Full-page loader with "Preparing your final exam…" |
| Gating failure | Show which chapter quiz is not passed (from error message). Add a "Go to Chapter" link |
| Already attempted | If 500 with "already exists" + no appeal, show "You've already taken the final exam" |
| Success | Navigate to final exam screen |

**UI suggestions:**
- **Dashboard component:** Show curriculum progress as a checklist:
  - ✅ Chapter 1 Quiz (passed)
  - ✅ Chapter 2 Quiz (passed)
  - ❌ Chapter 3 Quiz (not passed) — link to start
  - 🔒 Final Exam (locked — shows "Pass all quizzes to unlock")
- Final exam screen: 
  - MCQ questions use radio buttons
  - Essay questions use a textarea with word count
  - Timer (frontend-only)
  - "Submit" button sends to `POST /api/exams/:id/submit`

---

## 7. Exam — Read / Submit / Grade / Download

### 7.1 GET /api/exams/:examId

**Purpose:** Fetch an exam's current state. `correct_option` is stripped if `taken: false`.

**Response 200 (taken: false — before submit):**
```json
{
  "_id": "661f1a2b3c4d5e6f7a8b9c20",
  "type": "quiz",
  "title": "Quiz: Introduction",
  "generated_questions": [
    {
      "question_id": "q_1",
      "prompt": "Placeholder MCQ question 1?",
      "type": "mcq",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"]
    }
  ],
  "taken": false
}
```

**Response 200 (taken: true — after submit):**
```json
{
  "_id": "661f1a2b3c4d5e6f7a8b9c20",
  "type": "quiz",
  "title": "Quiz: Introduction",
  "generated_questions": [
    {
      "question_id": "q_1",
      "prompt": "Placeholder MCQ question 1?",
      "type": "mcq",
      "options": ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
      "correct_option": "A"
    }
  ],
  "student_answers": [
    { "question_id": "q_1", "answer": "A" }
  ],
  "taken": true,
  "mark": 5,
  "passing_mark": 3,
  "passed": true,
  "grading_status": "auto_graded"
}
```

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | After navigation to exam detail page, after submit to show results |
| Before submit | Show questions WITHOUT correct answers |
| After submit | Show full review: questions, your answers, correct answers, mark, passed/failed |
| Polling | Not needed — fetch once on page load |

**UI suggestions:**
- **Before submit:** clean question display with answer selection
- **After submit:** show result card at top (green "Passed" / red "Failed"), then scrollable answer review where each question shows your answer + correct answer side by side

---

### 7.2 POST /api/exams/:examId/submit

**Purpose:** Submit answers and trigger grading.

**Request:**
```json
{
  "student_answers": [
    { "question_id": "q_1", "answer": "A" },
    { "question_id": "q_2", "answer": "C" },
    { "question_id": "q_3", "answer": "B" }
  ]
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `student_answers` | array | yes | Array of answer objects |
| `[].question_id` | string | yes | Matches `question_id` in `generated_questions` |
| `[].answer` | string | yes | For MCQ: "A"/"B"/"C"/"D". For essay: free text |

**Response 200 (quiz/mid — auto-graded):**
```json
{
  "_id": "661f1a2b3c4d5e6f7a8b9c20",
  "generated_questions": [
    {
      "question_id": "q_1",
      "type": "mcq",
      "correct_option": "A",
      "prompt": "...",
      "options": ["A) ...", "B) ...", "C) ...", "D) ..."]
    }
  ],
  "student_answers": [
    { "question_id": "q_1", "answer": "A" },
    { "question_id": "q_2", "answer": "C" }
  ],
  "taken": true,
  "mark": 5,
  "passing_mark": 3,
  "passed": true,
  "grading_status": "auto_graded"
}
```

**Response 200 (final — pending review):**
```json
{
  "_id": "661f1a2b3c4d5e6f7a8b9c40",
  "taken": true,
  "mark": null,
  "grading_status": "pending_review",
  "passed": false
}
```
For finals, `mark` is `null` and `passed` is `false` until a teacher grades it.

**Response 500:** "Exam already submitted" — the exam was already submitted and cannot be resubmitted. To retake, the student must call start again (quiz/mid only).

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | User clicks "Submit Exam" after answering all questions |
| Confirmation | Show a confirmation dialog: "Are you sure? You cannot change your answers after submission." |
| Loading | Button spinner "Submitting…" |
| Auto-graded (quiz/mid) | Navigate to results page showing mark, passed/failed, answer review |
| Final (pending_review) | Navigate to "Thank you — your final has been submitted. Awaiting teacher grading." |
| Error "already submitted" | If the exam was already submitted (network issue), just show the existing results by calling GET /api/exams/:examId |

**UI suggestions:**
- **Submit button** at the bottom of the exam, disabled if not all questions answered
- Show unanswered question count: "3 of 5 answered"
- **Confirmation modal:** "You answered 5 of 5 questions. Submit?"
- **Results page (quiz/mid):**
  - Big score display: "5 / 5 — Passed! ✅" or "2 / 5 — Failed ❌"
  - Scroll through each question showing: question, your answer, correct answer (green/red highlight)
  - If failed: "Retake Quiz" button (calls start again)
- **Results page (final):**
  - "Your final exam has been submitted for grading."
  - Show current grading_status
  - If `integrity_status: "invalidated"`, show a warning banner

---

### 7.3 POST /api/exams/:examId/grade

**Purpose:** Teacher grades a final exam (manually grades essay questions). Only works for `type: "final"` with `grading_status: "pending_review"`.

**Request:**
```json
{
  "mark": 85,
  "graded_by": "teacher1",
  "reason": "Well done – comprehensive answers",
  "is_regrade": false
}
```

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `mark` | number | yes | — | Final mark (0-100) |
| `graded_by` | string | yes | — | Teacher identifier |
| `reason` | string | no | — | Visible in GradeHistory |
| `is_regrade` | boolean | no | `false` | Append another GradeHistory entry + overwrite mark |

**Response 200:**
```json
{ "success": true }
```

**Response error (not pending_review):**
```json
{ "error": "Exam is not pending review" }
```

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | Teacher opens a submitted final exam for grading |
| Pre-check | Only show the grade form if `grading_status === "pending_review"` |
| Loading | Button spinner "Submitting grade…" |
| Response | Show success, update the exam status to "graded" |
| Regrade | If already graded (`grading_status === "graded"`) but teacher wants to regrade, check for `is_regrade: true` |

**UI suggestions:**
- **Teacher grading page:**
  - Student info, exam title
  - Student's answers displayed with essay questions highlighted
  - List of essay questions with the student's answer
  - Input field for mark (0-100)
  - Text input for reason
  - "Submit Grade" button
- **After grading:** show "Graded — Mark: 85/100, Passed" with a link to download
- **GradeHistory audit trail:** could be shown in a sidebar (no endpoint to list it, but the data is there)

---

### 7.4 GET /api/exams/:examId/download

**Purpose:** Download a completed exam as a JSON file. Includes full exam data with correct answers, student answers, mark, passed/failed.

**Response 200:** JSON payload (same as GET /api/exams/:examId with `taken: true`), served with header `Content-Disposition: attachment; filename="exam-{examId}.json"`.

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | User clicks "Download" on a completed exam |
| Pre-check | Only show the download button if `exam.taken === true` |
| Implementation | Use `window.open(url)` or an `<a>` tag with the endpoint URL. The browser will download the file automatically |
| Error handling | If 404 (exam not found) or 500, show error toast |

**UI suggestions:**
- Download button with download icon on exam result page
- Also available on teacher grading page for record-keeping

---

## 8. Proctoring

### 8.1 POST /api/exams/:examId/proctoring-event

**Purpose:** Send proctoring events during an active exam session. The backend tracks suspicion score and can silently invalidate the exam if the threshold is crossed.

**Request — discrete events (all exam types):**
```json
{
  "type": "tab_switch",
  "student_id": "661f1a2b3c4d5e6f7a8b9c0d",
  "metadata": { "to": "youtube.com" }
}
```

**Request — camera events (mid/final only):**
```json
{
  "type": "no_face",
  "student_id": "661f1a2b3c4d5e6f7a8b9c0d",
  "detected": true
}
```

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `type` | string | yes | See event types below |
| `student_id` | ObjectId | yes | Who triggered the event |
| `detected` | boolean | only for camera | `true` = face absence detected, `false` = face returned |
| `metadata` | object | no | Free-form additional data |

**Event types:**

| Category | Types | Allowed on |
|----------|-------|------------|
| Discrete | `fullscreen_exit`, `tab_switch`, `copy_paste`, `devtools_open` | quiz, mid, final |
| Camera | `no_face`, `multiple_faces` | mid, final only (quiz returns 400) |

**Response 200:**
```json
{ "success": true }
```

**Response 400 (camera on quiz):**
```json
{ "error": "Camera events not allowed for exam type \"quiz\"" }
```

**How suspicion scoring works (important for frontend behavior):**

1. Each event type has a weight (tab_switch=25, copy_paste=20, devtools_open=35, fullscreen_exit=30, no_face=15, multiple_faces=25)
2. Threshold is 50. When cumulative suspicion_score crosses it:
   - Exam is silently marked `integrity_status: "invalidated"`
   - The session is NOT interrupted (student can keep going)
3. Camera events are duration-based: weight scales with how long the absence lasted

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | Periodically during an active exam (e.g., every 3-5 seconds for camera, on detected events for discrete) |
| Implementation | The FRONTEND is responsible for detecting and sending these events |
| Discrete events | Detect browser tab switches (`visibilitychange`), copy events (`copy`), fullscreen changes, DevTools detection |
| Camera events | Access webcam via `getUserMedia`, run face detection (e.g., TensorFlow.js or MediaPipe), send events when face is lost/found |
| Response handling | Always expect 200. If 400/500, log it silently — don't disrupt the student |
| Silent invalidation | The frontend doesn't know if the exam was invalidated (it's server-side). If you poll GET /api/exams/:examId and see `integrity_status: "invalidated"`, you could show a warning |

**UI suggestions:**
- **Discrete events (Tab switches):**
  - Listen to `document.visibilitychange` and `window.blur`
  - On tab switch: POST proctoring event immediately
  - Show a brief non-blocking toast: "Warning: tab switch detected (1)" but don't interrupt
- **Camera overlay:**
  - Small picture-in-picture of the student's webcam feed (bottom-right corner)
  - Green border when face detected, red border when no face
  - Send events in the background
- **Suspicion/warning indicator:**
  - Optional: periodically fetch GET /api/exams/:examId to check `integrity_status`
  - If `"invalidated"`, show a persistent subtle banner: "Your exam has been flagged for integrity review"
  - Do NOT block the student or force-submit
- **Important:** The proctoring should feel **non-intrusive** — it runs in the background. The student should be able to focus on the exam.

---

## 9. Integrity Appeals

### 9.1 POST /api/appeals

**Purpose:** Admin resolves an integrity appeal for an invalidated exam. Only works on exams with `integrity_status: "invalidated"`.

**Request:**
```json
{
  "exam_id": "661f1a2b3c4d5e6f7a8b9c30",
  "resolution": "cleared",
  "resolved_by": "admin",
  "note": "Student was using a calculator application, not browsing the web",
  "allow_retake": true
}
```

| Field | Type | Required | Default | Notes |
|-------|------|----------|---------|-------|
| `exam_id` | ObjectId | yes | — | The exam to resolve |
| `resolution` | `"upheld"` \| `"cleared"` | yes | — | `"cleared"` = student was innocent |
| `resolved_by` | string | yes | — | Admin identifier |
| `note` | string | no | — | Free-text note |
| `allow_retake` | boolean | no | `false` | Only meaningful for finals — allows starting a new final |

**Resolution effects:**

| Resolution | Quiz/Mid | Final |
|------------|----------|-------|
| `"cleared"` | `integrity_status → "clean"`, `passed` recomputed from `mark` vs `passing_mark` | `integrity_status → "clean"`. If `allow_retake: true`, a new final can be started |
| `"upheld"` | No change to exam data | No change to exam data |

**Response 200:**
```json
{ "success": true }
```

**Response 400:**
```json
{ "error": "Integrity status must be 'invalidated' to file an appeal" }
```

**Frontend treatment:**

| Aspect | Guidance |
|--------|----------|
| When to call | Admin reviews flagged exams and makes a decision |
| Pre-check | Only show the appeal form for exams with `integrity_status: "invalidated"` |
| Loading | Button spinner |
| Response | Show success, update exam status in the list |
| Error "not invalidated" | Show "This exam is not flagged for integrity issues" |

**UI suggestions:**
- **Admin integrity dashboard:**
  - List of exams where `integrity_status === "invalidated"` (no endpoint — you'd need to query by status or add one)
  - Each item shows: student name, exam title, mark (if submitted), proctoring events summary
  - "Review" button opens the appeal form
- **Appeal form:**
  - Resolution radio: "Cleared (student was fine)" / "Upheld (violation confirmed)"
  - Note textarea
  - "Allow Retake" checkbox (only relevant for finals)
  - "Submit" button
- **Student view:** If an exam is invalidated, show a message like "Your exam has been flagged for integrity review. An administrator will review it."

---

## End-to-End Frontend Flow

```
Dashboard
  ├── Upload Book (POST /api/books)
  │     └── Book Detail (GET /api/books/:id)
  │           └── View Curriculum Chapters (GET /api/curricula/:id/chapters)
  │
  ├── Curriculum Detail
  │     ├── Chapter 1 → Start Quiz (POST /api/exams/quiz/start)
  │     │                  └── Take Quiz → Submit (POST /api/exams/:id/submit)
  │     │                                       └── See Results (GET /api/exams/:id)
  │     ├── Chapter 2 → ... (same)
  │     ├── ...
  │     ├── Mid Exam → Start (POST /api/exams/mid/:id/start)
  │     │                  └── Take → Submit → See Results
  │     └── Final Exam → Start (POST /api/exams/final/start) [locked until all quizzes passed]
  │                        └── Take → Submit → "Awaiting grading"
  │                                             └── Teacher grades (POST /api/exams/:id/grade)
  │                                                   └── Download (GET /api/exams/:id/download)
  │
  ├── Proctoring (runs in background during any active exam)
  │     └── POST /api/exams/:id/proctoring-event
  │
  └── Admin: Integrity Appeals (POST /api/appeals)
```

## Common Error Response Format

All endpoints return errors as:
```json
{ "error": "Descriptive message" }
```

| Status | Meaning | Typical Cause |
|--------|---------|---------------|
| 400 | Validation failure / bad request | Missing field, invalid type, camera on quiz |
| 404 | Resource not found | Wrong ObjectId, already deleted |
| 409 | Duplicate | Double enrollment |
| 500 | Server / business-logic error | Not enrolled, exam already submitted, gating check failed, integrity not invalidated |

**Frontend rule:** Always show the `error` message from the response body to the user. It's already human-readable.
