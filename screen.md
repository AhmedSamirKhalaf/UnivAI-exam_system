# Screen Recording + Tiny Model Proctoring — Analysis

> Issue #6 — Preventing screen switching, multiple displays, and external content

---

## What needs to be done

1. Screen recording — capture what's on the student's screen
2. Multiple display detection — count how many monitors are connected
3. Local tiny model — analyze screen content in real-time to detect suspicious activity
4. Mouse movement tracking — detect if cursor leaves the exam window
5. Logging — send all of this to the proctoring backend

---

## How each piece could be done

### 1. Screen Recording / Capture

**Browser API**: `navigator.mediaDevices.getDisplayMedia()` — the Screen Capture API.

- The browser shows a native permission prompt ("Share your screen?"). The student must click "Allow" — mandatory and cannot be bypassed.
- Once granted, we get a `MediaStream` we can:
  - **Record** via `MediaRecorder` API (full video recording, saved to blob/URL)
  - **Snapshot** periodically by drawing frames to a `<canvas>` and calling `toDataURL()` or `toBlob()` — this gives us screenshots for ML analysis
- The API can enumerate available displays/sources via `stream.getVideoTracks()[0].getSettings().displaySurface` which can tell us if the student is sharing a screen, window, or tab

**Limitation**: The student chooses what to share (entire screen, a window, or a tab). If they have 2 monitors and only share one, we can't see the other. But we CAN detect that multiple display surfaces are available via `navigator.mediaDevices.enumerateDevices()`.

### 2. Multiple Display Detection

| Method | What it detects | Reliability |
|--------|----------------|-------------|
| `navigator.mediaDevices.enumerateDevices()` filtered to video inputs | Lists available display sources | High — shows all capturable displays |
| `getDisplayMedia()` video track `getSettings().displaySurface` | What the student chose to share (`"monitor"`, `"window"`, `"application"`, `"browser"`) | High — tells us if they're sharing a full monitor vs just a tab |
| `window.screen` properties (`availWidth`, `width`, `availHeight`) | Current screen dimensions (can hint at taskbar/dual monitors) | Medium |
| CSS media query `window.matchMedia("(spanning: single-fold-vertical)")` | Foldable/dual-screen detection | Low — limited browser support |

**Best approach**: Use `enumerateDevices()` on mount + whenever the screen stream changes. Compare the count of display-type video sources. If > 1, report it.

### 3. Local Tiny Model for Screen Analysis

Take periodic screenshots, run them through a lightweight ML model, detect anomalies.

**Model options** (client-side via TensorFlow.js or ONNX Runtime Web):

| Model | Size | What it can detect | Feasibility |
|-------|------|-------------------|-------------|
| **face-api.js** (already installed) | ~6MB | Face presence/absence, multiple faces, face position | High — already in `package.json`, just unused |
| **MobileNet v2** (TF.js) | ~16MB | General image classification — could detect "exam page" vs "other app" | Medium — large download |
| **Custom tiny CNN** (trained in-house) | < 1MB | Specifically trained for exam proctoring anomalies | Best but requires training data |
| **SSD MobileNet** (TF.js) | ~20MB | Object detection — could detect specific UI elements | Low — too heavy |

**Most practical approach**:
- Use **face-api.js** (already installed) on periodic screen captures to verify the student's face is still visible and no anomalies
- Use a **rule-based heuristic** on screenshots: compare frame N to frame N-1. If the exam page DOM is no longer visible (large pixel diff), flag it
- Optionally load a **tiny custom classifier** that categorizes screenshots as "exam_visible", "other_window", "blank_screen", "multiple_windows"

**Frame capture loop**:
```
Every 3-5 seconds:
  1. Draw current getDisplayMedia frame to canvas
  2. Convert to blob
  3. Run through model / heuristic
  4. If anomaly -> report to proctoring API
  5. Optionally store frame for later review
```

### 4. Mouse Movement Tracking

**Browser APIs**: `mousemove`, `mouseleave`, `mouseenter` events on `document`.

**What to track**:
- **Cursor leaving the window** — `mouseleave` on `document` means the student moved to another window/display. Strong signal of multi-monitor usage.
- **Cursor velocity** — abnormally fast cursor movement could indicate switching between displays
- **Click outside** — can't detect clicks outside the window, but CAN detect if the window loses focus (`blur` event) shortly after a `mouseleave`

**Implementation**:
- Add `mousemove` listener with throttling (e.g., sample every 500ms to avoid flooding)
- Add `mouseleave` on `document` -> report event with cursor position at time of exit
- Add `blur` on `window` -> report with timestamp correlation to last mouse position
- Store a trail of (x, y, timestamp) tuples in memory for pattern analysis

### 5. Logging / Backend Changes

**New `ProctoringEventType` values needed**:
- `"multi_display_detected"` — discrete event, fired when > 1 display source found
- `"screen_anomaly"` — discrete event, fired when model detects suspicious content
- `"mouse_left_window"` — discrete event, fired when cursor leaves the exam window

**New proctoring config weights**:
- `multiDisplayWeight` — e.g. 30 (similar to tab_switch)
- `screenAnomalyWeight` — e.g. 40 (high, since model detection is significant)
- `mouseLeftWeight` — e.g. 15 (lower, since leaving briefly could be accidental)

**API changes**: The existing `POST /api/exams/:id/proctoring-event` route already accepts any `ProctoringEventType` and handles discrete events generically. We just need to:
1. Add new types to the `ProctoringEventType` union
2. Add weights to `EVENT_WEIGHT_MAP`
3. Add new weight config values

---

## Key Challenges

| Challenge | Impact | Mitigation |
|-----------|--------|------------|
| `getDisplayMedia` requires user permission | Student must click "Allow" — can't silently capture | Show a clear prompt explaining why; fail gracefully if denied |
| ML model download size | 6-20MB initial load could be slow | Lazy-load the model after exam starts, not on page load |
| CPU usage from periodic screenshots + ML | Could slow down the exam on low-end devices | Use 5s+ intervals, offload to Web Worker, skip if tab is hidden |
| Student shares only 1 display | Can't see what's on the other monitor | Detect `displaySurface: "monitor"` and note it; if multiple sources exist, report |
| Privacy concerns | Full screen recording captures everything (passwords, messages) | Only analyze locally (never upload raw video); store only metadata/flags |
| face-api.js on screenshots | Designed for webcam, not screenshots — may need adaptation | Use it for basic face detection on screenshots, or use a simpler pixel-comparison approach |

---

## Implementation Plan

### New files

| File | Purpose |
|------|---------|
| `src/components/ScreenProctoring.tsx` | New component: screen capture, display detection, ML analysis, mouse tracking |
| `public/models/` | Model weight files for face-api.js or custom classifier |

### Modified files

| File | Changes |
|------|---------|
| `src/lib/proctoring-config.ts` | Add `multiDisplayWeight`, `screenAnomalyWeight`, `mouseLeftWeight` |
| `src/models/ProctoringEvent.ts` | Add `"multi_display_detected"`, `"screen_anomaly"`, `"mouse_left_window"` to `ProctoringEventType` |
| `src/schemas/proctoringEvent.ts` | Mirror the new enum values |
| `src/lib/business-logic.ts` | Add new weights to `EVENT_WEIGHT_MAP` |
| `src/app/exam/[examId]/ExamRunner.tsx` | Mount `ScreenProctoring` component, pass `report` callback |

### Architecture

```
ExamRunner.tsx
├── ScreenProctoring (new child component)
│   ├── Screen Capture Module
│   │   ├── getDisplayMedia() for screen stream
│   │   ├── Periodic screenshot capture via canvas
│   │   └── Display enumeration via enumerateDevices()
│   ├── ML Analysis Module
│   │   ├── Lazy-load face-api.js models
│   │   ├── Frame analysis loop (every 3-5s)
│   │   └── Anomaly detection (face check + pixel diff heuristic)
│   ├── Mouse Tracking Module
│   │   ├── Throttled mousemove listener
│   │   ├──mouseleave boundary detection
│   │   └── Window blur correlation
│   └── Reports via report("event_type", metadata)
├── Existing proctoring listeners (tab, copy, fullscreen, devtools)
└── Submit flow (unchanged)
```

### Heaviest decision

The ML model choice — face-api.js is ready to use but may need creative adaptation for screenshot analysis, while a custom tiny classifier would be ideal but requires training data that doesn't exist yet.
