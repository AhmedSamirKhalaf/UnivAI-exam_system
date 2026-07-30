import { z } from "zod";

const requiredText = z.string().trim().min(1);

export const sourcePageRangeSchema = z
  .object({
    start: z.number().int().min(1),
    end: z.number().int().min(1),
  })
  .superRefine((range, context) => {
    if (range.end < range.start) {
      context.addIssue({
        code: "custom",
        path: ["end"],
        message: "Page range end must be greater than or equal to start",
      });
    }
  });

export const sourceCoverageSchema = z.object({
  document_id: requiredText,
  document_title: requiredText,
  sections: z.array(requiredText).min(1),
  page_ranges: z.array(sourcePageRangeSchema).min(1),
});

export const assessmentBlueprintSchema = z
  .object({
    schema_version: z.literal("assessment-blueprint-v1"),
    programme: requiredText,
    semester: requiredText,
    course_id: requiredText,
    title: requiredText,
    outcomes: z.array(requiredText).min(1),
    difficulty: z.enum(["easy", "medium", "hard", "mixed"]),
    source_coverage: z.array(sourceCoverageSchema).min(1),
    plan_version: requiredText,
    approved: z.boolean().default(false),
    approved_by: requiredText.optional(),
    approved_at: z.coerce.date().optional(),
  })
  .superRefine((blueprint, context) => {
    if (blueprint.approved && !blueprint.approved_by) {
      context.addIssue({
        code: "custom",
        path: ["approved_by"],
        message: "approved_by is required for an approved blueprint",
      });
    }
    if (blueprint.approved && !blueprint.approved_at) {
      context.addIssue({
        code: "custom",
        path: ["approved_at"],
        message: "approved_at is required for an approved blueprint",
      });
    }
  });

export type SourcePageRangeInput = z.infer<typeof sourcePageRangeSchema>;
export type SourceCoverageInput = z.infer<typeof sourceCoverageSchema>;
export type AssessmentBlueprintInput = z.infer<
  typeof assessmentBlueprintSchema
>;
