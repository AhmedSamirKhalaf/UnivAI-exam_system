import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Exam } from "@/models/Exam";
import {
  recordDiscreteEvent,
  recordCameraEvent,
} from "@/lib/business-logic";
import { examAttemptErrorResponse, requireExamAttempt } from "@/lib/exam-attempt";
import {
  parseJsonBody,
  proctoringEventSchema,
  requestValidationErrorResponse,
} from "@/lib/request-validation";
import { examRateLimiter } from "@/lib/rate-limit";

const CAMERA_EVENT_TYPES = ["no_face", "multiple_faces"];

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ examId: string }> }
) {
  try {
    await connectDB();
    const { examId } = await params;
    const session = await requireExamAttempt(request, examId);
    examRateLimiter.enforce({ kind: "session", id: examId });
    const body = await parseJsonBody(request, proctoringEventSchema);

    if (CAMERA_EVENT_TYPES.includes(body.type)) {
      const exam = await Exam.findById(examId);
      if (!exam) {
        return Response.json({ error: "Exam not found" }, { status: 404 });
      }
      await recordCameraEvent(
        examId,
        session?.student_id ?? exam.student_id,
        body.type as "no_face" | "multiple_faces",
        body.detected ?? true
      );
    } else {
      if (!session) {
        return Response.json({ error: "Exam session not found" }, { status: 409 });
      }
      await recordDiscreteEvent(examId, session.student_id, body.type, body.metadata);
    }

    return Response.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    const validationResponse = requestValidationErrorResponse(error);
    if (validationResponse) return validationResponse;
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
