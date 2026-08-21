import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  activateExamTimer,
  examAttemptErrorResponse,
  getExamAttemptView,
  requireExamAttempt,
} from "@/lib/exam-attempt";
import { finalizeExpiredTimedExam } from "@/lib/timed-exam";
import { examRateLimiter } from "@/lib/rate-limit";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  try {
    await connectDB();
    const { examId } = await params;
    await requireExamAttempt(request, examId);
    examRateLimiter.enforce({ kind: "session", id: examId });
    if (await finalizeExpiredTimedExam(examId)) {
      return Response.json(await getExamAttemptView(examId));
    }
    return Response.json(await activateExamTimer(examId));
  } catch (error: unknown) {
    return examAttemptErrorResponse(error);
  }
}

