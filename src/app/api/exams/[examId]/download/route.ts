import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Exam } from "@/models/Exam";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;

    const exam = await Exam.findById(examId);
    if (!exam) {
      return Response.json({ error: "Exam not found" }, { status: 404 });
    }

    const payload = {
      title: exam.title,
      type: exam.type,
      student_id: exam.student_id,
      mark: exam.mark,
      passed: exam.passed,
      grading_status: exam.grading_status,
      generated_questions: exam.generated_questions,
      student_answers: exam.student_answers,
      submitted_at: exam.updatedAt,
    };

    return Response.json(payload, {
      status: 200,
      headers: {
        "Content-Disposition": `attachment; filename="exam-${examId}.json"`,
      },
    });
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
