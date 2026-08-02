import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { IdempotencyError } from "./idempotency";
import { RateLimitError } from "./rate-limit";
import { assertStandaloneRequest, isStandalone } from "./runtime";

/**
 * Request validation for public exam payloads.
 *
 * Every schema is `.strict()` so unknown fields are rejected instead of being
 * silently stripped, and string fields carry explicit size caps so oversized
 * input is refused before it reaches business logic.
 */

export const MAX_BODY_BYTES = 512 * 1024;
const MIN_SERVICE_TOKEN_LENGTH = 32;

export class RequestValidationError extends Error {
  readonly issues?: z.ZodIssue[];
  constructor(message: string, readonly status = 400, issues?: z.ZodIssue[]) {
    super(message);
    this.name = "RequestValidationError";
    if (issues) this.issues = issues;
  }
}

const objectIdString = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Expected a 24-character ObjectId");

const studentSidString = z.string().trim().min(1).max(120);
const shortName = z.string().trim().min(1).max(120);
const noteString = z.string().trim().min(1).max(2000);

function equalSecret(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export function trustedServiceAuthConfigured(): boolean {
  if (isStandalone()) return true;
  return (process.env.UNIVAI_EXAM_API_TOKEN?.trim().length ?? 0) >=
    MIN_SERVICE_TOKEN_LENGTH;
}

/** Protect state-changing service routes from direct browser callers. */
export function requireTrustedService(request: Request): void {
  if (isStandalone()) {
    try {
      assertStandaloneRequest(request);
      return;
    } catch {
      throw new RequestValidationError("Trusted service authentication failed", 401);
    }
  }

  const configured = process.env.UNIVAI_EXAM_API_TOKEN?.trim();
  if (!configured || configured.length < MIN_SERVICE_TOKEN_LENGTH) {
    throw new RequestValidationError(
      "Trusted exam API authentication is not configured",
      503,
    );
  }

  const authorization = request.headers.get("authorization");
  const supplied = authorization?.startsWith("Bearer ")
    ? authorization.slice("Bearer ".length).trim()
    : "";
  if (!supplied || !equalSecret(supplied, configured)) {
    throw new RequestValidationError("Trusted service authentication failed", 401);
  }
}

export const startQuizSchema = z
  .object({
    student_id: objectIdString,
    chapter_id: objectIdString,
    question_count: z.number().int().min(3).max(30).optional(),
    student_sid: studentSidString.optional(),
  })
  .strict();

export const startMidSchema = z
  .object({
    question_count: z.number().int().min(5).max(60).optional(),
    student_sid: studentSidString.optional(),
  })
  .strict();

export const startFinalSchema = z
  .object({
    student_id: objectIdString,
    curriculum_id: objectIdString,
    student_sid: studentSidString.optional(),
  })
  .strict();

export const gradeFinalSchema = z
  .object({
    mark: z.number().int().min(0).max(100),
    graded_by: shortName,
    reason: noteString.optional(),
    is_regrade: z.boolean().optional(),
  })
  .strict();

export const proctoringEventSchema = z
  .object({
    type: z.enum([
      "no_face",
      "multiple_faces",
      "fullscreen_exit",
      "tab_switch",
      "copy_paste",
      "devtools_open",
    ]),
    detected: z.boolean().optional(),
    metadata: z
      .record(
        z.string(),
        z.union([z.string().max(2000), z.number(), z.boolean(), z.null()]),
      )
      .refine((m) => Object.keys(m).length <= 16, {
        message: "metadata has too many keys",
      })
      .optional(),
  })
  .strict();

export const resolveAppealSchema = z
  .object({
    exam_id: objectIdString,
    resolution: z.enum(["upheld", "cleared"]),
    resolved_by: shortName,
    note: noteString.optional(),
    allow_retake: z.boolean().optional(),
  })
  .strict();

/**
 * Reads and validates a JSON request body against an explicit schema.
 * Empty or non-JSON bodies and oversized bodies are rejected uniformly.
 * When `allowEmpty` is set, an empty body is treated as `{}` (used by routes
 * that intentionally accept an optional body).
 */
export async function parseJsonBody<T extends z.ZodType>(
  request: Request,
  schema: T,
  options: { allowEmpty?: boolean } = {},
): Promise<z.infer<T>> {
  let raw: string;
  try {
    raw = await request.text();
  } catch {
    throw new RequestValidationError("Request body could not be read");
  }

  if (raw.trim().length === 0) {
    if (options.allowEmpty) return schema.parse({}) as z.infer<T>;
    throw new RequestValidationError("Request body is required");
  }

  if (raw.length > MAX_BODY_BYTES) {
    throw new RequestValidationError(
      `Request body exceeds ${MAX_BODY_BYTES} bytes`,
      413,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RequestValidationError("Request body must be valid JSON");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    const unknownKeys = result.error.issues
      .filter((issue) => issue.code === "unrecognized_keys")
      .flatMap((issue) =>
        "keys" in issue
          ? (issue.keys as string[]).map((key) => `${issue.path.join(".")}.${key}`)
          : [],
      );
    const message = unknownKeys.length
      ? `Unknown fields are not allowed: ${unknownKeys.join(", ")}`
      : "Request failed validation";
    throw new RequestValidationError(message, 400, result.error.issues);
  }

  return result.data as z.infer<T>;
}

export function requestValidationErrorResponse(error: unknown): Response | null {
  if (error instanceof RateLimitError) {
    return Response.json(
      { error: error.message },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))),
        },
      },
    );
  }
  if (error instanceof IdempotencyError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (!(error instanceof RequestValidationError)) return null;
  return Response.json(
    {
      error: error.message,
      ...(error.issues ? { details: error.issues } : {}),
    },
    { status: error.status },
  );
}
