# Sprint 1 — Acceptance Procedure

## Scope

This repository provides two separate gates:

1. a 56-case source-grounding dataset and scorer for recorded Agent outputs;
2. an eight-gate black-box journey across the real Exam HTTP boundary.

The Exam journey covers ingestion, quiz opening, answer submission, proctoring,
final-exam gating, trusted-result capture, and an approved upstream
multi-book/programme/lecture-Q&A fixture crossing into the real Exam API. The
fixture is labelled `recorded_fixture`; it never counts as a production
App/Core/Agent/Live pass. The complete multi-repository path
(`App → Core/Agent → Live → Exam → App`) is a separate configured manual gate
and must remain `NOT RUN` when those services and their URLs are unavailable.

## Prerequisites

1. Node.js 20 or newer and Docker.
2. `npm ci`.
3. MongoDB standalone container exposed at `127.0.0.1:27018`.
4. Optional overrides:
   - `BASE_URL` (default `http://127.0.0.1:3200`);
   - `DEV_TOKEN` (otherwise derived from the standalone secret);
   - `UNIVAI_STANDALONE_SECRET` when the server uses a non-default secret.

## 1. Start the isolated Exam environment

In the first terminal:

```bash
npm run dev:standalone
```

Wait until `/api/health` reports `ready: true`, `mode: "standalone"`, and five
seeded scenarios. Never point this procedure at the integration database.

## 2. Validate the dataset

```bash
node tests/capstone/validate-dataset.mjs
```

Expected: 56 valid cases, zero invalid cases, and all ten categories present.

## 3. Exercise the evaluator with recorded fixture outputs

```bash
node tests/capstone/run-evaluation.mjs --mode mock
```

Mock mode reads `tests/e2e/fixtures/mock-agent-outputs.json`; it does not build
answers from the expected values. The fixture contains three recorded outputs,
so the expected summary is `PASS: 3`, `FAIL: 0`, `NOT RUN: 53`.

To evaluate real recorded Agent output:

```bash
node tests/capstone/run-evaluation.mjs --mode real --agent-outputs path/to/agent-output.json --output path/to/report.json
```

Missing responses are always `NOT RUN`. Any scored failure exits non-zero.

## 4. Run the Exam black-box journey

In a second terminal:

```bash
npx playwright test tests/e2e/final-mvp-sprint1.spec.ts
```

Expected: eight passed gates. A missing server, invalid token, unavailable
database, unexpected denial, or absent webhook capture fails the command. Tests
do not return early or convert an unavailable dependency into a pass.

Gate 8 validates the versioned recorded upstream fixture (multiple ready source
documents, approved programme, grounded lecture answer, and source
relationships), then uses that handoff to open and submit a quiz through the
real Exam HTTP API and verifies the captured trusted result. It is the CI path
allowed by the issue's contract-first unblocking rule; it does not replace the
configured production-services manual gate.

## 5. Run repository gates

```bash
npm test
npm run lint
npm run build
git diff --check
```

For build-only environments, set a local standalone `MONGODB_URI`; never commit
the value.

## 6. Record the result

Update `evidence/final-mvp/sprint1/README.md` with:

- dataset commit and SHA-256;
- exact commands and PASS/FAIL/NOT RUN counts;
- real Agent-output report path when available;
- full cross-system result or exact missing dependency;
- linked defects in the owning repository.

## Blocking criteria

- fewer than 50 valid cases or a missing required category;
- any unsupported-answer, prompt-injection, malformed-output, or invalid
  provenance case fails;
- missing/wrong citations in the citation category;
- any of the eight Exam black-box gates fails;
- a dependency is reported as passed when it was not executed.

Mock fixture success validates the scorer path only. It is not evidence that the
real Agent or the full multi-repository product passed.
