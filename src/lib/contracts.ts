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
  attempt_number: z.number().int().min(1),
  final_form: z.enum(["primary", "retake"]).nullable(),
  mark: z.number().nullable(),
  total_questions: z.number().int().min(0),
  max_score: z.number().int().min(0),
  passing_mark: z.number().nullable(),
  passed: z.boolean(),
  grading_status: z.enum(["auto_graded", "pending_review", "graded"]),
  integrity_status: z.enum(["clean", "invalidated"]),
  policy_action: z.enum(["none", "session_invalidated"]),
  review_status: z.enum(["not_required", "pending", "cleared", "upheld"]),
  report: z.object({
    suspicion_score: z.number().min(0),
    flagged: z.boolean(),
    raw_score: z.number().min(0).nullable().default(null),
    integrity_penalty_applied: z.boolean().default(false),
    risk_band: z.enum(["observe", "review", "high_review", "protocol_lock"]).default("observe"),
    risk_explanation: z.record(z.string(), z.unknown()).nullable().default(null),
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
    integrity_events: z.array(
      z.object({
        type: z.string().min(1),
        at: z.coerce.date(),
        evidence_value: z.number().min(0),
        details: z.record(
          z.string(),
          z.union([z.string(), z.number(), z.boolean(), z.null()]),
        ),
      }),
    ).default([]),
  }),
});
