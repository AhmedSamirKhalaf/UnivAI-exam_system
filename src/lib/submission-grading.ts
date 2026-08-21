import type { ExamType, GradingStatus, IntegrityStatus } from "../models/Exam";
import { scoreObjectiveAnswers } from "./objective-scoring";

interface SubmissionGradingTarget {
  type: ExamType;
  generated_questions?: Record<string, unknown>[];
  raw_mark?: number;
  integrity_penalty_applied?: boolean;
  mark?: number;
  passing_mark?: number;
  passed: boolean;
  grading_status: GradingStatus;
  integrity_status: IntegrityStatus;
}

export function integrityAdjustedMark(
  rawMark: number,
  type: ExamType,
  flagged: boolean,
): number {
  return flagged && (type === "quiz" || type === "mid")
    ? Math.ceil(rawMark / 2)
    : rawMark;
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
  options: { flagged?: boolean } = {},
): void {
  if (exam.type === "final" && !isObjectiveFinal(exam)) {
    exam.grading_status = "pending_review";
    return;
  }

  const questions = exam.generated_questions ?? [];
  const score = scoreObjectiveAnswers(questions, studentAnswers);
  const flagged = options.flagged === true;
  const penaltyApplies = flagged && (exam.type === "quiz" || exam.type === "mid");

  exam.raw_mark = score.mark;
  exam.mark = integrityAdjustedMark(score.mark, exam.type, flagged);
  exam.integrity_penalty_applied = penaltyApplies;
  exam.passing_mark ??= Math.max(1, Math.ceil(questions.length * 0.6));
  exam.passed =
    exam.integrity_status !== "invalidated" &&
    exam.mark >= exam.passing_mark;
  exam.grading_status = "auto_graded";
}
