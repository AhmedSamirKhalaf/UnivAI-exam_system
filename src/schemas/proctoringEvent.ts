import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectId = z.string().regex(objectIdRegex, "Invalid ObjectId");

export const proctoringEventSchema = z.object({
  exam_id: objectId,
  student_id: objectId,
  type: z.enum([
    "no_face",
    "multiple_faces",
    "fullscreen_exit",
    "tab_switch",
    "copy_paste",
    "devtools_open",
  ]),
  weight: z.number().min(0),
  score_at_event: z.number().min(0),
  occurrences: z.number().int().min(1).default(1),
  last_seen_at: z.coerce.date(),
  duration_seconds: z.number().min(0).optional(),
  ended_at: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ProctoringEventInput = z.infer<typeof proctoringEventSchema>;
