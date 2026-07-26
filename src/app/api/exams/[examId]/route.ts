import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Exam } from "@/models/Exam";
import { examToPlain } from "@/lib/business-logic";

/**
 * GET /api/exams/[examId]
 *
 * Without `?index=`  → returns exam metadata + question_count (no questions).
 * With    `?index=N` → returns exam metadata + the single question at index N
 *                      (correct_option stripped when the exam is still in-progress).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;
    const indexParam = request.nextUrl.searchParams.get("index");

    const exam = await Exam.findById(examId);
    if (!exam) {
      return Response.json({ error: "Exam not found" }, { status: 404 });
    }

    const plain = examToPlain(exam);
    const allQuestions = (plain.generated_questions ?? []) as Record<string, unknown>[];
    plain.question_count = allQuestions.length;

    if (indexParam !== null) {
      const idx = parseInt(indexParam, 10);
      if (isNaN(idx) || idx < 0 || idx >= allQuestions.length) {
        return Response.json(
          { error: "Invalid question index" },
          { status: 400 }
        );
      }

      const question = { ...allQuestions[idx] };
      if (!exam.taken) {
        delete question.correct_option;
      }
      plain.generated_questions = [question];
    } else {
      plain.generated_questions = undefined;
    }

    return Response.json(plain);
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
