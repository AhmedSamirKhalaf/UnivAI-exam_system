import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { Exam, type IExam } from "@/models/Exam";
import { ExamSession, type IExamSession } from "@/models/ExamSession";
import { assertStandaloneRequest, isStandalone } from "@/lib/runtime";

export type PublicQuestion = {
  question_id: string;
  prompt: string;
  type: "mcq" | "essay";
  options?: string[];
};

export type ExamAttemptView = {
  _id: string;
  type: "quiz" | "mid" | "final";
  title: string;
  taken: boolean;
  integrity_status: "clean" | "invalidated";
  started_at?: string;
  current_question: PublicQuestion | null;
  progress: {
    position: number;
    total: number;
    answered: number;
  };
  answer_revision: number;
  can_submit: boolean;
  integrity_state: "active" | "reconnecting" | "grace" | "integrity_locked" | "submitted";
  lock_reason?: string;
  result?: {
    grading_status: "auto_graded" | "pending_review" | "graded";
    mark?: number;
    passing_mark?: number;
    passed: boolean;
    integrity_status: "clean" | "invalidated";
    review_status: "not_required" | "pending" | "cleared" | "upheld";
  };
};

export class ExamAttemptError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export const answerCurrentQuestionSchema = z
  .object({
    question_id: z.string().min(1).max(120),
    answer: z.string().max(10_000).default(""),
    action: z.enum(["answer", "skip"]),
    revision: z.number().int().min(0),
    idempotency_key: z.string().min(8).max(128),
  })
  .strict();

function tokenDigest(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function bearerToken(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim() || null;
}

export async function issueExamAttemptToken(
  examId: string | mongoose.Types.ObjectId,
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const result = await ExamSession.updateOne(
    { exam_id: examId, status: "in_progress" },
    {
      $set: {
        access_token_hash: tokenDigest(token),
        access_token_issued_at: new Date(),
      },
    },
  );
  if (result.matchedCount !== 1) {
    throw new ExamAttemptError("Active exam session not found", 409);
  }
  return token;
}

export async function verifyExamAttemptToken(
  examId: string | mongoose.Types.ObjectId,
  token: string,
): Promise<IExamSession | null> {
  const session = await ExamSession.findOne({ exam_id: examId }).select(
    "+access_token_hash",
  );
  if (!session?.access_token_hash) return null;
  return safeEqual(session.access_token_hash, tokenDigest(token))
    ? session
    : null;
}

export async function requireExamAttempt(
  request: Request,
  examId: string,
): Promise<IExamSession | null> {
  if (isStandalone()) {
    assertStandaloneRequest(request);
    return ExamSession.findOne({ exam_id: examId });
  }

  const token = bearerToken(request);
  if (!token) throw new ExamAttemptError("Exam access token is required", 401);
  const session = await verifyExamAttemptToken(examId, token);
  if (!session) throw new ExamAttemptError("Exam access token is invalid", 403);
  return session;
}

function publicQuestion(value: Record<string, unknown>): PublicQuestion {
  const type = value.type === "essay" ? "essay" : "mcq";
  return {
    question_id: String(value.question_id ?? ""),
    prompt: String(value.prompt ?? ""),
    type,
    ...(type === "mcq" && Array.isArray(value.options)
      ? { options: value.options.map(String) }
      : {}),
  };
}

export function buildExamAttemptView(
  exam: Pick<
    IExam,
    | "_id"
    | "type"
    | "title"
    | "taken"
    | "integrity_status"
    | "generated_questions"
    | "grading_status"
    | "mark"
    | "passing_mark"
    | "passed"
    | "review_status"
  >,
  session: Pick<
    IExamSession,
    | "current_question_index"
    | "answer_revision"
    | "answers"
    | "status"
    | "integrity_state"
    | "integrity_lock_reason"
    | "started_at"
  > | null,
): ExamAttemptView {
  const questions = (exam.generated_questions ?? []) as Record<string, unknown>[];
  const index = Math.min(
    Math.max(0, session?.current_question_index ?? 0),
    questions.length,
  );
  const integrityState = session?.integrity_state ?? (exam.taken ? "submitted" : "active");
  const active =
    !exam.taken &&
    session?.status === "in_progress" &&
    integrityState === "active";

  return {
    _id: exam._id.toString(),
    type: exam.type,
    title: exam.title,
    taken: exam.taken,
    integrity_status: exam.integrity_status,
    ...(session?.started_at ? { started_at: session.started_at.toISOString() } : {}),
    current_question: active && index < questions.length
      ? publicQuestion(questions[index])
      : null,
    progress: {
      position: Math.min(index + 1, questions.length),
      total: questions.length,
      answered: Math.min(index, questions.length),
    },
    answer_revision: session?.answer_revision ?? 0,
    can_submit: active && index >= questions.length,
    integrity_state: integrityState,
    ...(session?.integrity_lock_reason
      ? { lock_reason: session.integrity_lock_reason }
      : {}),
    ...(exam.taken
      ? {
          result: {
            grading_status: exam.grading_status,
            ...(exam.mark !== undefined ? { mark: exam.mark } : {}),
            ...(exam.passing_mark !== undefined ? { passing_mark: exam.passing_mark } : {}),
            passed: exam.passed,
            integrity_status: exam.integrity_status,
            review_status: exam.review_status,
          },
        }
      : {}),
  };
}

export async function getExamAttemptView(
  examId: string | mongoose.Types.ObjectId,
  knownSession?: IExamSession | null,
): Promise<ExamAttemptView> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new ExamAttemptError("Exam not found", 404);
  const session = knownSession === undefined
    ? await ExamSession.findOne({ exam_id: exam._id })
    : knownSession;
  return buildExamAttemptView(exam, session ?? null);
}

export async function createExamLaunch(
  exam: IExam,
  origin: string,
): Promise<ExamAttemptView & { attempt_token: string; launch_url: string }> {
  const attemptToken = await issueExamAttemptToken(exam._id);
  const session = await ExamSession.findOne({ exam_id: exam._id });
  const view = buildExamAttemptView(exam, session);
  return {
    ...view,
    attempt_token: attemptToken,
    launch_url: `${origin}/exam/${exam._id.toString()}#attempt_token=${encodeURIComponent(attemptToken)}`,
  };
}

export async function saveCurrentAnswer(
  examId: string,
  input: z.infer<typeof answerCurrentQuestionSchema>,
): Promise<ExamAttemptView & { idempotent: boolean }> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new ExamAttemptError("Exam not found", 404);
  if (exam.taken) throw new ExamAttemptError("Exam already submitted", 409);

  const questions = (exam.generated_questions ?? []) as Record<string, unknown>[];
  const session = await ExamSession.findOne({ exam_id: exam._id });
  if (
    !session ||
    session.status !== "in_progress" ||
    session.integrity_state !== "active"
  ) {
    throw new ExamAttemptError("Exam session is not active", 409);
  }

  if (session.last_action_id === input.idempotency_key) {
    return { ...buildExamAttemptView(exam, session), idempotent: true };
  }

  const index = session.current_question_index ?? 0;
  const question = questions[index];
  if (!question) throw new ExamAttemptError("All questions are already complete", 409);
  if (String(question.question_id) !== input.question_id) {
    throw new ExamAttemptError("Question is not the current server question", 409);
  }
  const revision = session.answer_revision ?? 0;
  if (revision !== input.revision) {
    throw new ExamAttemptError("Answer revision is stale", 409);
  }

  const answer = input.action === "skip" ? "" : input.answer;
  const updated = await ExamSession.findOneAndUpdate(
    {
      _id: session._id,
      status: "in_progress",
      integrity_state: "active",
      current_question_index: index,
      answer_revision: revision,
    },
    {
      $set: {
        [`answers.${index}`]: {
          question_id: input.question_id,
          answer,
          action: input.action,
          accepted_at: new Date(),
        },
        last_action_id: input.idempotency_key,
        last_action_question_id: input.question_id,
        last_action_revision: input.revision,
      },
      $inc: { current_question_index: 1, answer_revision: 1 },
    },
    { returnDocument: "after", runValidators: true },
  );
  if (!updated) throw new ExamAttemptError("Answer state changed; reload the current question", 409);

  return { ...buildExamAttemptView(exam, updated), idempotent: false };
}

export async function getServerStoredAnswers(
  examId: string | mongoose.Types.ObjectId,
): Promise<Record<string, unknown>[]> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new ExamAttemptError("Exam not found", 404);
  const session = await ExamSession.findOne({ exam_id: exam._id });
  const total = exam.generated_questions?.length ?? 0;
  if (
    !session ||
    session.status !== "in_progress" ||
    session.integrity_state !== "active"
  ) {
    throw new ExamAttemptError("Exam session is not active", 409);
  }
  if (session.current_question_index < total) {
    throw new ExamAttemptError("Every question must be answered or skipped before submission", 409);
  }
  return session.answers ?? [];
}

export function examAttemptErrorResponse(error: unknown): Response {
  if (error instanceof ExamAttemptError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof z.ZodError) {
    return Response.json(
      { error: "Invalid request", details: error.issues },
      { status: 400 },
    );
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "Unknown error" },
    { status: 500 },
  );
}
