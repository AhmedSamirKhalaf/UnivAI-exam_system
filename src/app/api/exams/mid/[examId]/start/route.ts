import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  startMid,
} from "@/lib/business-logic";
import { createExamLaunch, examAttemptErrorResponse } from "@/lib/exam-attempt";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;
    const body = await request.json().catch(() => ({}));

    const exam = await startMid(examId, body?.question_count, body?.student_sid);
    return Response.json(
      await createExamLaunch(exam, request.nextUrl.origin),
      { status: 200 },
    );
  } catch (error: unknown) {
    return examAttemptErrorResponse(error);
  }
}
