import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Exam } from "@/models/Exam";
import {
  hasLearnerOwnedMidtermSnapshot,
  startMid,
} from "@/lib/business-logic";
import {
  createExamLaunch,
  ExamAttemptError,
  examAttemptErrorResponse,
} from "@/lib/exam-attempt";
import {
  parseJsonBody,
  requestValidationErrorResponse,
  startMidSchema,
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
    const body = await parseJsonBody(request, startMidSchema, {
      allowEmpty: true,
    });
    if (!body.student_id) {
      throw new ExamAttemptError("Authenticated student_id is required", 401);
    }
    const exam = await Exam.findById(examId).select(
      "student_id student_sid published_midterm_id questions_snapshot taken package_id package_version package_hash publication_key",
    );
    if (!exam) throw new ExamAttemptError("Exam not found", 404);
    if (exam.student_id.toString() !== body.student_id) {
      throw new ExamAttemptError("Exam does not belong to this student", 403);
    }
    if (
      hasLearnerOwnedMidtermSnapshot(exam) &&
      body.student_sid !== exam.student_sid
    ) {
      throw new ExamAttemptError("Midterm does not belong to this registration", 403);
    }
    if (
      (!exam.published_midterm_id && !hasLearnerOwnedMidtermSnapshot(exam)) ||
      !exam.questions_snapshot?.length
    ) {
      throw new ExamAttemptError("Midterm is not published", 409);
    }
    if (exam.taken) {
      throw new ExamAttemptError("Midterm attempt is already finalized", 409);
    }
    if (
      body.question_count !== undefined &&
      body.question_count !== exam.questions_snapshot.length
    ) {
      throw new ExamAttemptError(
        "question_count cannot change an immutable published midterm",
        409,
      );
    }
    examRateLimiter.enforce({ kind: "session", id: examId });

    const idempotencyKey = idempotencyKeyFromRequest(
      request,
      `mid-start:${examId}`,
    );
    const fingerprint = JSON.stringify({
      examId,
      student_id: body.student_id ?? null,
      question_count: body.question_count ?? null,
      student_sid: body.student_sid ?? null,
    });

    const run = async () => {
      const exam = await startMid(examId, body.question_count, body.student_sid);
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
