import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  canStartFinal,
  startFinal,
} from "@/lib/business-logic";
import { createExamLaunch, examAttemptErrorResponse, ExamAttemptError } from "@/lib/exam-attempt";
import {
  parseJsonBody,
  requireTrustedService,
  requestValidationErrorResponse,
  startFinalSchema,
} from "@/lib/request-validation";
import { examRateLimiter } from "@/lib/rate-limit";
import {
  idempotencyKeyFromRequest,
  MongoIdempotencyStore,
  withIdempotency,
} from "@/lib/idempotency";

export async function POST(request: NextRequest) {
  try {
    requireTrustedService(request);
    await connectDB();
    const body = await parseJsonBody(request, startFinalSchema);
    examRateLimiter.enforce({ kind: "user", id: body.student_id });

    const idempotencyKey = idempotencyKeyFromRequest(
      request,
      `final-start:${body.student_id}`,
    );
    const fingerprint = JSON.stringify({
      student_id: body.student_id,
      curriculum_id: body.curriculum_id,
      student_sid: body.student_sid ?? null,
    });

    const run = async () => {
      const check = await canStartFinal(body.student_id, body.curriculum_id);
      if (!check.allowed) {
        throw new ExamAttemptError(check.reason, 403);
      }

      const exam = await startFinal(
        body.student_id,
        body.curriculum_id,
        body.student_sid,
      );
      return createExamLaunch(exam, request.nextUrl.origin);
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
    return examAttemptErrorResponse(error);
  }
}
