import { describe, expect, test } from "vitest";
import { IdempotencyError } from "../../src/lib/idempotency";
import { RateLimitError } from "../../src/lib/rate-limit";
import {
  MAX_BODY_BYTES,
  RequestValidationError,
  gradeFinalSchema,
  parseJsonBody,
  proctoringEventSchema,
  requestValidationErrorResponse,
  startFinalSchema,
  startMidSchema,
  startQuizSchema,
} from "../../src/lib/request-validation";

const VALID_OBJECT_ID = "64b000000000000000000001";

function jsonRequest(body: unknown): Request {
  return new Request("http://localhost/api/exam", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function emptyRequest(): Request {
  return new Request("http://localhost/api/exam", { method: "POST" });
}

describe("request validation", () => {
  test("accepts a well-formed quiz start payload", async () => {
    const body = await parseJsonBody(
      jsonRequest({
        student_id: VALID_OBJECT_ID,
        chapter_id: VALID_OBJECT_ID,
        question_count: 5,
        student_sid: "S-2026-000042",
      }),
      startQuizSchema,
    );
    expect(body).toMatchObject({ student_id: VALID_OBJECT_ID, chapter_id: VALID_OBJECT_ID });
  });

  test("rejects unknown fields instead of silently stripping them", async () => {
    await expect(
      parseJsonBody(
        jsonRequest({
          student_id: VALID_OBJECT_ID,
          chapter_id: VALID_OBJECT_ID,
          admin_bypass: true,
        }),
        startQuizSchema,
      ),
    ).rejects.toThrow(/Unknown fields are not allowed/);
  });

  test("rejects oversized fields", async () => {
    await expect(
      parseJsonBody(
        jsonRequest({
          student_id: "x".repeat(200),
          chapter_id: VALID_OBJECT_ID,
        }),
        startQuizSchema,
      ),
    ).rejects.toThrow(RequestValidationError);
  });

  test("rejects malformed ObjectIds", async () => {
    await expect(
      parseJsonBody(
        jsonRequest({
          student_id: "not-an-object-id",
          chapter_id: VALID_OBJECT_ID,
        }),
        startQuizSchema,
      ),
    ).rejects.toThrow(RequestValidationError);
  });

  test("rejects non-JSON bodies", async () => {
    const request = new Request("http://localhost/api/exam", {
      method: "POST",
      body: "this is not json{",
    });
    await expect(parseJsonBody(request, startQuizSchema)).rejects.toThrow(
      /must be valid JSON/,
    );
  });

  test("rejects an empty body by default", async () => {
    await expect(parseJsonBody(emptyRequest(), startQuizSchema)).rejects.toThrow(
      /Request body is required/,
    );
  });

  test("treats an empty body as {} when allowEmpty is set", async () => {
    const body = await parseJsonBody(emptyRequest(), startMidSchema, {
      allowEmpty: true,
    });
    expect(body).toEqual({});
  });

  test("validates the legacy student identity on mid-start payloads", async () => {
    const body = await parseJsonBody(
      jsonRequest({ student_id: VALID_OBJECT_ID }),
      startMidSchema,
    );
    expect(body.student_id).toBe(VALID_OBJECT_ID);

    await expect(
      parseJsonBody(jsonRequest({ student_id: "not-an-id" }), startMidSchema),
    ).rejects.toThrow(RequestValidationError);
  });

  test("rejects oversized bodies", async () => {
    const oversized = "z".repeat(MAX_BODY_BYTES + 1);
    const request = new Request("http://localhost/api/exam", {
      method: "POST",
      body: oversized,
    });
    await expect(parseJsonBody(request, startQuizSchema)).rejects.toThrow(
      /exceeds/,
    );
  });

  test("rejects out-of-range mark in grade payload", async () => {
    await expect(
      parseJsonBody(
        jsonRequest({ mark: 101, graded_by: "Dr. A" }),
        gradeFinalSchema,
      ),
    ).rejects.toThrow(RequestValidationError);
  });

  test("proctoring schema rejects unknown event metadata types", async () => {
    await expect(
      parseJsonBody(
        jsonRequest({
          type: "tab_switch",
          metadata: { payload: { nested: true } },
        }),
        proctoringEventSchema,
      ),
    ).rejects.toThrow(RequestValidationError);
  });

  test("final start schema rejects a missing curriculum_id", async () => {
    await expect(
      parseJsonBody(jsonRequest({ student_id: VALID_OBJECT_ID }), startFinalSchema),
    ).rejects.toThrow(RequestValidationError);
  });

  test("requestValidationErrorResponse maps to a 400 Response", async () => {
    try {
      await parseJsonBody(
        jsonRequest({ student_id: VALID_OBJECT_ID, stray: 1 }),
        startFinalSchema,
      );
      throw new Error("should not reach");
    } catch (error) {
      const response = requestValidationErrorResponse(error);
      expect(response).not.toBeNull();
      expect(response!.status).toBe(400);
      const payload = await response!.json();
      expect(payload.error).toMatch(/Unknown fields are not allowed/);
    }
  });

  test("validates the legacy student identity on proctoring events", async () => {
    const body = await parseJsonBody(
      jsonRequest({ type: "tab_switch", student_id: VALID_OBJECT_ID }),
      proctoringEventSchema,
    );
    expect(body.student_id).toBe(VALID_OBJECT_ID);
  });

  test("maps rate limits and idempotency failures to their public statuses", () => {
    const limited = requestValidationErrorResponse(new RateLimitError(1500));
    expect(limited?.status).toBe(429);
    expect(limited?.headers.get("Retry-After")).toBe("2");

    const replay = requestValidationErrorResponse(
      new IdempotencyError("conflict", 422),
    );
    expect(replay?.status).toBe(422);
  });

});
