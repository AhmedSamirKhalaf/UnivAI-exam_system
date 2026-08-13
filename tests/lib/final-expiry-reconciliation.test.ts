import mongoose from "mongoose";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  attemptFind: vi.fn(),
  attemptSort: vi.fn(),
  attemptUpdateOne: vi.fn(),
  examFindById: vi.fn(),
  sessionFindOne: vi.fn(),
  sessionUpdateOne: vi.fn(),
}));

vi.mock("@/models/ExamAttemptRecord", () => ({
  ExamAttemptRecord: {
    find: mocks.attemptFind,
    updateOne: mocks.attemptUpdateOne,
  },
}));
vi.mock("@/models/Exam", () => ({ Exam: { findById: mocks.examFindById } }));
vi.mock("@/models/ExamSession", () => ({
  ExamSession: {
    findOne: mocks.sessionFindOne,
    updateOne: mocks.sessionUpdateOne,
  },
}));

import { evaluateStart } from "@/lib/exam-attempt-policy";

describe("final deadline reconciliation across forms", () => {
  const learnerId = new mongoose.Types.ObjectId("66f0a1b2c3d4e5f607182930");
  const curriculumId = new mongoose.Types.ObjectId("66f0a1b2c3d4e5f607182931");
  const primaryId = new mongoose.Types.ObjectId("66f0a1b2c3d4e5f607182932");
  const retakeId = new mongoose.Types.ObjectId("66f0a1b2c3d4e5f607182933");
  const recordId = new mongoose.Types.ObjectId("66f0a1b2c3d4e5f607182934");
  const sessionId = new mongoose.Types.ObjectId("66f0a1b2c3d4e5f607182935");
  const expiresAt = new Date("2026-08-02T00:00:00.000Z");
  const activeRecord = {
    _id: recordId,
    source_exam_id: primaryId,
    attempt_number: 1,
    status: "active",
    issued_at: new Date("2026-08-01T00:00:00.000Z"),
  };
  const primaryExam = {
    _id: primaryId,
    type: "final",
    access_expires_at: expiresAt,
    generated_questions: [],
    student_answers: [],
    taken: false,
    passed: false,
    grading_status: "auto_graded",
    integrity_status: "clean",
    policy_action: "none",
    review_status: "not_required",
  };
  const retakeExam = { ...primaryExam, _id: retakeId, final_form: "retake" };
  const session = {
    _id: sessionId,
    exam_id: primaryId,
    status: "in_progress",
    answers: [{ question_id: "q1", answer: "A" }],
    started_at: new Date("2026-08-01T00:00:00.000Z"),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.attemptFind.mockImplementation(() => ({ sort: mocks.attemptSort }));
    mocks.examFindById.mockResolvedValue(primaryExam);
    mocks.sessionFindOne.mockResolvedValue(session);
    mocks.sessionUpdateOne.mockResolvedValue({ modifiedCount: 1 });
    mocks.attemptUpdateOne.mockResolvedValue({ modifiedCount: 1 });
  });

  it("times out an abandoned primary ledger before allowing the reserve form", async () => {
    mocks.attemptSort
      .mockResolvedValueOnce([activeRecord])
      .mockResolvedValueOnce([
        { ...activeRecord, status: "timed_out", terminal_at: expiresAt },
      ]);

    const decision = await evaluateStart(
      learnerId,
      "final",
      curriculumId,
      retakeExam as never,
      new Date("2026-08-09T00:00:00.000Z"),
    );

    expect(decision).toMatchObject({ kind: "allowed", basedOnAttemptNumber: 1 });
    expect(mocks.examFindById).toHaveBeenCalledWith(primaryId);
    expect(mocks.sessionUpdateOne).toHaveBeenCalledWith(
      { _id: sessionId, status: "in_progress" },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "terminated",
          terminated_reason: "timeout",
          ended_at: expiresAt,
        }),
        $unset: { access_token_hash: "", active_connection_id: "" },
      }),
    );
    expect(mocks.attemptUpdateOne).toHaveBeenCalledWith(
      { _id: recordId, status: "active" },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: "timed_out",
          terminal_at: expiresAt,
        }),
      }),
    );
  });

  it("does not resume the reserve form while a different primary form is active", async () => {
    mocks.attemptSort.mockResolvedValueOnce([activeRecord]);

    const decision = await evaluateStart(
      learnerId,
      "final",
      curriculumId,
      retakeExam as never,
      new Date("2026-08-01T12:00:00.000Z"),
    );

    expect(decision).toMatchObject({
      kind: "blocked",
      snapshot: { reason_code: "attempt_active" },
    });
    expect(mocks.attemptUpdateOne).not.toHaveBeenCalled();
  });
});
