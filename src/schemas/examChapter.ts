import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectId = z.string().regex(objectIdRegex, "Invalid ObjectId");

export const examChapterSchema = z.object({
  chapter_id: objectId,
  exam_id: objectId,
});

export type ExamChapterInput = z.infer<typeof examChapterSchema>;
