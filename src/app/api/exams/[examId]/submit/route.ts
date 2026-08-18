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
import { examRateLimiter } from "@/lib/rate-limit";
import { requestValidationErrorResponse } from "@/lib/request-validation";
import {
  idempotencyKeyFromRequest,
  MongoIdempotencyStore,
  withIdempotency,
} from "@/lib/idempotency";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;
    await requireExamAttempt(request, examId);
    examRateLimiter.enforce({ kind: "session", id: examId });

    const idempotencyKey = idempotencyKeyFromRequest(request, `submit:${examId}`);

    const run = async () => {
      const exam = await submitExam(examId, await getServerStoredAnswers(examId));

      // Result + proctoring report go back to the UnivAI app. Fire-and-forget:
      // a dead webhook must never break a student's submission.
      if (exam.type !== "practice") void sendResultWebhook(exam);

      return getExamAttemptView(examId);
    };

    if (idempotencyKey) {
      const { result } = await withIdempotency(
        new MongoIdempotencyStore(),
        idempotencyKey,
        examId,
        run,
      );
      return Response.json(result, { status: 200 });
    }

    return Response.json(await run(), { status: 200 });
  } catch (error: unknown) {
    const boundaryResponse = requestValidationErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return examAttemptErrorResponse(error);
  }
}
