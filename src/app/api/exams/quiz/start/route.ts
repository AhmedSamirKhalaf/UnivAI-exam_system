import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  canStartExam,
  startQuiz,
} from "@/lib/business-logic";
import { createExamLaunch, examAttemptErrorResponse, ExamAttemptError } from "@/lib/exam-attempt";
import {
  parseJsonBody,
  requestValidationErrorResponse,
  startQuizSchema,
} from "@/lib/request-validation";
import { examRateLimiter } from "@/lib/rate-limit";
import {
  idempotencyKeyFromRequest,
  MongoIdempotencyStore,
  withIdempotency,
} from "@/lib/idempotency";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await parseJsonBody(request, startQuizSchema);
    examRateLimiter.enforce({ kind: "user", id: body.student_id });

    const idempotencyKey = idempotencyKeyFromRequest(request);
    const fingerprint = JSON.stringify({
      student_id: body.student_id,
      chapter_id: body.chapter_id,
      question_count: body.question_count ?? null,
    });

    const run = async () => {
      const check = await canStartExam(body.student_id, "quiz", body.chapter_id);
      if (!check.allowed) {
        throw new ExamAttemptError(check.reason, 403);
      }

      const { exam, created } = await startQuiz(
        body.student_id,
        body.chapter_id,
        body.question_count,
        body.student_sid,
      );
      const launch = await createExamLaunch(exam, request.nextUrl.origin);
      return { launch, created };
    };

    if (idempotencyKey) {
      const { result, idempotent } = await withIdempotency(
        new MongoIdempotencyStore(),
        idempotencyKey,
        fingerprint,
        run,
      );
      return Response.json(result.launch, {
        status: idempotent ? 200 : result.created ? 201 : 200,
      });
    }

    const { launch, created } = await run();
    return Response.json(launch, { status: created ? 201 : 200 });
  } catch (error: unknown) {
    const validationResponse = requestValidationErrorResponse(error);
    if (validationResponse) return validationResponse;
    return examAttemptErrorResponse(error);
  }
}
