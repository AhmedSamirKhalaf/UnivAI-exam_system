import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceValueFor,
  integrityAuthenticateSchema,
  integrityEventMessageSchema,
  parseSocketPayload,
} from "../src/lib/integrity-protocol";
import {
  createHeartbeatChallenge,
  verifyHeartbeatChallenge,
} from "../src/lib/heartbeat-policy";
import { ExamListenerRegistry } from "../src/lib/exam-listener-registry";

test("integrity authentication requires a token and rejects extra data", () => {
  assert.equal(
    integrityAuthenticateSchema.safeParse({
      version: 1,
      type: "authenticate",
      client_build: "test",
    }).success,
    false,
  );
  assert.equal(
    integrityAuthenticateSchema.safeParse({
      version: 1,
      type: "authenticate",
      token: "x".repeat(32),
      client_build: "test",
      student_id: "client-controlled",
    }).success,
    false,
  );
});

test("integrity event contract accepts ordered metadata without sensitive payloads", () => {
  const parsed = integrityEventMessageSchema.parse({
    version: 1,
    type: "event",
    event_id: "80d575b2-3f11-41cb-9204-55f5970d2f05",
    sequence: 1,
    occurred_at: "2026-08-01T10:00:00.000Z",
    event_type: "restricted_shortcut",
    details: { shortcut: "Ctrl+Shift+I", confidence: "medium" },
  });
  assert.equal(parsed.event_type, "restricted_shortcut");
  assert.equal(evidenceValueFor(parsed.event_type), 3);
});

test("integrity event payload is bounded and strict", () => {
  const base = {
    version: 1,
    type: "event",
    event_id: "80d575b2-3f11-41cb-9204-55f5970d2f05",
    sequence: 1,
    occurred_at: "2026-08-01T10:00:00.000Z",
    event_type: "window_blur",
  };
  assert.equal(
    integrityEventMessageSchema.safeParse({
      ...base,
      details: { raw_keys: ["a", "b"] },
    }).success,
    false,
  );
  assert.throws(
    () => parseSocketPayload("x".repeat(65 * 1024)),
    /too large/,
  );
});

test("heartbeat challenge is signed, session-bound, and expires", () => {
  const examId = "64b000000000000000000022";
  const connectionId = "80d575b2-3f11-41cb-9204-55f5970d2f05";
  const challenge = createHeartbeatChallenge(examId, connectionId, 1_000, 5_000);
  assert.equal(
    verifyHeartbeatChallenge(challenge.token, examId, connectionId, 2_000).nonce,
    challenge.payload.nonce,
  );
  assert.throws(
    () => verifyHeartbeatChallenge(`${challenge.token}x`, examId, connectionId, 2_000),
    /signature/,
  );
  assert.throws(
    () => verifyHeartbeatChallenge(challenge.token, examId, crypto.randomUUID(), 2_000),
    /another session/,
  );
  assert.throws(
    () => verifyHeartbeatChallenge(challenge.token, examId, connectionId, 6_001),
    /expired/,
  );
});

test("listener registry keeps stable handlers and restores one copy", () => {
  const target = new EventTarget();
  const registry = new ExamListenerRegistry("test-v1");
  let calls = 0;
  const handler = () => { calls += 1; };
  registry.register({ name: "focus", target, type: "focus", handler });
  registry.verifyAndRestore();
  registry.verifyAndRestore();
  target.dispatchEvent(new Event("focus"));
  assert.equal(calls, 1);
  assert.deepEqual(registry.health(), {
    version: "test-v1",
    digest: registry.health().digest,
    listenerCount: 1,
  });
  registry.dispose();
  target.dispatchEvent(new Event("focus"));
  assert.equal(calls, 1);
});
