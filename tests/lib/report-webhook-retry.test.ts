import mongoose from "mongoose";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findOneAndUpdateExam: vi.fn(),
  updateExam: vi.fn(),
  findExams: vi.fn(),
  findSession: vi.fn(),
  findEvents: vi.fn(),
  sortEvents: vi.fn(),
  isStandalone: vi.fn(),
}));

vi.mock("../../src/models/Exam", () => ({
  Exam: {
    findOneAndUpdate: mocks.findOneAndUpdateExam,
    updateOne: mocks.updateExam,
    find: mocks.findExams,
  },
}));
vi.mock("../../src/models/ExamSession", () => ({
  ExamSession: { findOne: mocks.findSession },
}));
vi.mock("../../src/models/ProctoringEvent", () => ({
  ProctoringEvent: { find: mocks.findEvents },
}));
vi.mock("../../src/lib/runtime", () => ({
  isStandalone: mocks.isStandalone,
}));

import {
  resultMaximumScore,
  retryPendingResultWebhooks,
  sendResultWebhook,
} from "../../src/lib/report-webhook";

const examId = new mongoose.Types.ObjectId();
const studentId = new mongoose.Types.ObjectId();

function queuedExam(attempts: number) {
  return {
    _id: examId,
    type: "final",
    title: "Final",
    student_id: studentId,
    student_sid: "S-1",
    attempt_number: 2,
    final_form: "retake",
    generated_questions: [{ question_id: "q1", type: "essay" }],
    mark: 80,
    passing_mark: 70,
    passed: true,
    grading_status: "graded",
    integrity_status: "clean",
    policy_action: "none",
    review_status: "not_required",
    result_webhook_version: 1,
    result_webhook_delivered_version: 0,
    result_webhook_attempts: attempts,
  };
}

describe("durable result webhook retry", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RESULT_WEBHOOK_URL = "https://app.example.test/exam-result";
    process.env.EXAM_CALLBACK_SECRET = "test-secret";
    mocks.isStandalone.mockReturnValue(false);
    mocks.findSession.mockResolvedValue({
      suspicion_score: 0,
      flagged: false,
      status: "completed",
      started_at: new Date("2026-08-10T10:00:00.000Z"),
      ended_at: new Date("2026-08-10T11:00:00.000Z"),
    });
    mocks.sortEvents.mockResolvedValue([]);
    mocks.findEvents.mockReturnValue({ sort: mocks.sortEvents });
    mocks.updateExam.mockResolvedValue({ modifiedCount: 1 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.RESULT_WEBHOOK_URL;
    delete process.env.EXAM_CALLBACK_SECRET;
  });

  test("uses question count for objective exams and 100 for manual finals", () => {
    expect(
      resultMaximumScore({
        type: "final",
        generated_questions: [
          { question_id: "q1", type: "mcq" },
          { question_id: "q2", type: "mcq" },
        ],
      } as never),
    ).toBe(2);
    expect(resultMaximumScore(queuedExam(0) as never)).toBe(100);
  });

  test("keeps a failed delivery pending and retries the same idempotent revision", async () => {
    const firstClaim = queuedExam(1);
    const retryClaim = queuedExam(2);
    mocks.findOneAndUpdateExam
      .mockResolvedValueOnce(firstClaim)
      .mockResolvedValueOnce(retryClaim);
    mocks.findExams.mockReturnValue({
      select: () => ({
        limit: async () => [
          { _id: examId, result_webhook_version: 1 },
        ],
      }),
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await sendResultWebhook(firstClaim as never);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.updateExam).toHaveBeenCalledWith(
      { _id: examId, result_webhook_version: 1 },
      expect.objectContaining({
        $set: expect.objectContaining({
          result_webhook_next_attempt_at: expect.any(Date),
          result_webhook_last_error: expect.stringContaining("503"),
        }),
      }),
    );

    await retryPendingResultWebhooks();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstHeaders = fetchMock.mock.calls[0][1].headers;
    const retryHeaders = fetchMock.mock.calls[1][1].headers;
    expect(firstHeaders["Idempotency-Key"]).toBe(
      `exam-result-${examId.toString()}-1`,
    );
    expect(retryHeaders["Idempotency-Key"]).toBe(
      firstHeaders["Idempotency-Key"],
    );
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({
      attempt_number: 2,
      final_form: "retake",
      mark: 80,
      total_questions: 1,
      max_score: 100,
      passing_mark: 70,
    });
    expect(mocks.updateExam).toHaveBeenLastCalledWith(
      { _id: examId, result_webhook_version: 1 },
      expect.objectContaining({
        $max: { result_webhook_delivered_version: 1 },
      }),
    );
  });
});
