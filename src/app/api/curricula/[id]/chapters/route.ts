import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Chapter } from "@/models/Chapter";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectDB();
    const { id } = await params;
    const chapters = await Chapter.find({ curriculum_id: id }).sort({
      number: 1,
    });
    return Response.json(chapters);
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
