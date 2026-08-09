import { beforeEach, describe, expect, test, vi } from "vitest";
import mongoose from "mongoose";
import {
  canonicalQuestionHash,
  publishQuizPackage,
  validateQuizPackage,
  type QuizPackageV1,
} from "../../src/lib/quiz-publication";

const modelMocks = vi.hoisted(() => ({
  findProvenance: vi.fn(),
  insertProvenance: vi.fn(),
}));

const transactionSession = {
  withTransaction: vi.fn(async (work: () => Promise<void>) => work()),
  endSession: vi.fn(async () => undefined),
};

function leanProvenance(value: unknown[]) {
  return { lean: vi.fn().mockResolvedValue(value) };
}

vi.mock("../../src/models/QuestionProvenance", () => ({
  QuestionProvenance: {
    find: modelMocks.findProvenance,
    insertMany: modelMocks.insertProvenance,
  },
}));

const blueprintId = "64b0000000000000000000ab";
const chapterId = "64b000000000000000000011";

const approvedBlueprint = {
  _id: blueprintId,
  schema_version: "assessment-blueprint-v1",
  programme: "Computer Science",
  semester: "Fall 2026",
  course_id: "CS101",
  title: "Introduction to CS Blueprint",
  outcomes: ["Explain variables", "Trace simple programs"],
  difficulty: "medium",
  plan_version: "2026-v1",
  approved: true,
  approved_by: "Academic Committee",
  approved_at: "2026-07-30T00:00:00.000Z",
  source_coverage: [
    {
      document_id: "doc_cs101_textbook",
      document_title: "CS101 Fundamentals",
      sections: ["Week 2: Variables"],
      page_ranges: [{ start: 10, end: 30 }],
    },
  ],
};

function makeQuestion(index: number) {
  const question = {
    question_id: `q_cs101_w2_${index}`,
    prompt: `Grounded question ${index} about variables?`,
    type: "mcq" as const,
    options: [
      "A memory location",
      "A function call",
      "A loop counter",
      "A compiler pass",
    ],
    correct_option: "A memory location",
    provenance: {
      document_id: "doc_cs101_textbook",
      document_title: "CS101 Fundamentals",
      page_number: 10 + index * 2,
      section: "Week 2: Variables",
      excerpt: "A variable stores a value in a named memory location.",
    },
  };
  return {
    ...question,
    question_hash: canonicalQuestionHash(question),
  };
}

function makePackage(overrides: Partial<QuizPackageV1> = {}) {
  const questions = [1, 2, 3, 4, 5].map(makeQuestion);
  const pkg: QuizPackageV1 = {
    schema_version: "quiz-package-v1",
    package_id: "pkg-cs101-w2-0001",
    learner_id: "S-2026-000042",
    programme: "Computer Science",
    course_id: "CS101",
    week: "Week 2",
    plan_version: "2026-v1",
    blueprint_id: blueprintId,
    blueprint_version: "2026-v1",
    generator_prompt_id: "prompt-cs101-w2",
    generator_prompt_version: "2026-v1",
    difficulty: "medium",
    chapter_id: chapterId,
    answer_key: Object.fromEntries(
      questions.map((question) => [question.question_id, question.correct_option]),
    ),
    questions,
  };
  return { ...pkg, ...overrides };
}

describe("QuizPackageV1 validation against an approved blueprint", () => {
  test("publishes a fully grounded package", () => {
    const result = validateQuizPackage(makePackage(), approvedBlueprint);

    expect(result.valid).toBe(true);
    expect(result.defects).toEqual([]);
    expect(result.publishedQuestions).toHaveLength(5);
    expect(result.publishedQuestions.every((question) => question.approved)).toBe(true);
  });

  test("refuses an unapproved blueprint", () => {
    const result = validateQuizPackage(makePackage(), {
      ...approvedBlueprint,
      approved: false,
      approved_by: undefined,
      approved_at: undefined,
    });

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain("blueprint.not_approved");
  });

  test("fails closed on a fabricated document id", () => {
    const pkg = makePackage();
    pkg.questions[0].provenance.document_id = "doc_invented";
    const result = validateQuizPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.provenance.uncovered",
    );
  });

  test("fails closed on an out-of-scope section", () => {
    const pkg = makePackage();
    pkg.questions[1].provenance.section = "Week 99: Fabricated";
    const result = validateQuizPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.provenance.uncovered",
    );
  });

  test("fails closed on a page outside the approved source range", () => {
    const pkg = makePackage();
    pkg.questions[2].provenance.page_number = 99;
    const result = validateQuizPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.page.out_of_range",
    );
  });

  test("fails closed on an unapproved plan version", () => {
    const result = validateQuizPackage(
      makePackage({ plan_version: "2025-v2", blueprint_version: "2025-v2" }),
      approvedBlueprint,
    );

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain("plan_version.mismatch");
  });

  test("fails closed on a generator blueprint-version mismatch", () => {
    const result = validateQuizPackage(
      makePackage({ blueprint_version: "2026-v9" }),
      approvedBlueprint,
    );

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain("plan_version.mismatch");
  });

  test("fails closed on a programme/course scope mismatch", () => {
    const programmeResult = validateQuizPackage(
      makePackage({ programme: "Physics" }),
      approvedBlueprint,
    );
    const courseResult = validateQuizPackage(
      makePackage({ course_id: "PHY201" }),
      approvedBlueprint,
    );

    expect(programmeResult.defects.map((defect) => defect.code)).toContain(
      "programme.mismatch",
    );
    expect(courseResult.defects.map((defect) => defect.code)).toContain(
      "course.mismatch",
    );
  });

  test("fails closed when the answer key disagrees with the correct option", () => {
    const pkg = makePackage();
    pkg.questions[3].correct_option = "A function call";
    const result = validateQuizPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain("answer_key.mismatch");
  });

  test("fails closed when the immutable question hash is tampered with", () => {
    const pkg = makePackage();
    pkg.questions[4].question_hash = "a".repeat(64);
    const result = validateQuizPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.hash.mismatch",
    );
  });

  test("fails closed on fewer than four options or duplicate options", () => {
    const shortOptions = makePackage();
    shortOptions.questions[0].options = ["A memory location", "A function call"];
    const shortResult = validateQuizPackage(shortOptions, approvedBlueprint);

    const duplicateOptions = makePackage();
    duplicateOptions.questions[1].options = [
      "A memory location",
      "A memory location",
      "A loop counter",
      "A compiler pass",
    ];
    const duplicateResult = validateQuizPackage(duplicateOptions, approvedBlueprint);

    expect(shortResult.valid).toBe(false);
    expect(duplicateResult.valid).toBe(false);
  });

  test("fails closed on a correct option outside the supplied options", () => {
    const pkg = makePackage();
    pkg.questions[2].correct_option = "A memory location";
    pkg.questions[2].options = ["X", "Y", "Z", "W"];
    const result = validateQuizPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
  });

  test("fails closed on duplicate question ids", () => {
    const pkg = makePackage();
    pkg.questions[1].question_id = pkg.questions[0].question_id;
    const result = validateQuizPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.duplicate_id",
    );
  });

  test("fails closed on duplicate question content", () => {
    const pkg = makePackage();
    pkg.questions[1].question_id = "q_cs101_w2_duplicate";
    pkg.questions[1].prompt = pkg.questions[0].prompt;
    pkg.questions[1].options = pkg.questions[0].options;
    pkg.questions[1].correct_option = pkg.questions[0].correct_option;
    pkg.questions[1].provenance = { ...pkg.questions[0].provenance };
    pkg.questions[1].question_hash = pkg.questions[0].question_hash;
    pkg.answer_key["q_cs101_w2_duplicate"] = pkg.questions[1].correct_option;
    const result = validateQuizPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.duplicate_content",
    );
  });

  test("fails closed on a missing answer-key entry", () => {
    const pkg = makePackage();
    delete pkg.answer_key[pkg.questions[0].question_id];
    const result = validateQuizPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain("answer_key.mismatch");
  });

  test("fails closed on an essay item (weekly quizzes are auto-graded MCQs)", () => {
    const pkg = makePackage();
    // @ts-expect-error forcing an invalid type to prove the format policy
    pkg.questions[0].type = "essay";
    const result = validateQuizPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
  });
});

describe("publishQuizPackage persistence and idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.findProvenance.mockReturnValue(leanProvenance([]));
    modelMocks.insertProvenance.mockImplementation(async (docs) => docs);
    vi.spyOn(mongoose, "startSession").mockResolvedValue(transactionSession as never);
  });

  test("persists an accepted package with full publication trace", async () => {
    const receipt = await publishQuizPackage(makePackage(), approvedBlueprint);

    expect(receipt.status).toBe("accepted");
    expect(receipt.defects).toEqual([]);
    expect(receipt.published_ids).toHaveLength(5);
    expect(receipt.idempotent).toBe(false);
    expect(modelMocks.insertProvenance).toHaveBeenCalledTimes(1);

    const docs = modelMocks.insertProvenance.mock.calls[0][0];
    expect(docs[0]).toMatchObject({
      blueprint_id: new mongoose.Types.ObjectId(blueprintId),
      chapter_id: new mongoose.Types.ObjectId(chapterId),
      learner_id: "S-2026-000042",
      package_id: "pkg-cs101-w2-0001",
      generator_prompt_id: "prompt-cs101-w2",
      generator_prompt_version: "2026-v1",
      approved: true,
    });
    expect(docs[0].question_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a rejected package is never persisted", async () => {
    const pkg = makePackage();
    pkg.questions[0].provenance.page_number = 99;

    const receipt = await publishQuizPackage(pkg, approvedBlueprint);

    expect(receipt.status).toBe("rejected");
    expect(receipt.defects.map((defect) => defect.code)).toContain(
      "question.page.out_of_range",
    );
    expect(receipt.published_ids).toEqual([]);
    expect(modelMocks.insertProvenance).not.toHaveBeenCalled();
  });

  test("republishing the same package is an idempotent acceptance", async () => {
    modelMocks.findProvenance.mockReturnValue(
      leanProvenance(
        ["q_cs101_w2_1", "q_cs101_w2_2", "q_cs101_w2_3", "q_cs101_w2_4", "q_cs101_w2_5"].map(
          (question_id) => ({ question_id, package_id: "pkg-cs101-w2-0001" }),
        ),
      ),
    );

    const receipt = await publishQuizPackage(makePackage(), approvedBlueprint);

    expect(receipt.status).toBe("accepted");
    expect(receipt.idempotent).toBe(true);
    expect(receipt.published_ids).toHaveLength(5);
    expect(modelMocks.insertProvenance).not.toHaveBeenCalled();
  });

  test("a different package reusing published question ids is rejected", async () => {
    modelMocks.findProvenance.mockReturnValue(
      leanProvenance([{ question_id: "q_cs101_w2_1", package_id: "pkg-cs101-w2-0000" }]),
    );

    const receipt = await publishQuizPackage(makePackage(), approvedBlueprint);

    expect(receipt.status).toBe("rejected");
    expect(receipt.defects.map((defect) => defect.code)).toContain(
      "question.duplicate_id",
    );
    expect(modelMocks.insertProvenance).not.toHaveBeenCalled();
  });
});
