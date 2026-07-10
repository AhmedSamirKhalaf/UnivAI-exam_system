import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectId = z.string().regex(objectIdRegex, "Invalid ObjectId");

export const integrityAppealSchema = z.object({
  exam_id: objectId,
  submitted_note: z.string().optional(),
  resolved_by: z.string().min(1),
  resolution: z.enum(["upheld", "cleared"]),
  allow_retake: z.boolean().default(false),
  resolved_at: z.coerce.date(),
});

export type IntegrityAppealInput = z.infer<typeof integrityAppealSchema>;
