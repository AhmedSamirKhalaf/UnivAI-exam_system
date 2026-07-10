import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectId = z.string().regex(objectIdRegex, "Invalid ObjectId");

export const bookSchema = z.object({
  title: z.string().min(1),
  original_filename: z.string().min(1),
  storage_path: z.string().min(1),
  status: z
    .enum(["uploaded", "processing", "ready", "failed"])
    .default("uploaded"),
  requested_by_student_id: objectId.optional(),
  error_message: z.string().optional(),
});

export type BookInput = z.infer<typeof bookSchema>;
