import mongoose from "mongoose";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  connectDB: vi.fn(),
  submitExam: vi.fn(),
  sendResultWebhook: vi.fn(),
  requireExamAttempt: vi.fn(),
  getServerStoredAnswers: vi.fn(),
  getExamAttemptView: vi.fn(),
  enforceRateLimit: vi.fn(),
}));

vi.mock("../../src/lib/db", () => ({ connectDB: mocks.connectDB }));
vi.mock("../../src/lib/business-logic", () => ({
  submitExam: mocks.submitExam,
}));
vi.mock("../../src/lib/report-webhook", () => ({
  sendResultWebhook: mocks.sendResultWebhook,
}));
vi.mock("../../src/lib/exam-attempt", () => ({
  requireExamAttempt: mocks.requireExamAttempt,
  getServerStoredAnswers: mocks.getServerStoredAnswers,
  getExamAttemptView: mocks.getExamAttemptView,
  examAttemptErrorResponse: (error: unknown) =>
    Response.json({ error: String(error) }, { status: 500 }),
}));
vi.mock("../../src/lib/rate-limit", () => ({
  examRateLimiter: { enforce: mocks.enforceRateLimit },
}));

import { POST } from "../../src/app/api/exams/[examId]/submit/route";

describe("final submission result callback", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectDB.mockResolvedValue(undefined);
    mocks.requireExamAttempt.mockResolvedValue(undefined);
    mocks.getServerStoredAnswers.mockResolvedValue([
      { question_id: "q1", answer: "A" },
    ]);
    mocks.sendResultWebhook.mockResolvedValue(undefined);
  });

  test("uses the existing submit callback exactly once for an objective final", async () => {
    const examId = new mongoose.Types.ObjectId().toString();
    const exam = {
      _id: new mongoose.Types.ObjectId(examId),
      type: "final",
      grading_status: "auto_graded",
      mark: 1,
      passed: true,
    };
    mocks.submitExam.mockResolvedValue(exam);
    mocks.getExamAttemptView.mockResolvedValue({
      result: { grading_status: "auto_graded", mark: 1, passed: true },
    });

    const response = await POST(
      new NextRequest(`http://localhost/api/exams/${examId}/submit`, {
        method: "POST",
      }),
      { params: Promise.resolve({ examId }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.submitExam).toHaveBeenCalledTimes(1);
    expect(mocks.sendResultWebhook).toHaveBeenCalledTimes(1);
    expect(mocks.sendResultWebhook).toHaveBeenCalledWith(exam);
    await expect(response.json()).resolves.toEqual({
      result: { grading_status: "auto_graded", mark: 1, passed: true },
    });
  });
});
