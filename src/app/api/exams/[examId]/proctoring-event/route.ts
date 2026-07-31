import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Exam } from "@/models/Exam";
import {
  recordDiscreteEvent,
  recordCameraEvent,
} from "@/lib/business-logic";
import { examAttemptErrorResponse, requireExamAttempt } from "@/lib/exam-attempt";

const CAMERA_EVENT_TYPES = ["no_face", "multiple_faces"];
const DISCRETE_EVENT_TYPES = [
  "fullscreen_exit",
  "tab_switch",
  "copy_paste",
  "devtools_open",
];
const ALL_EVENT_TYPES = [...CAMERA_EVENT_TYPES, ...DISCRETE_EVENT_TYPES];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;
    const session = await requireExamAttempt(request, examId);
    const body = await request.json();
    const { type, detected, metadata } = body;

    if (!type) {
      return Response.json(
        { error: "type is required" },
        { status: 400 }
      );
    }

    if (!ALL_EVENT_TYPES.includes(type)) {
      return Response.json(
        { error: `Invalid proctoring event type: ${type}` },
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
        session?.student_id ?? exam.student_id,
        type as "no_face" | "multiple_faces",
        detected ?? true
      );
    } else {
      if (!session) {
        return Response.json({ error: "Exam session not found" }, { status: 409 });
      }
      await recordDiscreteEvent(examId, session.student_id, type, metadata);
    }

    return Response.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (
      message.includes("not allowed") ||
      message.includes("not found") ||
      message.includes("Expected") ||
      message.includes("No open session")
    ) {
      return Response.json({ error: message }, { status: 400 });
    }
    return examAttemptErrorResponse(error);
  }
}
