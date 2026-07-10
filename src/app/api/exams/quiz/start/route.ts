import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  canStartExam,
  startQuiz,
  stripCorrectOption,
  examToPlain,
} from "@/lib/business-logic";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();
    const { student_id, chapter_id } = body;

    if (!student_id || !chapter_id) {
      return Response.json(
        { error: "student_id and chapter_id are required" },
        { status: 400 }
      );
    }

    const check = await canStartExam(student_id, "quiz", chapter_id);
    if (!check.allowed) {
      return Response.json({ error: check.reason }, { status: 403 });
    }

    const { exam, created } = await startQuiz(student_id, chapter_id);
    const safeExam = stripCorrectOption(examToPlain(exam));

    return Response.json(safeExam, { status: created ? 201 : 200 });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
