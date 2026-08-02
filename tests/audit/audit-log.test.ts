import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  AUDIT_SCHEMA_VERSION,
  InMemoryAuditSink,
  INTEGRITY_POLICY_VERSION,
  MongoAuditSink,
  auditEntrySchema,
  auditSink,
  setAuditSink,
  writeAudit,
} from "../../src/lib/audit-log";

describe("audit log", () => {
  let sink: InMemoryAuditSink;

  beforeEach(() => {
    sink = new InMemoryAuditSink();
    setAuditSink(sink);
  });

  afterEach(() => {
    setAuditSink(null);
  });

  test("writes a schema-validated entry with actor, action, resource, time and policy version", async () => {
    await writeAudit({
      actor: { type: "student", id: "64b000000000000000000001" },
      action: "attempt.submit",
      resource: { type: "exam", id: "64b000000000000000000021" },
      metadata: { grading_status: "auto_graded" },
    });

    expect(sink.entries).toHaveLength(1);
    const entry = sink.entries[0];
    expect(entry.actor).toEqual({
      type: "student",
      id: "64b000000000000000000001",
    });
    expect(entry.action).toBe("attempt.submit");
    expect(entry.resource).toEqual({
      type: "exam",
      id: "64b000000000000000000021",
    });
    expect(entry.policy_version).toBe(INTEGRITY_POLICY_VERSION);
    expect(entry.schema_version).toBe(AUDIT_SCHEMA_VERSION);
    expect(entry.occurred_at).toBeInstanceOf(Date);
    expect(entry.metadata).toEqual({ grading_status: "auto_graded" });

    const validated = auditEntrySchema.parse(entry);
    expect(validated).toEqual(entry);
  });

  test("each write appends a new entry (append-only surface)", async () => {
    await writeAudit({
      actor: { type: "system", id: "blueprint-publisher" },
      action: "question.published",
      resource: { type: "blueprint", id: "64b000000000000000000001" },
    });
    await writeAudit({
      actor: { type: "admin", id: "reviewer" },
      action: "integrity.appeal_resolved",
      resource: { type: "exam", id: "64b000000000000000000021" },
    });

    expect(sink.entries).toHaveLength(2);
    expect(sink.entries[0].action).toBe("question.published");
    expect(sink.entries[1].action).toBe("integrity.appeal_resolved");
    // The sink exposes no update/delete; append is the only mutation path.
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(sink))).toEqual(
      expect.arrayContaining(["append"]),
    );
  });

  test("refuses metadata keys that could carry answers or secrets", async () => {
    await expect(
      writeAudit({
        actor: { type: "student", id: "s1" },
        action: "attempt.submit",
        resource: { type: "exam", id: "e1" },
        metadata: { answer: "A) Option 1" },
      }),
    ).rejects.toThrow(/answers or secrets/);

    await expect(
      writeAudit({
        actor: { type: "system", id: "policy" },
        action: "integrity.session_invalidated",
        resource: { type: "exam", id: "e1" },
        metadata: { access_token: "leak" },
      }),
    ).rejects.toThrow(/answers or secrets/);

    expect(sink.entries).toHaveLength(0);
  });

  test("rejects schema-invalid entries", () => {
    expect(() =>
      auditEntrySchema.parse({
        actor: { type: "student" },
        action: "attempt.submit",
        resource: { type: "exam", id: "e1" },
      }),
    ).toThrow();
  });

  test("rejects unknown fields on an audit entry", () => {
    expect(() =>
      auditEntrySchema.parse({
        schema_version: AUDIT_SCHEMA_VERSION,
        occurred_at: new Date(),
        actor: { type: "system", id: "x" },
        action: "attempt.submit",
        resource: { type: "exam", id: "e1" },
        policy_version: INTEGRITY_POLICY_VERSION,
        bogus: true,
      }),
    ).toThrow();
  });

  test("Mongo sink refuses to append without a database connection", async () => {
    const mongoSink = new MongoAuditSink();
    const entry = auditEntrySchema.parse({
      schema_version: AUDIT_SCHEMA_VERSION,
      occurred_at: new Date(),
      actor: { type: "system", id: "x" },
      action: "attempt.submit",
      resource: { type: "exam", id: "e1" },
      policy_version: INTEGRITY_POLICY_VERSION,
    });
    await expect(mongoSink.append(entry)).rejects.toThrow(/database connection/);
  });

  test("auditSink returns the installed sink", () => {
    expect(auditSink()).toBe(sink);
  });
});
