import { z } from "zod";

export const provenanceSourceSchema = z.object({
  document_id: z.string().min(1),
  document_title: z.string().min(1),
  page_number: z.number().int().min(1),
  section: z.string().min(1),
  excerpt: z.string().min(1).optional(),
});

export const questionProvenanceSchema = z.object({
  question_id: z.string().min(1),
  prompt: z.string().min(1),
  type: z.enum(["mcq", "essay"]),
  options: z.array(z.string()).optional(),
  correct_option: z.string().optional(),
  plan_version: z.string().min(1),
  approved: z.boolean().default(true),
  provenance: provenanceSourceSchema,
});

export type ProvenanceSourceInput = z.infer<typeof provenanceSourceSchema>;
export type QuestionProvenanceInput = z.infer<typeof questionProvenanceSchema>;
