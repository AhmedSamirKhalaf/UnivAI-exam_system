import mongoose from "mongoose";
import { Enrollment } from "@/models/Enrollment";
import { Exam, IExam } from "@/models/Exam";
import { ExamChapter } from "@/models/ExamChapter";
import { Chapter } from "@/models/Chapter";
import { Curriculum } from "@/models/Curriculum";
import { Book } from "@/models/Book";
import { QuestionProvenance } from "@/models/QuestionProvenance";
import { ProctoringEvent, ProctoringEventType } from "@/models/ProctoringEvent";
import { ExamSession } from "@/models/ExamSession";
import { GradeHistory } from "@/models/GradeHistory";
import { IntegrityAppeal } from "@/models/IntegrityAppeal";
import { QuestionProvenance } from "@/models/QuestionProvenance";
import { PROCTORING_CONFIG } from "@/lib/proctoring-config";
import {
  createSeededRandom,
  shuffled,
  type RandomSource,
} from "@/lib/deterministic-rng";
import { isStandalone } from "@/lib/runtime";
import {
  AUDIT_SCHEMA_VERSION,
  INTEGRITY_POLICY_VERSION,
  auditEntrySchema,
  writeAudit,
} from "@/lib/audit-log";

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

  const existingFinal = await Exam.findOne({
    student_id: studentId,
    curriculum_id: curriculumId,
    type: "final",
  });

  if (existingFinal) {
    const clearedAppeal = await IntegrityAppeal.findOne({
      exam_id: existingFinal._id,
      resolution: "cleared",
      allow_retake: true,
    });
    if (!clearedAppeal) {
      return {
        allowed: false,
        reason: "Student has already attempted the final exam",
      };
    }
  }

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
/*   Agent question bank selection                                    */
/* ------------------------------------------------------------------ */

type BankQuestion = {
  question_id: string;
  prompt: string;
  type: "mcq" | "essay";
  options?: string[];
  correct_option?: string;
  /** "lecture" = the lecturer said it out loud; "self_study" = book-only material */
  source?: "lecture" | "self_study";
};

/**
 * UnivAI-Agent stores complete questions per chapter in `question_banks`.
 * Exam may select those supplied records, but it never fabricates missing
 * content or identifiers.
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
  return questions.filter((q) => q.question_id && q.prompt && q.type);
}

function sample<T>(items: T[], count: number, random: RandomSource): T[] {
  return shuffled(items, random).slice(0, count);
}

async function selectAgentBankQuestions(
  scope: mongoose.Types.ObjectId | mongoose.Types.ObjectId[],
  count: number,
  examType: "quiz" | "mid" | "final"
): Promise<Record<string, unknown>[]> {
  const chapterIds = Array.isArray(scope)
    ? scope
    : examType === "final"
      ? (
          await Chapter.find({ curriculum_id: scope })
            .select("_id")
            .lean()
        ).map((chapter) => chapter._id)
      : [scope];
  const random = isStandalone()
    ? createSeededRandom(Number(process.env.UNIVAI_EXAM_SEED ?? "20260727"))
    : Math.random;

  const pool: BankQuestion[] = [];
  for (const chapterId of chapterIds) {
    pool.push(...(await bankQuestions(chapterId)));
  }

  if (!pool.length) {
    throw new Error(
      "Agent question bank is empty; Exam refuses to fabricate missing questions",
    );
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

  if (picked.length !== count) {
    throw new Error(
      `Agent question bank has ${picked.length} eligible questions; ${count} are required`,
    );
  }

  return sample(picked, picked.length, random);
}

/* ------------------------------------------------------------------ */
/*   startQuiz — find-or-reset from the published quiz bank            */
/* ------------------------------------------------------------------ */

export interface StartResult {
  exam: IExam;
  created: boolean;
}

const QUIZ_MIN_COUNT = 3;
const QUIZ_MAX_COUNT = 30;

function publishedQuestionToSnapshot(
  question: Record<string, unknown>,
): Record<string, unknown> {
  return {
    schema_version: "question-provenance-v1",
    question_id: question.question_id,
    prompt: question.prompt,
    type: question.type,
    options: question.options,
    correct_option: question.correct_option,
    plan_version: question.plan_version,
    approved: true,
    provenance: question.provenance,
  };
}

/**
 * Draws a quiz exclusively from the published provenance bank
 * (QuestionProvenance, stamped by a validated QuizPackageV1). There is no
 * generation and no placeholder fallback here: an empty or short bank is an
 * explicit start failure, not a license to fabricate questions.
 */
export async function startQuiz(
  studentId: string | mongoose.Types.ObjectId,
  chapterId: string | mongoose.Types.ObjectId,
  requestedCount?: number,
  studentSid?: string
): Promise<StartResult> {
  const chapter = await Chapter.findById(chapterId);
  if (!chapter) throw new Error("Chapter not found");

  const studentIdObj = new mongoose.Types.ObjectId(studentId.toString());
  const chapterIdObj = new mongoose.Types.ObjectId(chapterId.toString());

  const existing = await Exam.findOne({
    student_id: studentIdObj,
    chapter_id: chapterIdObj,
    type: "quiz",
  });

  const title = `Quiz: ${chapter.title}`;
  const now = new Date();
  const questionCount = Math.min(QUIZ_MAX_COUNT, Math.max(QUIZ_MIN_COUNT, Math.floor(requestedCount ?? 5)));
  let passingMark = Math.max(1, Math.ceil(questionCount * 0.6));
  let exam: IExam;

  if (existing) {
    existing.attempt_number = (existing.attempt_number || 0) + 1;
    if (studentSid) existing.student_sid = studentSid;
    existing.student_answers = [];
    existing.taken = false;
    existing.mark = undefined;
    existing.passed = false;
    existing.passing_mark = passingMark;
    existing.grading_status = "auto_graded";
    existing.integrity_status = "clean";
    existing.policy_action = "none";
    existing.review_status = "not_required";
    existing.invalidated_at = undefined;
    existing.invalidation_notified_at = undefined;

    if (existing.questions_snapshot) {
      // Reuse the immutable published snapshot so a retake is deterministic
      // and always grades the same published version.
      existing.generated_questions = existing.questions_snapshot;
      passingMark = Math.max(1, Math.ceil(existing.questions_snapshot.length * 0.6));
    } else {
      // Legacy attempt from before blueprint-backed quizzes: refresh from the
      // published bank without mutating the immutable snapshot field.
      const published = await publishedBank(chapterIdObj, studentIdObj, studentSid);
      existing.generated_questions = samplePublishedBank(published, questionCount).map(
        (question) => publishedQuestionToSnapshot(question)
      );
    }

    exam = await existing.save();

    await ExamSession.deleteOne({ exam_id: exam._id });
    await ProctoringEvent.deleteMany({ exam_id: exam._id });

    await ExamSession.create({
      exam_id: exam._id,
      student_id: studentIdObj,
      started_at: now,
      suspicion_score: 0,
      flagged: false,
      status: "in_progress",
    });

    await writeAudit({
      actor: { type: "student", id: studentIdObj.toString() },
      action: "attempt.start",
      resource: { type: "exam", id: exam._id.toString() },
      metadata: {
        exam_type: "quiz",
        chapter_id: chapterIdObj.toString(),
        attempt_number: exam.attempt_number,
        question_count: questionCount,
        blueprint_id: exam.blueprint_id?.toString() ?? null,
        plan_version: exam.plan_version ?? null,
      },
    });

    return { exam, created: false };
  }

  const published = await publishedBank(chapterIdObj, studentIdObj, studentSid);
  const snapshot = samplePublishedBank(published, questionCount).map((question) =>
    publishedQuestionToSnapshot(question)
  );
  const blueprintIds = new Set(
    published.map((question) =>
      question.blueprint_id ? String(question.blueprint_id) : undefined,
    ),
  );
  if (blueprintIds.size !== 1 || blueprintIds.has(undefined)) {
    throw new Error("Published quiz bank spans multiple blueprints");
  }
  const blueprintId = published[0].blueprint_id as mongoose.Types.ObjectId;
  const planVersion = String(published[0].plan_version ?? "");

  exam = await Exam.create({
    type: "quiz",
    title,
    student_id: studentIdObj,
    student_sid: studentSid,
    chapter_id: chapterIdObj,
    blueprint_id: blueprintId,
    plan_version: planVersion,
    questions_snapshot: snapshot,
    attempt_number: 1,
    generated_questions: snapshot,
    student_answers: [],
    taken: false,
    passing_mark: passingMark,
    passed: false,
    grading_status: "auto_graded",
    integrity_status: "clean",
    policy_action: "none",
    review_status: "not_required",
  });

  await ExamSession.create({
    exam_id: exam._id,
    student_id: studentIdObj,
    started_at: now,
    suspicion_score: 0,
    flagged: false,
    status: "in_progress",
  });

  return { exam, created: true };
}

async function publishedBank(
  chapterId: mongoose.Types.ObjectId,
  studentId: mongoose.Types.ObjectId,
  studentSid?: string,
): Promise<Record<string, unknown>[]> {
  const learnerFilter = studentSid
    ? { $or: [{ learner_id: studentSid }, { learner_id: studentId.toString() }] }
    : { learner_id: studentId.toString() };
  const published = await QuestionProvenance.find({
    chapter_id: chapterId,
    approved: true,
    ...learnerFilter,
  }).lean();

  if (published.length === 0) {
    throw new Error(
      "No published quiz questions for this chapter; the weekly quiz package is not available",
    );
  }
  if (published.length < QUIZ_MIN_COUNT) {
    throw new Error(
      `Insufficient published quiz bank: ${published.length} available, at least ${QUIZ_MIN_COUNT} required`,
    );
  }
  return published as unknown as Record<string, unknown>[];
}

function samplePublishedBank(
  published: Record<string, unknown>[],
  count: number,
): Record<string, unknown>[] {
  if (published.length < count) {
    throw new Error(
      `Insufficient published quiz bank: ${published.length} available, ${count} requested`,
    );
  }
  const random = isStandalone()
    ? createSeededRandom(Number(process.env.UNIVAI_EXAM_SEED ?? "20260727"))
    : Math.random;
  return shuffled(published, random).slice(0, count);
}

/* ------------------------------------------------------------------ */
/*   startMid — reset-in-place on pre-created Exam                     */
/* ------------------------------------------------------------------ */

export async function startMid(
  examId: string | mongoose.Types.ObjectId,
  requestedCount?: number,
  studentSid?: string
): Promise<IExam> {
  const examIdObj = new mongoose.Types.ObjectId(examId.toString());
  const exam = await Exam.findById(examIdObj);
  if (!exam) throw new Error("Exam not found");
  if (exam.type !== "mid") throw new Error("Exam is not a mid");
  if (
    !exam.published_midterm_id ||
    !exam.blueprint_id ||
    exam.blueprint_version === undefined ||
    !exam.plan_version ||
    !exam.package_id ||
    !exam.package_version ||
    !exam.package_hash ||
    !exam.publication_key ||
    !exam.published_at ||
    !exam.questions_snapshot?.length
  ) {
    throw new Error("Midterm has no immutable published question package");
  }
  if (exam.taken) throw new Error("Midterm attempt is already finalized");

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

  const count = exam.questions_snapshot.length;
  if (requestedCount !== undefined && requestedCount !== count) {
    throw new Error(
      `Published midterm contains exactly ${count} questions; question_count cannot change it`,
    );
  }

  const existingSession = await ExamSession.findOne({ exam_id: examIdObj });
  if (existingSession) {
    if (existingSession.status === "in_progress") return exam;
    throw new Error("Midterm attempt cannot be restarted after finalization");
  }

  const transactionSession = await mongoose.startSession();
  try {
    await transactionSession.withTransaction(async () => {
      const concurrentSession = await ExamSession.findOne({
        exam_id: examIdObj,
      }).session(transactionSession);
      if (concurrentSession) {
        if (concurrentSession.status === "in_progress") return;
        throw new Error("Midterm attempt cannot be restarted after finalization");
      }

      if (studentSid && studentSid !== exam.student_sid) {
        await Exam.updateOne(
          { _id: examIdObj, published_midterm_id: exam.published_midterm_id },
          { $set: { student_sid: studentSid } },
          { session: transactionSession },
        );
        exam.student_sid = studentSid;
      }

      const startedAt = new Date();
      await ExamSession.create(
        [
          {
            exam_id: examIdObj,
            student_id: exam.student_id,
            started_at: startedAt,
            suspicion_score: 0,
            flagged: false,
            status: "in_progress",
          },
        ],
        { session: transactionSession },
      );

      const auditEntry = auditEntrySchema.parse({
        schema_version: AUDIT_SCHEMA_VERSION,
        occurred_at: startedAt,
        actor: { type: "student", id: exam.student_id.toString() },
        action: "attempt.start",
        resource: { type: "exam", id: exam._id.toString() },
        policy_version: INTEGRITY_POLICY_VERSION,
        metadata: {
          exam_type: "mid",
          attempt_number: exam.attempt_number,
          question_count: count,
          package_id: exam.package_id,
          package_version: exam.package_version,
          package_hash: exam.package_hash,
        },
      });
      await mongoose.connection.db!.collection("audit_logs").insertOne(
        auditEntry,
        { session: transactionSession },
      );
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: number }).code === 11000
    ) {
      const concurrentSession = await ExamSession.findOne({
        exam_id: examIdObj,
        status: "in_progress",
      });
      if (concurrentSession) return exam;
    }
    throw error;
  } finally {
    await transactionSession.endSession();
  }

  return exam;
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
    curriculum_id: new mongoose.Types.ObjectId(curriculumId.toString()),
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
/*   startFinal — one-shot creation from the published final bank      */
/* ------------------------------------------------------------------ */

export const FINAL_MIN_QUESTIONS = 10;

function publishedFinalQuestionToSnapshot(
  question: Record<string, unknown>,
): Record<string, unknown> {
  const isMcq = question.type === "mcq";
  const snapshot: Record<string, unknown> = {
    schema_version: "question-provenance-v1",
    question_id: question.question_id,
    prompt: question.prompt,
    type: question.type,
    plan_version: question.plan_version,
    approved: true,
    provenance: question.provenance,
  };
  if (isMcq) {
    snapshot.options = question.options;
    snapshot.correct_option = question.correct_option;
  }
  return snapshot;
}

/**
 * Draws the final EXCLUSIVELY from the published cumulative final bank
 * (QuestionProvenance stamped by a validated FinalPackageV1). There is no
 * generation and no placeholder fallback: an empty or short bank is an explicit
 * start failure, not a license to fabricate questions. One final attempt binds
 * to one immutable published version (the full paper — no random sampling).
 */
async function publishedFinalBank(
  curriculumId: mongoose.Types.ObjectId,
  studentId: mongoose.Types.ObjectId,
  studentSid?: string,
): Promise<Record<string, unknown>[]> {
  const learnerFilter = studentSid
    ? { $or: [{ learner_id: studentSid }, { learner_id: studentId.toString() }] }
    : { learner_id: studentId.toString() };
  const published = await QuestionProvenance.find({
    curriculum_id: curriculumId,
    approved: true,
    ...learnerFilter,
  }).lean();

  if (published.length === 0) {
    throw new Error(
      "No published final questions for this curriculum; the cumulative final package is not available",
    );
  }
  if (published.length < FINAL_MIN_QUESTIONS) {
    throw new Error(
      `Insufficient published final bank: ${published.length} available, at least ${FINAL_MIN_QUESTIONS} required`,
    );
  }
  return published as unknown as Record<string, unknown>[];
}

export async function startFinal(
  studentId: string | mongoose.Types.ObjectId,
  curriculumId: string | mongoose.Types.ObjectId,
  studentSid?: string,
): Promise<IExam> {
  const studentIdObj = new mongoose.Types.ObjectId(studentId.toString());
  const curriculumIdObj = new mongoose.Types.ObjectId(
    curriculumId.toString()
  );

  const existingFinal = await Exam.findOne({
    student_id: studentIdObj,
    student_sid: studentSid,
    curriculum_id: curriculumIdObj,
    type: "final",
  });

  if (existingFinal) {
    const clearedAppeal = await IntegrityAppeal.findOne({
      exam_id: existingFinal._id,
      resolution: "cleared",
      allow_retake: true,
    });
    if (!clearedAppeal) {
      throw new Error("Final exam already exists for this student and curriculum");
    }
  }

  const curriculum = await Curriculum.findById(curriculumIdObj);
  if (!curriculum) throw new Error("Curriculum not found");

  const published = await publishedFinalBank(
    curriculumIdObj,
    studentIdObj,
    studentSid,
  );
  const snapshot = published.map(publishedFinalQuestionToSnapshot);

  const blueprintIds = new Set(
    published.map((question) =>
      question.blueprint_id ? String(question.blueprint_id) : undefined,
    ),
  );
  if (blueprintIds.size !== 1 || blueprintIds.has(undefined)) {
    throw new Error("Published final bank spans multiple blueprints");
  }
  const blueprintId = published[0].blueprint_id as mongoose.Types.ObjectId;
  const planVersion = String(published[0].plan_version ?? "");
  const now = new Date();

  const exam = await Exam.create({
    type: "final",
    title: `Final: ${curriculum.title}`,
    student_id: studentIdObj,
    student_sid: studentSid,
    curriculum_id: curriculumIdObj,
    blueprint_id: blueprintId,
    plan_version: planVersion,
    questions_snapshot: snapshot,
    attempt_number: 1,
    generated_questions: snapshot,
    student_answers: [],
    taken: false,
    passed: false,
    grading_status: "auto_graded",
    integrity_status: "clean",
    policy_action: "none",
    review_status: "not_required",
  });

  await ExamSession.create({
    exam_id: exam._id,
    student_id: studentIdObj,
    started_at: now,
    suspicion_score: 0,
    flagged: false,
    status: "in_progress",
  });

  await writeAudit({
    actor: { type: "student", id: studentIdObj.toString() },
    action: "attempt.start",
    resource: { type: "exam", id: exam._id.toString() },
    metadata: {
      exam_type: "final",
      curriculum_id: curriculumIdObj.toString(),
      blueprint_id: blueprintId.toString(),
      plan_version: planVersion,
      attempt_number: exam.attempt_number,
      question_count: snapshot.length,
    },
  });

  return exam;
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

  const publicFields = [
    "_id",
    "type",
    "title",
    "taken",
    "createdAt",
    "updatedAt",
  ];
  return Object.fromEntries(
    publicFields
      .filter((field) => plain[field] !== undefined)
      .map((field) => [field, plain[field]]),
  );
}
