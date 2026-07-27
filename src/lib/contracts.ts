import { z } from "zod";

export const questionSourceSchema = z.enum(["lecture", "self_study"]);
export const proctoringEventTypeSchema = z.enum([
  "no_face",
  "multiple_faces",
  "fullscreen_exit",
  "tab_switch",
  "copy_paste",
  "devtools_open",
]);

export const resultWebhookSchema = z.object({
  exam_id: z.string().length(24),
  type: z.enum(["quiz", "mid", "final"]),
  title: z.string().min(1),
  student_id: z.string().length(24),
  student_sid: z.string().nullable(),
  chapter_id: z.string().length(24).nullable(),
  mark: z.number().nullable(),
  total_questions: z.number().int().min(0),
  passing_mark: z.number().nullable(),
  passed: z.boolean(),
  grading_status: z.enum(["auto_graded", "pending_review", "graded"]),
  integrity_status: z.enum(["clean", "invalidated"]),
  policy_action: z.enum(["none", "session_invalidated"]),
  review_status: z.enum(["not_required", "pending", "cleared", "upheld"]),
  report: z.object({
    suspicion_score: z.number().min(0),
    flagged: z.boolean(),
    session_status: z.string(),
    started_at: z.coerce.date().nullable(),
    ended_at: z.coerce.date().nullable(),
    events: z.array(
      z.object({
        type: proctoringEventTypeSchema,
        weight: z.number().min(0),
        occurrences: z.number().int().min(1),
        at: z.coerce.date(),
      })
    ),
  }),
});
