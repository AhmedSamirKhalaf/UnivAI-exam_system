import { z } from "zod";

export const curriculumSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
});

export type CurriculumInput = z.infer<typeof curriculumSchema>;
