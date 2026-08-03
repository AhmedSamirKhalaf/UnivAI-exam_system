import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import {
  finalPackageV1Schema,
  publishFinalPackage,
} from "@/lib/final-publication";
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
import { Chapter } from "@/models/Chapter";
import { Curriculum } from "@/models/Curriculum";

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
 * Publishes an agent-supplied FinalPackageV1 for a completed approved semester.
 * The Exam system never generates questions: the whole package is validated
 * against the separately approved assessment blueprint AND the resolved
 * curriculum weeks, then either published atomically or rejected with a
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
          { error: "A valid agent token is required to publish final packages" },
          { status: 401 },
        );
      }
    }

    const body = await parseJsonBody(request, finalPackageV1Schema);

    const blueprint = await AssessmentBlueprint.findById(body.blueprint_id).lean();
    if (!blueprint) {
      return Response.json(
        { error: "Assessment blueprint not found" },
        { status: 404 },
      );
    }

    const curriculum = await Curriculum.findById(body.curriculum_id).lean();
    if (!curriculum) {
      return Response.json(
        { error: "Curriculum not found" },
        { status: 404 },
      );
    }

    // The external truth for "completed semester": the curriculum's full chapter
    // set, ordered by chapter number. The package must cover exactly these weeks.
    const chapters = await Chapter.find({ curriculum_id: curriculum._id })
      .sort({ number: 1 })
      .lean();
    const resolvedSemesterWeeks = chapters
      .map((chapter) => (chapter.title ?? "").trim())
      .filter((title) => title.length > 0);

    const idempotencyKey = idempotencyKeyFromRequest(
      request,
      `final-publish:${body.package_id}`,
    );
    const fingerprint = JSON.stringify({
      package_id: body.package_id,
      blueprint_id: body.blueprint_id,
      curriculum_id: body.curriculum_id,
      learner_id: body.learner_id,
      plan_version: body.plan_version,
      semester_weeks: body.semester_weeks,
      question_ids: body.questions.map((question) => question.question_id).sort(),
    });

    const run = async () => {
      const receipt = await publishFinalPackage(body, blueprint, {
        curriculumId: curriculum._id,
        resolvedSemesterWeeks,
      });

      if (receipt.status === "rejected") {
        await writeAudit({
          actor: { type: "system", id: "final-agent-publisher" },
          action: "final.package_rejected",
          resource: { type: "blueprint", id: blueprint._id.toString() },
          metadata: {
            package_id: receipt.package_id,
            plan_version: receipt.plan_version,
            curriculum_id: receipt.curriculum_id,
            question_count: receipt.question_count,
            defect_codes: receipt.defects.map((defect) => defect.code),
          },
        });
        return receipt;
      }

      await writeAudit({
        actor: { type: "system", id: "final-agent-publisher" },
        action: "final.package_published",
        resource: { type: "blueprint", id: blueprint._id.toString() },
        metadata: {
          package_id: receipt.package_id,
          plan_version: receipt.plan_version,
          curriculum_id: receipt.curriculum_id,
          learner_id: receipt.learner_id,
          generator_prompt_id: receipt.generator_prompt_id,
          generator_prompt_version: receipt.generator_prompt_version,
          question_count: receipt.question_count,
          mcq_count: receipt.mcq_count,
          essay_count: receipt.essay_count,
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
        { error: "Invalid blueprint_id or curriculum_id" },
        { status: 400 },
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 },
    );
  }
}
