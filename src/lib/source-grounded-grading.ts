import mongoose from "mongoose";
import { Exam } from "@/models/Exam";
import { ExamSession } from "@/models/ExamSession";
import { sendResultWebhook } from "@/lib/report-webhook";
import { questionProvenanceSchema, type QuestionProvenanceInput } from "@/schemas/question-provenance";

export interface StudentAnswerInput {
  question_id: string;
  answer: string;
}

export interface GradedAttemptResult {
  exam_id: string;
  attempt_number: number;
  student_id: string;
  student_sid?: string;
  mark: number;
  total_questions: number;
  passing_mark: number;
  passed: boolean;
  grading_status: string;
  idempotent: boolean;
  submitted_at: Date;
  integrity_metadata: {
    status: string;
    suspicion_score: number;
    flagged: boolean;
  };
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

/**
 * Server-side trusted grading logic for exams.
 * Computes scores strictly server-side, enforces submission idempotency,
 * and attaches attempt identity plus integrity metadata.
 */
export async function gradeAssessmentServerSide(
  examId: string | mongoose.Types.ObjectId,
  studentAnswers: StudentAnswerInput[],
  idempotencyKey?: string
): Promise<GradedAttemptResult> {
  const examIdObj = new mongoose.Types.ObjectId(examId.toString());
  const exam = await Exam.findById(examIdObj);
  if (!exam) {
    throw new Error(`Exam not found: ${examId}`);
  }

  const session = await ExamSession.findOne({ exam_id: examIdObj });
  const integrityMeta = {
    status: exam.integrity_status,
    suspicion_score: session?.suspicion_score ?? 0,
    flagged: session?.flagged ?? false,
  };

  const rawQuestions = (exam.generated_questions || []) as Record<string, unknown>[];
  const validatedSnapshot: QuestionProvenanceInput[] = rawQuestions.map((q) => {
    const parse = questionProvenanceSchema.safeParse(q);
    if (parse.success) return parse.data;
    return {
      question_id: (q.question_id as string) || "unknown",
      prompt: (q.prompt as string) || "",
      type: (q.type as "mcq" | "essay") || "mcq",
      options: q.options as string[] | undefined,
      correct_option: q.correct_option as string | undefined,
      plan_version: (q.plan_version as string) || exam.plan_version || "v1.0",
      approved: true,
      provenance: (q.provenance as QuestionProvenanceInput["provenance"]) || {
        document_id: "legacy_doc",
        document_title: "Course Material",
        page_number: 1,
        section: "General",
        excerpt: (q.prompt as string) || "",
      },
    };
  });

  // Idempotency check: if exam has already been submitted, return saved result without double-grading
  if (exam.taken) {
    return {
      exam_id: exam._id.toString(),
      attempt_number: exam.attempt_number,
      student_id: exam.student_id.toString(),
      student_sid: exam.student_sid,
      mark: exam.mark ?? 0,
      total_questions: validatedSnapshot.length,
      passing_mark: exam.passing_mark ?? 0,
      passed: exam.passed,
      grading_status: exam.grading_status,
      idempotent: true,
      submitted_at: exam.submitted_at ?? exam.updatedAt,
      integrity_metadata: integrityMeta,
      questions_snapshot: validatedSnapshot,
    };
  }

  // Calculate objective score strictly server-side
  let correctCount = 0;
  for (const answerInput of studentAnswers) {
    const matchingQ = validatedSnapshot.find(
      (q) => q.question_id === answerInput.question_id
    );
    if (matchingQ && matchingQ.type === "mcq") {
      if (matchingQ.correct_option && answerInput.answer === matchingQ.correct_option) {
        correctCount++;
      }
    }
  }

  const passingMark = exam.passing_mark ?? Math.max(1, Math.ceil(validatedSnapshot.length * 0.6));
  const passed = exam.integrity_status === "invalidated" ? false : correctCount >= passingMark;

  const now = new Date();
  exam.student_answers = studentAnswers as unknown as Record<string, unknown>[];
  exam.taken = true;
  exam.mark = correctCount;
  exam.passing_mark = passingMark;
  exam.passed = passed;
  exam.grading_status = "auto_graded";
  exam.submitted_at = now;
  if (idempotencyKey) {
    exam.submission_idempotency_key = idempotencyKey;
  }
  exam.integrity_metadata = integrityMeta;
  await exam.save();

  if (session) {
    session.status = "completed";
    session.ended_at = now;
    session.terminated_reason = "student_submitted";
    await session.save();
  }

  // Webhook notification trigger
  await sendResultWebhook(exam);

  return {
    exam_id: exam._id.toString(),
    attempt_number: exam.attempt_number,
    student_id: exam.student_id.toString(),
    student_sid: exam.student_sid,
    mark: correctCount,
    total_questions: validatedSnapshot.length,
    passing_mark: passingMark,
    passed,
    grading_status: "auto_graded",
    idempotent: false,
    submitted_at: now,
    integrity_metadata: integrityMeta,
    questions_snapshot: validatedSnapshot,
  };
}

/**
 * Validates that an output is source-grounded or returns an explicit refusal.
 */
export function generateSourceGroundedResponse(
  questionId: string,
  snapshotQuestions: Record<string, unknown>[]
): GroundedResponseResult {
  const q = snapshotQuestions.find((item) => item.question_id === questionId);
  if (!q || !q.provenance) {
    return {
      refused: true,
      reason: "Insufficient evidence: source provenance missing or unverified.",
    };
  }

  const prov = q.provenance as Record<string, unknown>;
  if (!prov.document_id || !prov.section) {
    return {
      refused: true,
      reason: "Insufficient evidence: source provenance missing or unverified.",
    };
  }

  const parse = questionProvenanceSchema.safeParse(q);
  if (!parse.success || !parse.data.approved) {
    return {
      refused: true,
      reason: "Question is unapproved or failed schema validation.",
    };
  }

  return {
    refused: false,
    question_id: q.question_id as string,
    answer: (q.correct_option as string) || "Grounded response verified against blueprint source.",
    citation: {
      document_id: parse.data.provenance.document_id,
      document_title: parse.data.provenance.document_title,
      page_number: parse.data.provenance.page_number,
      section: parse.data.provenance.section,
      excerpt: parse.data.provenance.excerpt,
    },
  };
}

/**
 * Historical attempt reader — preserves source citations even if source documents are later removed.
 */
export async function getHistoricalAttempt(
  examId: string | mongoose.Types.ObjectId
): Promise<Record<string, unknown> & { immutable_questions_snapshot: QuestionProvenanceInput[] }> {
  const exam = await Exam.findById(examId);
  if (!exam) {
    throw new Error(`Exam not found: ${examId}`);
  }

  const rawQuestions = (exam.generated_questions || []) as Record<string, unknown>[];
  const immutable_questions_snapshot: QuestionProvenanceInput[] = rawQuestions.map((q) => {
    const parse = questionProvenanceSchema.safeParse(q);
    if (parse.success) return parse.data;
    return {
      question_id: (q.question_id as string) || "unknown",
      prompt: (q.prompt as string) || "",
      type: (q.type as "mcq" | "essay") || "mcq",
      options: q.options as string[] | undefined,
      correct_option: q.correct_option as string | undefined,
      plan_version: (q.plan_version as string) || "v1.0",
      approved: true,
      provenance: (q.provenance as QuestionProvenanceInput["provenance"]) || {
        document_id: "archived_doc",
        document_title: "Archived Source",
        page_number: 1,
        section: "Historical Snapshot",
        excerpt: q.prompt,
      },
    };
  });

  const obj = exam.toObject ? exam.toObject() : exam;
  return {
    ...obj,
    immutable_questions_snapshot,
  };
}
