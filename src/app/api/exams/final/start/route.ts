import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  canStartFinal,
  startFinalWithForms,
} from "@/lib/business-logic";
import { createExamLaunch, examAttemptErrorResponse, ExamAttemptError } from "@/lib/exam-attempt";
import {
  parseJsonBody,
  requestValidationErrorResponse,
  startFinalSchema,
} from "@/lib/request-validation";
import { examRateLimiter } from "@/lib/rate-limit";
import {
  idempotencyKeyFromRequest,
  MongoIdempotencyStore,
  withIdempotency,
} from "@/lib/idempotency";
import { isStandalone } from "@/lib/runtime";
import { verifyAppRequestSignature } from "@/lib/webhook-signature";

export async function POST(request: NextRequest) {
  try {
    if (!isStandalone()) {
      const raw = await request.clone().text();
      if (
        !verifyAppRequestSignature(
          raw,
          request.headers.get("x-univai-app-signature"),
          process.env.EXAM_CALLBACK_SECRET ?? "",
        )
      ) {
        return Response.json({ error: "Unauthorized final-exam launch." }, { status: 401 });
      }
    }
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
      final_form: body.final_form,
      authorized_at: body.authorized_at,
      access_opens_at: body.access_opens_at,
      access_expires_at: body.access_expires_at,
      retake_not_before: body.retake_not_before ?? null,
    });

    const run = async () => {
      const check = await canStartFinal(body.student_id, body.curriculum_id);
      if (!check.allowed) {
        throw new ExamAttemptError(check.reason, 403);
      }

      const exam = await startFinalWithForms(
        body.student_id,
        body.curriculum_id,
        body.student_sid,
        {
          form: body.final_form,
          accessOpensAt: new Date(body.access_opens_at),
          accessExpiresAt: new Date(body.access_expires_at),
          ...(body.retake_not_before
            ? { retakeNotBefore: new Date(body.retake_not_before) }
            : {}),
        },
        new Date(body.authorized_at),
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
