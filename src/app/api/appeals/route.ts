import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { resolveIntegrityAppeal } from "@/lib/business-logic";
import {
  parseJsonBody,
  requestValidationErrorResponse,
  resolveAppealSchema,
} from "@/lib/request-validation";
import { examRateLimiter } from "@/lib/rate-limit";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await parseJsonBody(request, resolveAppealSchema);
    examRateLimiter.enforce({ kind: "user", id: body.resolved_by });

    await resolveIntegrityAppeal(
      body.exam_id,
      body.resolution,
      body.resolved_by,
      body.note,
      body.allow_retake ?? false
    );

    return Response.json({ success: true }, { status: 200 });
  } catch (error: unknown) {
    const validationResponse = requestValidationErrorResponse(error);
    if (validationResponse) return validationResponse;
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
