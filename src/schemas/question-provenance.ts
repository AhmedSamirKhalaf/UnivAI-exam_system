import { z } from "zod";

const requiredText = z.string().trim().min(1);

export const provenanceSourceSchema = z.object({
  document_id: requiredText,
  document_title: requiredText,
  page_number: z.number().int().min(1),
  section: requiredText,
  excerpt: requiredText.optional(),
});

const questionFields = {
  schema_version: z.literal("question-provenance-v1"),
  question_id: requiredText,
  prompt: requiredText,
  type: z.enum(["mcq", "essay"]),
  options: z.array(requiredText).optional(),
  correct_option: requiredText.optional(),
  plan_version: requiredText,
  provenance: provenanceSourceSchema,
};

function validateQuestionShape(
  question: {
    type: "mcq" | "essay";
    options?: string[];
    correct_option?: string;
  },
  context: z.RefinementCtx,
): void {
  if (question.type === "mcq") {
    if (!question.options || question.options.length < 2) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "MCQ questions require at least two options",
      });
    } else if (
      !question.correct_option ||
      !question.options.includes(question.correct_option)
    ) {
      context.addIssue({
        code: "custom",
        path: ["correct_option"],
        message: "MCQ correct_option must match one supplied option",
      });
    }
  }

  if (
    question.type === "essay" &&
    (question.options !== undefined || question.correct_option !== undefined)
  ) {
    context.addIssue({
      code: "custom",
      path: ["type"],
      message: "Essay questions cannot contain MCQ options or a correct_option",
    });
  }
}

export const proposedQuestionProvenanceSchema = z
  .object({
    ...questionFields,
    approved: z.boolean().optional().default(false),
  })
  .superRefine(validateQuestionShape);

export const questionProvenanceSchema = z
  .object({
    ...questionFields,
    approved: z.literal(true),
  })
  .superRefine(validateQuestionShape);

export type ProvenanceSourceInput = z.infer<typeof provenanceSourceSchema>;
export type ProposedQuestionProvenanceInput = z.infer<
  typeof proposedQuestionProvenanceSchema
>;
export type QuestionProvenanceInput = z.infer<
  typeof questionProvenanceSchema
>;
