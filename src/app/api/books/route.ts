import { NextRequest } from "next/server";
import { connectDB } from "@/lib/db";
import { Book } from "@/models/Book";
import { processBook } from "@/lib/business-logic";

export async function POST(request: NextRequest) {
  try {
    await connectDB();
    const body = await request.json();
    const { title, student_id, storage_path, original_filename } = body;

    if (!title || !storage_path || !original_filename) {
      return Response.json(
        { error: "title, storage_path, and original_filename are required" },
        { status: 400 }
      );
    }

    const book = await Book.create({
      title,
      original_filename,
      storage_path,
      status: "uploaded",
      requested_by_student_id: student_id || undefined,
    });

    await processBook(book._id, student_id || undefined);

    const updatedBook = await Book.findById(book._id);
    return Response.json(updatedBook, { status: 201 });
  } catch (error: unknown) {
    return Response.json({ error: error instanceof Error ? error.message : "Unknown error" }, { status: 500 });
  }
}
