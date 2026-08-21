import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  examAttemptErrorResponse,
  getExamAttemptView,
  requireExamAttempt,
} from "@/lib/exam-attempt";
import { finalizeExpiredTimedExam } from "@/lib/timed-exam";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;
    await requireExamAttempt(_request, examId);
    await finalizeExpiredTimedExam(examId);
    return Response.json(await getExamAttemptView(examId));
  } catch (error: unknown) {
    return examAttemptErrorResponse(error);
  }
}
