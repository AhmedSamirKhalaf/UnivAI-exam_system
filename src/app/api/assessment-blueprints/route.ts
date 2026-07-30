import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db";
import { publishQuestions } from "@/lib/blueprint-validator";
import { AssessmentBlueprint } from "@/models/AssessmentBlueprint";
import { QuestionProvenance } from "@/models/QuestionProvenance";
import { assessmentBlueprintSchema } from "@/schemas/assessment-blueprint";

const publicationRequestSchema = z.object({
  blueprint_id: z
    .string()
    .refine((value) => mongoose.isValidObjectId(value), "Invalid blueprint_id"),
  questions: z.array(z.unknown()).min(1),
});

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = request.nextUrl;
    const query: Record<string, unknown> = {};

    for (const key of ["course_id", "plan_version", "programme"] as const) {
      const value = searchParams.get(key)?.trim();
      if (value) query[key] = value;
    }

    const approved = searchParams.get("approved");
    if (approved !== null) {
      if (approved !== "true" && approved !== "false") {
        return Response.json(
          { error: "approved must be true or false" },
          { status: 400 },
        );
      }
      query.approved = approved === "true";
    }

    const blueprints = await AssessmentBlueprint.find(query)
      .sort({ createdAt: -1 })
      .limit(100)
      .lean();
    return Response.json({ blueprints }, { status: 200 });
  } catch (error: unknown) {
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json().catch(() => null);
    const parseResult = assessmentBlueprintSchema.safeParse(body);
    if (!parseResult.success) {
      return Response.json(
        {
          error: "Invalid assessment blueprint schema",
          details: parseResult.error.issues,
        },
        { status: 400 },
      );
    }

    const blueprint = await AssessmentBlueprint.create(parseResult.data);
    return Response.json({ blueprint }, { status: 201 });
  } catch (error: unknown) {
    if (isDuplicateKeyError(error)) {
      return Response.json(
        {
          error:
            "A blueprint already exists for this programme, semester, course, and plan version",
        },
        { status: 409 },
      );
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}

/**
 * Publishes an immutable question set against an approved blueprint.
 * Untrusted questions cannot set approved=true; approval is added only after
 * strict plan, document, section, and page-range validation.
 */
export async function PUT(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json().catch(() => null);
    const requestResult = publicationRequestSchema.safeParse(body);
    if (!requestResult.success) {
      return Response.json(
        {
          error: "Invalid publication request",
          details: requestResult.error.issues,
        },
        { status: 400 },
      );
    }

    const blueprint = await AssessmentBlueprint.findById(
      requestResult.data.blueprint_id,
    ).lean();
    if (!blueprint) {
      return Response.json(
        { error: "Assessment blueprint not found" },
        { status: 404 },
      );
    }

    let published;
    try {
      published = publishQuestions(requestResult.data.questions, blueprint);
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : "Publication refused" },
        { status: 422 },
      );
    }

    const existingQuestion = await QuestionProvenance.exists({
      blueprint_id: blueprint._id,
      question_id: { $in: published.map((question) => question.question_id) },
    });
    if (existingQuestion) {
      return Response.json(
        {
          error:
            "One or more question IDs are already published for this blueprint",
        },
        { status: 409 },
      );
    }

    const questions = await QuestionProvenance.insertMany(
      published.map((question) => ({
        blueprint_id: blueprint._id,
        ...question,
      })),
      { ordered: true },
    );
    return Response.json({ questions }, { status: 201 });
  } catch (error: unknown) {
    if (isDuplicateKeyError(error)) {
      return Response.json(
        {
          error:
            "One or more question IDs are already published for this blueprint",
        },
        { status: 409 },
      );
    }
    return Response.json(
      {
        error:
          error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 },
    );
  }
}
