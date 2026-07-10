import { z } from "zod";

export const createMidSchema = z
  .object({
    curriculum_id: z.string(),
    title: z.string().min(1),
    chapter_ids: z
      .array(z.string())
      .min(1, "At least one chapter is required")
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "chapter_ids must not contain duplicates"
      ),
    passing_mark: z.number().min(0),
  })
  .strict();

export type CreateMidInput = z.infer<typeof createMidSchema>;
