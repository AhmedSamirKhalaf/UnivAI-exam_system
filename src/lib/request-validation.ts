import { z } from "zod";
import { IdempotencyError } from "./idempotency";
import { RateLimitError } from "./rate-limit";

/**
 * Request validation for public exam payloads.
 *
 * Every schema is `.strict()` so unknown fields are rejected instead of being
 * silently stripped, and string fields carry explicit size caps so oversized
 * input is refused before it reaches business logic.
 */

export const MAX_BODY_BYTES = 512 * 1024;

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

const practiceQuestionSchema = z
  .object({
    schema_version: z.literal("question-provenance-v1"),
    question_id: z.string().trim().min(1).max(160),
    prompt: z.string().trim().min(1).max(2_000),
    type: z.literal("mcq"),
    options: z.array(z.string().trim().min(1).max(1_000)).length(4),
    correct_option: z.string().trim().min(1).max(1_000),
    plan_version: z.string().trim().min(1).max(160),
    approved: z.literal(true),
    provenance: z.object({
      document_id: z.string().trim().min(1).max(160),
      document_title: z.string().trim().min(1).max(500),
      page_number: z.number().int().min(1),
      section: z.string().trim().min(1).max(500),
      excerpt: z.string().trim().min(1).max(2_000).optional(),
    }).strict(),
  })
  .strict()
  .superRefine((question, context) => {
    if (new Set(question.options).size !== question.options.length) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "Practice answer options must be unique",
      });
    }
    if (!question.options.includes(question.correct_option)) {
      context.addIssue({
        code: "custom",
        path: ["correct_option"],
        message: "correct_option must match one supplied option",
      });
    }
  });

export const startPracticeSchema = z
  .object({
    student_id: objectIdString,
    curriculum_id: objectIdString,
    chapter_id: objectIdString,
    student_sid: studentSidString,
    package_id: z.string().trim().min(8).max(160),
    title: z.string().trim().min(1).max(300),
    plan_version: z.string().trim().min(1).max(160),
    questions: z.array(practiceQuestionSchema).length(5),
  })
  .strict();

export const resumePracticeSchema = z
  .object({
    student_id: objectIdString,
    student_sid: studentSidString,
  })
  .strict();

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
    student_id: objectIdString.optional(),
    question_count: z.number().int().min(5).max(60).optional(),
    student_sid: studentSidString.optional(),
  })
  .strict();

export const startFinalSchema = z
  .object({
    student_id: objectIdString,
    curriculum_id: objectIdString,
    student_sid: studentSidString.optional(),
    final_form: z.enum(["primary", "retake"]),
    authorized_at: z.string().datetime({ offset: true }),
    access_opens_at: z.string().datetime({ offset: true }),
    access_expires_at: z.string().datetime({ offset: true }),
    retake_not_before: z.string().datetime({ offset: true }).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    const opensAt = new Date(value.access_opens_at);
    const expiresAt = new Date(value.access_expires_at);
    if (expiresAt <= opensAt) {
      context.addIssue({
        code: "custom",
        path: ["access_expires_at"],
        message: "access_expires_at must be after access_opens_at",
      });
    }
    if (value.final_form === "retake" && !value.retake_not_before) {
      context.addIssue({
        code: "custom",
        path: ["retake_not_before"],
        message: "Retake starts require retake_not_before",
      });
    }
  });

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
    student_id: objectIdString.optional(),
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
