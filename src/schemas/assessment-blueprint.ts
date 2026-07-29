import { z } from "zod";

export const sourceCoverageSchema = z.object({
  document_id: z.string().min(1),
  document_title: z.string().optional(),
  sections: z.array(z.string()).min(1),
});

export const assessmentBlueprintSchema = z.object({
  programme: z.string().min(1),
  semester: z.string().min(1),
  course_id: z.string().min(1),
  title: z.string().min(1),
  outcomes: z.array(z.string()).min(1),
  difficulty: z.enum(["easy", "medium", "hard", "mixed"]),
  source_coverage: z.array(sourceCoverageSchema).min(1),
  plan_version: z.string().min(1),
  approved: z.boolean().default(true),
  approved_by: z.string().optional(),
});

export type SourceCoverageInput = z.infer<typeof sourceCoverageSchema>;
export type AssessmentBlueprintInput = z.infer<typeof assessmentBlueprintSchema>;
