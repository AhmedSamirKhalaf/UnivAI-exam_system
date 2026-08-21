import assert from "node:assert/strict";
import test from "node:test";
import {
  examDeadline,
  examTimeLimitSeconds,
  MIDTERM_SECONDS_PER_QUESTION,
  QUIZ_SECONDS_PER_QUESTION,
} from "../src/lib/exam-timing";

test("quiz allows one minute per question", () => {
  assert.equal(examTimeLimitSeconds("quiz", 5), 5 * QUIZ_SECONDS_PER_QUESTION);
  assert.equal(QUIZ_SECONDS_PER_QUESTION, 60);
});

test("midterm allows ninety seconds per question", () => {
  assert.equal(examTimeLimitSeconds("mid", 10), 10 * MIDTERM_SECONDS_PER_QUESTION);
  assert.equal(MIDTERM_SECONDS_PER_QUESTION, 90);
});

test("practice and final keep their existing timing policies", () => {
  assert.equal(examTimeLimitSeconds("practice", 5), null);
  assert.equal(examTimeLimitSeconds("final", 10), null);
});

test("deadline is derived from the server start time", () => {
  const start = new Date("2026-08-21T10:00:00.000Z");
  assert.equal(
    examDeadline("quiz", 3, start)?.toISOString(),
    "2026-08-21T10:03:00.000Z",
  );
});

