# Exam System

A Next.js exam platform with question-by-question navigation, exam monitoring, and voice permission gating. Built with MUI, App Router, and Next.js Route Handlers.

## Project Structure

```
app/
  layout.tsx              - Root layout
  page.tsx                - Exam rules warning page
  globals.css             - Minimal reset (all UI via MUI)
  components/
    QuestionCard.tsx      - Single MCQ question with radio buttons
    QuestionList.tsx      - Sidebar: seen questions with answer checkmarks
    EndExamDialog.tsx     - Confirmation dialog before ending exam
    PermissionGate.tsx    - Mic permission request before exam starts
  hooks/
    useMonitor.ts         - Monitoring hook: camera, face detection, violations
  exam/
    page.tsx              - Exam page with phases: permission → exam → ending
  result/
    page.tsx              - Grade display with per-question breakdown
  data/
    questions.ts          - 10 dummy MCQ questions with answers
  api/
    questions/
      route.ts            - GET: returns questions without answers
    end-exam/
      route.ts            - POST: grades answers, returns results
    violations/
      route.ts            - POST: writes violations to violations.json in root
violations.json           - Created on each exam end (overwritten each time)
```

## Pages

| Route       | Description                                          |
|-------------|------------------------------------------------------|
| `/`         | Exam rules warning page with a "Start Exam" button   |
| `/exam`     | Permission gate → exam with monitoring & violations   |
| `/result`   | Grade, correct count, per-question breakdown         |

## API Endpoints

### `GET /api/questions`
Returns all questions **without** correct answers.

### `POST /api/end-exam`
Receives answers, returns grade and per-question results.

**Request:** `{ "answers": { "q1": "a", "q2": "b", ... } }`

### `POST /api/violations`
Writes violations array to `violations.json` in the project root. Overwrites previous content on each call.

**Request:** `{ "violations": [{ "type": "...", "details": "...", "timestamp": "..." }, ...] }`

## Monitoring

The `useMonitor` hook tracks these violations during the exam:
- `fullscreen_exit` — User left fullscreen
- `tab_switch` — Tab hidden or window lost focus
- `copy_paste` — Copy, cut, paste, or right-click attempted
- `devtools_open` — DevTools shortcut or devtools detected
- `face_not_detected` — No face visible in webcam
- `multiple_faces` — More than one face detected
- `camera_blocked` — Camera permission denied

Each violation records a `type`, `details` string, and ISO `timestamp`. On exam end, all violations are POSTed to `/api/violations` and saved to `violations.json` in the project root (overwritten each time).

## How It Works

1. User lands on `/`, reads exam rules, clicks **Start Exam**.
2. `/exam` loads questions, then shows `PermissionGate` asking for mic access.
3. User enables mic or skips (skip is logged as a violation).
4. Exam starts: camera activates, face detection runs, browser events are monitored.
5. Question navigation: **Next** / **Previous** / sidebar click. Answered questions show a checkmark.
6. **End Exam** shows a confirmation dialog. On confirm: fullscreen exits, violations are saved, answers are submitted.
7. `/result` displays the grade and per-question breakdown.

## Running

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).
