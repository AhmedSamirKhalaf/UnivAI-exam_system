import { z } from "zod";

const objectIdRegex = /^[0-9a-fA-F]{24}$/;
const objectId = z.string().regex(objectIdRegex, "Invalid ObjectId");

export const enrollmentSchema = z.object({
  student_id: objectId,
  curriculum_id: objectId,
  enrolled_at: z.coerce.date(),
  status: z
    .enum(["active", "completed", "withdrawn"])
    .default("active"),
});

export type EnrollmentInput = z.infer<typeof enrollmentSchema>;
