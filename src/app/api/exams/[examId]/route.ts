import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Exam } from "@/models/Exam";
import {
  stripCorrectOption,
  examToPlain,
} from "@/lib/business-logic";

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

    let result = examToPlain(exam);
    if (!exam.taken) {
      result = stripCorrectOption(result);
    }

    return Response.json(result);
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
