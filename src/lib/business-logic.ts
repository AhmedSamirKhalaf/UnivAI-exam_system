import mongoose from "mongoose";
import { Enrollment } from "@/models/Enrollment";
import { Exam, IExam } from "@/models/Exam";
import { ExamChapter } from "@/models/ExamChapter";
import { Chapter } from "@/models/Chapter";
import { Curriculum } from "@/models/Curriculum";
import { Book } from "@/models/Book";
import { ProctoringEvent, ProctoringEventType } from "@/models/ProctoringEvent";
import { ExamSession } from "@/models/ExamSession";
import { GradeHistory } from "@/models/GradeHistory";
import { IntegrityAppeal } from "@/models/IntegrityAppeal";
import { PROCTORING_CONFIG } from "@/lib/proctoring-config";

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
    });
  }

  await session.save();
}

/* ------------------------------------------------------------------ */
/*   Question generation (dummy)                                       */
/* ------------------------------------------------------------------ */

export async function generateQuestions(
  scope: mongoose.Types.ObjectId | mongoose.Types.ObjectId[],
  count: number,
  examType: "quiz" | "mid" | "final"
): Promise<Record<string, unknown>[]> {
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

/* ------------------------------------------------------------------ */
/*   startQuiz — find-or-reset                                        */
/* ------------------------------------------------------------------ */

export async function startQuiz(
  studentId: string | mongoose.Types.ObjectId,
  chapterId: string | mongoose.Types.ObjectId
): Promise<IExam> {
  const chapter = await Chapter.findById(chapterId);
  if (!chapter) throw new Error("Chapter not found");

  const studentIdObj = new mongoose.Types.ObjectId(studentId.toString());
  const chapterIdObj = new mongoose.Types.ObjectId(chapterId.toString());

  let exam = await Exam.findOne({
    student_id: studentIdObj,
    chapter_id: chapterIdObj,
    type: "quiz",
  });

  const title = `Quiz: ${chapter.title}`;
  const now = new Date();

  const questionCount = 5;
  if (exam) {
    exam.attempt_number = (exam.attempt_number || 0) + 1;
    exam.generated_questions = await generateQuestions(chapter._id, questionCount, "quiz");
    exam.student_answers = [];
    exam.taken = false;
    exam.mark = undefined;
    exam.passed = false;
    exam.grading_status = "auto_graded";
    exam.integrity_status = "clean";
    exam.invalidated_at = undefined;
    exam.invalidation_notified_at = undefined;
    await exam.save();

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
  } else {
    const questions = await generateQuestions(chapter._id, questionCount, "quiz");
    exam = await Exam.create({
      type: "quiz",
      title,
      student_id: studentIdObj,
      chapter_id: chapterIdObj,
      attempt_number: 1,
      generated_questions: questions,
      student_answers: [],
      taken: false,
      passing_mark: 3,
      passed: false,
      grading_status: "auto_graded",
      integrity_status: "clean",
    });

    await ExamSession.create({
      exam_id: exam._id,
      student_id: studentIdObj,
      started_at: now,
      suspicion_score: 0,
      flagged: false,
      status: "in_progress",
    });
  }

  return exam!;
}

/* ------------------------------------------------------------------ */
/*   startMid — reset-in-place on pre-created Exam                     */
/* ------------------------------------------------------------------ */

export async function startMid(
  examId: string | mongoose.Types.ObjectId
): Promise<IExam> {
  const examIdObj = new mongoose.Types.ObjectId(examId.toString());
  const exam = await Exam.findById(examIdObj);
  if (!exam) throw new Error("Exam not found");
  if (exam.type !== "mid") throw new Error("Exam is not a mid");

  const examChapters = await ExamChapter.find({ exam_id: examIdObj });
  const chapterIds = examChapters.map((ec) => ec.chapter_id);
  const count = Math.max(5, chapterIds.length * 3);

  exam.attempt_number = (exam.attempt_number || 0) + 1;
  exam.generated_questions = await generateQuestions(chapterIds, count, "mid");
  exam.student_answers = [];
  exam.taken = false;
  exam.mark = undefined;
  exam.passed = false;
  exam.grading_status = "auto_graded";
  exam.integrity_status = "clean";
  exam.invalidated_at = undefined;
  exam.invalidation_notified_at = undefined;
  await exam.save();

  await ExamSession.deleteOne({ exam_id: examIdObj });
  await ProctoringEvent.deleteMany({ exam_id: examIdObj });

  await ExamSession.create({
    exam_id: examIdObj,
    student_id: exam.student_id,
    started_at: new Date(),
    suspicion_score: 0,
    flagged: false,
    status: "in_progress",
  });

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
    attempt_number: 1,
    taken: false,
    passed: false,
    passing_mark: passingMark,
    grading_status: "auto_graded" as const,
    integrity_status: "clean" as const,
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
/*   startFinal — one-shot creation                                    */
/* ------------------------------------------------------------------ */

export async function startFinal(
  studentId: string | mongoose.Types.ObjectId,
  curriculumId: string | mongoose.Types.ObjectId
): Promise<IExam> {
  const studentIdObj = new mongoose.Types.ObjectId(studentId.toString());
  const curriculumIdObj = new mongoose.Types.ObjectId(
    curriculumId.toString()
  );

  const existingFinal = await Exam.findOne({
    student_id: studentIdObj,
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

  const questions = await generateQuestions(curriculumIdObj, 10, "final");
  const now = new Date();

  const exam = await Exam.create({
    type: "final",
    title: `Final: ${curriculum.title}`,
    student_id: studentIdObj,
    curriculum_id: curriculumIdObj,
    attempt_number: 1,
    generated_questions: questions,
    student_answers: [],
    taken: false,
    passed: false,
    grading_status: "auto_graded",
    integrity_status: "clean",
  });

  await ExamSession.create({
    exam_id: exam._id,
    student_id: studentIdObj,
    started_at: now,
    suspicion_score: 0,
    flagged: false,
    status: "in_progress",
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
    session.ended_at = new Date();
    session.terminated_reason = "student_submitted";
    await session.save();
  }

  if (exam.integrity_status === "invalidated") {
    await notifyIntegrityInvalidation(exam);
  }

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

  exam.mark = mark;
  exam.grading_status = "graded";
  await exam.save();
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
    if (exam.type === "quiz" || exam.type === "mid") {
      if (exam.mark !== undefined && exam.passing_mark !== undefined) {
        exam.passed = exam.mark >= exam.passing_mark;
      }
    }
    await exam.save();
  }
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
  return exam.toObject ? exam.toObject() : { ...exam };
}
