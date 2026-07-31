import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  examAttemptErrorResponse,
  getExamAttemptView,
  requireExamAttempt,
} from "@/lib/exam-attempt";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;
    const session = await requireExamAttempt(_request, examId);
    return Response.json(await getExamAttemptView(examId, session));
  } catch (error: unknown) {
    return examAttemptErrorResponse(error);
  }
}
