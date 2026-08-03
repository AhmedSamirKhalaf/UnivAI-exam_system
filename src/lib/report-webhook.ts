import { ExamSession } from "@/models/ExamSession";
import { ProctoringEvent } from "@/models/ProctoringEvent";
import type { IExam } from "@/models/Exam";
import { resultWebhookSchema } from "@/lib/contracts";
import { isStandalone } from "@/lib/runtime";
import { signResultWebhook } from "@/lib/webhook-signature";

/**
 * After a submission, send the result AND the proctoring report back to the
 * UnivAI app (RESULT_WEBHOOK_URL), so it can record the grade and decide
 * whether the attempt has a problem.
 *
 * Fire-and-forget: a dead webhook must never break a student's submission —
 * the app can still poll GET /api/exams/[examId] as a fallback.
 */
export async function sendResultWebhook(exam: IExam): Promise<void> {
  const url = process.env.RESULT_WEBHOOK_URL;
  if (!url && !isStandalone()) return;

  try {
    const session = await ExamSession.findOne({ exam_id: exam._id });
    const events = await ProctoringEvent.find({ exam_id: exam._id }).sort({ createdAt: 1 });

    const payload = {
      exam_id: exam._id.toString(),
      type: exam.type,
      title: exam.title,
      student_id: exam.student_id.toString(),
      // The UnivAI app's tenant key — routes this grade to the right owner.
      student_sid: exam.student_sid ?? null,
      chapter_id: exam.chapter_id?.toString() ?? null,
      mark: exam.mark ?? null,
      total_questions: (exam.generated_questions ?? []).length,
      passing_mark: exam.passing_mark ?? null,
      passed: exam.passed,
      grading_status: exam.grading_status,
      integrity_status: exam.integrity_status,
      policy_action: exam.policy_action ?? "none",
      review_status: exam.review_status ?? "not_required",
      report: {
        suspicion_score: session?.suspicion_score ?? 0,
        flagged: session?.flagged ?? false,
        session_status: session?.status ?? "unknown",
        started_at: session?.started_at ?? null,
        ended_at: session?.ended_at ?? null,
        events: events.map((event) => ({
          type: event.type,
          weight: event.weight,
          occurrences: event.occurrences,
          at: event.last_seen_at,
        })),
      },
    };

    const validated = resultWebhookSchema.parse(payload);
    if (!url) {
      await ExamSession.db.collection("webhook_captures").insertOne({
        captured_at: new Date(),
        payload: validated,
      });
      return;
    }

    const rawBody = JSON.stringify(validated);
    const signature = signResultWebhook(
      rawBody,
      process.env.EXAM_CALLBACK_SECRET ?? "",
    );

    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Exam-Signature": signature,
      },
      body: rawBody,
    });
  } catch (error) {
    console.error("[webhook] failed to deliver result:", error);
  }
}
