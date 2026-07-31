import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectId = z.string().regex(objectIdRegex, "Invalid ObjectId");

export const examSessionSchema = z.object({
  exam_id: objectId,
  student_id: objectId,
  started_at: z.coerce.date(),
  ended_at: z.coerce.date().optional(),
  suspicion_score: z.number().min(0).default(0),
  flagged: z.boolean().default(false),
  status: z.enum(["in_progress", "completed", "terminated"]),
  integrity_state: z
    .enum(["active", "reconnecting", "grace", "integrity_locked", "submitted"])
    .default("active"),
  current_question_index: z.number().int().min(0).default(0),
  answer_revision: z.number().int().min(0).default(0),
  answers: z.array(z.record(z.string(), z.unknown())).default([]),
  terminated_reason: z
    .enum([
      "suspicion_threshold",
      "manual_admin_stop",
      "student_submitted",
      "timeout",
      "heartbeat_failure",
      "protocol_failure",
      "duplicate_session",
    ])
    .optional(),
  integrity_lock_reason: z.string().max(240).optional(),
  active_connection_id: z.string().uuid().optional(),
  last_integrity_sequence: z.number().int().min(0).default(0),
  heartbeat_last_seen_at: z.coerce.date().optional(),
  heartbeat_consecutive_misses: z.number().int().min(0).default(0),
  heartbeat_grace_until: z.coerce.date().optional(),
  heartbeat_registry_version: z.string().max(120).optional(),
  heartbeat_registry_digest: z.string().max(128).optional(),
  heartbeat_client_build: z.string().max(120).optional(),
});

export type ExamSessionInput = z.infer<typeof examSessionSchema>;
