import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  canStartFinal,
  startFinal,
} from "@/lib/business-logic";
import { createExamLaunch, examAttemptErrorResponse } from "@/lib/exam-attempt";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();
    const { student_id, curriculum_id, student_sid } = body;

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

    const exam = await startFinal(student_id, curriculum_id, student_sid);
    return Response.json(
      await createExamLaunch(exam, request.nextUrl.origin),
      { status: 200 },
    );
  } catch (error: unknown) {
    return examAttemptErrorResponse(error);
  }
}
