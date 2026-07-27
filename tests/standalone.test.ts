import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { resultWebhookSchema } from "../src/lib/contracts";
import { createSeededRandom, shuffled } from "../src/lib/deterministic-rng";

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
