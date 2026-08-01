import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  answerCurrentQuestionSchema,
  examAttemptErrorResponse,
  requireExamAttempt,
  saveCurrentAnswer,
} from "@/lib/exam-attempt";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> },
) {
  try {
    await connectDB();
    const { examId } = await params;
    await requireExamAttempt(request, examId);
    const input = answerCurrentQuestionSchema.parse(await request.json());
    return Response.json(await saveCurrentAnswer(examId, input));
  } catch (error: unknown) {
    return examAttemptErrorResponse(error);
  }
}
