// @ts-expect-error Vitest is supplied by the issue's mandatory npx command.
import { beforeEach, describe, expect, test, vi } from "vitest";
import mongoose from "mongoose";

const modelMocks = vi.hoisted(() => ({
  findExamById: vi.fn(),
  findOneAndUpdateExam: vi.fn(),
  findSession: vi.fn(),
  updateSession: vi.fn(),
  sendWebhook: vi.fn(),
}));

vi.mock("../../src/models/Exam", () => ({
  Exam: {
    findById: modelMocks.findExamById,
    findOneAndUpdate: modelMocks.findOneAndUpdateExam,
  },
}));

vi.mock("../../src/models/ExamSession", () => ({
  ExamSession: {
    findOne: modelMocks.findSession,
    updateOne: modelMocks.updateSession,
  },
}));

vi.mock("../../src/lib/report-webhook", () => ({
  sendResultWebhook: modelMocks.sendWebhook,
}));

import {
  getHistoricalAttempt,
  gradeAssessmentServerSide,
} from "../../src/lib/source-grounded-grading";

const examId = new mongoose.Types.ObjectId();
const studentId = new mongoose.Types.ObjectId();
const blueprintId = new mongoose.Types.ObjectId();
const submittedAt = new Date("2026-07-30T12:00:00.000Z");

const questionsSnapshot = [
  {
    schema_version: "question-provenance-v1",
    question_id: "q_1",
    prompt: "Which structure does BFS use?",
    type: "mcq",
    options: ["Stack", "Queue", "Heap"],
    correct_option: "Queue",
    plan_version: "2026-v1",
    approved: true,
    provenance: {
      document_id: "doc_algorithms",
      document_title: "Algorithms",
      page_number: 142,
      section: "Graph Traversals",
      excerpt: "Breadth-first search uses a queue.",
    },
  },
];

function examFixture(overrides: Record<string, unknown> = {}) {
  return {
    _id: examId,
    type: "quiz",
    title: "Grounded quiz",
    student_id: studentId,
    student_sid: "S-2026-000042",
    blueprint_id: blueprintId,
    plan_version: "2026-v1",
    attempt_number: 1,
    questions_snapshot: questionsSnapshot,
    generated_questions: questionsSnapshot,
    student_answers: [],
    taken: false,
    mark: undefined,
    passing_mark: 1,
    passed: false,
    grading_status: "auto_graded",
    integrity_status: "clean",
    integrity_metadata: undefined,
    policy_action: "none",
    review_status: "not_required",
    submitted_at: undefined,
    submission_idempotency_key: undefined,
    createdAt: new Date("2026-07-30T10:00:00.000Z"),
    updatedAt: new Date("2026-07-30T10:00:00.000Z"),
    toObject() {
      return { ...this };
    },
    ...overrides,
  };
}

describe("assessment grading flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.findSession.mockResolvedValue({
      suspicion_score: 0,
      flagged: false,
    });
    modelMocks.updateSession.mockResolvedValue({ modifiedCount: 1 });
    modelMocks.sendWebhook.mockResolvedValue(undefined);
  });

  test("duplicate submission returns the saved grade without a second update or webhook", async () => {
    const initial = examFixture();
    const submitted = examFixture({
      taken: true,
      mark: 1,
      passed: true,
      submitted_at: submittedAt,
      submission_idempotency_key: "submission-001",
      integrity_metadata: {
        status: "clean",
        suspicion_score: 0,
        flagged: false,
      },
      updatedAt: submittedAt,
    });

    modelMocks.findExamById
      .mockResolvedValueOnce(initial)
      .mockResolvedValueOnce(submitted);
    modelMocks.findOneAndUpdateExam.mockResolvedValueOnce(submitted);

    const first = await gradeAssessmentServerSide(
      examId,
      [{ question_id: "q_1", answer: "Queue" }],
      "submission-001",
    );
    const duplicate = await gradeAssessmentServerSide(
      examId,
      [{ question_id: "q_1", answer: "Queue" }],
      "submission-001",
    );

    expect(first).toMatchObject({ mark: 1, passed: true, idempotent: false });
    expect(duplicate).toMatchObject({
      mark: 1,
      passed: true,
      idempotent: true,
    });
    expect(modelMocks.findOneAndUpdateExam).toHaveBeenCalledTimes(1);
    expect(modelMocks.findOneAndUpdateExam).toHaveBeenCalledWith(
      { _id: examId, taken: false },
      expect.any(Object),
            { returnDocument: "after", runValidators: true },
    );
    expect(modelMocks.updateSession).toHaveBeenCalledTimes(1);
    expect(modelMocks.sendWebhook).toHaveBeenCalledTimes(1);
  });

  test("a different idempotency key cannot read or overwrite a submitted grade", async () => {
    modelMocks.findExamById.mockResolvedValue(
      examFixture({
        taken: true,
        mark: 1,
        passed: true,
        submitted_at: submittedAt,
        submission_idempotency_key: "submission-001",
        updatedAt: submittedAt,
      }),
    );

    await expect(
      gradeAssessmentServerSide(
        examId,
        [{ question_id: "q_1", answer: "Queue" }],
        "submission-002",
      ),
    ).rejects.toThrow(/different idempotency key/);
    expect(modelMocks.findOneAndUpdateExam).not.toHaveBeenCalled();
    expect(modelMocks.sendWebhook).not.toHaveBeenCalled();
  });

  test("historical attempt reads its immutable citation snapshot after source removal", async () => {
    modelMocks.findExamById.mockResolvedValue(
      examFixture({
        taken: true,
        questions_snapshot: structuredClone(questionsSnapshot),
        toObject() {
          return {
            _id: this._id,
            taken: this.taken,
            questions_snapshot: this.questions_snapshot,
          };
        },
      }),
    );

    const historical = await getHistoricalAttempt(examId);

    expect(historical.immutable_questions_snapshot[0]).toMatchObject({
      question_id: "q_1",
      provenance: {
        document_id: "doc_algorithms",
        page_number: 142,
        section: "Graph Traversals",
      },
    });
  });

  test("missing immutable provenance is refused instead of fabricated", async () => {
    modelMocks.findExamById.mockResolvedValue(
      examFixture({ questions_snapshot: undefined }),
    );

    await expect(getHistoricalAttempt(examId)).rejects.toThrow(
      /Immutable question snapshot is invalid/,
    );
  });
});
