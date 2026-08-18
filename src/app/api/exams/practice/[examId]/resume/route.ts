import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { resumePractice } from "@/lib/business-logic";
import { createExamLaunch, examAttemptErrorResponse } from "@/lib/exam-attempt";
import {
  parseJsonBody,
  requestValidationErrorResponse,
  resumePracticeSchema,
} from "@/lib/request-validation";
import { requireTrustedAgentRequest, TrustedAgentError } from "@/lib/trusted-agent";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ examId: string }> },
) {
  try {
    requireTrustedAgentRequest(request);
    await connectDB();
    const { examId } = await context.params;
    if (!/^[0-9a-f]{24}$/i.test(examId)) {
      return Response.json({ error: "Invalid practice attempt" }, { status: 400 });
    }
    const body = await parseJsonBody(request, resumePracticeSchema);
    const exam = await resumePractice(examId, body.student_id, body.student_sid);
    return Response.json(await createExamLaunch(exam, request.nextUrl.origin));
  } catch (error: unknown) {
    if (error instanceof TrustedAgentError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    const boundaryResponse = requestValidationErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return examAttemptErrorResponse(error);
  }
}
