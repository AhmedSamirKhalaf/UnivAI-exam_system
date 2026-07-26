import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Exam } from "@/models/Exam";

/**
 * POST /api/exams/[examId]/screenshot
 *
 * Webhook that receives a base64 screenshot taken when a screen-violation
 * is detected on the client. For now this is a placeholder that logs the
 * receipt and returns success. A real implementation would store the image
 * in cloud storage and link it to the exam session.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;
    const body = await request.json();

    const { student_id, image, violation_type, metadata } = body as {
      student_id?: string;
      image?: string;
      violation_type?: string;
      metadata?: Record<string, unknown>;
    };

    if (!student_id || !image) {
      return Response.json(
        { error: "student_id and image are required" },
        { status: 400 }
      );
    }

    const exam = await Exam.findById(examId);
    if (!exam) {
      return Response.json({ error: "Exam not found" }, { status: 404 });
    }

    // Placeholder: log receipt. Replace with cloud storage + DB record later.
    console.log(
      `[screenshot] exam=${examId} student=${student_id} type=${violation_type ?? "unknown"} imageSize=${image.length} metadata=`,
      metadata ?? {}
    );

    return Response.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
