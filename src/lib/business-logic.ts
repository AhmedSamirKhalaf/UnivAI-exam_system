import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { Enrollment } from "@/models/Enrollment";
import { Exam, IExam } from "@/models/Exam";
import {
  evaluateStart,
  issueAttemptRecord,
  policyErrorForSnapshot,
  finalizeActiveRecordForSourceExam,
  buildTerminalEvidence,
  isDuplicateKeyError,
} from "@/lib/exam-attempt-policy";
import { ExamAttemptError } from "@/lib/exam-attempt";
import { ExamChapter } from "@/models/ExamChapter";
import { Chapter } from "@/models/Chapter";
import { Curriculum } from "@/models/Curriculum";
import { Student } from "@/models/Student";
import { Book } from "@/models/Book";
import { QuestionProvenance } from "@/models/QuestionProvenance";
import { ProctoringEvent, ProctoringEventType } from "@/models/ProctoringEvent";
import { ExamSession } from "@/models/ExamSession";
import { GradeHistory } from "@/models/GradeHistory";
import { IntegrityAppeal } from "@/models/IntegrityAppeal";
import { PROCTORING_CONFIG } from "@/lib/proctoring-config";
import {
  createSeededRandom,
  shuffled,
  type RandomSource,
} from "@/lib/deterministic-rng";
import { isStandalone } from "@/lib/runtime";
import { INTEGRITY_POLICY_VERSION, writeAudit } from "@/lib/audit-log";
import { gradeExamSubmission } from "@/lib/submission-grading";
import { sendResultWebhook } from "@/lib/report-webhook";
import { queueResultWebhookRevision } from "@/lib/result-webhook-state";
import { refreshIntegrityRisk } from "@/lib/integrity-risk-service";

export type CanStartExamResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/* ------------------------------------------------------------------ */
/*   Enrolment                                                        */
/* ------------------------------------------------------------------ */

export async function isEnrolled(
  studentId: string | mongoose.Types.ObjectId,
  curriculumId: string | mongoose.Types.ObjectId
): Promise<boolean> {
  const enrollment = await Enrollment.findOne({
    student_id: studentId,
    curriculum_id: curriculumId,
    status: "active",
  });
  return enrollment !== null;
}

/* ------------------------------------------------------------------ */
/*   Exam-gating checks                                               */
/* ------------------------------------------------------------------ */

export async function canStartExam(
  studentId: string | mongoose.Types.ObjectId,
  examType: "quiz" | "mid" | "final",
  curriculumOrChapterId: string | mongoose.Types.ObjectId
): Promise<CanStartExamResult> {
  if (examType === "final") {
    return canStartFinal(studentId, curriculumOrChapterId);
  }

  let curriculumId: mongoose.Types.ObjectId;

  if (examType === "quiz") {
    const chapter = await Chapter.findById(curriculumOrChapterId);
    if (!chapter) {
      return { allowed: false, reason: "Chapter not found" };
    }
    curriculumId = chapter.curriculum_id;
  } else {
    curriculumId = new mongoose.Types.ObjectId(
      curriculumOrChapterId.toString()
    );
  }

  const enrolled = await isEnrolled(studentId, curriculumId);
  if (!enrolled) {
    return {
      allowed: false,
      reason: "Student is not enrolled in this curriculum",
    };
  }

  return { allowed: true };
}

export async function canStartFinal(
  studentId: string | mongoose.Types.ObjectId,
  curriculumId: string | mongoose.Types.ObjectId
): Promise<CanStartExamResult> {
  const enrolled = await isEnrolled(studentId, curriculumId);
  if (!enrolled) {
    return {
      allowed: false,
      reason: "Student is not enrolled in this curriculum",
    };
  }

  // UnivAI-app owns the semester clock and opens the final only after the
  // last lecture ends. Quiz attendance and scores never gate the final.
  // Attempt count and cooldown remain enforced atomically by startFinal.
  return { allowed: true };
}

/* ------------------------------------------------------------------ */
/*   Helper: check threshold & invalidate silently                    */
/* ------------------------------------------------------------------ */

async function bumpSuspicionScore(
  examId: mongoose.Types.ObjectId,
  extraWeight: number
): Promise<void> {
  const session = await ExamSession.findOne({ exam_id: examId });
  if (!session) {
    throw new Error(`ExamSession not found for exam ${examId}`);
  }

  const oldScore = session.suspicion_score;
  const newScore = oldScore + extraWeight;
  session.suspicion_score = newScore;

  if (oldScore < PROCTORING_CONFIG.suspicionThreshold && newScore >= PROCTORING_CONFIG.suspicionThreshold) {
    session.flagged = true;
    await Exam.findByIdAndUpdate(examId, {
      integrity_status: "invalidated",
      invalidated_at: new Date(),
      policy_action: "session_invalidated",
      review_status: "pending",
    });
    await writeAudit({
      actor: { type: "system", id: "proctoring-policy" },
      action: "integrity.session_invalidated",
      resource: { type: "exam", id: examId.toString() },
      metadata: {
        suspicion_score: newScore,
        threshold: PROCTORING_CONFIG.suspicionThreshold,
        policy_version: INTEGRITY_POLICY_VERSION,
      },
    });
  }

  await session.save();
}

/* ------------------------------------------------------------------ */
/*   Question generation — drawn from the per-chapter question bank    */
/* ------------------------------------------------------------------ */

type BankQuestion = {
  question_id?: string;
  prompt: string;
  type: "mcq" | "essay";
  options?: string[];
  correct_option?: string;
  /** "lecture" = the lecturer said it out loud; "self_study" = book-only material */
  source?: "lecture" | "self_study";
  provenance?: {
    document_id?: string;
    document_title?: string;
    page_number?: number;
    section?: string;
    excerpt?: string;
  };
};

const LEGACY_BANK_PLAN_VERSION = "legacy-question-bank-v1";
const LEGACY_SIX_OPTION_COMPATIBILITY = [
  "E) None of the other answers is correct",
  "F) More than one of the other answers is correct",
];

function normalizedAssessmentOptions(
  supplied: string[] | undefined,
  expectedOptionCount: number,
): string[] {
  const cleaned = supplied?.map((option) => option.trim()).filter(Boolean) ?? [];
  const options =
    expectedOptionCount === 6 && cleaned.length === 4
      ? [...cleaned, ...LEGACY_SIX_OPTION_COMPATIBILITY]
      : cleaned;
  return options.length === expectedOptionCount &&
    new Set(options).size === expectedOptionCount
    ? options
    : [];
}

export function legacyQuestionToPublished(
  question: BankQuestion,
  index: number,
  chapterId: mongoose.Types.ObjectId,
  chapterTitle: string,
  learnerId: string,
  expectedOptionCount = 4,
): Record<string, unknown> | null {
  if (question.type !== "mcq" || !question.prompt?.trim()) return null;
  const options = normalizedAssessmentOptions(
    question.options,
    expectedOptionCount,
  );
  if (!options.length) return null;

  const answer = question.correct_option?.trim();
  const allowedLabels = expectedOptionCount === 6 ? "A-F" : "A-D";
  const optionLabel = new RegExp(`^([${allowedLabels}])[).:]\\s*`, "i");
  const correctOption = options.find((option) => {
    if (!answer) return false;
    return option === answer || option.match(optionLabel)?.[1].toUpperCase() === answer.toUpperCase();
  });
  if (!correctOption) return null;

  const supplied = question.provenance;
  const hasSuppliedProvenance = Boolean(
    supplied?.document_id?.trim() &&
    supplied.document_title?.trim() &&
    Number.isInteger(supplied.page_number) &&
    Number(supplied.page_number) >= 1 &&
    supplied.section?.trim(),
  );
  const provenance = hasSuppliedProvenance
    ? supplied
    : {
        document_id: `legacy-question-bank:${chapterId}`,
        document_title: chapterTitle,
        page_number: 1,
        section: "Legacy generated quiz bank",
      };

  return {
    blueprint_id: chapterId,
    schema_version: "question-provenance-v1",
    question_id: question.question_id?.trim() || `legacy-${chapterId}-${index + 1}`,
    prompt: question.prompt.trim(),
    type: "mcq",
    options,
    correct_option: correctOption,
    plan_version: LEGACY_BANK_PLAN_VERSION,
    approved: true,
    learner_id: learnerId,
    provenance,
  };
}

async function legacyBankAsPublished(
  chapterId: mongoose.Types.ObjectId,
  chapterTitle: string,
  owner: LearnerBankOwner,
  expectedOptionCount = 4,
): Promise<Record<string, unknown>[]> {
  const db = mongoose.connection.db;
  if (!db) return [];
  const bank = await db.collection("question_banks").findOne(
    learnerQuestionBankFilter(chapterId, owner),
  );
  const questions = (bank?.questions ?? []) as BankQuestion[];
  return questions.flatMap((question, index) => {
    const published = legacyQuestionToPublished(
      question,
      index,
      chapterId,
      chapterTitle,
      owner.studentSid ?? owner.studentId.toString(),
      expectedOptionCount,
    );
    return published ? [published] : [];
  });
}

async function legacyFinalBankAsPublished(
  curriculumId: mongoose.Types.ObjectId,
  owner: LearnerBankOwner,
): Promise<Record<string, unknown>[]> {
  const chapters = await Chapter.find({ curriculum_id: curriculumId })
    .select("_id title")
    .sort({ number: 1, _id: 1 })
    .lean();
  const banks = await Promise.all(
    chapters.map((chapter) =>
      legacyBankAsPublished(chapter._id, chapter.title, owner, 6),
    ),
  );
  return banks
    .flat()
    .map((question) => ({
      ...question,
      blueprint_id: curriculumId,
      // Old weekly generators often reused q_1, q_2, ... in every chapter.
      // Namespace the cumulative-paper ids so the two immutable forms cannot
      // collide or accidentally present the same item as a different item.
      question_id: `final-${String(question.blueprint_id)}-${String(question.question_id)}`,
    }));
}

/**
 * UnivAI generates questions from the course book and stores them per chapter
 * in the `question_banks` collection ({ chapter_id, questions }). Exams draw
 * from there, so a quiz is actually about its lecture. The old placeholder
 * generator survives only as a last resort for chapters with no bank.
 */
async function bankQuestions(
  chapterId: mongoose.Types.ObjectId,
  owner?: LearnerBankOwner,
): Promise<BankQuestion[]> {
  if (!owner) return [];
  const db = mongoose.connection.db;
  if (!db) return [];
  const bank = await db
    .collection("question_banks")
    .findOne(learnerQuestionBankFilter(chapterId, owner));
  const questions = (bank?.questions ?? []) as BankQuestion[];
  return questions.filter((q) => q.prompt && q.type);
}

function sample<T>(items: T[], count: number, random: RandomSource): T[] {
  return shuffled(items, random).slice(0, count);
}

function placeholderQuestions(count: number, examType: "quiz" | "mid" | "final") {
  const questions: Record<string, unknown>[] = [];
  const optionCount = examType === "quiz" ? 4 : 6;
  for (let i = 1; i <= count; i++) {
    if (examType === "final" && i % 3 === 0) {
      questions.push({
        question_id: `q_${i}`,
        prompt: `Placeholder essay question ${i} — describe a key concept.`,
        type: "essay",
        correct_option: undefined,
      });
    } else {
      const options = Array.from(
        { length: optionCount },
        (_, optionIndex) =>
          `${String.fromCharCode(65 + optionIndex)}) Option ${optionIndex + 1}`,
      );
      questions.push({
        question_id: `q_${i}`,
        prompt: `Placeholder MCQ question ${i}?`,
        type: "mcq",
        options,
        correct_option: options[i % optionCount],
      });
    }
  }
  return questions;
}

export async function generateQuestions(
  scope: mongoose.Types.ObjectId | mongoose.Types.ObjectId[],
  count: number,
  examType: "quiz" | "mid" | "final",
  owner?: LearnerBankOwner,
): Promise<Record<string, unknown>[]> {
  const chapterIds = Array.isArray(scope) ? scope : [scope];
  const random = isStandalone()
    ? createSeededRandom(Number(process.env.UNIVAI_EXAM_SEED ?? "20260727"))
    : Math.random;

  const pool: BankQuestion[] = [];
  if (examType !== "final") {
    for (const chapterId of chapterIds) {
      pool.push(...(await bankQuestions(chapterId, owner)));
    }
  }

  if (!pool.length) {
    return placeholderQuestions(count, examType);
  }

  const expectedOptionCount = examType === "quiz" ? 4 : 6;
  const eligiblePool = pool.flatMap((question) => {
    if (question.type !== "mcq") return [question];
    const options = normalizedAssessmentOptions(
      question.options,
      expectedOptionCount,
    );
    if (!options.length) return [];
    const answer = question.correct_option?.trim();
    const lastLabel = expectedOptionCount === 6 ? "F" : "D";
    const optionLabel = new RegExp(`^([A-${lastLabel}])[).:]\\s*`, "i");
    const correctOption = options.find(
      (option) =>
        option === answer ||
        option.match(optionLabel)?.[1].toUpperCase() === answer?.toUpperCase(),
    );
    return correctOption
      ? [{ ...question, options, correct_option: correctOption }]
      : [];
  });
  if (!eligiblePool.length) {
    return placeholderQuestions(count, examType);
  }

  // At least 90% of every paper must be answerable from what the lecturer
  // actually said; "self_study" questions (book material beyond the lecture)
  // can NEVER exceed 10% of the paper. A 5-question quiz therefore carries
  // none; the 12-question mid carries exactly one.
  const selfPool = eligiblePool.filter((q) => q.source === "self_study");
  const taughtPool = eligiblePool.filter((q) => q.source !== "self_study");
  const selfCount = Math.min(selfPool.length, Math.floor(count * 0.1));

  const picked = [
    ...sample(taughtPool, count - selfCount, random),
    ...sample(selfPool, selfCount, random),
  ];

  return sample(picked, picked.length, random).map((question, index) => ({
    question_id: `q_${index + 1}`,
    prompt: question.prompt,
    type: question.type,
    options: question.options,
    correct_option: question.correct_option,
    source: question.source ?? "lecture",
  }));
}

/* ------------------------------------------------------------------ */
/*   startQuiz — policy-gated find-or-resume                          */
/* ------------------------------------------------------------------ */

export interface StartResult {
  exam: IExam;
  created: boolean;
  resumed: boolean;
}

const MAX_START_ATTEMPTS = 5;
const START_RACE_BACKOFF_MS = 20;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const QUIZ_MIN_COUNT = 3;
const QUIZ_MAX_COUNT = 30;
export const FINAL_MIN_QUESTIONS = 10;

function publishedQuestionToSnapshot(
  question: Record<string, unknown>,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    schema_version: "question-provenance-v1",
    question_id: question.question_id,
    prompt: question.prompt,
    type: question.type,
    plan_version: question.plan_version,
    approved: true,
    provenance: question.provenance,
  };
  if (question.type === "mcq") {
    snapshot.options = question.options;
    snapshot.correct_option = question.correct_option;
  }
  return snapshot;
}

async function publishedBank(
  filter: Record<string, unknown>,
  learnerId: mongoose.Types.ObjectId,
  studentSid?: string,
): Promise<Record<string, unknown>[]> {
  // A supplied registration number is authoritative; never OR it with a
  // different identity because that turns a mismatched request into access.
  const learnerFilter = {
    learner_id: studentSid ?? learnerId.toString(),
  };
  return await QuestionProvenance.find({
    ...filter,
    approved: true,
    ...learnerFilter,
  }).lean() as unknown as Record<string, unknown>[];
}

function assertOnePublishedVersion(published: Record<string, unknown>[]): {
  blueprintId: mongoose.Types.ObjectId;
  planVersion: string;
} {
  const blueprintIds = new Set(published.map((question) => String(question.blueprint_id ?? "")));
  const planVersions = new Set(published.map((question) => String(question.plan_version ?? "")));
  if (blueprintIds.size !== 1 || blueprintIds.has("") || planVersions.size !== 1 || planVersions.has("")) {
    throw new Error("Published question bank spans multiple blueprint or plan versions");
  }
  return {
    blueprintId: new mongoose.Types.ObjectId([...blueprintIds][0]),
    planVersion: [...planVersions][0],
  };
}

export async function startQuiz(
  studentId: string | mongoose.Types.ObjectId,
  chapterId: string | mongoose.Types.ObjectId,
  requestedCount?: number,
  studentSid?: string,
  now: Date = new Date()
): Promise<StartResult> {
  const chapter = await Chapter.findById(chapterId);
  if (!chapter) throw new Error("Chapter not found");

  const studentIdObj = new mongoose.Types.ObjectId(studentId.toString());
  const chapterIdObj = new mongoose.Types.ObjectId(chapterId.toString());

  const title = `Quiz: ${chapter.title}`;
  // The caller (UnivAI's course-size dial) may scale the paper; pass mark
  // stays proportional to the original 3-of-5.
  const questionCount = Math.min(QUIZ_MAX_COUNT, Math.max(QUIZ_MIN_COUNT, Math.floor(requestedCount ?? 5)));

  for (let loop = 0; loop < MAX_START_ATTEMPTS; loop++) {
    const existing = await Exam.findOne({
      student_id: studentIdObj,
      chapter_id: chapterIdObj,
      type: "quiz",
    });

    const eligibility = await evaluateStart(
      studentIdObj,
      "quiz",
      chapterIdObj,
      existing ?? null,
      now,
    );

    if (eligibility.kind === "blocked") {
      throw policyErrorForSnapshot(eligibility.snapshot, now);
    }
    if (eligibility.kind === "resume") {
      return { exam: eligibility.exam, created: false, resumed: true };
    }

    let published = existing?.questions_snapshot?.length
      ? []
      : await publishedBank({ chapter_id: chapterIdObj }, studentIdObj, studentSid);
    // Courses generated before immutable quiz publication already have a
    // complete, learner-scoped bank synced by UnivAI-app. Prefer the strict
    // published package, but keep those existing courses usable instead of
    // falsely reporting that their ready bank contains zero questions.
    if (!existing?.questions_snapshot?.length && published.length === 0) {
      published = await legacyBankAsPublished(
        chapterIdObj,
        chapter.title,
        {
          studentId: studentIdObj,
          studentSid,
          curriculumId: chapter.curriculum_id,
        },
      );
    }
    if (!existing?.questions_snapshot?.length && published.length < questionCount) {
      throw new Error(`Insufficient published quiz bank: ${published.length} available, ${questionCount} requested`);
    }
    const questions = existing?.questions_snapshot?.length
      ? existing.questions_snapshot as Record<string, unknown>[]
      : shuffled(published, isStandalone() ? createSeededRandom(Number(process.env.UNIVAI_EXAM_SEED ?? "20260727")) : Math.random)
          .slice(0, questionCount)
          .map(publishedQuestionToSnapshot);
    const publication = existing?.blueprint_id && existing.plan_version
      ? { blueprintId: existing.blueprint_id, planVersion: existing.plan_version }
      : assertOnePublishedVersion(published);
    const passingMark = Math.max(1, Math.ceil(questions.length * 0.6));

    // Allowed: issue the next attempt atomically. The unique ledger index
    // guarantees two simultaneous requests can create at most one attempt.
    const examId = existing?._id ?? new mongoose.Types.ObjectId();
    const issuance = await issueAttemptRecord({
      learnerId: studentIdObj,
      type: "quiz",
      assessmentId: chapterIdObj,
      sourceExamId: examId,
      now,
      basedOnAttemptNumber: eligibility.basedOnAttemptNumber,
    });
    if (!issuance.created) {
      await sleep(START_RACE_BACKOFF_MS);
      continue;
    }

    let exam: IExam;
    if (existing) {
      // Previous attempt evidence was archived into its terminal ledger
      // record during reconciliation; reset the container in place so the
      // retry gets fresh questions without erasing earlier evidence.
      await resetExamForAttempt(
        existing,
        questions,
        passingMark,
        issuance.record.attempt_number,
        studentSid,
      );
      exam = existing;
    } else {
      try {
        exam = await Exam.create({
          _id: examId,
          type: "quiz",
          title,
          student_id: studentIdObj,
          student_sid: studentSid,
          chapter_id: chapterIdObj,
          blueprint_id: publication.blueprintId,
          plan_version: publication.planVersion,
          questions_snapshot: questions,
          attempt_number: issuance.record.attempt_number,
          generated_questions: questions,
          student_answers: [],
          taken: false,
          passing_mark: passingMark,
          passed: false,
          grading_status: "auto_graded",
          integrity_status: "clean",
          policy_action: "none",
          review_status: "not_required",
        });
      } catch (error: unknown) {
        if (isDuplicateKeyError(error)) {
          await sleep(START_RACE_BACKOFF_MS);
          continue;
        }
        throw error;
      }
    }

    await resetExamSession(exam, studentIdObj, now);

    await writeAudit({
      actor: { type: "student", id: studentIdObj.toString() },
      action: "attempt.start",
      resource: { type: "exam", id: exam._id.toString() },
      metadata: {
        exam_type: "quiz",
        chapter_id: chapterIdObj.toString(),
        attempt_number: issuance.record.attempt_number,
        question_count: questions.length,
        blueprint_id: publication.blueprintId.toString(),
        plan_version: publication.planVersion,
      },
    });

    return { exam, created: !existing, resumed: false };
  }

  throw new ExamAttemptError(
    "Could not start the quiz; a concurrent start is in progress. Please retry.",
    409,
  );
}

/** Reset an Exam container for a freshly issued attempt. */
async function resetExamForAttempt(
  exam: IExam,
  questions: Record<string, unknown>[],
  passingMark: number | undefined,
  attemptNumber: number,
  studentSid?: string,
): Promise<void> {
  exam.attempt_number = attemptNumber;
  if (studentSid) exam.student_sid = studentSid;
  exam.generated_questions = questions;
  exam.student_answers = [];
  exam.taken = false;
  exam.raw_mark = undefined;
  exam.integrity_penalty_applied = false;
  exam.mark = undefined;
  exam.passed = false;
  exam.passing_mark = passingMark;
  exam.grading_status = "auto_graded";
  exam.integrity_status = "clean";
  exam.policy_action = "none";
  exam.review_status = "not_required";
  exam.invalidated_at = undefined;
  exam.invalidation_notified_at = undefined;
  exam.submitted_at = undefined;
  exam.submission_idempotency_key = undefined;
  await exam.save();
}

/**
 * Reuse (or create) the single ExamSession per exam. The previous session's
 * answers were archived into the terminal attempt record before a retry is
 * issued, so resetting the container never erases earlier evidence.
 */
async function resetExamSession(
  exam: IExam,
  studentId: mongoose.Types.ObjectId,
  now: Date,
): Promise<unknown> {
  const existing = await ExamSession.findOne({ exam_id: exam._id });
  if (existing) {
    existing.started_at = now;
    existing.deadline_at = undefined;
    existing.ended_at = undefined;
    existing.suspicion_score = 0;
    existing.flagged = false;
    existing.risk_score = 0;
    existing.risk_probability = undefined;
    existing.risk_band = "observe";
    existing.risk_model_version = undefined;
    existing.risk_explanation = undefined;
    existing.risk_updated_at = undefined;
    existing.status = "in_progress";
    existing.terminated_reason = undefined;
    existing.current_question_index = 0;
    existing.answer_revision = 0;
    existing.answers = [];
    existing.integrity_state = "active";
    existing.integrity_lock_reason = undefined;
    existing.active_connection_id = undefined;
    existing.last_action_id = undefined;
    existing.last_action_question_id = undefined;
    existing.last_action_revision = undefined;
    existing.last_integrity_sequence = 0;
    existing.heartbeat_last_seen_at = undefined;
    existing.heartbeat_consecutive_misses = 0;
    existing.heartbeat_grace_until = undefined;
    await existing.save();
    return existing;
  }
  return ExamSession.create({
    exam_id: exam._id,
    student_id: studentId,
    started_at: now,
    suspicion_score: 0,
    flagged: false,
    status: "in_progress",
  });
}

export type PracticePackageInput = {
  studentId: string;
  curriculumId: string;
  chapterId: string;
  studentSid: string;
  packageId: string;
  title: string;
  planVersion: string;
  questions: Record<string, unknown>[];
};

/**
 * Store one immutable, learner-owned practice package and create its only
 * proctored attempt. Replaying the same package rotates the launch token and
 * resumes its server-saved session; a submitted package can never be reset.
 */
export async function startPractice(
  input: PracticePackageInput,
  now: Date = new Date(),
): Promise<{ exam: IExam; created: boolean; resumed: boolean }> {
  const studentId = new mongoose.Types.ObjectId(input.studentId);
  const curriculumId = new mongoose.Types.ObjectId(input.curriculumId);
  const chapterId = new mongoose.Types.ObjectId(input.chapterId);

  if (!(await isEnrolled(studentId, curriculumId))) {
    throw new ExamAttemptError("Student is not enrolled in this curriculum", 403);
  }
  const chapter = await Chapter.findOne({ _id: chapterId, curriculum_id: curriculumId });
  if (!chapter) throw new ExamAttemptError("Practice chapter not found", 404);

  const existing = await Exam.findOne({
    type: "practice",
    student_id: studentId,
    package_id: input.packageId,
  });
  if (existing) {
    if (existing.student_sid !== input.studentSid) {
      throw new ExamAttemptError("Practice package does not belong to this registration", 403);
    }
    if (existing.taken) {
      throw new ExamAttemptError("This practice package has already been submitted", 409);
    }
    const session = await ExamSession.findOne({ exam_id: existing._id });
    if (!session || session.status !== "in_progress") {
      throw new ExamAttemptError("Practice attempt is no longer active", 409);
    }
    return { exam: existing, created: false, resumed: true };
  }

  const exam = await Exam.create({
    type: "practice",
    title: input.title,
    student_id: studentId,
    student_sid: input.studentSid,
    curriculum_id: curriculumId,
    chapter_id: chapterId,
    package_id: input.packageId,
    package_version: "practice-package-v1",
    plan_version: input.planVersion,
    questions_snapshot: input.questions,
    generated_questions: input.questions,
    student_answers: [],
    attempt_number: 1,
    taken: false,
    passing_mark: 3,
    passed: false,
    grading_status: "auto_graded",
    integrity_status: "clean",
    policy_action: "none",
    review_status: "not_required",
  });
  await resetExamSession(exam, studentId, now);
  await writeAudit({
    actor: { type: "student", id: studentId.toString() },
    action: "attempt.start",
    resource: { type: "exam", id: exam._id.toString() },
    metadata: {
      exam_type: "practice",
      package_id: input.packageId,
      chapter_id: chapterId.toString(),
      question_count: input.questions.length,
      attempt_number: 1,
    },
  });
  return { exam, created: true, resumed: false };
}

export async function resumePractice(
  examId: string,
  studentId: string,
  studentSid: string,
): Promise<IExam> {
  const exam = await Exam.findOne({
    _id: new mongoose.Types.ObjectId(examId),
    type: "practice",
    student_id: new mongoose.Types.ObjectId(studentId),
    student_sid: studentSid,
  });
  if (!exam) throw new ExamAttemptError("Practice attempt not found", 404);
  if (exam.taken) throw new ExamAttemptError("This practice package has already been submitted", 409);
  const session = await ExamSession.findOne({ exam_id: exam._id });
  if (!session || session.status !== "in_progress") {
    throw new ExamAttemptError("Practice attempt is no longer active", 409);
  }
  return exam;
}

/* ------------------------------------------------------------------ */
/*   startMid — policy-gated start on a pre-created Exam               */
/* ------------------------------------------------------------------ */

export async function startMid(
  examId: string | mongoose.Types.ObjectId,
  requestedCount?: number,
  studentSid?: string,
  now: Date = new Date()
): Promise<IExam> {
  const examIdObj = new mongoose.Types.ObjectId(examId.toString());
  const exam = await Exam.findById(examIdObj);
  if (!exam) throw new Error("Exam not found");
  if (exam.type !== "mid") throw new Error("Exam is not a mid");
  if (exam.student_sid && studentSid !== exam.student_sid) {
    throw new ExamAttemptError("Midterm does not belong to this registration", 403);
  }
  if (studentSid) exam.student_sid = studentSid;

  const examChapters = await ExamChapter.find({ exam_id: examIdObj });
  const chapterIds = examChapters.map((ec) => ec.chapter_id);

  if (chapterIds.length > 0) {
    const chapter = await Chapter.findById(chapterIds[0]);
    if (!chapter) throw new Error("Exam chapter lookup failed");
    const enrolled = await isEnrolled(exam.student_id, chapter.curriculum_id);
    if (!enrolled) {
      throw new Error("Student is not enrolled in this curriculum");
    }
  }

  if (
    !exam.questions_snapshot?.length ||
    (!exam.published_midterm_id && !hasLearnerOwnedMidtermSnapshot(exam))
  ) {
    throw new Error("Midterm has no immutable learner-owned question package");
  }
  const count = exam.questions_snapshot.length;
  if (requestedCount !== undefined && requestedCount !== count) {
    throw new Error(`Published midterm contains exactly ${count} questions; question_count cannot change it`);
  }
  const passingMark = Math.max(1, Math.ceil(count * 0.4));

  for (let loop = 0; loop < MAX_START_ATTEMPTS; loop++) {
    const eligibility = await evaluateStart(
      exam.student_id,
      "mid",
      exam._id,
      exam,
      now,
    );

    if (eligibility.kind === "blocked") {
      throw policyErrorForSnapshot(eligibility.snapshot, now);
    }
    if (eligibility.kind === "resume") {
      return eligibility.exam;
    }

    const issuance = await issueAttemptRecord({
      learnerId: exam.student_id,
      type: "mid",
      assessmentId: exam._id,
      sourceExamId: exam._id,
      now,
      basedOnAttemptNumber: eligibility.basedOnAttemptNumber,
    });
    if (!issuance.created) {
      await sleep(START_RACE_BACKOFF_MS);
      continue;
    }

    const questions = exam.questions_snapshot as Record<string, unknown>[];
    await resetExamForAttempt(
      exam,
      questions,
      passingMark,
      issuance.record.attempt_number,
      studentSid,
    );
    await resetExamSession(exam, exam.student_id, now);

    await writeAudit({
      actor: { type: "student", id: exam.student_id.toString() },
      action: "attempt.start",
      resource: { type: "exam", id: exam._id.toString() },
      metadata: {
        exam_type: "mid",
        attempt_number: issuance.record.attempt_number,
        question_count: count,
      },
    });

    return exam;
  }

  throw new ExamAttemptError(
    "Could not start the midterm; a concurrent start is in progress. Please retry.",
    409,
  );
}

/* ------------------------------------------------------------------ */
/*   createMid — admin batch-create                                    */
/* ------------------------------------------------------------------ */

const LEARNER_MIDTERM_PACKAGE_VERSION = "learner-midterm-package-v1";
const LEARNER_MIDTERM_QUESTION_COUNT = 12;

export function hasLearnerOwnedMidtermSnapshot(exam: {
  student_sid?: string;
  package_id?: string;
  package_version?: string;
  package_hash?: string;
  publication_key?: string;
  questions_snapshot?: unknown[];
}): boolean {
  return Boolean(
    exam.student_sid &&
    exam.package_id?.startsWith("learner-mid.") &&
    exam.package_version === LEARNER_MIDTERM_PACKAGE_VERSION &&
    /^[a-f0-9]{64}$/.test(exam.package_hash ?? "") &&
    exam.publication_key?.startsWith("learner-mid:") &&
    Array.isArray(exam.questions_snapshot) &&
    exam.questions_snapshot.length >= 5
  );
}

async function assembleLearnerMidtermPaper(input: {
  curriculumId: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  studentSid: string;
  chapters: Array<{ _id: mongoose.Types.ObjectId; title: string; number: number }>;
}): Promise<Record<string, unknown>[]> {
  const owner: LearnerBankOwner = {
    studentId: input.studentId,
    studentSid: input.studentSid,
    curriculumId: input.curriculumId,
  };
  const pools = await Promise.all(
    input.chapters.map(async (chapter) => ({
      chapter,
      questions: await legacyBankAsPublished(
        chapter._id,
        chapter.title,
        owner,
        6,
      ),
    })),
  );
  if (pools.some((pool) => pool.questions.length === 0)) {
    throw new Error("Every completed week needs a learner-owned midterm bank");
  }

  const selected: Record<string, unknown>[] = [];
  let cursor = 0;
  while (selected.length < LEARNER_MIDTERM_QUESTION_COUNT) {
    let added = false;
    for (const pool of pools) {
      const question = pool.questions[cursor];
      if (!question) continue;
      selected.push({
        ...question,
        question_id: `mid-${pool.chapter._id}-${String(question.question_id)}`,
      });
      added = true;
      if (selected.length === LEARNER_MIDTERM_QUESTION_COUNT) break;
    }
    if (!added) break;
    cursor += 1;
  }
  if (selected.length < LEARNER_MIDTERM_QUESTION_COUNT) {
    throw new Error(
      `Insufficient learner-owned midterm bank: ${selected.length} available, ${LEARNER_MIDTERM_QUESTION_COUNT} required`,
    );
  }
  return selected.map(publishedQuestionToSnapshot);
}

export async function createMid(
  curriculumId: string | mongoose.Types.ObjectId,
  studentId: string | mongoose.Types.ObjectId,
  studentSid: string,
  title: string,
  chapterIds: (string | mongoose.Types.ObjectId)[],
  passingMark: number
): Promise<{ examsCreated: number }> {
  const curriculumIdObj = new mongoose.Types.ObjectId(curriculumId.toString());
  const studentIdObj = new mongoose.Types.ObjectId(studentId.toString());
  const [student, curriculum] = await Promise.all([
    Student.findOne({ _id: studentIdObj, sid: studentSid }).select("_id").lean(),
    Curriculum.findOne({
      _id: curriculumIdObj,
      owner_student_id: studentIdObj,
    }).select("_id").lean(),
  ]);
  if (!student || !curriculum) {
    throw new Error("Midterm learner, registration, and curriculum ownership do not match");
  }
  const chapters = await Chapter.find({
    _id: { $in: chapterIds },
    curriculum_id: curriculumIdObj,
  }).sort({ number: 1, _id: 1 });

  if (chapters.length !== chapterIds.length) {
    const foundIds = chapters.map((c) => c._id.toString());
    const missing = chapterIds.filter(
      (id) => !foundIds.includes(id.toString())
    );
    throw new Error(
      `Some chapter_ids do not belong to this curriculum: ${missing.join(", ")}`
    );
  }

  const enrollment = await Enrollment.findOne({
    curriculum_id: curriculumIdObj,
    student_id: studentIdObj,
    status: "active",
  });
  if (!enrollment) {
    return { examsCreated: 0 };
  }

  const bindChapters = async (examId: mongoose.Types.ObjectId): Promise<void> => {
    await Promise.all(
      chapterIds.map((chapterId) => {
        const chapterObjectId = new mongoose.Types.ObjectId(chapterId.toString());
        return ExamChapter.updateOne(
          { chapter_id: chapterObjectId, exam_id: examId },
          { $setOnInsert: { chapter_id: chapterObjectId, exam_id: examId } },
          { upsert: true },
        );
      }),
    );
  };

  let exam = await Exam.findOne({
    type: "mid",
    student_id: studentIdObj,
    curriculum_id: curriculumIdObj,
    title,
  });
  if (
    exam &&
    (exam.published_midterm_id || hasLearnerOwnedMidtermSnapshot(exam))
  ) {
    await bindChapters(exam._id);
    return { examsCreated: 0 };
  }

  const questions = await assembleLearnerMidtermPaper({
    curriculumId: curriculumIdObj,
    studentId: studentIdObj,
    studentSid,
    chapters: chapters.map((chapter) => ({
      _id: chapter._id,
      title: chapter.title,
      number: chapter.number,
    })),
  });
  if (passingMark < 0 || passingMark > questions.length) {
    throw new Error("Midterm passing mark exceeds its learner-owned paper");
  }
  const packageHash = createHash("sha256")
    .update(JSON.stringify(questions))
    .digest("hex");
  const packageId = `learner-mid.${studentIdObj}.${packageHash.slice(0, 16)}`;
  const publicationKey = `learner-mid:${studentIdObj}:${curriculumIdObj}:${title}`;
  const publishedAt = new Date();

  let created = false;
  if (!exam) {
    try {
      exam = await Exam.create({
        type: "mid",
        title,
        student_id: studentIdObj,
        student_sid: studentSid,
        curriculum_id: curriculumIdObj,
        package_id: packageId,
        package_version: LEARNER_MIDTERM_PACKAGE_VERSION,
        package_hash: packageHash,
        publication_key: publicationKey,
        published_at: publishedAt,
        questions_snapshot: questions,
        generated_questions: questions,
        attempt_number: 1,
        taken: false,
        passed: false,
        passing_mark: passingMark,
        grading_status: "auto_graded",
        integrity_status: "clean",
        policy_action: "none",
        review_status: "not_required",
      });
      created = true;
    } catch (error) {
      if (!isDuplicateKeyError(error)) throw error;
      exam = await Exam.findOne({
        type: "mid",
        student_id: studentIdObj,
        curriculum_id: curriculumIdObj,
        title,
      });
      if (!exam) throw error;
    }
  }
  if (!exam) throw new Error("Could not create the learner-owned midterm");
  if (
    !exam.published_midterm_id &&
    !hasLearnerOwnedMidtermSnapshot(exam)
  ) {
    if (exam.taken) throw new Error("Cannot replace a finalized midterm package");
    await Exam.collection.updateOne(
      {
        _id: exam._id,
        published_midterm_id: { $exists: false },
        taken: false,
      },
      {
        $set: {
          student_sid: studentSid,
          curriculum_id: curriculumIdObj,
          package_id: packageId,
          package_version: LEARNER_MIDTERM_PACKAGE_VERSION,
          package_hash: packageHash,
          publication_key: publicationKey,
          published_at: publishedAt,
          questions_snapshot: questions,
          generated_questions: questions,
          passing_mark: passingMark,
        },
      },
    );
    exam = await Exam.findById(exam._id);
    if (!exam?.questions_snapshot?.length) {
      throw new Error("Could not materialize the learner-owned midterm package");
    }
  }

  await bindChapters(exam._id);

  return { examsCreated: created ? 1 : 0 };
}

/* ------------------------------------------------------------------ */
/*   Legacy generic final start (the signed integrated route does not use it) */
/* ------------------------------------------------------------------ */

export async function startFinal(
  studentId: string | mongoose.Types.ObjectId,
  curriculumId: string | mongoose.Types.ObjectId,
  studentSid?: string,
  now: Date = new Date()
): Promise<IExam> {
  const studentIdObj = new mongoose.Types.ObjectId(studentId.toString());
  const curriculumIdObj = new mongoose.Types.ObjectId(
    curriculumId.toString()
  );

  for (let loop = 0; loop < MAX_START_ATTEMPTS; loop++) {
    const existingFinal = await Exam.findOne({
      student_id: studentIdObj,
      curriculum_id: curriculumIdObj,
      type: "final",
    });

    const eligibility = await evaluateStart(
      studentIdObj,
      "final",
      curriculumIdObj,
      existingFinal ?? null,
      now,
    );

    if (eligibility.kind === "blocked") {
      throw policyErrorForSnapshot(eligibility.snapshot, now);
    }
    if (eligibility.kind === "resume") {
      return eligibility.exam;
    }

    // Validate every dependency before consuming an attempt. A missing
    // curriculum or unpublished bank must never leave an active orphan ledger
    // record that blocks the learner from retrying after the data is fixed.
    const curriculum = await Curriculum.findById(curriculumIdObj);
    if (!curriculum) throw new Error("Curriculum not found");
    let published = existingFinal?.questions_snapshot?.length
      ? []
      : await publishedBank({ curriculum_id: curriculumIdObj }, studentIdObj, studentSid);
    if (!existingFinal?.questions_snapshot?.length && published.length === 0) {
      published = await legacyFinalBankAsPublished(
        curriculumIdObj,
        { studentId: studentIdObj, studentSid, curriculumId: curriculumIdObj },
      );
    }
    if (!existingFinal?.questions_snapshot?.length && published.length < FINAL_MIN_QUESTIONS) {
      throw new Error(`Insufficient published final bank: ${published.length} available, at least ${FINAL_MIN_QUESTIONS} required`);
    }
    const questions = existingFinal?.questions_snapshot?.length
      ? existingFinal.questions_snapshot as Record<string, unknown>[]
      : published.map(publishedQuestionToSnapshot);
    const passingMark = questions.every((question) => question.type === "mcq")
      ? Math.max(1, Math.ceil(questions.length * 0.6))
      : 50;
    const publication = existingFinal?.blueprint_id && existingFinal.plan_version
      ? { blueprintId: existingFinal.blueprint_id, planVersion: existingFinal.plan_version }
      : assertOnePublishedVersion(published);

    const examId = existingFinal?._id ?? new mongoose.Types.ObjectId();
    const issuance = await issueAttemptRecord({
      learnerId: studentIdObj,
      type: "final",
      assessmentId: curriculumIdObj,
      sourceExamId: examId,
      now,
      basedOnAttemptNumber: eligibility.basedOnAttemptNumber,
    });
    if (!issuance.created) {
      await sleep(START_RACE_BACKOFF_MS);
      continue;
    }

    let exam: IExam;
    if (existingFinal) {
      await resetExamForAttempt(
        existingFinal,
        questions,
        passingMark,
        issuance.record.attempt_number,
        studentSid,
      );
      exam = existingFinal;
    } else {
      try {
        exam = await Exam.create({
          _id: examId,
          type: "final",
          title: `Final: ${curriculum.title}`,
          student_id: studentIdObj,
          student_sid: studentSid,
          curriculum_id: curriculumIdObj,
          blueprint_id: publication.blueprintId,
          plan_version: publication.planVersion,
          questions_snapshot: questions,
          attempt_number: issuance.record.attempt_number,
          generated_questions: questions,
          student_answers: [],
          taken: false,
          passing_mark: passingMark,
          passed: false,
          grading_status: "auto_graded",
          integrity_status: "clean",
          policy_action: "none",
          review_status: "not_required",
        });
      } catch (error: unknown) {
        if (isDuplicateKeyError(error)) {
          await sleep(START_RACE_BACKOFF_MS);
          continue;
        }
        throw error;
      }
    }

    await resetExamSession(exam, studentIdObj, now);

    await writeAudit({
      actor: { type: "student", id: studentIdObj.toString() },
      action: "attempt.start",
      resource: { type: "exam", id: exam._id.toString() },
      metadata: {
        exam_type: "final",
        curriculum_id: curriculumIdObj.toString(),
        attempt_number: issuance.record.attempt_number,
        question_count: questions.length,
        blueprint_id: publication.blueprintId.toString(),
        plan_version: publication.planVersion,
      },
    });

    return exam;
  }

  throw new ExamAttemptError(
    "Could not start the final; a concurrent start is in progress. Please retry.",
    409,
  );
}

/* ------------------------------------------------------------------ */
/*   Proctoring — discrete events (dedup by window)                   */
/* ------------------------------------------------------------------ */

/* Final form preparation and trusted-window launch. */
export type FinalStartPolicy = {
  form: "primary" | "retake";
  accessOpensAt: Date;
  accessExpiresAt: Date;
  retakeNotBefore?: Date;
};

export type LearnerBankOwner = {
  studentId: mongoose.Types.ObjectId;
  curriculumId: mongoose.Types.ObjectId;
  studentSid?: string;
};

/** Exact owner filter for App-synced fallback banks; no unowned legacy reads. */
export function learnerQuestionBankFilter(
  chapterId: mongoose.Types.ObjectId,
  owner: LearnerBankOwner,
): Record<string, unknown> {
  return {
    schema_version: "learner-question-bank-binding-v1",
    chapter_id: { $in: [chapterId, chapterId.toString()] },
    owner_sid: owner.studentSid ?? "__missing_learner_sid__",
    student_id: { $in: [owner.studentId, owner.studentId.toString()] },
    curriculum_id: {
      $in: [owner.curriculumId, owner.curriculumId.toString()],
    },
  };
}

type PreparedFinalForm = {
  form: "primary" | "retake";
  packageId: string;
  questions: Record<string, unknown>[];
  blueprintId: mongoose.Types.ObjectId;
  planVersion: string;
};

function finalPassingMark(questions: Record<string, unknown>[]): number {
  return questions.every((question) => question.type === "mcq")
    ? Math.max(1, Math.ceil(questions.length * 0.6))
    : 50;
}

function finalQuestionContentSignature(question: Record<string, unknown>): string {
  return JSON.stringify({
    prompt: question.prompt,
    type: question.type,
    options: question.options ?? null,
    correct_option: question.correct_option ?? null,
  });
}

function assertDisjointFinalPapers(
  primary: Record<string, unknown>[],
  retake: Record<string, unknown>[],
): void {
  const primaryContent = new Set(primary.map(finalQuestionContentSignature));
  if (retake.some((question) => primaryContent.has(finalQuestionContentSignature(question)))) {
    throw new Error("Primary and reserve final packages must not reuse question content");
  }
}

export function preparePublishedFinalForms(
  published: Record<string, unknown>[],
): PreparedFinalForm[] {
  if (published.length === 0) return [];
  const packages = new Map<string, Record<string, unknown>[]>();
  for (const question of published) {
    const packageId = String(question.package_id ?? "").trim();
    if (!packageId) {
      throw new Error(
        "Published final questions must identify their package; publish two complete final packages for this learner",
      );
    }
    const group = packages.get(packageId) ?? [];
    group.push(question);
    packages.set(packageId, group);
  }
  const eligible = [...packages.entries()]
    .filter(([, questions]) => questions.length >= FINAL_MIN_QUESTIONS)
    .sort(([left], [right]) => left.localeCompare(right));
  if (eligible.length < 2) {
    throw new Error(
      `Two distinct published final packages are required; ${eligible.length} complete package(s) are available`,
    );
  }
  const forms = eligible.slice(0, 2).map<PreparedFinalForm>(([packageId, questions], index) => {
    const publication = assertOnePublishedVersion(questions);
    return {
      form: index === 0 ? "primary" : "retake",
      packageId,
      questions: questions.map(publishedQuestionToSnapshot),
      blueprintId: publication.blueprintId,
      planVersion: publication.planVersion,
    };
  });
  if (forms[0]!.questions.length !== forms[1]!.questions.length) {
    throw new Error("Primary and reserve final packages must contain the same number of questions");
  }
  assertDisjointFinalPapers(forms[0]!.questions, forms[1]!.questions);
  return forms;
}

export function prepareLegacyFinalForms(
  published: Record<string, unknown>[],
  curriculumId: mongoose.Types.ObjectId,
): PreparedFinalForm[] {
  const primary = published.filter((_, index) => index % 2 === 0).slice(0, FINAL_MIN_QUESTIONS);
  const retake = published.filter((_, index) => index % 2 === 1).slice(0, FINAL_MIN_QUESTIONS);
  if (primary.length < FINAL_MIN_QUESTIONS || retake.length < FINAL_MIN_QUESTIONS) {
    throw new Error(
      `Insufficient legacy final bank for two disjoint forms: ${published.length} valid questions available, at least ${FINAL_MIN_QUESTIONS * 2} required`,
    );
  }
  const forms = [
    { form: "primary" as const, raw: primary },
    { form: "retake" as const, raw: retake },
  ].map<PreparedFinalForm>(({ form, raw }) => ({
    form,
    packageId: `legacy-${form}-${curriculumId.toString()}`,
    questions: raw.map(publishedQuestionToSnapshot),
    blueprintId: curriculumId,
    planVersion: LEGACY_BANK_PLAN_VERSION,
  }));
  assertDisjointFinalPapers(forms[0]!.questions, forms[1]!.questions);
  return forms;
}

/**
 * Materialize both papers before the first launch. The unique form index makes
 * concurrent starts converge on the same two immutable snapshots.
 */
async function ensureFinalForms(input: {
  studentId: mongoose.Types.ObjectId;
  curriculumId: mongoose.Types.ObjectId;
  studentSid?: string;
  curriculumTitle: string;
}): Promise<Record<"primary" | "retake", IExam>> {
  let stored = await Exam.find({
    student_id: input.studentId,
    curriculum_id: input.curriculumId,
    type: "final",
    final_form: { $in: ["primary", "retake"] },
  });
  const present = new Set(stored.map((exam) => exam.final_form));
  if (!present.has("primary") || !present.has("retake")) {
    const published = await publishedBank(
      { curriculum_id: input.curriculumId },
      input.studentId,
      input.studentSid,
    );
    const prepared = published.length
      ? preparePublishedFinalForms(published)
      : prepareLegacyFinalForms(
          await legacyFinalBankAsPublished(
            input.curriculumId,
            {
              studentId: input.studentId,
              studentSid: input.studentSid,
              curriculumId: input.curriculumId,
            },
          ),
          input.curriculumId,
        );

    const blueprints = new Set(prepared.map((form) => form.blueprintId.toString()));
    const plans = new Set(prepared.map((form) => form.planVersion));
    if (blueprints.size !== 1 || plans.size !== 1) {
      throw new Error("Primary and reserve final packages must use the same blueprint and plan version");
    }

    for (const form of prepared) {
      if (present.has(form.form)) continue;
      try {
        await Exam.create({
          type: "final",
          title:
            form.form === "primary"
              ? `Final: ${input.curriculumTitle}`
              : `Final retake: ${input.curriculumTitle}`,
          student_id: input.studentId,
          student_sid: input.studentSid,
          curriculum_id: input.curriculumId,
          blueprint_id: form.blueprintId,
          plan_version: form.planVersion,
          package_id: form.packageId,
          final_form: form.form,
          questions_snapshot: form.questions,
          attempt_number: form.form === "primary" ? 1 : 2,
          generated_questions: form.questions,
          student_answers: [],
          taken: false,
          passing_mark: finalPassingMark(form.questions),
          passed: false,
          grading_status: "auto_graded",
          integrity_status: "clean",
          policy_action: "none",
          review_status: "not_required",
        });
      } catch (error: unknown) {
        if (!isDuplicateKeyError(error)) throw error;
      }
    }
    stored = await Exam.find({
      student_id: input.studentId,
      curriculum_id: input.curriculumId,
      type: "final",
      final_form: { $in: ["primary", "retake"] },
    });
  }

  const primary = stored.find((exam) => exam.final_form === "primary");
  const retake = stored.find((exam) => exam.final_form === "retake");
  if (!primary || !retake) throw new Error("Could not prepare both final-exam forms");
  if (
    !primary.blueprint_id ||
    !retake.blueprint_id ||
    primary.blueprint_id.toString() !== retake.blueprint_id.toString() ||
    !primary.plan_version ||
    primary.plan_version !== retake.plan_version
  ) {
    throw new Error("Stored primary and reserve forms do not share one blueprint and plan version");
  }
  if (!primary.package_id || !retake.package_id || primary.package_id === retake.package_id) {
    throw new Error("Stored primary and reserve forms must use distinct packages");
  }
  const primaryQuestions = primary.questions_snapshot as Record<string, unknown>[];
  const retakeQuestions = retake.questions_snapshot as Record<string, unknown>[];
  if (
    !Array.isArray(primaryQuestions) ||
    !Array.isArray(retakeQuestions) ||
    primaryQuestions.length < FINAL_MIN_QUESTIONS ||
    primaryQuestions.length !== retakeQuestions.length
  ) {
    throw new Error("Stored primary and reserve forms are not distinct comparable papers");
  }
  assertDisjointFinalPapers(primaryQuestions, retakeQuestions);
  return { primary, retake };
}

/**
 * Trusted app-controlled final start. Unlike the legacy generic start above,
 * this path accepts only an authorized primary or reserve window and never
 * reuses one form's immutable question snapshot for the other.
 */
export async function startFinalWithForms(
  studentId: string | mongoose.Types.ObjectId,
  curriculumId: string | mongoose.Types.ObjectId,
  studentSid: string | undefined,
  policy: FinalStartPolicy,
  now: Date = new Date(),
): Promise<IExam> {
  const studentIdObj = new mongoose.Types.ObjectId(studentId.toString());
  const curriculumIdObj = new mongoose.Types.ObjectId(curriculumId.toString());
  if (
    policy.accessExpiresAt <= policy.accessOpensAt ||
    now < policy.accessOpensAt ||
    now >= policy.accessExpiresAt
  ) {
    throw new ExamAttemptError("This final-exam form is outside its authorized window", 403);
  }
  if (
    policy.form === "retake" &&
    (!policy.retakeNotBefore || now < policy.retakeNotBefore)
  ) {
    throw new ExamAttemptError("The reserve-form retake is not available yet", 403);
  }

  const curriculum = await Curriculum.findById(curriculumIdObj);
  if (!curriculum) throw new Error("Curriculum not found");
  const forms = await ensureFinalForms({
    studentId: studentIdObj,
    curriculumId: curriculumIdObj,
    studentSid,
    curriculumTitle: curriculum.title,
  });

  for (let loop = 0; loop < MAX_START_ATTEMPTS; loop++) {
    const exam = forms[policy.form];
    const eligibility = await evaluateStart(
      studentIdObj,
      "final",
      curriculumIdObj,
      exam,
      now,
    );
    if (eligibility.kind === "blocked") {
      throw policyErrorForSnapshot(eligibility.snapshot, now);
    }
    if (eligibility.kind === "resume") return eligibility.exam;

    const questions = exam.questions_snapshot as Record<string, unknown>[];
    const issuance = await issueAttemptRecord({
      learnerId: studentIdObj,
      type: "final",
      assessmentId: curriculumIdObj,
      sourceExamId: exam._id,
      now,
      basedOnAttemptNumber: eligibility.basedOnAttemptNumber,
    });
    if (!issuance.created) {
      await sleep(START_RACE_BACKOFF_MS);
      continue;
    }

    exam.access_opens_at = policy.accessOpensAt;
    exam.access_expires_at = policy.accessExpiresAt;
    await resetExamForAttempt(
      exam,
      questions,
      finalPassingMark(questions),
      issuance.record.attempt_number,
      studentSid,
    );
    await resetExamSession(exam, studentIdObj, now);

    await writeAudit({
      actor: { type: "student", id: studentIdObj.toString() },
      action: "attempt.start",
      resource: { type: "exam", id: exam._id.toString() },
      metadata: {
        exam_type: "final",
        final_form: policy.form,
        curriculum_id: curriculumIdObj.toString(),
        attempt_number: issuance.record.attempt_number,
        question_count: questions.length,
        blueprint_id: exam.blueprint_id?.toString(),
        plan_version: exam.plan_version,
        package_id: exam.package_id,
        access_expires_at: policy.accessExpiresAt.toISOString(),
      },
    });
    return exam;
  }

  throw new ExamAttemptError(
    "Could not start the final; a concurrent start is in progress. Please retry.",
    409,
  );
}

/* Proctoring discrete events (deduplicated by window). */
const DISCRETE_EVENT_TYPES = [
  "fullscreen_exit",
  "tab_switch",
  "copy_paste",
  "devtools_open",
];

const EVENT_WEIGHT_MAP: Record<ProctoringEventType, number> = {
  no_face: PROCTORING_CONFIG.faceScoreWeight,
  multiple_faces: PROCTORING_CONFIG.multipleFacesWeight,
  fullscreen_exit: PROCTORING_CONFIG.fullscreenExitWeight,
  tab_switch: PROCTORING_CONFIG.tabSwitchWeight,
  copy_paste: PROCTORING_CONFIG.copyPasteWeight,
  devtools_open: PROCTORING_CONFIG.devtoolsWeight,
};

export async function recordDiscreteEvent(
  examId: string | mongoose.Types.ObjectId,
  studentId: string | mongoose.Types.ObjectId,
  type: ProctoringEventType,
  metadata?: Record<string, unknown>
): Promise<void> {
  const now = new Date();
  const examIdObj = new mongoose.Types.ObjectId(examId.toString());
  const studentIdObj = new mongoose.Types.ObjectId(studentId.toString());

  if (!DISCRETE_EVENT_TYPES.includes(type)) {
    throw new Error(`Expected a discrete event type, got: ${type}`);
  }

  const weight = EVENT_WEIGHT_MAP[type];

  const existingEvent = await ProctoringEvent.findOne({
    exam_id: examIdObj,
    type,
    last_seen_at: {
      $gte: new Date(
        now.getTime() - PROCTORING_CONFIG.duplicateEventWindowMs
      ),
    },
  }).sort({ last_seen_at: -1 });

  if (existingEvent) {
    existingEvent.occurrences += 1;
    existingEvent.last_seen_at = now;
    await existingEvent.save();
  } else {
    const session = await ExamSession.findOne({ exam_id: examIdObj });
    if (!session) {
      throw new Error(`ExamSession not found for exam ${examId}`);
    }

    const scoreBefore = session.suspicion_score;
    await ProctoringEvent.create({
      exam_id: examIdObj,
      student_id: studentIdObj,
      type,
      weight,
      score_at_event: scoreBefore + weight,
      occurrences: 1,
      last_seen_at: now,
      metadata,
    });

    await bumpSuspicionScore(examIdObj, weight);
  }
}

/* ------------------------------------------------------------------ */
/*   Proctoring — camera events (duration-based open/extend/close)     */
/* ------------------------------------------------------------------ */

export async function recordCameraEvent(
  examId: string | mongoose.Types.ObjectId,
  studentId: string | mongoose.Types.ObjectId,
  type: "no_face" | "multiple_faces",
  detected: boolean
): Promise<void> {
  const examIdObj = new mongoose.Types.ObjectId(examId.toString());
  const studentIdObj = new mongoose.Types.ObjectId(studentId.toString());

  const exam = await Exam.findById(examIdObj);
  if (!exam) throw new Error("Exam not found");

  if (
    !PROCTORING_CONFIG.faceDetectionExamTypes.includes(exam.type)
  ) {
    throw new Error(
      `Camera events not allowed for exam type "${exam.type}"`
    );
  }

  const evType: ProctoringEventType = type;
  const now = new Date();

  /* eslint-disable @typescript-eslint/no-explicit-any */
  if (detected) {
    const existingOpen = await ProctoringEvent.findOne({
      exam_id: examIdObj,
      type: evType,
      ended_at: { $eq: null },
    } as any);

    if (existingOpen) {
      const elapsed = Math.floor(
        (now.getTime() - existingOpen.last_seen_at.getTime()) / 1000
      );
      existingOpen.duration_seconds =
        (existingOpen.duration_seconds || 0) + elapsed;
      existingOpen.last_seen_at = now;
      await existingOpen.save();
    } else {
      await ProctoringEvent.create({
        exam_id: examIdObj,
        student_id: studentIdObj,
        type: evType,
        weight: 0,
        score_at_event: 0,
        occurrences: 1,
        last_seen_at: now,
        duration_seconds: 0,
        ended_at: undefined,
        metadata: type === "multiple_faces" ? { faceCount: 2 } : { confidence: 0.95 },
      });
    }
  } else {
    const openEvent = await ProctoringEvent.findOne({
      exam_id: examIdObj,
      type: evType,
      ended_at: { $eq: null },
    } as any);

    if (openEvent) {
      const elapsed = Math.floor(
        (now.getTime() - openEvent.last_seen_at.getTime()) / 1000
      );
      openEvent.duration_seconds =
        (openEvent.duration_seconds || 0) + elapsed;
      openEvent.last_seen_at = now;
      openEvent.ended_at = now;

      const totalDuration = openEvent.duration_seconds || 0;
      const intervals = Math.floor(
        totalDuration / PROCTORING_CONFIG.absenceScoreIntervalSeconds
      );
      const baseWeight =
        evType === "no_face"
          ? PROCTORING_CONFIG.faceScoreWeight
          : PROCTORING_CONFIG.multipleFacesWeight;
      const weight = Math.min(
        baseWeight * intervals,
        PROCTORING_CONFIG.maxAbsenceEventWeight
      );
      openEvent.weight = weight;
      openEvent.score_at_event =
        (await getSessionScore(examIdObj)) + weight;
      await openEvent.save();

      await bumpSuspicionScore(examIdObj, weight);
    }
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function getSessionScore(
  examId: mongoose.Types.ObjectId
): Promise<number> {
  const session = await ExamSession.findOne({ exam_id: examId });
  return session?.suspicion_score ?? 0;
}

/* ------------------------------------------------------------------ */
/*   Integrity: notification (stub)                                    */
/* ------------------------------------------------------------------ */

async function sendNotification(
  payload: Record<string, unknown>
): Promise<void> {
  // Stub — wire up real notification (email / in-app) later
  console.log("[sendNotification]", JSON.stringify(payload));
}

export async function notifyIntegrityInvalidation(
  exam: IExam
): Promise<void> {
  if (exam.invalidation_notified_at) return;

  const events = await ProctoringEvent.find({ exam_id: exam._id }).sort({
    createdAt: 1,
  });

  const payload = {
    exam_id: exam._id.toString(),
    student_id: exam.student_id.toString(),
    type: exam.type,
    title: exam.title,
    invalidated_at: exam.invalidated_at,
    score: exam.mark,
    proctoring_events: events.map((e) => ({
      type: e.type,
      weight: e.weight,
      occurrences: e.occurrences,
      duration_seconds: e.duration_seconds,
      last_seen_at: e.last_seen_at,
      metadata: e.metadata,
    })),
  };

  await sendNotification(payload);

  exam.invalidation_notified_at = new Date();
  await exam.save();
}

/* ------------------------------------------------------------------ */
/*   submitExam                                                        */
/* ------------------------------------------------------------------ */

export async function submitExam(
  examId: string | mongoose.Types.ObjectId,
  studentAnswers: Record<string, unknown>[],
  options: {
    terminalReason?: "student_submitted" | "timeout";
    terminalAt?: Date;
  } = {},
): Promise<IExam> {
  const examIdObj = new mongoose.Types.ObjectId(examId.toString());
  await refreshIntegrityRisk(examIdObj);
  const exam = await Exam.findById(examIdObj);
  if (!exam) throw new Error("Exam not found");
  if (exam.taken) return exam;

  const session = await ExamSession.findOne({ exam_id: examIdObj });

  exam.student_answers = studentAnswers;
  exam.taken = true;

  gradeExamSubmission(exam, studentAnswers, {
    flagged: session?.flagged ?? false,
  });
  if (exam.type !== "practice") queueResultWebhookRevision(exam);

  await exam.save();

  if (session) {
    session.status = "completed";
    session.integrity_state = "submitted";
    session.ended_at = options.terminalAt ?? new Date();
    session.terminated_reason = options.terminalReason ?? "student_submitted";
    await session.save();
  }

  // A submitted attempt is terminal: freeze the ledger record with its
  // durable evidence. Cooldown begins from this server-recorded time. A retry
  // therefore can never refund or erase this attempt.
  if (exam.type !== "practice") {
    await finalizeActiveRecordForSourceExam(
      exam._id,
      "submitted",
      session?.ended_at ?? new Date(),
      buildTerminalEvidence(exam, session ?? null),
    );
  }

  if (exam.type !== "practice" && exam.integrity_status === "invalidated") {
    await notifyIntegrityInvalidation(exam);
  }

  await writeAudit({
    actor: { type: "student", id: exam.student_id.toString() },
    action: "attempt.submit",
    resource: { type: "exam", id: exam._id.toString() },
    metadata: {
      exam_type: exam.type,
      grading_status: exam.grading_status,
      integrity_status: exam.integrity_status,
      policy_action: exam.policy_action,
      mark: exam.mark ?? null,
      raw_mark: exam.raw_mark ?? null,
      integrity_penalty_applied: exam.integrity_penalty_applied ?? false,
      flagged: session?.flagged ?? false,
      passed: exam.passed,
    },
  });

  return exam;
}

/* ------------------------------------------------------------------ */
/*   gradeFinal — manual grading                                       */
/* ------------------------------------------------------------------ */

export async function gradeFinal(
  examId: string | mongoose.Types.ObjectId,
  mark: number,
  gradedBy: string,
  reason?: string,
  isRegrade: boolean = false
): Promise<IExam> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new Error("Exam not found");
  if (exam.type !== "final") {
    throw new Error("gradeFinal can only be used on final exams");
  }
  if (
    exam.grading_status !== "pending_review" &&
    !(isRegrade && exam.grading_status === "graded")
  ) {
    throw new Error("Exam is not pending review");
  }

  const maximumMark = 100;
  if (!Number.isInteger(mark) || mark < 0 || mark > maximumMark) {
    throw new Error(`Final mark must be an integer from 0 to ${maximumMark}`);
  }
  if (
    exam.passing_mark === undefined ||
    !Number.isFinite(exam.passing_mark) ||
    exam.passing_mark < 0 ||
    exam.passing_mark > maximumMark
  ) {
    throw new Error("Final exam has no valid stored passing mark");
  }

  const now = new Date();

  await GradeHistory.create({
    exam_id: exam._id,
    mark,
    graded_by: gradedBy,
    graded_at: now,
    is_regrade: isRegrade,
    reason: reason || (isRegrade ? "regrade" : "initial grade"),
  });

  exam.mark = mark;
  exam.passed =
    exam.integrity_status !== "invalidated" && mark >= exam.passing_mark;
  exam.grading_status = "graded";
  queueResultWebhookRevision(exam, now);
  await exam.save();

  await writeAudit({
    actor: { type: "instructor", id: gradedBy },
    action: "grading.final",
    resource: { type: "exam", id: exam._id.toString() },
    metadata: {
      mark,
      passed: exam.passed,
      is_regrade: isRegrade,
      reason: reason || (isRegrade ? "regrade" : "initial grade"),
    },
  });

  // The save above durably marks this result revision for callback delivery.
  // The retry worker owns transient callback failures without rolling back the
  // instructor's trusted grade.
  await sendResultWebhook(exam);
  return exam;
}

/* ------------------------------------------------------------------ */
/*   resolveIntegrityAppeal                                            */
/* ------------------------------------------------------------------ */

export async function resolveIntegrityAppeal(
  examId: string | mongoose.Types.ObjectId,
  resolution: "upheld" | "cleared",
  resolvedBy: string,
  note?: string,
  allowRetake: boolean = false
): Promise<void> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new Error("Exam not found");
  if (exam.integrity_status !== "invalidated") {
    throw new Error(
      "Integrity status must be 'invalidated' to file an appeal"
    );
  }

  const now = new Date();

  await IntegrityAppeal.create({
    exam_id: exam._id,
    submitted_note: note,
    resolved_by: resolvedBy,
    resolution,
    allow_retake: allowRetake,
    resolved_at: now,
  });

  if (resolution === "cleared") {
    exam.integrity_status = "clean";
    exam.policy_action = "none";
    exam.review_status = "cleared";
    if (exam.type === "quiz" || exam.type === "mid") {
      if (exam.mark !== undefined && exam.passing_mark !== undefined) {
        exam.passed = exam.mark >= exam.passing_mark;
      }
    }
  }
  if (resolution === "upheld") exam.review_status = "upheld";
  await exam.save();

  await writeAudit({
    actor: { type: "admin", id: resolvedBy },
    action: "integrity.appeal_resolved",
    resource: { type: "exam", id: exam._id.toString() },
    metadata: {
      resolution,
      allow_retake: allowRetake,
      integrity_status: exam.integrity_status,
    },
  });
}

/* ------------------------------------------------------------------ */
/*   processBook — dummy implementation                                */
/* ------------------------------------------------------------------ */

export async function processBook(
  bookId: string | mongoose.Types.ObjectId,
  studentId?: string | mongoose.Types.ObjectId
): Promise<void> {
  const bookIdObj = new mongoose.Types.ObjectId(bookId.toString());
  const book = await Book.findById(bookIdObj);
  if (!book) throw new Error("Book not found");

  book.status = "processing";
  await book.save();

  const curriculum = await Curriculum.create({
    title: book.title,
    description: `Curriculum generated from book: ${book.title}`,
    book_id: bookIdObj,
    owner_student_id: studentId
      ? new mongoose.Types.ObjectId(studentId.toString())
      : undefined,
  });

  const dummyChapters = [
    { title: "Introduction", number: 1 },
    { title: "Core Concepts", number: 2 },
    { title: "Advanced Topics", number: 3 },
    { title: "Practical Applications", number: 4 },
    { title: "Review & Summary", number: 5 },
  ];

  const chapterDocs = dummyChapters.map((ch) => ({
    curriculum_id: curriculum._id,
    title: ch.title,
    number: ch.number,
  }));

  await Chapter.insertMany(chapterDocs);

  if (studentId) {
    await Enrollment.create({
      student_id: new mongoose.Types.ObjectId(studentId.toString()),
      curriculum_id: curriculum._id,
      enrolled_at: new Date(),
      status: "active",
    });
  }

  book.status = "ready";
  await book.save();
}

/* ------------------------------------------------------------------ */
/*   Utility: strip correct_option from generated questions            */
/* ------------------------------------------------------------------ */

export function stripCorrectOption(
  exam: Record<string, unknown>
): Record<string, unknown> {
  const obj = { ...exam };
  const questions = obj.generated_questions as
    | Record<string, unknown>[]
    | undefined;
  if (questions) {
    obj.generated_questions = questions.map((q) => {
      const rest = { ...q };
      delete rest.correct_option;
      return rest;
    });
  }
  return obj;
}

export function examToPlain(exam: { toObject?: () => Record<string, unknown> }): Record<string, unknown> {
  const plain = exam.toObject ? exam.toObject() : { ...exam };
  if (plain.type !== "mid") return plain;
  const publicFields = ["_id", "type", "title", "taken", "createdAt", "updatedAt"];
  return Object.fromEntries(
    publicFields
      .filter((field) => plain[field] !== undefined)
      .map((field) => [field, plain[field]]),
  );
}
