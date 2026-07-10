import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectId = z.string().regex(objectIdRegex, "Invalid ObjectId");

export const chapterSchema = z.object({
  curriculum_id: objectId,
  title: z.string().min(1),
  number: z.number().int().min(0),
});

export type ChapterInput = z.infer<typeof chapterSchema>;
