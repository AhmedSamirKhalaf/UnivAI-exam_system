import mongoose from "mongoose";
import { z } from "zod";

/**
 * Append-only audit log.
 *
 * Every entry is schema-validated before it is written and records
 * actor / action / resource / time / policy version. Answers and secrets are
 * deliberately excluded: `writeAudit` refuses metadata keys that could carry
 * them. The Mongo sink exposes no update or delete operations.
 */

export const AUDIT_SCHEMA_VERSION = "univai-audit-v1";
export const INTEGRITY_POLICY_VERSION = "univai-integrity-provisional-v1";

export const AUDIT_ACTOR_TYPES = ["system", "student", "admin", "instructor"] as const;

export const auditEntrySchema = z
  .object({
    schema_version: z.literal(AUDIT_SCHEMA_VERSION),
    occurred_at: z.coerce.date(),
    actor: z
      .object({
        type: z.enum(AUDIT_ACTOR_TYPES),
        id: z.string().min(1).max(160),
      })
      .strict(),
    action: z.string().min(1).max(200),
    resource: z
      .object({
        type: z.string().min(1).max(60),
        id: z.string().min(1).max(160),
      })
      .strict(),
    policy_version: z.string().min(1).max(160),
    metadata: z
      .record(z.string(), z.unknown())
      .refine((m) => Object.keys(m).length <= 32, {
        message: "audit metadata has too many keys",
      })
      .optional(),
  })
  .strict();

export type AuditEntry = z.infer<typeof auditEntrySchema>;

export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export interface AuditSink {
  append(entry: AuditEntry): Promise<void>;
}

/** Append-only Mongo sink. Only inserts; there is deliberately no update path. */
export class MongoAuditSink implements AuditSink {
  private collection() {
    const db = mongoose.connection.db;
    if (!db) {
      throw new Error("Audit sink requires an active database connection");
    }
    return db.collection("audit_logs");
  }

  async append(entry: AuditEntry): Promise<void> {
    await this.collection().insertOne(entry);
  }
}

export class InMemoryAuditSink implements AuditSink {
  readonly entries: AuditEntry[] = [];

  async append(entry: AuditEntry): Promise<void> {
    this.entries.push(entry);
  }

  reset(): void {
    this.entries.length = 0;
  }
}

const defaultSink = new MongoAuditSink();
let activeSink: AuditSink | null = null;

/** Override the sink, primarily for tests. Pass `null` to restore Mongo. */
export function setAuditSink(sink: AuditSink | null): void {
  activeSink = sink;
}

export function auditSink(): AuditSink {
  return activeSink ?? defaultSink;
}

const SENSITIVE_METADATA_KEY = /answer|secret|token|password|correct_option|access_token|attempt_token/i;

function sensitiveMetadataKey(
  value: unknown,
  seen = new Set<object>(),
): string | null {
  if (!value || typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  for (const [key, nested] of Object.entries(value)) {
    if (SENSITIVE_METADATA_KEY.test(key)) return key;
    const match = sensitiveMetadataKey(nested, seen);
    if (match) return match;
  }
  return null;
}

export interface AuditInput {
  actor: { type: AuditActorType; id: string };
  action: string;
  resource: { type: string; id: string };
  policy_version?: string;
  metadata?: Record<string, unknown>;
}

export async function writeAudit(input: AuditInput): Promise<void> {
  const sensitiveKey = sensitiveMetadataKey(input.metadata);
  if (sensitiveKey) {
    throw new Error(
      `Audit entry refused: metadata key "${sensitiveKey}" may carry answers or secrets`,
    );
  }

  const entry = auditEntrySchema.parse({
    schema_version: AUDIT_SCHEMA_VERSION,
    occurred_at: new Date(),
    policy_version: input.policy_version ?? INTEGRITY_POLICY_VERSION,
    ...input,
  });

  await auditSink().append(entry);
}
