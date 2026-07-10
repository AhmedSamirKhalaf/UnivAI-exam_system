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
  terminated_reason: z
    .enum([
      "suspicion_threshold",
      "manual_admin_stop",
      "student_submitted",
      "timeout",
    ])
    .optional(),
});

export type ExamSessionInput = z.infer<typeof examSessionSchema>;
