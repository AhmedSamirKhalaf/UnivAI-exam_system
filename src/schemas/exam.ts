import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectId = z.string().regex(objectIdRegex, "Invalid ObjectId");

export const examSchema = z.object({
  type: z.enum(["quiz", "mid", "final"]),
  title: z.string().min(1),
  student_id: objectId,
  curriculum_id: objectId.optional(),
  chapter_id: objectId.optional(),
  attempt_number: z.number().int().min(1).default(1),
  generated_questions: z.any().optional(),
  student_answers: z.any().optional(),
  taken: z.boolean().default(false),
  mark: z.number().optional(),
  passing_mark: z.number().min(0).optional(),
  passed: z.boolean().default(false),
  grading_status: z
    .enum(["auto_graded", "pending_review", "graded"])
    .default("auto_graded"),
  integrity_status: z
    .enum(["clean", "invalidated"])
    .default("clean"),
  invalidated_at: z.coerce.date().optional(),
  invalidation_notified_at: z.coerce.date().optional(),
});

export type ExamInput = z.infer<typeof examSchema>;
