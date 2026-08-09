import mongoose from "mongoose";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findExamById: vi.fn(),
  createGradeHistory: vi.fn(),
  writeAudit: vi.fn(),
  sendResultWebhook: vi.fn(),
}));

vi.mock("../../src/models/Exam", () => ({
  Exam: { findById: mocks.findExamById },
}));
vi.mock("../../src/models/GradeHistory", () => ({
  GradeHistory: { create: mocks.createGradeHistory },
}));
vi.mock("../../src/lib/audit-log", () => ({
  INTEGRITY_POLICY_VERSION: "test-policy",
  writeAudit: mocks.writeAudit,
}));
vi.mock("../../src/lib/report-webhook", () => ({
  sendResultWebhook: mocks.sendResultWebhook,
}));

import { gradeFinal } from "../../src/lib/business-logic";

function pendingFinal(overrides: Record<string, unknown> = {}) {
  return {
    _id: new mongoose.Types.ObjectId(),
    type: "final",
    student_id: new mongoose.Types.ObjectId(),
    mark: undefined,
    passing_mark: 70,
    passed: false,
    grading_status: "pending_review",
    integrity_status: "clean",
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("manual final grading", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createGradeHistory.mockResolvedValue({});
    mocks.writeAudit.mockResolvedValue(undefined);
    mocks.sendResultWebhook.mockResolvedValue(undefined);
  });

  test("uses the stored passing mark and emits one callback after save", async () => {
    const exam = pendingFinal();
    mocks.findExamById.mockResolvedValue(exam);

    const result = await gradeFinal(
      exam._id,
      65,
      "instructor-1",
      "Reviewed rubric",
    );

    expect(result).toBe(exam);
    expect(exam).toMatchObject({
      mark: 65,
      passing_mark: 70,
      passed: false,
      grading_status: "graded",
      result_webhook_version: 1,
      result_webhook_attempts: 0,
      result_webhook_next_attempt_at: expect.any(Date),
    });
    expect(exam.save).toHaveBeenCalledTimes(1);
    expect(mocks.sendResultWebhook).toHaveBeenCalledTimes(1);
    expect(mocks.sendResultWebhook).toHaveBeenCalledWith(exam);
    expect(exam.save.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sendResultWebhook.mock.invocationCallOrder[0],
    );
  });

  test("does not let an invalidated final pass manual grading", async () => {
    const exam = pendingFinal({
      passing_mark: 50,
      integrity_status: "invalidated",
    });
    mocks.findExamById.mockResolvedValue(exam);

    await gradeFinal(exam._id, 90, "instructor-1");

    expect(exam.mark).toBe(90);
    expect(exam.passed).toBe(false);
    expect(mocks.sendResultWebhook).toHaveBeenCalledTimes(1);
  });

  test("rejects a mark above the final's 100-point maximum before history or callback", async () => {
    const exam = pendingFinal();
    mocks.findExamById.mockResolvedValue(exam);

    await expect(
      gradeFinal(exam._id, 101, "instructor-1"),
    ).rejects.toThrow(/0 to 100/);

    expect(mocks.createGradeHistory).not.toHaveBeenCalled();
    expect(exam.save).not.toHaveBeenCalled();
    expect(mocks.sendResultWebhook).not.toHaveBeenCalled();
  });
});
