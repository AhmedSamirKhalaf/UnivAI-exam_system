import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { quizPackageV1Schema } from "@/lib/quiz-publication";
import { publishQuizPackage } from "@/lib/quiz-publication";
import { writeAudit } from "@/lib/audit-log";
import {
  parseJsonBody,
  requestValidationErrorResponse,
} from "@/lib/request-validation";
import {
  idempotencyKeyFromRequest,
  MongoIdempotencyStore,
  withIdempotency,
} from "@/lib/idempotency";
import { assertStandaloneRequest, isStandalone } from "@/lib/runtime";
import { AssessmentBlueprint } from "@/models/AssessmentBlueprint";

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * Publishes an agent-supplied QuizPackageV1. The Exam system never generates
 * questions: the whole package is validated against the separately approved
 * assessment blueprint and either published atomically or rejected with a
 * machine-readable receipt. Nothing is persisted for a rejected package.
 */
export async function POST(request: NextRequest) {
  try {
    await connectDB();

    if (isStandalone()) {
      assertStandaloneRequest(request);
    } else {
      const secret = process.env.UNIVAI_AGENT_SECRET;
      const provided = request.headers.get("x-univai-agent-token");
      if (!secret || !provided || !safeEqual(digest(provided), digest(secret))) {
        return Response.json(
          { error: "A valid agent token is required to publish quiz packages" },
          { status: 401 },
        );
      }
    }

    const body = await parseJsonBody(request, quizPackageV1Schema);

    const blueprint = await AssessmentBlueprint.findById(body.blueprint_id).lean();
    if (!blueprint) {
      return Response.json(
        { error: "Assessment blueprint not found" },
        { status: 404 },
      );
    }

    const idempotencyKey = idempotencyKeyFromRequest(
      request,
      `quiz-publish:${body.package_id}`,
    );
    const fingerprint = JSON.stringify({
      package_id: body.package_id,
      blueprint_id: body.blueprint_id,
      learner_id: body.learner_id,
      plan_version: body.plan_version,
      question_ids: body.questions.map((question) => question.question_id).sort(),
    });

    const run = async () => {
      const receipt = await publishQuizPackage(body, blueprint);

      if (receipt.status === "rejected") {
        await writeAudit({
          actor: { type: "system", id: "quiz-agent-publisher" },
          action: "quiz.package_rejected",
          resource: { type: "blueprint", id: blueprint._id.toString() },
          metadata: {
            package_id: receipt.package_id,
            plan_version: receipt.plan_version,
            question_count: receipt.question_count,
            defect_codes: receipt.defects.map((defect) => defect.code),
          },
        });
        return receipt;
      }

      await writeAudit({
        actor: { type: "system", id: "quiz-agent-publisher" },
        action: "quiz.package_published",
        resource: { type: "blueprint", id: blueprint._id.toString() },
        metadata: {
          package_id: receipt.package_id,
          plan_version: receipt.plan_version,
          chapter_id: receipt.chapter_id,
          learner_id: receipt.learner_id,
          generator_prompt_id: receipt.generator_prompt_id,
          generator_prompt_version: receipt.generator_prompt_version,
          question_count: receipt.question_count,
          published_ids: receipt.published_ids,
          idempotent: receipt.idempotent,
        },
      });

      return receipt;
    };

    if (idempotencyKey) {
      const { result, idempotent } = await withIdempotency(
        new MongoIdempotencyStore(),
        idempotencyKey,
        fingerprint,
        run,
      );
      return Response.json(result, {
        status: result.status === "rejected" ? 422 : idempotent ? 200 : 201,
      });
    }

    const result = await run();
    return Response.json(result, {
      status: result.status === "rejected" ? 422 : 201,
    });
  } catch (error: unknown) {
    const boundaryResponse = requestValidationErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    if (
      typeof error === "object" &&
      error !== null &&
      (error as { code?: number }).code === 11000
    ) {
      return Response.json(
        { error: "One or more question IDs are already published for this blueprint" },
        { status: 409 },
      );
    }
    if (error instanceof mongoose.Error.CastError) {
      return Response.json(
        { error: "Invalid blueprint_id" },
        { status: 400 },
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
