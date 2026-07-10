import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Enrollment } from "@/models/Enrollment";
import { enrollmentSchema } from "@/schemas/enrollment";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();

    const parsed = enrollmentSchema.safeParse(body);
    if (!parsed.success) {
      return Response.json(
        { error: parsed.error.issues },
        { status: 400 }
      );
    }

    const enrollment = await Enrollment.create(parsed.data);
    return Response.json(enrollment, { status: 201 });
  } catch (error: unknown) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as Record<string, unknown>).code === 11000
    ) {
      return Response.json(
        { error: "Student is already enrolled in this curriculum" },
        { status: 409 }
      );
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}
