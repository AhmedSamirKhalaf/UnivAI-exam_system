import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { resolveIntegrityAppeal } from "@/lib/business-logic";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();
    const { exam_id, resolution, resolved_by, note, allow_retake } = body;

    if (!exam_id || !resolution || !resolved_by) {
      return Response.json(
        {
          error: "exam_id, resolution, and resolved_by are required",
        },
        { status: 400 }
      );
    }

    if (!["upheld", "cleared"].includes(resolution)) {
      return Response.json(
        { error: 'resolution must be "upheld" or "cleared"' },
        { status: 400 }
      );
    }

    await resolveIntegrityAppeal(
      exam_id,
      resolution,
      resolved_by,
      note,
      allow_retake ?? false
    );

    return Response.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (
      message.includes("not found") ||
      message.includes("Integrity status") ||
      message.includes("must be")
    ) {
      return Response.json({ error: message }, { status: 400 });
    }
    return Response.json({ error: message }, { status: 500 });
  }
}
