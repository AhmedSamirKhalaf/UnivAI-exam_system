import assert from "node:assert/strict";
import test from "node:test";
import {
  gradeExamSubmission,
  integrityAdjustedMark,
} from "../src/lib/submission-grading";

test("flagged quiz and midterm marks are halved and rounded up", () => {
  assert.equal(integrityAdjustedMark(5, "quiz", true), 3);
  assert.equal(integrityAdjustedMark(1, "quiz", true), 1);
  assert.equal(integrityAdjustedMark(7, "mid", true), 4);
  assert.equal(integrityAdjustedMark(5, "quiz", false), 5);
});

test("the adjusted mark is the official pass/fail mark", () => {
  const exam: Parameters<typeof gradeExamSubmission>[0] = {
    type: "quiz" as const,
    generated_questions: [
      { question_id: "q1", type: "mcq", correct_option: "A" },
      { question_id: "q2", type: "mcq", correct_option: "B" },
      { question_id: "q3", type: "mcq", correct_option: "C" },
    ],
    passing_mark: 2,
    passed: false,
    grading_status: "auto_graded" as const,
    integrity_status: "clean" as const,
  };
  gradeExamSubmission(exam, [
    { question_id: "q1", answer: "A" },
    { question_id: "q2", answer: "B" },
    { question_id: "q3", answer: "C" },
  ], { flagged: true });

  assert.equal(exam.raw_mark, 3);
  assert.equal(exam.mark, 2);
  assert.equal(exam.integrity_penalty_applied, true);
  assert.equal(exam.passed, true);
});
