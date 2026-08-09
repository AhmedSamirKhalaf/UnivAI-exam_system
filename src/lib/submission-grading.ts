import type { ExamType, GradingStatus, IntegrityStatus } from "../models/Exam";
import { scoreObjectiveAnswers } from "./objective-scoring";

interface SubmissionGradingTarget {
  type: ExamType;
  generated_questions?: Record<string, unknown>[];
  mark?: number;
  passing_mark?: number;
  passed: boolean;
  grading_status: GradingStatus;
  integrity_status: IntegrityStatus;
}

function isObjectiveFinal(exam: SubmissionGradingTarget): boolean {
  const questions = exam.generated_questions ?? [];
  return (
    exam.type === "final" &&
    questions.length > 0 &&
    questions.every((question) => question.type === "mcq")
  );
}

/**
 * Grade an all-objective submission immediately. Finals containing any
 * non-objective item remain pending for a trusted human mark. Integrity stays
 * an independent gate: an invalidated attempt keeps its score but cannot pass.
 */
export function gradeExamSubmission(
  exam: SubmissionGradingTarget,
  studentAnswers: Record<string, unknown>[],
): void {
  if (exam.type === "final" && !isObjectiveFinal(exam)) {
    exam.grading_status = "pending_review";
    return;
  }

  const questions = exam.generated_questions ?? [];
  const score = scoreObjectiveAnswers(questions, studentAnswers);

  exam.mark = score.mark;
  exam.passing_mark ??= Math.max(1, Math.ceil(questions.length * 0.6));
  exam.passed =
    exam.integrity_status !== "invalidated" &&
    score.mark >= exam.passing_mark;
  exam.grading_status = "auto_graded";
}
