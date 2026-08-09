import { describe, expect, test } from "vitest";
import { quizPackageV1Schema } from "../../src/lib/quiz-publication";
import { midtermPackageQuestionV1Schema } from "../../src/lib/midterm-publication";
import { finalPackageV1Schema } from "../../src/lib/final-publication";

const provenance = {
  document_id: "book",
  document_title: "Book",
  page_number: 1,
  section: "Section",
  excerpt: "Grounded evidence",
};

function options(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `Option ${index + 1}`);
}

describe("assessment MCQ option counts", () => {
  test("quiz publication keeps exactly four options", () => {
    const result = quizPackageV1Schema.shape.questions.element.safeParse({
      question_id: "quiz-question",
      prompt: "Prompt",
      type: "mcq",
      options: options(4),
      correct_option: "Option 1",
      provenance,
      question_hash: "a".repeat(64),
    });
    expect(result.success).toBe(true);

    const sixOptions = quizPackageV1Schema.shape.questions.element.safeParse({
      question_id: "quiz-question",
      prompt: "Prompt",
      type: "mcq",
      options: options(6),
      correct_option: "Option 1",
      provenance,
      question_hash: "a".repeat(64),
    });
    expect(sixOptions.success).toBe(false);
  });

  test("midterm MCQs accept six options and reject four", () => {
    const base = {
      schema_version: "question-provenance-v1",
      question_id: "mid-question",
      prompt: "Prompt",
      type: "mcq",
      correct_option: "Option 1",
      plan_version: "plan-v1",
      provenance,
      source_ids: ["source-1"],
      chapter_id: "64b000000000000000000103",
      week: 1,
      objective_ids: ["objective-1"],
      difficulty: "medium",
      integration: false,
      generator_prompt_version: "prompt-v1",
      question_hash: "a".repeat(64),
    };

    expect(
      midtermPackageQuestionV1Schema.safeParse({ ...base, options: options(6) })
        .success,
    ).toBe(true);
    expect(
      midtermPackageQuestionV1Schema.safeParse({ ...base, options: options(4) })
        .success,
    ).toBe(false);
  });

  test("final package schema rejects a four-option MCQ before publication", () => {
    const invalid = finalPackageV1Schema.safeParse({
      schema_version: "final-package-v1",
      package_id: "valid-package-id",
      learner_id: "learner",
      programme: "Programme",
      semester: "Semester",
      course_id: "Course",
      plan_version: "plan-v1",
      blueprint_id: "64b0000000000000000000ab",
      blueprint_version: "v1",
      generator_prompt_id: "prompt",
      generator_prompt_version: "v1",
      difficulty: "medium",
      curriculum_id: "64b0000000000000000000c3",
      semester_weeks: ["Week 1", "Week 2"],
      books: [{ document_id: "book", document_title: "Book" }],
      answer_key: { q1: "Option 1" },
      rubrics: {},
      questions: [
        {
          question_id: "q1",
          prompt: "Prompt",
          type: "mcq",
          week: "Week 1",
          difficulty: "medium",
          options: options(4),
          correct_option: "Option 1",
          provenance,
          question_hash: "a".repeat(64),
        },
      ],
    });

    expect(invalid.success).toBe(false);
  });
});
