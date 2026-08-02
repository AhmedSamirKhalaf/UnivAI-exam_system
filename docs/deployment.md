# Deployment

The Exam service is independently buildable and runnable. It does not require
the UnivAI app repository or the Core submodule at build or run time: the only
runtime dependencies are Node.js and a MongoDB connection string.

## Container image

A multi-stage `Dockerfile` produces the production image:

```bash
docker build -t univai-exam:final .
docker run --rm -p 3200:3200 \
  -e MONGODB_URI=mongodb://host.docker.internal:27017/univai_exams \
  -e RESULT_WEBHOOK_URL=https://univai.example/api/exam-results \
  -e UNIVAI_MODE=integrated \
  univai-exam:final
```

Build stages:

1. `deps` — `npm ci` from the lockfile.
2. `builder` — `npm run build` (a placeholder `MONGODB_URI` build arg keeps the
   `next build` import graph healthy; the real value is injected at run time).
3. `runner` — production `node_modules`, `.next`, source, `server.ts`; runs as a
   non-root user on port `3200`.

For local standalone development, `docker-compose.standalone.yml` provides a
MongoDB 7 container on `127.0.0.1:27018`.

## Configuration

All configuration is environment-based. `MONGODB_URI` and any values beginning
with `UNIVAI_` must be treated as secrets where relevant and never committed.

| Variable | Default | Purpose |
|---|---|---|
| `MONGODB_URI` | *(required)* | MongoDB connection string. |
| `UNIVAI_MODE` | `integrated` | `standalone` (deterministic seed, dev tokens, disabled in production) or `integrated`. |
| `UNIVAI_STANDALONE_SECRET` | local dev default | HMAC key signing standalone dev tokens. Change it; never deploy the default. |
| `UNIVAI_EXAM_SEED` | `20260727` | Seed for the standalone deterministic RNG. |
| `RESULT_WEBHOOK_URL` | empty | Result + proctoring report callback to the UnivAI app. When empty in standalone, payloads are validated and captured in `webhook_captures`. |
| `UNIVAI_APP_URL` | empty | Return URL for "Back to UnivAI" buttons. |
| `UNIVAI_RATE_LIMIT_USER_MAX` | `30` | Max user-scoped requests (start / grade / appeal) per window. |
| `UNIVAI_RATE_LIMIT_USER_WINDOW_MS` | `60000` | User window length in ms. |
| `UNIVAI_RATE_LIMIT_SESSION_MAX` | `120` | Max session-scoped requests (answer / proctoring / submit) per window. |
| `UNIVAI_RATE_LIMIT_SESSION_WINDOW_MS` | `60000` | Session window length in ms. |
| `PORT` / `EXAM_HOST` | `3200` / `0.0.0.0` | HTTP listen address. |

Example `.env.local`:

```dotenv
UNIVAI_MODE=integrated
MONGODB_URI=mongodb://localhost:27017/univai_exams
UNIVAI_APP_URL=http://localhost:3100
RESULT_WEBHOOK_URL=https://univai.example/api/exam-results
```

## Hardening surface

- **Request validation**: every public exam payload is parsed against a strict
  Zod schema (`src/lib/request-validation.ts`). Unknown fields are rejected,
  strings are size-capped, bodies over `512 KiB` are refused, and malformed JSON
  is rejected uniformly.
- **Rate limiting**: per-user and per-session windows enforced in
  `src/lib/rate-limit.ts`; over-limit requests get `429` with a `Retry-After`
  window. Tune via the `UNIVAI_RATE_LIMIT_*` variables above.
- **Idempotency**: `Idempotency-Key` headers protect start / submit / grade.
  A replay with the same key returns the stored response; a replay with a
  different fingerprint is rejected (`src/lib/idempotency.ts`).
- **Audit log**: append-only, schema-validated records of question publication,
  attempt state, grading and integrity policy actions, written to the
  `audit_logs` collection (`src/lib/audit-log.ts`). Entries record
  actor / action / resource / time / policy version and never include answers
  or secrets.

## Health and operations

`GET /api/health` reports readiness plus the active hardening surface:

```json
{
  "ok": true,
  "ready": true,
  "mode": "integrated",
  "mongo": "ready",
  "hardening": {
    "request_validation": "strict-schemas-v1",
    "rate_limits": { "user": { "windowMs": 60000, "max": 30 }, "session": { "windowMs": 60000, "max": 120 } },
    "idempotency": "enabled",
    "audit_schema": "univai-audit-v1",
    "integrity_policy": "univai-integrity-provisional-v1"
  }
}
```

## Verification

From the repository root:

```bash
npm ci
npm run lint
npm run build
npx vitest run tests/security tests/audit
docker build -t univai-exam:final .
git diff --check
```

## Known limitations

- Rate limiting is process-local (in-memory). Scale this service as one
  instance per tenant; a horizontally scaled multi-instance deployment needs a
  shared store (Redis or similar) before windows are meaningful across nodes.
- The audit sink and idempotency store are MongoDB-backed and require the
  connection to be established before use (routes call `connectDB()` first).
- `RESULT_WEBHOOK_URL` delivery is fire-and-forget; the app must poll
  `GET /api/exams/[examId]` as a fallback. Idempotency keys prevent duplicate
  result callbacks.
