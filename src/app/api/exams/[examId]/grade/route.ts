import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { gradeFinal } from "@/lib/business-logic";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;
    const body = await request.json();
    const { mark, graded_by, reason, is_regrade } = body;

    if (mark === undefined || !graded_by) {
      return Response.json(
        { error: "mark and graded_by are required" },
        { status: 400 }
      );
    }

    await gradeFinal(examId, mark, graded_by, reason, is_regrade ?? false);

    return Response.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
