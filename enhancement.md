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
