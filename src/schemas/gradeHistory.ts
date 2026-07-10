import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectId = z.string().regex(objectIdRegex, "Invalid ObjectId");

export const gradeHistorySchema = z.object({
  exam_id: objectId,
  mark: z.number(),
  graded_by: z.string().min(1),
  graded_at: z.coerce.date(),
  is_regrade: z.boolean().default(false),
  reason: z.string().optional(),
});

export type GradeHistoryInput = z.infer<typeof gradeHistorySchema>;
