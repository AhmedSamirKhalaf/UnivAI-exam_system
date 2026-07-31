import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { submitExam } from "@/lib/business-logic";
import { sendResultWebhook } from "@/lib/report-webhook";
import {
  examAttemptErrorResponse,
  getExamAttemptView,
  getServerStoredAnswers,
  requireExamAttempt,
} from "@/lib/exam-attempt";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;
    await requireExamAttempt(request, examId);
    const exam = await submitExam(examId, await getServerStoredAnswers(examId));

    // Result + proctoring report go back to the UnivAI app. Fire-and-forget:
    // a dead webhook must never break a student's submission.
    void sendResultWebhook(exam);

    return Response.json(await getExamAttemptView(examId), { status: 200 });
  } catch (error: unknown) {
    return examAttemptErrorResponse(error);
  }
}
