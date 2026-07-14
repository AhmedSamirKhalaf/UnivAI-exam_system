import { NextResponse } from "next/server";
import { questions } from "@/app/data/questions";

export async function GET() {
  const safe = questions.map(({ id, text, options }) => ({
    id,
    text,
    options,
  }));
  return NextResponse.json(safe);
}
