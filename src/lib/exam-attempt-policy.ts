import mongoose from "mongoose";
import {
  ExamAttemptRecord,
  type IExamAttemptRecord,
} from "@/models/ExamAttemptRecord";
import type { AttemptTerminalStatus } from "@/models/ExamAttemptRecord";
import { ExamSession, type IExamSession } from "@/models/ExamSession";
import { Exam, type IExam } from "@/models/Exam";

export type { AttemptTerminalStatus };

/**
 * Exam attempt policy — the authoritative product source of truth.
 *
 * The Exam service owns this table and enforces it atomically at the moment an
 * attempt is issued. Client clocks, query parameters, local storage, cookies
 * and request bodies can never decide eligibility; only the server clock and
 * the durable attempt ledger matter. Unknown assessment types fail closed.
 *
 *   Assessment  Maximum attempts  Minimum wait before the next attempt
 *   Quiz        2                 3 hours
 *   Midterm     3                 5 hours
 *   Final       2                 7 days (reserve form; app approval required)
 */

export const ATTEMPT_POLICY_VERSION = "univai-exam-attempt-policy-v2";

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;

export const EXAM_ATTEMPT_POLICY: Record<
  "quiz" | "mid" | "final",
  { max_attempts: number; cooldown_seconds: number }
> = {
  quiz: { max_attempts: 2, cooldown_seconds: 3 * HOUR_SECONDS },
  mid: { max_attempts: 3, cooldown_seconds: 5 * HOUR_SECONDS },
  final: { max_attempts: 2, cooldown_seconds: 7 * DAY_SECONDS },
};

export type AttemptAssessmentType = "quiz" | "mid" | "final";

export type AttemptReasonCode =
  | "ok"
  | "attempt_active"
  | "cooldown"
  | "exhausted"
  | "unknown_assessment_type";

/** Typed policy snapshot returned by every attempt decision. */
export type AttemptPolicySnapshot = {
  assessment_type: AttemptAssessmentType | "unknown";
  max_attempts: number;
  attempts_used: number;
  attempts_remaining: number;
  cooldown_seconds: number;
  next_attempt_at: string | null;
  can_start: boolean;
  reason_code: AttemptReasonCode;
};

/** Compact, testable view of one ledger record for the pure evaluator. */
export type AttemptRecordInput = {
  attempt_number: number;
  status: AttemptTerminalStatus;
  issued_at: Date;
  terminal_at?: Date;
};

export function policyForType(
  type: string,
): { max_attempts: number; cooldown_seconds: number } | null {
  if (type === "quiz" || type === "mid" || type === "final") {
    return EXAM_ATTEMPT_POLICY[type];
  }
  return null;
}

/** Exact wording the readiness screen must show before the exam starts. */
export function attemptPolicyStatement(type: AttemptAssessmentType): string {
  switch (type) {
    case "quiz":
      return "Quiz: 2 attempts, 3 hours between attempts";
    case "mid":
      return "Midterm: 3 attempts, 5 hours";
    case "final":
      return "Final: primary form plus an approved reserve-form retake after 7 days";
  }
}

/**
 * Pure policy evaluation over the immutable attempt ledger.
 *
 * `now` is always the injected server clock; nothing from the request can
 * influence the result. Cooldown begins when the previous attempt reached a
 * server-recorded terminal state. An `active` attempt always blocks a new
 * start (refresh/resume never issues another attempt).
 */
export function evaluateAttemptPolicy(
  type: string,
  now: Date,
  history: AttemptRecordInput[],
): AttemptPolicySnapshot {
  const policy = policyForType(type);
  if (!policy) {
    return {
      assessment_type: "unknown",
      max_attempts: 0,
      attempts_used: 0,
      attempts_remaining: 0,
      cooldown_seconds: 0,
      next_attempt_at: null,
      can_start: false,
      reason_code: "unknown_assessment_type",
    };
  }

  const sorted = [...history].sort(
    (a, b) => a.attempt_number - b.attempt_number,
  );
  const latest = sorted.length ? sorted[sorted.length - 1] : null;
  const attemptsUsed = latest?.attempt_number ?? 0;
  const attemptsRemaining = Math.max(0, policy.max_attempts - attemptsUsed);
  const base: AttemptPolicySnapshot = {
    assessment_type: type as AttemptAssessmentType,
    max_attempts: policy.max_attempts,
    attempts_used: attemptsUsed,
    attempts_remaining: attemptsRemaining,
    cooldown_seconds: policy.cooldown_seconds,
    next_attempt_at: null,
    can_start: false,
    reason_code: "ok",
  };

  if (!latest) {
    return { ...base, can_start: true, reason_code: "ok" };
  }

  if (latest.status === "active") {
    return { ...base, reason_code: "attempt_active" };
  }

  const terminalAt = latest.terminal_at;
  const nextAttemptAt =
    terminalAt !== undefined
      ? new Date(terminalAt.getTime() + policy.cooldown_seconds * 1000)
      : null;

  if (attemptsRemaining <= 0) {
    return { ...base, reason_code: "exhausted" };
  }

  if (nextAttemptAt && now.getTime() < nextAttemptAt.getTime()) {
    return {
      ...base,
      reason_code: "cooldown",
      next_attempt_at: nextAttemptAt.toISOString(),
    };
  }

  return { ...base, can_start: true, reason_code: "ok" };
}

/* ------------------------------------------------------------------ */
/*   Typed failure contract                                            */
/* ------------------------------------------------------------------ */

export class AttemptPolicyError extends Error {
  readonly status: number;
  readonly reason_code: AttemptReasonCode;
  readonly snapshot: AttemptPolicySnapshot;
  readonly retryAfterMs?: number;

  constructor(
    message: string,
    status: number,
    snapshot: AttemptPolicySnapshot,
    retryAfterMs?: number,
  ) {
    super(message);
    this.name = "AttemptPolicyError";
    this.status = status;
    this.reason_code = snapshot.reason_code;
    this.snapshot = snapshot;
    this.retryAfterMs = retryAfterMs;
  }
}

export function policyErrorForSnapshot(
  snapshot: AttemptPolicySnapshot,
  now: Date,
): AttemptPolicyError {
  switch (snapshot.reason_code) {
    case "attempt_active":
      return new AttemptPolicyError(
        "An attempt is already active for this assessment",
        409,
        snapshot,
      );
    case "cooldown": {
      const retryAfterMs = snapshot.next_attempt_at
        ? Math.max(0, new Date(snapshot.next_attempt_at).getTime() - now.getTime())
        : 0;
      return new AttemptPolicyError(
        "Cooldown active — the next attempt is not yet eligible",
        429,
        snapshot,
        retryAfterMs,
      );
    }
    case "exhausted":
      return new AttemptPolicyError(
        "Maximum attempts reached for this assessment",
        403,
        snapshot,
      );
    case "unknown_assessment_type":
      return new AttemptPolicyError(
        "Unknown assessment type",
        400,
        snapshot,
      );
    default:
      return new AttemptPolicyError(
        "The attempt is not eligible to start",
        409,
        snapshot,
      );
  }
}

/* ------------------------------------------------------------------ */
/*   Durable ledger helpers                                            */
/* ------------------------------------------------------------------ */

function toObjectId(value: string | mongoose.Types.ObjectId) {
  return new mongoose.Types.ObjectId(value.toString());
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    error instanceof Error &&
    (error as { code?: number }).code === 11000
  );
}
export { isDuplicateKeyError };

function toRecordInput(record: IExamAttemptRecord): AttemptRecordInput {
  return {
    attempt_number: record.attempt_number,
    status: record.status,
    issued_at: record.issued_at,
    terminal_at: record.terminal_at,
  };
}

export async function getAttemptHistory(
  learnerId: string | mongoose.Types.ObjectId,
  type: AttemptAssessmentType,
  assessmentId: string | mongoose.Types.ObjectId,
): Promise<IExamAttemptRecord[]> {
  return ExamAttemptRecord.find({
    learner_id: toObjectId(learnerId),
    assessment_type: type,
    assessment_id: toObjectId(assessmentId),
  }).sort({ attempt_number: 1 });
}

/**
 * Atomically issue the next attempt.
 *
 * The issuer must pass `basedOnAttemptNumber` — the latest attempt number the
 * same eligibility read observed (0 for a fresh assessment). Every concurrent
 * start that evaluated from the same ledger state passes the same basis, so
 * the unique compound index on
 * (learner_id, assessment_type, assessment_id, previous_attempt_number)
 * guarantees at most one of them can create the next attempt. A caller that
 * loses the race receives `created: false` and must re-evaluate (resume the
 * winner's active attempt) rather than mint a phantom higher attempt.
 */
export async function issueAttemptRecord(input: {
  learnerId: string | mongoose.Types.ObjectId;
  type: AttemptAssessmentType;
  assessmentId: string | mongoose.Types.ObjectId;
  sourceExamId: string | mongoose.Types.ObjectId;
  now: Date;
  basedOnAttemptNumber: number;
}): Promise<{ record: IExamAttemptRecord; created: boolean }> {
  const learnerId = toObjectId(input.learnerId);
  const assessmentId = toObjectId(input.assessmentId);
  const sourceExamId = toObjectId(input.sourceExamId);
  const basedOn = input.basedOnAttemptNumber;
  const attemptNumber = basedOn + 1;

  try {
    const record = await ExamAttemptRecord.create({
      learner_id: learnerId,
      assessment_type: input.type,
      assessment_id: assessmentId,
      source_exam_id: sourceExamId,
      attempt_number: attemptNumber,
      previous_attempt_number: basedOn,
      status: "active",
      issued_at: input.now,
      policy_version: ATTEMPT_POLICY_VERSION,
    });
    return { record, created: true };
  } catch (error: unknown) {
    if (isDuplicateKeyError(error)) {
      const existing = await ExamAttemptRecord.findOne({
        learner_id: learnerId,
        assessment_type: input.type,
        assessment_id: assessmentId,
        previous_attempt_number: basedOn,
      });
      if (existing) {
        return { record: existing, created: false };
      }
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/*   Terminal-state derivation and evidence archival                   */
/* ------------------------------------------------------------------ */

export type TerminalEvidence = {
  answers: Record<string, unknown>[];
  question_count?: number;
  mark?: number;
  passing_mark?: number;
  passed?: boolean;
  grading_status?: "auto_graded" | "pending_review" | "graded";
  integrity_status?: "clean" | "invalidated";
  policy_action?: string;
  review_status?: string;
  submitted_at?: Date;
  invalidated_at?: Date;
};

export function buildTerminalEvidence(
  exam: IExam,
  session: IExamSession | null,
): TerminalEvidence {
  return {
    answers:
      (exam.student_answers as Record<string, unknown>[]) ??
      session?.answers ??
      [],
    question_count: exam.generated_questions?.length,
    mark: exam.mark,
    passing_mark: exam.passing_mark,
    passed: exam.passed,
    grading_status: exam.grading_status,
    integrity_status: exam.integrity_status,
    policy_action: exam.policy_action,
    review_status: exam.review_status,
    submitted_at: exam.submitted_at,
    invalidated_at: exam.invalidated_at,
  };
}

export function deriveTerminalStatus(
  exam: IExam,
  session: IExamSession | null,
): AttemptTerminalStatus {
  if (exam.integrity_status === "invalidated") return "invalidated";
  if (exam.taken) return "submitted";
  if (!session) return "active";
  if (session.status === "completed") return "submitted";
  if (session.status === "terminated") {
    switch (session.terminated_reason) {
      case "timeout":
      case "heartbeat_failure":
        return "timed_out";
      case "manual_admin_stop":
      case "duplicate_session":
      case "protocol_failure":
        return "admin_closed";
      default:
        return "timed_out";
    }
  }
  return "active";
}

function reasonForTerminalStatus(status: AttemptTerminalStatus): string {
  switch (status) {
    case "submitted":
      return "student_submitted";
    case "timed_out":
      return "server_timeout";
    case "invalidated":
      return "session_invalidated";
    case "admin_closed":
      return "admin_closed";
    default:
      return status;
  }
}

/**
 * Transition an active ledger record to a terminal status exactly once. A
 * second call is a no-op (guarded conditional update), so concurrent
 * terminalization can never double-apply.
 */
export async function finalizeAttemptRecord(
  record: IExamAttemptRecord,
  status: Exclude<AttemptTerminalStatus, "active">,
  terminalAt: Date,
  evidence: TerminalEvidence,
): Promise<boolean> {
  const result = await ExamAttemptRecord.updateOne(
    { _id: record._id, status: "active" },
    {
      $set: {
        status,
        terminal_at: terminalAt,
        terminal_reason: reasonForTerminalStatus(status),
        final_evidence: evidence,
      },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Finalize the active ledger record that points at a given source exam. Used
 * by submission and by server-side reconciliation (timeout / invalidation).
 */
export async function finalizeActiveRecordForSourceExam(
  sourceExamId: string | mongoose.Types.ObjectId,
  status: Exclude<AttemptTerminalStatus, "active">,
  terminalAt: Date,
  evidence: TerminalEvidence,
): Promise<boolean> {
  const result = await ExamAttemptRecord.updateOne(
    { source_exam_id: toObjectId(sourceExamId), status: "active" },
    {
      $set: {
        status,
        terminal_at: terminalAt,
        terminal_reason: reasonForTerminalStatus(status),
        final_evidence: evidence,
      },
    },
  );
  return result.modifiedCount === 1;
}

/**
 * Backfill one ledger record for a legacy exam (created before this ledger
 * existed) from its durable exam/session state. Only ever derived from
 * server state, never fabricated. Idempotent under the unique index.
 */
export async function backfillLegacyAttemptRecord(input: {
  learnerId: string | mongoose.Types.ObjectId;
  type: AttemptAssessmentType;
  assessmentId: string | mongoose.Types.ObjectId;
  exam: IExam;
  session: IExamSession | null;
}): Promise<void> {
  const learnerId = toObjectId(input.learnerId);
  const assessmentId = toObjectId(input.assessmentId);
  const status = deriveTerminalStatus(input.exam, input.session);
  try {
    await ExamAttemptRecord.create({
      learner_id: learnerId,
      assessment_type: input.type,
      assessment_id: assessmentId,
      source_exam_id: input.exam._id,
      attempt_number: 1,
      status,
      issued_at: input.session?.started_at ?? input.exam.createdAt ?? new Date(),
      ...(status !== "active"
        ? {
            terminal_at:
              input.session?.ended_at ??
              input.exam.submitted_at ??
              new Date(),
            terminal_reason: reasonForTerminalStatus(status),
            final_evidence: buildTerminalEvidence(input.exam, input.session),
          }
        : {}),
      ...(input.session ? { session_id: input.session._id } : {}),
      policy_version: ATTEMPT_POLICY_VERSION,
    });
  } catch (error: unknown) {
    if (!isDuplicateKeyError(error)) throw error;
  }
}

/* ------------------------------------------------------------------ */
/*   Start eligibility                                                 */
/* ------------------------------------------------------------------ */

export type StartEligibility =
  | { kind: "allowed"; snapshot: AttemptPolicySnapshot; basedOnAttemptNumber: number }
  | {
      kind: "resume";
      snapshot: AttemptPolicySnapshot;
      exam: IExam;
      session: IExamSession;
    }
  | { kind: "blocked"; snapshot: AttemptPolicySnapshot; basedOnAttemptNumber: number };

/**
 * Reconcile the latest active ledger record even when the caller is trying to
 * launch a different form. Without this, a primary form abandoned before its
 * deadline could remain active forever and block an approved reserve form.
 */
async function reconcileActiveHistory(
  history: IExamAttemptRecord[],
  suppliedExam: IExam | null,
  now: Date,
): Promise<boolean> {
  const activeRecord = [...history]
    .reverse()
    .find((record) => record.status === "active");
  if (!activeRecord) return false;

  const sourceMatchesSupplied =
    suppliedExam?._id.toString() === activeRecord.source_exam_id.toString();
  const sourceExam = sourceMatchesSupplied
    ? suppliedExam
    : await Exam.findById(activeRecord.source_exam_id);
  if (!sourceExam) return false;

  const session = await ExamSession.findOne({ exam_id: sourceExam._id });
  const finalDeadline = sourceExam.type === "final" ? sourceExam.access_expires_at : undefined;
  if (finalDeadline && now.getTime() >= finalDeadline.getTime()) {
    if (session?.status === "in_progress") {
      await ExamSession.updateOne(
        { _id: session._id, status: "in_progress" },
        {
          $set: {
            status: "terminated",
            terminated_reason: "timeout",
            ended_at: finalDeadline,
            integrity_state: "submitted",
          },
          $unset: { access_token_hash: "", active_connection_id: "" },
        },
      );
    }
    return finalizeAttemptRecord(
      activeRecord,
      "timed_out",
      finalDeadline,
      buildTerminalEvidence(sourceExam, session ?? null),
    );
  }

  const terminal = deriveTerminalStatus(sourceExam, session ?? null);
  if (terminal === "active") return false;
  return finalizeAttemptRecord(
    activeRecord,
    terminal,
    session?.ended_at ?? now,
    buildTerminalEvidence(sourceExam, session ?? null),
  );
}

/**
 * Evaluate whether a learner may start. Reconciles server-terminalized
 * sessions (browser close is never a refund), derives legacy attempts, and
 * decides allow / resume / block using only the server clock.
 */
export async function evaluateStart(
  learnerId: string | mongoose.Types.ObjectId,
  type: AttemptAssessmentType,
  assessmentId: string | mongoose.Types.ObjectId,
  exam: IExam | null,
  now: Date,
): Promise<StartEligibility> {
  const learnerObj = toObjectId(learnerId);
  const assessmentObj = toObjectId(assessmentId);

  let history = await getAttemptHistory(learnerObj, type, assessmentObj);

  if (exam && history.length === 0) {
    const session = await ExamSession.findOne({ exam_id: exam._id });
    const wasStarted = Boolean(session) || exam.taken;
    if (wasStarted) {
      await backfillLegacyAttemptRecord({
        learnerId: learnerObj,
        type,
        assessmentId: assessmentObj,
        exam,
        session,
      });
      history = await getAttemptHistory(learnerObj, type, assessmentObj);
    }
  }

  if (await reconcileActiveHistory(history, exam, now)) {
    history = await getAttemptHistory(learnerObj, type, assessmentObj);
  }

  const snapshot = evaluateAttemptPolicy(
    type,
    now,
    history.map(toRecordInput),
  );

  if (!snapshot.can_start) {
    const activeRecord = history.find((record) => record.status === "active");
    if (
      snapshot.reason_code === "attempt_active" &&
      exam &&
      activeRecord?.source_exam_id.toString() === exam._id.toString()
    ) {
      const session = await ExamSession.findOne({ exam_id: exam._id });
      if (session && session.status === "in_progress") {
        return { kind: "resume", snapshot, exam, session };
      }
    }
    return { kind: "blocked", snapshot, basedOnAttemptNumber: latestAttemptNumber(history) };
  }

  return { kind: "allowed", snapshot, basedOnAttemptNumber: latestAttemptNumber(history) };
}

function latestAttemptNumber(
  history: IExamAttemptRecord[],
): number {
  const last = history.length ? history[history.length - 1] : null;
  return last?.attempt_number ?? 0;
}

/* ------------------------------------------------------------------ */
/*   View snapshot                                                     */
/* ------------------------------------------------------------------ */

export function attemptScopeForExam(exam: IExam): {
  learnerId: string | mongoose.Types.ObjectId;
  type: AttemptAssessmentType;
  assessmentId: string | mongoose.Types.ObjectId;
} {
  const type: AttemptAssessmentType = exam.type;
  const assessmentId =
    type === "quiz"
      ? (exam.chapter_id ?? exam._id)
      : type === "mid"
        ? exam._id
        : (exam.curriculum_id ?? exam._id);
  return { learnerId: exam.student_id, type, assessmentId };
}

/** Reconcile + evaluate the current policy snapshot for an existing exam. */
export async function getAttemptPolicySnapshot(
  exam: IExam,
  now: Date = new Date(),
): Promise<AttemptPolicySnapshot> {
  const { learnerId, type, assessmentId } = attemptScopeForExam(exam);
  let history = await getAttemptHistory(learnerId, type, assessmentId);

  const activeRecord = history.find(
    (record) =>
      record.source_exam_id.toString() === exam._id.toString() &&
      record.status === "active",
  );
  if (activeRecord) {
    const session = await ExamSession.findOne({ exam_id: exam._id });
    const terminal = deriveTerminalStatus(exam, session ?? null);
    if (terminal !== "active") {
      await finalizeAttemptRecord(
        activeRecord,
        terminal,
        session?.ended_at ?? now,
        buildTerminalEvidence(exam, session ?? null),
      );
      history = await getAttemptHistory(learnerId, type, assessmentId);
    }
  }

  return evaluateAttemptPolicy(type, now, history.map(toRecordInput));
}
