import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import {
  startMid,
  stripCorrectOption,
  examToPlain,
} from "@/lib/business-logic";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;

    const exam = await startMid(examId);
    const safeExam = stripCorrectOption(examToPlain(exam));

    return Response.json(safeExam, { status: 200 });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
