import assert from "node:assert/strict";
import test from "node:test";
import {
  extractIntegrityFeatures,
  provisionalIntegrityModel,
  scoreIntegrityTimeline,
  type ExplainableRiskModel,
  type TimelineEvent,
} from "../src/lib/integrity-risk";
import { evaluateRiskPredictions } from "../src/lib/integrity-risk-evaluation";
import { integrityEventMessageSchema } from "../src/lib/integrity-protocol";

const at = (seconds: number): string => new Date(Date.UTC(2026, 7, 1, 10, 0, seconds)).toISOString();
const event = (event_type: TimelineEvent["event_type"], seconds: number): TimelineEvent => ({
  event_type,
  occurred_at: at(seconds),
});

test("one low-confidence dimension signal cannot independently raise a review", () => {
  const result = scoreIntegrityTimeline([event("devtools_dimension_suspected", 0)]);
  assert.equal(result.band, "observe");
  assert.equal(result.probability, null);
  assert.equal(result.contributions.length, 0);
});

test("one window focus loss immediately flags the attempt for review", () => {
  const result = scoreIntegrityTimeline([event("window_blur", 0)]);
  assert.equal(result.band, "review");
  assert.ok(result.reviewPriority >= 35);
});

test("the provisional policy adds a visible pair contribution", () => {
  const shortcutOnly = scoreIntegrityTimeline([event("restricted_shortcut", 0)]);
  const paired = scoreIntegrityTimeline([
    event("restricted_shortcut", 0),
    event("devtools_dimension_suspected", 10),
  ]);
  assert.ok(paired.rawLogit > shortcutOnly.rawLogit);
  assert.deepEqual(
    paired.contributions.find((contribution) => contribution.kind === "pair"),
    {
      kind: "pair",
      feature: "restricted_shortcut + devtools_dimension_suspected",
      value: 2,
      occurrences: 1,
    },
  );
});

test("behavioral combinations request review but do not impersonate a protocol lock", () => {
  const result = scoreIntegrityTimeline([
    event("restricted_shortcut", 0),
    event("restricted_shortcut", 1),
    event("clipboard_copy_attempt", 2),
    event("clipboard_copy_attempt", 3),
    event("duplicate_attempt_context", 4),
  ]);
  assert.equal(result.band, "high_review");
  assert.equal(result.probability, null);
});

test("a cryptographically invalid heartbeat is identified as a protocol lock", () => {
  const result = scoreIntegrityTimeline([event("heartbeat_invalid", 0)]);
  assert.equal(result.band, "protocol_lock");
});

test("feature extraction preserves counts, recency, repetition, and recovery", () => {
  const features = extractIntegrityFeatures([
    event("visibility_hidden", 0),
    event("visibility_hidden", 5),
    event("visibility_visible", 10),
    event("heartbeat_missed", 20),
  ], at(30));
  assert.equal(features.counts.visibility_hidden, 2);
  assert.equal(features.repeatedWithinThirtySeconds, 1);
  assert.equal(features.recoveryCount, 1);
  assert.equal(features.heartbeatMissCount, 1);
  assert.equal(features.secondsSinceLastEvent, 10);
});

test("only a versioned calibrated model emits a probability", () => {
  const calibrated: ExplainableRiskModel = {
    ...provisionalIntegrityModel,
    version: "test-calibrated-v1",
    mode: "calibrated_ebm",
    calibrationVersion: "test-isotonic-v1",
    calibration: [
      { input: 0, output: 0 },
      { input: 1, output: 1 },
    ],
  };
  const result = scoreIntegrityTimeline([], calibrated);
  assert.notEqual(result.probability, null);
  assert.equal(result.calibrationVersion, "test-isotonic-v1");
});

test("offline evaluation reports calibration and threshold metrics", () => {
  const result = evaluateRiskPredictions([
    { session_id: "a", label: 0, probability: 0.1 },
    { session_id: "b", label: 1, probability: 0.9 },
  ]);
  assert.equal(result.sampleCount, 2);
  assert.equal(result.confusion.truePositive, 1);
  assert.equal(result.confusion.trueNegative, 1);
  assert.ok(Math.abs(result.brierScore - 0.01) < 1e-12);
});

test("server-only evidence cannot be forged in a client event message", () => {
  assert.equal(integrityEventMessageSchema.safeParse({
    version: 1,
    type: "event",
    event_id: "80d575b2-3f11-41cb-9204-55f5970d2f05",
    sequence: 1,
    occurred_at: at(0),
    event_type: "heartbeat_invalid",
    details: {},
  }).success, false);
});
