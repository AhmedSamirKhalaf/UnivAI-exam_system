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

  // The final-attempt count and cooldown are enforced by the versioned
  // attempt policy (2 attempts, 2 days) in the same atomic operation that
  // issues the attempt. This gate keeps the remaining mandatory gates:
  // every chapter quiz must be passed before the final opens.
  const chapters = await Chapter.find({ curriculum_id: curriculumId });

  for (const chapter of chapters) {
    const quizExam = await Exam.findOne({
      student_id: studentId,
      chapter_id: chapter._id,
      type: "quiz",
    });

    if (!quizExam || !quizExam.passed) {
      return {
        allowed: false,
        reason: `Chapter "${chapter.title}" quiz not yet passed`,
      };
    }
  }

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
  prompt: string;
  type: "mcq" | "essay";
  options?: string[];
  correct_option?: string;
  /** "lecture" = the lecturer said it out loud; "self_study" = book-only material */
  source?: "lecture" | "self_study";
};

/**
 * UnivAI generates questions from the course book and stores them per chapter
 * in the `question_banks` collection ({ chapter_id, questions }). Exams draw
 * from there, so a quiz is actually about its lecture. The old placeholder
 * generator survives only as a last resort for chapters with no bank.
 */
async function bankQuestions(
  chapterId: mongoose.Types.ObjectId
): Promise<BankQuestion[]> {
  const db = mongoose.connection.db;
  if (!db) return [];
  const bank = await db
    .collection("question_banks")
    .findOne({ chapter_id: chapterId.toString() });
  const questions = (bank?.questions ?? []) as BankQuestion[];
  return questions.filter((q) => q.prompt && q.type);
}

function sample<T>(items: T[], count: number, random: RandomSource): T[] {
  return shuffled(items, random).slice(0, count);
}

function placeholderQuestions(count: number, examType: "quiz" | "mid" | "final") {
  const questions: Record<string, unknown>[] = [];
  for (let i = 1; i <= count; i++) {
    if (examType === "final" && i % 3 === 0) {
      questions.push({
        question_id: `q_${i}`,
        prompt: `Placeholder essay question ${i} — describe a key concept.`,
        type: "essay",
        correct_option: undefined,
      });
    } else {
      questions.push({
        question_id: `q_${i}`,
        prompt: `Placeholder MCQ question ${i}?`,
        type: "mcq",
        options: ["A) Option 1", "B) Option 2", "C) Option 3", "D) Option 4"],
        correct_option: String.fromCharCode(65 + (i % 4)),
      });
    }
  }
  return questions;
}

export async function generateQuestions(
  scope: mongoose.Types.ObjectId | mongoose.Types.ObjectId[],
  count: number,
  examType: "quiz" | "mid" | "final"
): Promise<Record<string, unknown>[]> {
  const chapterIds = Array.isArray(scope) ? scope : [scope];
  const random = isStandalone()
    ? createSeededRandom(Number(process.env.UNIVAI_EXAM_SEED ?? "20260727"))
    : Math.random;

  const pool: BankQuestion[] = [];
  if (examType !== "final") {
    for (const chapterId of chapterIds) {
      pool.push(...(await bankQuestions(chapterId)));
    }
  }

  if (!pool.length) {
    return placeholderQuestions(count, examType);
  }

  // At least 90% of every paper must be answerable from what the lecturer
  // actually said; "self_study" questions (book material beyond the lecture)
  // can NEVER exceed 10% of the paper. A 5-question quiz therefore carries
  // none; the 12-question mid carries exactly one.
  const selfPool = pool.filter((q) => q.source === "self_study");
  const taughtPool = pool.filter((q) => q.source !== "self_study");
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
  const learnerFilter = studentSid
    ? { $or: [{ learner_id: studentSid }, { learner_id: learnerId.toString() }] }
    : { learner_id: learnerId.toString() };
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

    const published = existing?.questions_snapshot?.length
      ? []
      : await publishedBank({ chapter_id: chapterIdObj }, studentIdObj, studentSid);

    let questions: Record<string, unknown>[];
    let publication: { blueprintId?: mongoose.Types.ObjectId; planVersion?: string };

    if (existing?.questions_snapshot?.length) {
      questions = existing.questions_snapshot as Record<string, unknown>[];
      publication = { blueprintId: existing.blueprint_id, planVersion: existing.plan_version };
    } else if (published.length >= questionCount) {
      questions = shuffled(published, isStandalone() ? createSeededRandom(Number(process.env.UNIVAI_EXAM_SEED ?? "20260727")) : Math.random)
          .slice(0, questionCount)
          .map(publishedQuestionToSnapshot);
      publication = assertOnePublishedVersion(published);
    } else {
      questions = await generateQuestions(chapterIdObj, questionCount, "quiz");
      if (questions.length < questionCount) {
        throw new Error(`Insufficient quiz bank: ${questions.length} available, ${questionCount} requested`);
      }
      publication = { blueprintId: undefined, planVersion: undefined };
    }

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
    existing.ended_at = undefined;
    existing.suspicion_score = 0;
    existing.flagged = false;
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

  if (!exam.questions_snapshot?.length) {
    throw new Error("Midterm has no immutable published question package");
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

export async function createMid(
  curriculumId: string | mongoose.Types.ObjectId,
  title: string,
  chapterIds: (string | mongoose.Types.ObjectId)[],
  passingMark: number
): Promise<{ examsCreated: number }> {
  const chapters = await Chapter.find({
    _id: { $in: chapterIds },
    curriculum_id: curriculumId,
  });

  if (chapters.length !== chapterIds.length) {
    const foundIds = chapters.map((c) => c._id.toString());
    const missing = chapterIds.filter(
      (id) => !foundIds.includes(id.toString())
    );
    throw new Error(
      `Some chapter_ids do not belong to this curriculum: ${missing.join(", ")}`
    );
  }

  const enrollments = await Enrollment.find({
    curriculum_id: curriculumId,
    status: "active",
  });

  if (enrollments.length === 0) {
    return { examsCreated: 0 };
  }

  const examDocs = enrollments.map((e) => ({
    type: "mid" as const,
    title,
    student_id: e.student_id,
    attempt_number: 1,
    taken: false,
    passed: false,
    passing_mark: passingMark,
    grading_status: "auto_graded" as const,
    integrity_status: "clean" as const,
    policy_action: "none" as const,
    review_status: "not_required" as const,
  }));

  const createdExams = await Exam.insertMany(examDocs);

  const examChapterDocs = createdExams.flatMap((exam) =>
    chapterIds.map((chapterId) => ({
      chapter_id: new mongoose.Types.ObjectId(chapterId.toString()),
      exam_id: exam._id,
    }))
  );

  await ExamChapter.insertMany(examChapterDocs);

  return { examsCreated: createdExams.length };
}

/* ------------------------------------------------------------------ */
/*   startFinal — policy-gated final (2 attempts, 2 days)              */
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

    const curriculum = await Curriculum.findById(curriculumIdObj);
    if (!curriculum) throw new Error("Curriculum not found");
    const published = existingFinal?.questions_snapshot?.length
      ? []
      : await publishedBank({ curriculum_id: curriculumIdObj }, studentIdObj, studentSid);
      
    let questions: Record<string, unknown>[];
    let publication: { blueprintId?: mongoose.Types.ObjectId; planVersion?: string };

    if (existingFinal?.questions_snapshot?.length) {
      questions = existingFinal.questions_snapshot as Record<string, unknown>[];
      publication = { blueprintId: existingFinal.blueprint_id, planVersion: existingFinal.plan_version };
    } else if (published.length >= FINAL_MIN_QUESTIONS) {
      questions = published.map(publishedQuestionToSnapshot);
      publication = assertOnePublishedVersion(published);
    } else {
      questions = await generateQuestions(curriculumIdObj, FINAL_MIN_QUESTIONS, "final");
      publication = { blueprintId: undefined, planVersion: undefined };
    }

    let exam: IExam;
    if (existingFinal) {
      await resetExamForAttempt(
        existingFinal,
        questions,
        undefined,
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
  studentAnswers: Record<string, unknown>[]
): Promise<IExam> {
  const examIdObj = new mongoose.Types.ObjectId(examId.toString());
  const exam = await Exam.findById(examIdObj);
  if (!exam) throw new Error("Exam not found");
  if (exam.taken) throw new Error("Exam already submitted");

  exam.student_answers = studentAnswers;
  exam.taken = true;

  if (exam.type === "quiz" || exam.type === "mid") {
    autoGrade(exam, studentAnswers);
    exam.grading_status = "auto_graded";
  } else {
    exam.grading_status = "pending_review";
  }

  if (exam.integrity_status === "invalidated") {
    exam.passed = false;
  }

  await exam.save();

  const session = await ExamSession.findOne({ exam_id: examIdObj });
  if (session) {
    session.status = "completed";
    session.integrity_state = "submitted";
    session.ended_at = new Date();
    session.terminated_reason = "student_submitted";
    await session.save();
  }

  // A submitted attempt is terminal: freeze the ledger record with its
  // durable evidence. Cooldown begins from this server-recorded time. A retry
  // therefore can never refund or erase this attempt.
  await finalizeActiveRecordForSourceExam(
    exam._id,
    "submitted",
    session?.ended_at ?? new Date(),
    buildTerminalEvidence(exam, session ?? null),
  );

  if (exam.integrity_status === "invalidated") {
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
      passed: exam.passed,
    },
  });

  return exam;
}

function autoGrade(
  exam: IExam,
  studentAnswers: Record<string, unknown>[]
): void {
  const questions = (exam.generated_questions ||
    []) as Record<string, unknown>[];
  let correctCount = 0;

  for (const answer of studentAnswers) {
    const question = questions.find(
      (q) => q.question_id === answer.question_id
    );
    if (question && question.type === "mcq") {
      if (answer.answer === question.correct_option) {
        correctCount++;
      }
    }
  }

  exam.mark = correctCount;
  if (exam.passing_mark !== undefined) {
    exam.passed = correctCount >= exam.passing_mark;
  }
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
): Promise<void> {
  const exam = await Exam.findById(examId);
  if (!exam) throw new Error("Exam not found");
  if (exam.type !== "final") {
    throw new Error("gradeFinal can only be used on final exams");
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

  if (exam.grading_status !== "pending_review") {
    throw new Error("Exam is not pending review");
  }

  exam.mark = mark;
  exam.passed = mark >= 50;
  exam.grading_status = "graded";
  await exam.save();

  await writeAudit({
    actor: { type: "instructor", id: gradedBy },
    action: "grading.final",
    resource: { type: "exam", id: exam._id.toString() },
    metadata: {
      mark,
      passed: mark >= 50,
      is_regrade: isRegrade,
      reason: reason || (isRegrade ? "regrade" : "initial grade"),
    },
  });
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
