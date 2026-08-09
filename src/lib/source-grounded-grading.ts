import mongoose from "mongoose";
import { z } from "zod";
import type { IExam } from "../models/Exam";
import { scoreObjectiveAnswers } from "./objective-scoring";
import {
  questionProvenanceSchema,
  type QuestionProvenanceInput,
} from "../schemas/question-provenance";

const studentAnswersSchema = z
  .array(
    z.object({
      question_id: z.string().trim().min(1),
      answer: z.string(),
    }),
  );

export interface StudentAnswerInput {
  question_id: string;
  answer: string;
}

export interface IntegrityMetadata {
  status: string;
  suspicion_score: number;
  flagged: boolean;
}

export interface ObjectiveGrade {
  mark: number;
  passing_mark: number;
  passed: boolean;
  grading_status: "auto_graded" | "pending_review";
}

export interface GradedAttemptResult extends ObjectiveGrade {
  exam_id: string;
  attempt_number: number;
  student_id: string;
  student_sid?: string;
  total_questions: number;
  idempotent: boolean;
  submitted_at: Date;
  integrity_metadata: IntegrityMetadata;
  questions_snapshot: QuestionProvenanceInput[];
}

export interface GroundedResponseResult {
  refused: boolean;
  reason?: string;
  question_id?: string;
  answer?: string;
  citation?: {
    document_id: string;
    document_title: string;
    page_number: number;
    section: string;
    excerpt?: string;
  };
}

function parseQuestionSnapshot(snapshot: unknown): QuestionProvenanceInput[] {
  const result = z.array(questionProvenanceSchema).min(1).safeParse(snapshot);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Immutable question snapshot is invalid: ${details}`);
  }

  const ids = result.data.map((question) => question.question_id);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Immutable question snapshot contains duplicate question IDs");
  }
  return result.data;
}

export function gradeQuestionSnapshot(
  snapshot: unknown,
  studentAnswers: unknown,
  passingMark: number,
  integrityStatus: string,
): ObjectiveGrade {
  const questions = parseQuestionSnapshot(snapshot);
  const answerResult = studentAnswersSchema.safeParse(studentAnswers);
  if (!answerResult.success) {
    throw new Error(
      `Student answers are invalid: ${answerResult.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
  }
  if (!Number.isInteger(passingMark) || passingMark < 1) {
    throw new Error("passingMark must be a positive integer");
  }

  const answers = answerResult.data;
  const answerIds = answers.map((answer) => answer.question_id);
  if (new Set(answerIds).size !== answerIds.length) {
    throw new Error("Student answers contain duplicate question IDs");
  }

  const questionsById = new Map(
    questions.map((question) => [question.question_id, question]),
  );
  const unknownId = answerIds.find((questionId) => !questionsById.has(questionId));
  if (unknownId) {
    throw new Error(`Student answer references unknown question "${unknownId}"`);
  }

  const { mark } = scoreObjectiveAnswers(questions, answers);

  const hasEssay = questions.some((question) => question.type === "essay");
  const gradingStatus = hasEssay ? "pending_review" : "auto_graded";
  return {
    mark,
    passing_mark: passingMark,
    passed:
      gradingStatus === "auto_graded" &&
      integrityStatus !== "invalidated" &&
      mark >= passingMark,
    grading_status: gradingStatus,
  };
}

function integrityMetadata(
  exam: IExam,
  session: {
    suspicion_score?: number;
    flagged?: boolean;
  } | null,
): IntegrityMetadata {
  const stored = exam.integrity_metadata;
  if (
    exam.taken &&
    stored &&
    typeof stored.status === "string" &&
    typeof stored.suspicion_score === "number" &&
    typeof stored.flagged === "boolean"
  ) {
    return {
      status: stored.status,
      suspicion_score: stored.suspicion_score,
      flagged: stored.flagged,
    };
  }
  return {
    status: exam.integrity_status,
    suspicion_score: session?.suspicion_score ?? 0,
    flagged: session?.flagged ?? false,
  };
}

function duplicateResult(
  exam: IExam,
  questions: QuestionProvenanceInput[],
  integrity: IntegrityMetadata,
  idempotencyKey: string,
): GradedAttemptResult {
  if (
    !exam.submission_idempotency_key ||
    exam.submission_idempotency_key !== idempotencyKey
  ) {
    throw new Error("Exam was already submitted with a different idempotency key");
  }
  return {
    exam_id: exam._id.toString(),
    attempt_number: exam.attempt_number,
    student_id: exam.student_id.toString(),
    student_sid: exam.student_sid,
    mark: exam.mark ?? 0,
    total_questions: questions.length,
    passing_mark: exam.passing_mark ?? 0,
    passed: exam.passed,
    grading_status:
      exam.grading_status === "pending_review"
        ? "pending_review"
        : "auto_graded",
    idempotent: true,
    submitted_at: exam.submitted_at ?? exam.updatedAt,
    integrity_metadata: integrity,
    questions_snapshot: questions,
  };
}

/**
 * Atomically grades a blueprint-backed attempt. The `taken: false` update
 * guard is the concurrency boundary; only the process that changes it to true
 * sends the webhook and completes the session.
 */
export async function gradeAssessmentServerSide(
  examId: string | mongoose.Types.ObjectId,
  studentAnswers: StudentAnswerInput[],
  idempotencyKey: string,
): Promise<GradedAttemptResult> {
  const normalizedKey = idempotencyKey.trim();
  if (!normalizedKey || normalizedKey.length > 200) {
    throw new Error("A valid idempotency key is required");
  }

  const examIdObj = new mongoose.Types.ObjectId(examId.toString());
  const [{ Exam }, { ExamSession }] = await Promise.all([
    import("../models/Exam"),
    import("../models/ExamSession"),
  ]);
  const exam = await Exam.findById(examIdObj);
  if (!exam) {
    throw new Error(`Exam not found: ${examId}`);
  }
  if (!exam.blueprint_id || !exam.plan_version) {
    throw new Error("Exam is not linked to an approved assessment blueprint");
  }

  const questions = parseQuestionSnapshot(exam.questions_snapshot);
  if (
    questions.some((question) => question.plan_version !== exam.plan_version)
  ) {
    throw new Error("Question snapshot plan version does not match the exam");
  }

  const session = await ExamSession.findOne({ exam_id: examIdObj });
  const integrity = integrityMetadata(exam, session);
  if (exam.taken) {
    return duplicateResult(exam, questions, integrity, normalizedKey);
  }

  const passingMark =
    exam.passing_mark ?? Math.max(1, Math.ceil(questions.length * 0.6));
  const grade = gradeQuestionSnapshot(
    questions,
    studentAnswers,
    passingMark,
    exam.integrity_status,
  );
  const submittedAt = new Date();

  const updated = await Exam.findOneAndUpdate(
    { _id: examIdObj, taken: false },
    {
      $set: {
        student_answers: studentAnswers,
        taken: true,
        mark: grade.mark,
        passing_mark: grade.passing_mark,
        passed: grade.passed,
        grading_status: grade.grading_status,
        submitted_at: submittedAt,
        submission_idempotency_key: normalizedKey,
        integrity_metadata: integrity,
        result_webhook_attempts: 0,
        result_webhook_next_attempt_at: submittedAt,
      },
      $inc: { result_webhook_version: 1 },
      $unset: {
        result_webhook_locked_until: "",
        result_webhook_last_error: "",
      },
    },
            { returnDocument: "after", runValidators: true },
  );

  if (!updated) {
    const concurrentlySubmitted = await Exam.findById(examIdObj);
    if (!concurrentlySubmitted) {
      throw new Error(`Exam not found after concurrent submission: ${examId}`);
    }
    return duplicateResult(
      concurrentlySubmitted,
      parseQuestionSnapshot(concurrentlySubmitted.questions_snapshot),
      integrityMetadata(concurrentlySubmitted, session),
      normalizedKey,
    );
  }

  await ExamSession.updateOne(
    { exam_id: examIdObj, status: "in_progress" },
    {
      $set: {
        status: "completed",
        ended_at: submittedAt,
        terminated_reason: "student_submitted",
      },
    },
  );

  const { sendResultWebhook } = await import("./report-webhook");
  await sendResultWebhook(updated);

  return {
    exam_id: updated._id.toString(),
    attempt_number: updated.attempt_number,
    student_id: updated.student_id.toString(),
    student_sid: updated.student_sid,
    ...grade,
    total_questions: questions.length,
    idempotent: false,
    submitted_at: submittedAt,
    integrity_metadata: integrity,
    questions_snapshot: questions,
  };
}

export function generateSourceGroundedResponse(
  questionId: string,
  snapshotQuestions: unknown,
): GroundedResponseResult {
  let questions: QuestionProvenanceInput[];
  try {
    questions = parseQuestionSnapshot(snapshotQuestions);
  } catch {
    return {
      refused: true,
      reason: "Insufficient evidence: the immutable source snapshot is invalid.",
    };
  }

  const question = questions.find((item) => item.question_id === questionId);
  if (!question) {
    return {
      refused: true,
      reason: "Insufficient evidence: no approved question snapshot was found.",
    };
  }

  const answer =
    question.type === "mcq"
      ? question.correct_option
      : question.provenance.excerpt;
  if (!answer) {
    return {
      refused: true,
      reason: "Insufficient evidence: no verified answer is stored in the snapshot.",
    };
  }

  return {
    refused: false,
    question_id: question.question_id,
    answer,
    citation: { ...question.provenance },
  };
}

export async function getHistoricalAttempt(
  examId: string | mongoose.Types.ObjectId,
): Promise<
  Record<string, unknown> & {
    immutable_questions_snapshot: QuestionProvenanceInput[];
  }
> {
  const { Exam } = await import("../models/Exam");
  const exam = await Exam.findById(examId);
  if (!exam) {
    throw new Error(`Exam not found: ${examId}`);
  }

  const immutableQuestionsSnapshot = parseQuestionSnapshot(
    exam.questions_snapshot,
  );
  const object = exam.toObject();
  return {
    ...object,
    immutable_questions_snapshot: immutableQuestionsSnapshot,
  };
}
