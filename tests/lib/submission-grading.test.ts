import { describe, expect, test } from "vitest";
import { gradeExamSubmission } from "../../src/lib/submission-grading";

function finalExam(
  questions: Record<string, unknown>[],
  overrides: Record<string, unknown> = {},
) {
  return {
    type: "final" as const,
    generated_questions: questions,
    passed: false,
    grading_status: "auto_graded" as const,
    integrity_status: "clean" as const,
    ...overrides,
  };
}

const objectiveQuestions = [
  {
    question_id: "q1",
    type: "mcq",
    correct_option: "A",
  },
  {
    question_id: "q2",
    type: "mcq",
    correct_option: "B",
  },
];

describe("final submission grading", () => {
  test("auto-grades an objective-only final on submission", () => {
    const exam = finalExam(objectiveQuestions, { passing_mark: 2 });

    gradeExamSubmission(exam, [
      { question_id: "q1", answer: "A" },
      { question_id: "q2", answer: "B" },
    ]);

    expect(exam).toMatchObject({
      mark: 2,
      passing_mark: 2,
      passed: true,
      grading_status: "auto_graded",
    });
  });

  test("keeps a final with an essay pending for manual review", () => {
    const exam = finalExam([
      objectiveQuestions[0],
      { question_id: "essay1", type: "essay" },
    ]);

    gradeExamSubmission(exam, [
      { question_id: "q1", answer: "A" },
      { question_id: "essay1", answer: "Explanation" },
    ]);

    expect(exam).toMatchObject({
      passed: false,
      grading_status: "pending_review",
    });
    expect(exam).not.toHaveProperty("mark");
  });

  test("scores but never passes an invalidated objective final", () => {
    const exam = finalExam(objectiveQuestions, {
      passing_mark: 1,
      integrity_status: "invalidated" as const,
    });

    gradeExamSubmission(exam, [
      { question_id: "q1", answer: "A" },
      { question_id: "q2", answer: "B" },
    ]);

    expect(exam).toMatchObject({
      mark: 2,
      passed: false,
      grading_status: "auto_graded",
      integrity_status: "invalidated",
    });
  });
});
