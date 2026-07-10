import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Exam } from "@/models/Exam";
import {
  recordDiscreteEvent,
  recordCameraEvent,
} from "@/lib/business-logic";

const CAMERA_EVENT_TYPES = ["no_face", "multiple_faces"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;
    const body = await request.json();
    const { type, student_id, detected, metadata } = body;

    if (!type || !student_id) {
      return Response.json(
        { error: "type and student_id are required" },
        { status: 400 }
      );
    }

    if (CAMERA_EVENT_TYPES.includes(type)) {
      const exam = await Exam.findById(examId);
      if (!exam) {
        return Response.json({ error: "Exam not found" }, { status: 404 });
      }
      await recordCameraEvent(
        examId,
        student_id,
        type as "no_face" | "multiple_faces",
        detected ?? true
      );
    } else {
      await recordDiscreteEvent(examId, student_id, type, metadata);
    }

    return Response.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
