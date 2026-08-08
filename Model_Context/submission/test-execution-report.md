# Test Execution Report — UAI-M2-S2-06

Date: 2026-08-02
Branch: `12-uai-m2-s2-06-run-final-exam-uat-cross-system-release-evidence-and-submission-gate`
Base: `main` @ `adb098c`

## Environment

- No Docker. MongoDB v8.0.28 on `127.0.0.1:27018`, database
  `univai_exams_standalone`, seed `exam-standalone-v1`.
- Server process:
  `UNIVAI_MODE=standalone MONGODB_URI=mongodb://127.0.0.1:27018/univai_exams_standalone npx tsx server.ts dev`
  listening on `http://127.0.0.1:3200`.
- Browser: Chrome Headless Shell 151.0.7922.34 (`npx playwright install chromium`).
- `npm ci` completed with 0 vulnerabilities (warnings only for esbuild /
  unrs-resolver install scripts).

## 1. Health

```text
GET /api/health
{"ok":true,"ready":true,"mode":"standalone","mongo":"ready","seed":"exam-standalone-v1","seededScenarios":5,"webhook":"local capture"}
```

## 2. Dataset validation

```text
node tests/capstone/validate-dataset.mjs
✅ All 56 cases pass schema validation.     (exit 0)
```

## 3. Evaluator

```text
node tests/capstone/run-evaluation.mjs --mode configured
--mode must be 'mock' or 'real'             (exit 1 — documented; configured mode is not implemented)

node tests/capstone/run-evaluation.mjs --mode mock --output evidence/final-release/evaluation-report-mock.json
TOTAL: 56  PASS: 3  FAIL: 0  NOT RUN: 53    (exit 0)

node tests/capstone/run-evaluation.mjs --mode real
--mode real requires --agent-outputs <recorded-output.json>   (exit 1 — documented)
```

## 4. Functional UAT (Playwright)

```text
npx playwright test tests/e2e/final-release.spec.ts
8 passed (1.3s)          (exit 0)

npx playwright test tests/security/public-release.spec.ts
10 passed (2.6s)         (exit 0)
```

Each file runs as its own invocation because the seeded per-student/per-chapter
quiz is shared and parallel workers collide on it.

## 5. Repository gates

```text
npm run lint          -> exit 0
npm run build         -> exit 0
git diff --check      -> exit 0
```

## 6. Notable observations during execution

- The standalone dev identity is bound to the seeded student
  `64b000000000000000000001`; attempt/answer/submit/webhook routes reject any
  other identity (HTTP 500 `Valid standalone development identity is
  required`). Tests therefore drive the seeded student.
- The exam launch view exposes only `current_question` (one at a time) and
  never `generated_questions` / `correct_option`; `POST /submit` takes no body
  (answers are read server-side). These contract facts are encoded in the
  tests and in `known-issues.md`.
