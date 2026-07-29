import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { AssessmentBlueprint } from "@/models/AssessmentBlueprint";
import { assessmentBlueprintSchema } from "@/schemas/assessment-blueprint";

export async function GET(request: NextRequest) {
  try {
    await connectDB();
    const { searchParams } = new URL(request.url);
    const course_id = searchParams.get("course_id");
    const plan_version = searchParams.get("plan_version");
    const programme = searchParams.get("programme");

    const query: Record<string, unknown> = {};
    if (course_id) query.course_id = course_id;
    if (plan_version) query.plan_version = plan_version;
    if (programme) query.programme = programme;

    const blueprints = await AssessmentBlueprint.find(query).sort({ createdAt: -1 });
    return Response.json(blueprints, { status: 200 });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();

    const parseResult = assessmentBlueprintSchema.safeParse(body);
    if (!parseResult.success) {
      return Response.json(
        {
          error: "Invalid assessment blueprint schema",
          details: parseResult.error.issues,
        },
        { status: 400 }
      );
    }

    const blueprint = await AssessmentBlueprint.create(parseResult.data);
    return Response.json(blueprint, { status: 201 });
  } catch (error: unknown) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Internal server error" },
      { status: 500 }
    );
  }
}
