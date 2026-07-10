import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectId = z.string().regex(objectIdRegex, "Invalid ObjectId");

export const curriculumSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  book_id: objectId.optional(),
  owner_student_id: objectId.optional(),
});

export type CurriculumInput = z.infer<typeof curriculumSchema>;
