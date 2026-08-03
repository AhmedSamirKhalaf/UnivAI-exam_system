import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resultWebhookSchema } from "../src/lib/contracts";
import { createSeededRandom, shuffled } from "../src/lib/deterministic-rng";
import {
  DEVTOOLS_DIMENSION_THRESHOLD,
  getDevToolsDimensionSignal,
  getRestrictedShortcut,
} from "../src/lib/proctoring-signals";
import { signResultWebhook } from "../src/lib/webhook-signature";

test("seeded random produces stable question order", () => {
  const first = shuffled([1, 2, 3, 4, 5], createSeededRandom(20260727));
  const second = shuffled([1, 2, 3, 4, 5], createSeededRandom(20260727));
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, [1, 2, 3, 4, 5]);
});

test("canonical result webhook validates and uses non-guilt policy terms", async () => {
  const fixture = JSON.parse(
    await readFile(new URL("../contracts/result-webhook.example.json", import.meta.url), "utf8")
  );
  const parsed = resultWebhookSchema.parse(fixture);
  assert.equal(parsed.policy_action, "none");
  assert.equal(parsed.review_status, "not_required");
  assert.equal(JSON.stringify(parsed).toLowerCase().includes("cheat"), false);
});

test("result webhook signature is deterministic and covers the exact raw body", () => {
  const secret = "integration-only-secret";
  const raw = '{"exam_id":"64b000000000000000000023","mark":4}';
  assert.equal(
    signResultWebhook(raw, secret),
    "770e0f433d8fbf47b37e7ec420d9a2326874ed9b8f6e1fe0e2f2c371c9aca5c5",
  );
  assert.notEqual(signResultWebhook(`${raw} `, secret), signResultWebhook(raw, secret));
  assert.throws(() => signResultWebhook(raw, ""), /EXAM_CALLBACK_SECRET is required/);
});

test("invalid proctoring event is rejected", () => {
  const fixture = {
    exam_id: "64b000000000000000000023",
    type: "quiz",
    title: "Example",
    student_id: "64b000000000000000000001",
    student_sid: null,
    chapter_id: null,
    mark: null,
    total_questions: 0,
    passing_mark: null,
    passed: false,
    grading_status: "auto_graded",
    integrity_status: "clean",
    policy_action: "none",
    review_status: "not_required",
    report: {
      suspicion_score: 1,
      flagged: true,
      session_status: "completed",
      started_at: null,
      ended_at: null,
      events: [{ type: "automatic_cheating_verdict", weight: 1, occurrences: 1, at: new Date() }],
    },
  };
  assert.equal(resultWebhookSchema.safeParse(fixture).success, false);
});

test("developer-tools dimension signal ignores normal browser chrome", () => {
  assert.equal(
    getDevToolsDimensionSignal({
      outerWidth: 1440,
      innerWidth: 1420,
      outerHeight: 900,
      innerHeight: 800,
    }),
    null
  );

  assert.deepEqual(
    getDevToolsDimensionSignal({
      outerWidth: 1440,
      innerWidth: 1440 - DEVTOOLS_DIMENSION_THRESHOLD,
      outerHeight: 900,
      innerHeight: 800,
    }),
    { widthDiff: DEVTOOLS_DIMENSION_THRESHOLD, heightDiff: 100 }
  );
});

test("restricted developer-tools shortcuts are cross-platform and specific", () => {
  const base = { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(getRestrictedShortcut({ ...base, key: "F12" }), "F12");
  assert.equal(
    getRestrictedShortcut({ ...base, key: "i", ctrlKey: true, shiftKey: true }),
    "Ctrl+Shift+I"
  );
  assert.equal(
    getRestrictedShortcut({ ...base, key: "j", metaKey: true, altKey: true }),
    "Meta+Alt+J"
  );
  assert.equal(getRestrictedShortcut({ ...base, key: "i", ctrlKey: true }), null);
});
