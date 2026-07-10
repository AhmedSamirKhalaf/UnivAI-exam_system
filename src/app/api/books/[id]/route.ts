import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Book } from "@/models/Book";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await connectDB();
    const { id } = await params;
    const book = await Book.findById(id);
    if (!book) {
      return Response.json({ error: "Book not found" }, { status: 404 });
    }
    return Response.json(book);
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
