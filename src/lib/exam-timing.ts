import type { ExamType } from "@/models/Exam";

export const QUIZ_SECONDS_PER_QUESTION = 60;
export const MIDTERM_SECONDS_PER_QUESTION = 90;

export function examTimeLimitSeconds(
  type: ExamType,
  questionCount: number,
): number | null {
  if (!Number.isSafeInteger(questionCount) || questionCount <= 0) return null;
  if (type === "quiz") return questionCount * QUIZ_SECONDS_PER_QUESTION;
  if (type === "mid") return questionCount * MIDTERM_SECONDS_PER_QUESTION;
  return null;
}

export function examDeadline(
  type: ExamType,
  questionCount: number,
  startedAt: Date,
): Date | null {
  const seconds = examTimeLimitSeconds(type, questionCount);
  return seconds === null
    ? null
    : new Date(startedAt.getTime() + seconds * 1_000);
}

