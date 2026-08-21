import mongoose from "mongoose";
import { Exam } from "@/models/Exam";
import { ExamSession } from "@/models/ExamSession";
import { submitExam } from "@/lib/business-logic";
import { examTimeLimitSeconds } from "@/lib/exam-timing";
import { sendResultWebhook } from "@/lib/report-webhook";

/**
 * Submit the server-saved answers when a quiz or midterm reaches its deadline.
 * Repeated callers are safe: the first submission makes the exam terminal.
 */
export async function finalizeExpiredTimedExam(
  examId: string | mongoose.Types.ObjectId,
  now: Date = new Date(),
): Promise<boolean> {
  const exam = await Exam.findById(examId);
  if (!exam || exam.taken) return false;
  if (examTimeLimitSeconds(exam.type, exam.generated_questions?.length ?? 0) === null) {
    return false;
  }

  const session = await ExamSession.findOne({ exam_id: exam._id });
  if (
    !session ||
    session.status !== "in_progress" ||
    !session.deadline_at ||
    now.getTime() < session.deadline_at.getTime()
  ) {
    return false;
  }

  const submitted = await submitExam(exam._id, session.answers ?? [], {
    terminalReason: "timeout",
    terminalAt: session.deadline_at,
  });
  if (submitted.type !== "practice") void sendResultWebhook(submitted);
  return true;
}

