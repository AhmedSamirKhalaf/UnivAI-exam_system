import { createHmac, timingSafeEqual } from "node:crypto";

export type RuntimeMode = "standalone" | "integrated";

export function runtimeMode(): RuntimeMode {
  const raw = (process.env.UNIVAI_MODE ?? "integrated").trim().toLowerCase();
  if (raw !== "standalone" && raw !== "integrated") {
    throw new Error("UNIVAI_MODE must be standalone or integrated");
  }
  if (raw === "standalone" && process.env.NODE_ENV === "production") {
    throw new Error("Standalone Exam features are disabled in production");
  }
  return raw;
}

export function isStandalone(): boolean {
  return runtimeMode() === "standalone";
}

export const STANDALONE_STUDENT_ID = "64b000000000000000000001";
export const STANDALONE_SEED_VERSION = "exam-standalone-v1";

function devSecret(): string {
  return process.env.UNIVAI_STANDALONE_SECRET ?? "univai-exam-local-development-only";
}

export function standaloneToken(studentId = STANDALONE_STUDENT_ID): string {
  if (!isStandalone()) throw new Error("Standalone identity is unavailable");
  return createHmac("sha256", devSecret()).update(studentId).digest("hex");
}

export function verifyStandaloneToken(
  token: string | null,
  studentId = STANDALONE_STUDENT_ID
): boolean {
  if (!isStandalone() || !token) return false;
  const expected = Buffer.from(standaloneToken(studentId));
  const received = Buffer.from(token);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function assertStandaloneRequest(request: Request): void {
  if (!isStandalone()) return;
  const url = new URL(request.url);
  const token =
    request.headers.get("x-univai-dev-token") ?? url.searchParams.get("dev_token");
  if (!verifyStandaloneToken(token)) {
    throw new Error("Valid standalone development identity is required");
  }
}
