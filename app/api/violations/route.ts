import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "fs/promises";
import { join } from "path";

export async function POST(req: NextRequest) {
  const { violations } = await req.json();
  const filePath = join(process.cwd(), "violations.json");
  await writeFile(filePath, JSON.stringify(violations, null, 2), "utf-8");
  return NextResponse.json({ ok: true });
}
