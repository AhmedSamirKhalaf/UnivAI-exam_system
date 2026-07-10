import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { createMid } from "@/lib/business-logic";
import { createMidSchema } from "@/schemas/createMid";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();

    const parsed = createMidSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues },
        { status: 400 }
      );
    }

    const result = await createMid(
      parsed.data.curriculum_id,
      parsed.data.title,
      parsed.data.chapter_ids,
      parsed.data.passing_mark
    );

    return Response.json(result, { status: 201 });
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
