import assert from "node:assert/strict";
import test from "node:test";
import {
  evidenceValueFor,
  integrityAuthenticateSchema,
  integrityEventMessageSchema,
  parseSocketPayload,
} from "../src/lib/integrity-protocol";

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
