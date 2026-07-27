import { connectDB } from "@/lib/db";
import { assertStandaloneRequest, isStandalone } from "@/lib/runtime";
import mongoose from "mongoose";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isStandalone()) return new Response("Not found", { status: 404 });
  try {
    assertStandaloneRequest(request);
    await connectDB();
    const captures = await mongoose.connection
      .collection("webhook_captures")
      .find({})
      .sort({ captured_at: -1 })
      .limit(20)
      .toArray();
    return Response.json({ captures });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 403 }
    );
  }
}
