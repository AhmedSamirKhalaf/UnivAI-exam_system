import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  answerCurrentQuestionSchema,
  examAttemptErrorResponse,
  requireExamAttempt,
  saveCurrentAnswer,
} from "@/lib/exam-attempt";
import { examRateLimiter } from "@/lib/rate-limit";
import {
  parseJsonBody,
  requestValidationErrorResponse,
} from "@/lib/request-validation";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  try {
    await connectDB();
    const { examId } = await params;
    await requireExamAttempt(request, examId);
    examRateLimiter.enforce({ kind: "session", id: examId });
    const input = await parseJsonBody(request, answerCurrentQuestionSchema);
    return Response.json(await saveCurrentAnswer(examId, input));
  } catch (error: unknown) {
    const boundaryResponse = requestValidationErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return examAttemptErrorResponse(error);
  }
}
