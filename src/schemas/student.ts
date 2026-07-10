import { z } from "zod";

export const studentSchema = z.object({
  name: z.string().min(1),
});

export type StudentInput = z.infer<typeof studentSchema>;
