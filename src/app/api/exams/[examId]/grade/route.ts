import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { gradeFinal } from "@/lib/business-logic";
import { ExamAttemptError, examAttemptErrorResponse } from "@/lib/exam-attempt";
import {
  gradeFinalSchema,
  parseJsonBody,
  requestValidationErrorResponse,
} from "@/lib/request-validation";
import { examRateLimiter } from "@/lib/rate-limit";
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
    const body = await parseJsonBody(request, gradeFinalSchema);
    examRateLimiter.enforce({ kind: "user", id: body.graded_by });

    const idempotencyKey = idempotencyKeyFromRequest(request, `grade:${examId}`);
    const fingerprint = JSON.stringify({
      examId,
      mark: body.mark,
      graded_by: body.graded_by,
      reason: body.reason ?? null,
      is_regrade: body.is_regrade ?? null,
    });

    const run = async () => {
      await gradeFinal(
        examId,
        body.mark,
        body.graded_by,
        body.reason,
        body.is_regrade ?? false,
      );
      return { success: true };
    };

    if (idempotencyKey) {
      const { result } = await withIdempotency(
        new MongoIdempotencyStore(),
        idempotencyKey,
        fingerprint,
        run,
      );
      return Response.json(result, { status: 200 });
    }

    return Response.json(await run(), { status: 200 });
  } catch (error: unknown) {
    const validationResponse = requestValidationErrorResponse(error);
    if (validationResponse) return validationResponse;
    if (error instanceof ExamAttemptError) return examAttemptErrorResponse(error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
