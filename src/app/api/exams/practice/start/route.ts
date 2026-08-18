import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { startPractice } from "@/lib/business-logic";
import {
  createExamLaunch,
  examAttemptErrorResponse,
} from "@/lib/exam-attempt";
import {
  parseJsonBody,
  requestValidationErrorResponse,
  startPracticeSchema,
} from "@/lib/request-validation";
import { requireTrustedAgentRequest, TrustedAgentError } from "@/lib/trusted-agent";
import { examRateLimiter } from "@/lib/rate-limit";
import {
  idempotencyKeyFromRequest,
  MongoIdempotencyStore,
  withIdempotency,
} from "@/lib/idempotency";

export async function POST(request: NextRequest) {
  try {
    requireTrustedAgentRequest(request);
    await connectDB();
    const body = await parseJsonBody(request, startPracticeSchema);
    examRateLimiter.enforce({ kind: "user", id: body.student_id });

    const run = async () => {
      const result = await startPractice({
        studentId: body.student_id,
        curriculumId: body.curriculum_id,
        chapterId: body.chapter_id,
        studentSid: body.student_sid,
        packageId: body.package_id,
        title: body.title,
        planVersion: body.plan_version,
        questions: body.questions,
      });
      return {
        launch: await createExamLaunch(result.exam, request.nextUrl.origin),
        created: result.created,
      };
    };

    const idempotencyKey = idempotencyKeyFromRequest(
      request,
      `practice-start:${body.student_id}`,
    );
    if (idempotencyKey) {
      const { result, idempotent } = await withIdempotency(
        new MongoIdempotencyStore(),
        idempotencyKey,
        JSON.stringify({ student_id: body.student_id, package_id: body.package_id }),
        run,
      );
      return Response.json(result.launch, {
        status: idempotent ? 200 : result.created ? 201 : 200,
      });
    }

    const result = await run();
    return Response.json(result.launch, { status: result.created ? 201 : 200 });
  } catch (error: unknown) {
    if (error instanceof TrustedAgentError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const boundaryResponse = requestValidationErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return examAttemptErrorResponse(error);
  }
}
