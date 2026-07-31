import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export type HeartbeatPolicy = {
  intervalMs: number;
  challengeTtlMs: number;
  maximumMisses: number;
  graceMs: number;
};

function boundedInteger(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export function heartbeatPolicy(): HeartbeatPolicy {
  return {
    intervalMs: boundedInteger(process.env.EXAM_HEARTBEAT_INTERVAL_MS, 10_000, 2_000, 60_000),
    challengeTtlMs: boundedInteger(process.env.EXAM_HEARTBEAT_TTL_MS, 8_000, 1_000, 30_000),
    maximumMisses: boundedInteger(process.env.EXAM_HEARTBEAT_MAX_MISSES, 3, 2, 10),
    graceMs: boundedInteger(process.env.EXAM_HEARTBEAT_GRACE_MS, 20_000, 5_000, 120_000),
  };
}

function heartbeatSecret(): string {
  const configured = process.env.EXAM_HEARTBEAT_SECRET;
  if (configured) return configured;
  if (process.env.NODE_ENV === "production") {
    throw new Error("EXAM_HEARTBEAT_SECRET is required in production");
  }
  return "univai-exam-heartbeat-local-development-only";
}

const challengePayloadSchema = z.object({
  version: z.literal(1),
  exam_id: z.string().regex(/^[0-9a-fA-F]{24}$/),
  connection_id: z.string().uuid(),
  nonce: z.string().min(20).max(120),
  issued_at: z.number().int().positive(),
  expires_at: z.number().int().positive(),
});

export type HeartbeatChallenge = z.infer<typeof challengePayloadSchema>;

function signature(payload: string): string {
  return createHmac("sha256", heartbeatSecret()).update(payload).digest("base64url");
}

function equalSignature(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

export function createHeartbeatChallenge(
  examId: string,
  connectionId: string,
  now = Date.now(),
  ttlMs = heartbeatPolicy().challengeTtlMs,
): { token: string; payload: HeartbeatChallenge } {
  const payload: HeartbeatChallenge = {
    version: 1,
    exam_id: examId,
    connection_id: connectionId,
    nonce: randomBytes(24).toString("base64url"),
    issued_at: now,
    expires_at: now + ttlMs,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return { token: `${encoded}.${signature(encoded)}`, payload };
}

export function verifyHeartbeatChallenge(
  token: string,
  expectedExamId: string,
  expectedConnectionId: string,
  now = Date.now(),
): HeartbeatChallenge {
  const [encoded, receivedSignature, extra] = token.split(".");
  if (!encoded || !receivedSignature || extra || !equalSignature(signature(encoded), receivedSignature)) {
    throw new Error("Heartbeat signature is invalid");
  }
  const payload = challengePayloadSchema.parse(
    JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")),
  );
  if (payload.exam_id !== expectedExamId || payload.connection_id !== expectedConnectionId) {
    throw new Error("Heartbeat is bound to another session");
  }
  if (payload.expires_at < now) throw new Error("Heartbeat challenge expired");
  return payload;
}
