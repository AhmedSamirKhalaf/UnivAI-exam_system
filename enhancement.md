# Enhancement Log

## 1. Sequential Question Fetching (One-by-One)

**Problem:** All exam questions were fetched in a single bulk request, loading the entire exam at once.

**Solution:** Questions are now fetched one after another from the server. Previously fetched questions are cached on the client for instant navigation.

### Changes

- `src/app/api/exams/[examId]/route.ts` — Added `?index=N` query parameter. Without it, returns exam metadata + `question_count` only (no questions). With it, returns the single question at that index (correct_option stripped if exam is in-progress).
- `src/app/exam/[examId]/ExamRunner.tsx` — Complete rewrite of the taking view:
  - Left sidebar shows all question numbers; only fetched ones are clickable, answered ones show a checkmark, current one is highlighted.
  - Questions are fetched sequentially via `fetchQuestion(index)`. Answering the current question auto-prefetches the next one.
  - All fetched questions cached in a ref + state for instant re-navigation.
  - "Next" button fetches the next question if not already cached. "Previous" navigates back instantly.
  - Submit generates answers for all `question_count` questions using the `q_N` ID pattern; unfetched questions submit as blank.

---

## 2. DevTools Detection & Input Blocking

**Problem:** Students could open browser DevTools (F12, right-click Inspect, keyboard shortcuts) to inspect the exam page, view source, or tamper with answers. No detection or prevention existed.

**Solution:** 5-layer defense added to `ExamRunner.tsx`:

| Layer | Mechanism |
|-------|-----------|
| Right-click blocked | `contextmenu` event `preventDefault()` kills "Inspect Element" via right-click |
| Keyboard shortcuts blocked | `keydown` listener prevents F12, Ctrl/Cmd+Shift+I/J/C/K, Ctrl/Cmd+U, Ctrl/Cmd+Shift+S |
| `console.dir` getter trick | A `<div>` with a custom `id` getter is passed to `console.dir()` every 1.5s. When DevTools is open, the console evaluates the element's properties, triggering the getter and firing `devtools_open` |
| Window resize heuristic | Monitors `outerWidth/Height` deltas. A sudden change > 160px indicates docked DevTools being toggled |
| Select/drag disabled | `selectstart` and `dragstart` blocked to prevent text selection and drag-based content extraction |

### Changes

- `src/app/exam/[examId]/ExamRunner.tsx` — Extended the `report` callback type to include `"devtools_open"`. Added a new `useEffect` with all 5 detection/prevention layers. A `devtoolsReported` flag ensures the proctoring event fires only once per session.

### Backend (already existed)

- `devtools_open` was already a supported `ProctoringEventType` with a **weight of 35** (highest discrete event — tab_switch is 25, copy_paste is 20). A single detection pushes the student 35 points toward the 50-point invalidation threshold.

---

## 3. Screen Recording Consent + Multi-Display / Screen-Change Detection

**Problem:** Students could connect multiple monitors, move the exam window between screens, or change screen configuration during the exam to look at external content. No screen recording, display detection, or screen-change monitoring existed.

**Solution:** Consent-gated screen recording + Window Management API detection + screenshot-on-violation webhook.

### Workflow

1. Student loads the exam page.
2. **Consent dialog** appears showing the violations list and a warning. Exam content is **hidden** until the student accepts.
3. Student clicks "I understand and consent — start exam".
4. Browser prompts for screen sharing via `getDisplayMedia()`. If denied, the exam does not start.
5. Screen recording stream is captured and stored in a ref for screenshot access.
6. **Screen-change detection** begins:
   - `screen.isExtended` is checked on mount — if `true`, a display other than the primary is connected.
   - `window.getScreenDetails()` is called (with permission) to enumerate all connected displays and listen for the `change` event on the screen list.
   - `window.screenLeft` / `window.screenTop` are tracked on every `resize` event — a large positional delta indicates the window was moved between screens.
   - A 5-second polling fallback re-checks `screen.isExtended` when `getScreenDetails` is unavailable.
7. On any violation: a screenshot is captured from the recording stream, sent to `POST /api/exams/:examId/screenshot`, a `screen_violation` proctoring event is reported, and the violation is added to the on-screen list.
8. The proctoring banner shows the total violation count in real time.
9. On submit or exam end, screen recording tracks are stopped.

### Violations Detected

| Violation | Detection method | Detail logged |
|-----------|-----------------|---------------|
| `multi_display` | `screen.isExtended === true` or `getScreenDetails().screens.length > 1` | Number of displays detected |
| `screen_change` | `change` event on `ScreenDetails` or user stopped sharing | Old count → new count |
| `window_move` | `screenLeft` / `screenTop` delta exceeds 50px threshold | Window position at time of move |

### Screenshot Webhook

`POST /api/exams/[examId]/screenshot` — receives `{ student_id, image (base64 JPEG), violation_type, metadata }`. Currently a placeholder that logs receipt. Designed to be replaced with cloud storage + DB record.

### Changes

- `src/models/ProctoringEvent.ts` — Added `"screen_violation"` to `ProctoringEventType` union and schema enum.
- `src/schemas/proctoringEvent.ts` — Added `"screen_violation"` to Zod enum.
- `src/lib/proctoring-config.ts` — Added `screenViolationWeight: 40` (highest discrete event weight).
- `src/lib/business-logic.ts` — Added `screen_violation` to `EVENT_WEIGHT_MAP`.
- `src/app/api/exams/[examId]/screenshot/route.ts` — New webhook endpoint (placeholder).
- `src/app/exam/[examId]/ExamRunner.tsx`:
  - New states: `consentGiven`, `screenViolations`, `screenStreamRef`.
  - New consent dialog shown before exam content — lists all monitored violations with a warning.
  - `handleConsent()` calls `getDisplayMedia()`, stores the stream, and sets `consentGiven`.
  - New `useEffect` for screen-change detection: `screen.isExtended`, `getScreenDetails()`, `screenLeft/screenTop` tracking, 5s polling fallback.
  - `captureScreenshot()` helper draws the current video frame to a canvas and returns a base64 JPEG.
  - `sendScreenshot()` captures a screenshot, sends it to the webhook, and reports a `screen_violation` proctoring event.
  - Screen recording tracks are stopped on submit.
