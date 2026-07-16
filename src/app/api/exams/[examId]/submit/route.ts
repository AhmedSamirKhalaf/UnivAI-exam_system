import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { submitExam, examToPlain } from "@/lib/business-logic";
import { sendResultWebhook } from "@/lib/report-webhook";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;
    const body = await request.json();
    const { student_answers } = body;

    if (!student_answers) {
      return Response.json(
        { error: "student_answers are required" },
        { status: 400 }
      );
    }

    const exam = await submitExam(examId, student_answers);

    // Result + proctoring report go back to the UnivAI app. Fire-and-forget:
    // a dead webhook must never break a student's submission.
    void sendResultWebhook(exam);

    const plain = examToPlain(exam);
    return Response.json(plain, { status: 200 });
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
