import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  canStartFinal,
  startFinal,
  stripCorrectOption,
  examToPlain,
} from "@/lib/business-logic";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();
    const { student_id, curriculum_id } = body;

    if (!student_id || !curriculum_id) {
      return Response.json(
        { error: "student_id and curriculum_id are required" },
        { status: 400 }
      );
    }

    const check = await canStartFinal(student_id, curriculum_id);
    if (!check.allowed) {
      return Response.json({ error: check.reason }, { status: 403 });
    }

    const exam = await startFinal(student_id, curriculum_id);
    const safeExam = stripCorrectOption(examToPlain(exam));

    return Response.json(safeExam, { status: 200 });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
