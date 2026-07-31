import { access } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

describe("Exam repository", () => {
  it.each([
    "src/app/exam/[examId]/page.tsx",
    "src/app/api/books/route.ts",
    "src/lib/business-logic.ts",
    "src/models/Exam.ts",
    "src/schemas/exam.ts",
  ])("contains %s", async (relativePath) => {
    await expect(access(path.join(root, relativePath))).resolves.toBeUndefined();
  });
});
