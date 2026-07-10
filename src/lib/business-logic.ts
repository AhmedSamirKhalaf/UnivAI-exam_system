import mongoose from "mongoose";
import { Enrollment, IEnrollment } from "@/models/Enrollment";
import { Exam, ExamType } from "@/models/Exam";
import { ExamChapter } from "@/models/ExamChapter";
import { Chapter } from "@/models/Chapter";
import { ProctoringEvent, ProctoringEventType } from "@/models/ProctoringEvent";
import { ExamSession } from "@/models/ExamSession";
import { GradeHistory } from "@/models/GradeHistory";
import { PROCTORING_CONFIG } from "@/lib/proctoring-config";

export type CanStartExamResult =
  | { allowed: true }
  | { allowed: false; reason: string };

/**
 * Checks whether a student has an active enrollment in a curriculum.
 */
export async function isEnrolled(
  studentId: string | mongoose.Types.ObjectId,
  curriculumId: string | mongoose.Types.ObjectId
): Promise<IEnrollment | null> {
  return Enrollment.findOne({
    student_id: studentId,
    curriculum_id: curriculumId,
    status: "active",
  });
}

/**
 * Type-specific weight lookup for proctoring events.
 */
const EVENT_WEIGHT_MAP: Record<ProctoringEventType, number> = {
  no_face: PROCTORING_CONFIG.faceScoreWeight,
  multiple_faces: PROCTORING_CONFIG.multipleFacesWeight,
  fullscreen_exit: PROCTORING_CONFIG.fullscreenExitWeight,
  tab_switch: PROCTORING_CONFIG.tabSwitchWeight,
  copy_paste: PROCTORING_CONFIG.copyPasteWeight,
  devtools_open: PROCTORING_CONFIG.devtoolsWeight,
};

/**
 * Checks whether a student can start an exam of the given type.
 * For "quiz": curriculumOrChapterId is the chapter_id (enrollment is checked
 *   via the chapter's curriculum).
 * For "mid": curriculumOrChapterId is the curriculum_id.
 * For "final": uses canStartFinal logic.
 */
export async function canStartExam(
  studentId: string | mongoose.Types.ObjectId,
  examType: ExamType,
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
    // "mid"
    curriculumId = new mongoose.Types.ObjectId(curriculumOrChapterId);
  }

  const enrollment = await isEnrolled(studentId, curriculumId);
  if (!enrollment) {
    return {
      allowed: false,
      reason: "Student is not enrolled in this curriculum",
    };
  }

  return { allowed: true };
}

/**
 * Checks whether a student can start the final exam for a curriculum.
 * Every chapter in the curriculum must have a passed quiz based on the
 * student's MOST RECENT attempt for that chapter.
 */
export async function canStartFinal(
  studentId: string | mongoose.Types.ObjectId,
  curriculumId: string | mongoose.Types.ObjectId
): Promise<CanStartExamResult> {
  const enrollment = await isEnrolled(studentId, curriculumId);
  if (!enrollment) {
    return {
      allowed: false,
      reason: "Student is not enrolled in this curriculum",
    };
  }

  // Check that no final exam already exists for this student+curriculum
  const existingFinal = await Exam.findOne({
    student_id: studentId,
    curriculum_id: curriculumId,
    type: "final",
  });
  if (existingFinal) {
    return {
      allowed: false,
      reason: "Student has already attempted the final exam",
    };
  }

  const chapters = await Chapter.find({ curriculum_id: curriculumId });

  for (const chapter of chapters) {
    // Find the most recent quiz exam linked to this chapter for this student
    // by finding ExamChapter entries for this chapter, then finding the exam
    // with the highest attempt_number among this student's quiz exams.
    const examChapters = await ExamChapter.find({
      chapter_id: chapter._id,
    }).sort({ createdAt: -1 });

    if (examChapters.length === 0) {
      return {
        allowed: false,
        reason: `Chapter "${chapter.title}" has no quiz attempts`,
      };
    }

    // Get the exam IDs linked to this chapter
    const examIds = examChapters.map((ec) => ec.exam_id);

    // Find the student's most recent quiz attempt among those exams
    const mostRecentExam = await Exam.findOne({
      _id: { $in: examIds },
      student_id: studentId,
      type: "quiz",
    }).sort({ attempt_number: -1, createdAt: -1 });

    if (!mostRecentExam || !mostRecentExam.passed) {
      return {
        allowed: false,
        reason: `Chapter "${chapter.title}" quiz not yet passed`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Records a proctoring event with dedup logic.
 * If an event of the same type for the same exam_id exists and was last seen
 * within duplicateEventWindowMs, increments occurrences and updates last_seen_at
 * instead of creating a new document. Otherwise inserts a new ProctoringEvent
 * and increases the linked ExamSession's suspicion_score.
 */
export async function recordProctoringEvent(
  examId: string | mongoose.Types.ObjectId,
  studentId: string | mongoose.Types.ObjectId,
  type: ProctoringEventType,
  metadata?: Record<string, unknown>
): Promise<void> {
  const now = new Date();
  const weight = EVENT_WEIGHT_MAP[type];

  // Look for an existing event of the same type for this exam within the dedup window
  const existingEvent = await ProctoringEvent.findOne({
    exam_id: examId,
    type,
    last_seen_at: {
      $gte: new Date(now.getTime() - PROCTORING_CONFIG.duplicateEventWindowMs),
    },
  }).sort({ last_seen_at: -1 });

  if (existingEvent) {
    // Dedup: increment occurrences and update last_seen_at, do NOT add weight again
    existingEvent.occurrences += 1;
    existingEvent.last_seen_at = now;
    await existingEvent.save();
  } else {
    // New event: get the current suspicion score from the session
    const session = await ExamSession.findOne({ exam_id: examId });
    if (!session) {
      throw new Error(`ExamSession not found for exam ${examId}`);
    }

    const newScore = session.suspicion_score + weight;

    await ProctoringEvent.create({
      exam_id: examId,
      student_id: studentId,
      type,
      weight,
      score_at_event: newScore,
      occurrences: 1,
      last_seen_at: now,
      metadata,
    });

    // Update the session's suspicion score
    session.suspicion_score = newScore;
    if (newScore >= PROCTORING_CONFIG.suspicionThreshold) {
      session.flagged = true;
    }
    await session.save();
  }
}

/**
 * Grades a final exam: inserts a GradeHistory row and updates Exam.mark +
 * grading_status accordingly.
 */
export async function gradeFinal(
  examId: string | mongoose.Types.ObjectId,
  mark: number,
  gradedBy: string,
  reason?: string,
  isRegrade: boolean = false
): Promise<void> {
  const exam = await Exam.findById(examId);
  if (!exam) {
    throw new Error(`Exam not found: ${examId}`);
  }
  if (exam.type !== "final") {
    throw new Error("gradeFinal can only be used on final exams");
  }

  const now = new Date();

  await GradeHistory.create({
    exam_id: examId,
    mark,
    graded_by: gradedBy,
    graded_at: now,
    is_regrade: isRegrade,
    reason,
  });

  exam.mark = mark;
  exam.grading_status = "graded";
  await exam.save();
}

/**
 * Creates a mid exam: validates chapter_ids belong to the curriculum, then
 * batch-creates one Exam + matching ExamChapter rows for every actively
 * enrolled student.
 */
export async function createMid(
  curriculumId: string | mongoose.Types.ObjectId,
  title: string,
  chapterIds: (string | mongoose.Types.ObjectId)[],
  passingMark: number
): Promise<{ examsCreated: number }> {
  // Validate all chapter_ids belong to the curriculum
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

  // Find all actively enrolled students
  const enrollments = await Enrollment.find({
    curriculum_id: curriculumId,
    status: "active",
  });

  const studentIds = enrollments.map((e) => e.student_id);

  if (studentIds.length === 0) {
    return { examsCreated: 0 };
  }

  // Batch create Exam docs (one per student) and ExamChapter rows
  const examDocs = studentIds.map((studentId) => ({
    type: "mid" as const,
    title,
    student_id: studentId,
    attempt_number: 1,
    taken: false,
    passed: false,
    passing_mark: passingMark,
    grading_status: "auto_graded" as const,
  }));

  const createdExams = await Exam.insertMany(examDocs);

  const examChapterDocs = createdExams.flatMap((exam) =>
    chapterIds.map((chapterId) => ({
      chapter_id: new mongoose.Types.ObjectId(chapterId),
      exam_id: exam._id,
    }))
  );

  await ExamChapter.insertMany(examChapterDocs);

  return { examsCreated: createdExams.length };
}
