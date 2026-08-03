// @ts-expect-error Vitest is supplied by the issue's mandatory npx command.
import { beforeEach, describe, expect, test, vi } from "vitest";
import mongoose from "mongoose";
import {
  canonicalQuestionHash,
  publishFinalPackage,
  validateFinalPackage,
  type FinalPackageQuestion,
  type FinalPackageV1,
} from "../../src/lib/final-publication";

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
const curriculumId = "64b0000000000000000000c3";
const DOCUMENT_ID = "doc_semester_textbook";
const DOCUMENT_TITLE = "Semester Textbook";
const MCQ_OPTIONS = [
  "Option Alpha",
  "Option Beta",
  "Option Gamma",
  "Option Delta",
];

const WEEKS = [
  { week: "Week 1", section: "Week 1: Foundations" },
  { week: "Week 2", section: "Week 2: Methods" },
  { week: "Week 3", section: "Week 3: Analysis" },
  { week: "Week 4", section: "Week 4: Applications" },
];

const approvedBlueprint = {
  _id: blueprintId,
  schema_version: "assessment-blueprint-v1",
  programme: "Computer Science",
  semester: "Fall 2026",
  course_id: "CS301",
  title: "Cumulative Semester Final Blueprint",
  outcomes: ["Integrate course concepts", "Apply methods to problems"],
  difficulty: "mixed",
  plan_version: "2026-v1",
  approved: true,
  approved_by: "Academic Committee",
  approved_at: "2026-07-30T00:00:00.000Z",
  source_coverage: [
    {
      document_id: DOCUMENT_ID,
      document_title: DOCUMENT_TITLE,
      sections: WEEKS.map((entry) => entry.section),
      page_ranges: [{ start: 1, end: 40 }],
    },
  ],
};

type UnhashedFinalQuestion = Omit<FinalPackageQuestion, "question_hash">;

function questionsFor(weekAssignments: number[]): UnhashedFinalQuestion[] {
  return weekAssignments.map((weekIndex, index) => {
    const week = WEEKS[weekIndex];
    const isEssay = index % 3 === 2;
    const base = {
      question_id: `f_q${index + 1}`,
      prompt: `Grounded final item ${index + 1}: ${week.section}?`,
      week: week.week,
      difficulty: (index % 2 === 0 ? "easy" : "medium") as
        | "easy"
        | "medium"
        | "hard",
      provenance: {
        document_id: DOCUMENT_ID,
        document_title: DOCUMENT_TITLE,
        page_number: weekIndex * 10 + (index % 9) + 1,
        section: week.section,
        excerpt: "The textbook states the answer on this page.",
      },
    };
    if (isEssay) return { ...base, type: "essay" as const };
    return {
      ...base,
      type: "mcq" as const,
      options: [...MCQ_OPTIONS],
      correct_option: "Option Alpha",
    };
  });
}

function makeRubric(
  question: FinalPackageQuestion,
): FinalPackageV1["rubrics"][string] {
  return {
    criteria: ["Accuracy", "Completeness", "Use of evidence"],
    model_answer_excerpt: `Model answer grounded on: ${question.provenance.excerpt}`,
    marks_breakdown: { accuracy: 4, completeness: 3, evidence: 3 },
    provenance: { ...question.provenance },
  };
}

function defaultQuestions(): UnhashedFinalQuestion[] {
  return questionsFor([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]);
}

function makePackage(
  overrides: Partial<Omit<FinalPackageV1, "questions">> & {
    questions?: UnhashedFinalQuestion[];
  } = {},
): FinalPackageV1 {
  const questions = (overrides.questions ?? defaultQuestions()).map(
    (question) => ({ ...question, question_hash: canonicalQuestionHash(question) }),
  );
  const mcqs = questions.filter((question) => question.type === "mcq");
  const essays = questions.filter((question) => question.type === "essay");

  const base: FinalPackageV1 = {
    schema_version: "final-package-v1",
    package_id: "pkg-cs301-final-0001",
    learner_id: "S-2026-000042",
    programme: "Computer Science",
    semester: "Fall 2026",
    course_id: "CS301",
    plan_version: "2026-v1",
    blueprint_id: blueprintId,
    blueprint_version: "2026-v1",
    generator_prompt_id: "prompt-cs301-final",
    generator_prompt_version: "2026-v1",
    difficulty: "mixed",
    curriculum_id: curriculumId,
    semester_weeks: WEEKS.map((entry) => entry.week),
    books: [{ document_id: DOCUMENT_ID, document_title: DOCUMENT_TITLE }],
    answer_key: Object.fromEntries(
      mcqs.map((question) => [
        question.question_id,
        question.correct_option as string,
      ]),
    ),
    rubrics: Object.fromEntries(
      essays.map((question) => [question.question_id, makeRubric(question)]),
    ),
    questions,
  };

  const merged = { ...base, ...overrides, questions };
  merged.answer_key =
    overrides.answer_key ??
    Object.fromEntries(
      mcqs.map((question) => [
        question.question_id,
        question.correct_option as string,
      ]),
    );
  merged.rubrics =
    overrides.rubrics ??
    Object.fromEntries(
      essays.map((question) => [question.question_id, makeRubric(question)]),
    );
  return merged;
}

function convertToMcq(pkg: FinalPackageV1, questionId: string): void {
  const question = pkg.questions.find((item) => item.question_id === questionId)!;
  question.type = "mcq";
  question.options = [...MCQ_OPTIONS];
  question.correct_option = "Option Alpha";
  question.question_hash = canonicalQuestionHash(question);
  pkg.answer_key[questionId] = "Option Alpha";
  delete pkg.rubrics[questionId];
}

describe("FinalPackageV1 validation against an approved blueprint and full semester scope", () => {
  test("publishes a fully grounded cumulative package", () => {
    const result = validateFinalPackage(
      makePackage(),
      approvedBlueprint,
      WEEKS.map((entry) => entry.week),
    );

    expect(result.valid).toBe(true);
    expect(result.defects).toEqual([]);
    expect(result.publishedQuestions).toHaveLength(12);
    expect(result.publishedQuestions.every((question) => question.approved)).toBe(true);
  });

  test("refuses an unapproved blueprint", () => {
    const result = validateFinalPackage(makePackage(), {
      ...approvedBlueprint,
      approved: false,
      approved_by: undefined,
      approved_at: undefined,
    });

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "blueprint.not_approved",
    );
  });

  test("fails closed on a fabricated document id", () => {
    const pkg = makePackage();
    pkg.questions[0].provenance.document_id = "doc_invented";
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.provenance.uncovered",
    );
  });

  test("fails closed on an out-of-scope section", () => {
    const pkg = makePackage();
    pkg.questions[1].provenance.section = "Week 99: Fabricated";
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.provenance.uncovered",
    );
  });

  test("fails closed on a page outside the approved source range", () => {
    const pkg = makePackage();
    pkg.questions[2].provenance.page_number = 99;
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.page.out_of_range",
    );
  });

  test("fails closed on a stale plan version", () => {
    const result = validateFinalPackage(
      makePackage({ plan_version: "2025-v2", blueprint_version: "2025-v2" }),
      approvedBlueprint,
    );

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "plan_version.mismatch",
    );
  });

  test("fails closed on a generator blueprint-version mismatch", () => {
    const result = validateFinalPackage(
      makePackage({ blueprint_version: "2026-v9" }),
      approvedBlueprint,
    );

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "plan_version.mismatch",
    );
  });

  test("fails closed on programme/course/semester scope mismatch", () => {
    const programmeResult = validateFinalPackage(
      makePackage({ programme: "Physics" }),
      approvedBlueprint,
    );
    const courseResult = validateFinalPackage(
      makePackage({ course_id: "PHY201" }),
      approvedBlueprint,
    );
    const semesterResult = validateFinalPackage(
      makePackage({ semester: "Spring 2027" }),
      approvedBlueprint,
    );

    expect(programmeResult.defects.map((defect) => defect.code)).toContain(
      "programme.mismatch",
    );
    expect(courseResult.defects.map((defect) => defect.code)).toContain(
      "course.mismatch",
    );
    expect(semesterResult.defects.map((defect) => defect.code)).toContain(
      "semester.mismatch",
    );
  });

  test("fails closed when the answer key disagrees with the correct option", () => {
    const pkg = makePackage();
    pkg.questions[3].correct_option = "Option Beta";
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "answer_key.mismatch",
    );
  });

  test("fails closed when the immutable question hash is tampered with", () => {
    const pkg = makePackage();
    pkg.questions[4].question_hash = "a".repeat(64);
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.hash.mismatch",
    );
  });

  test("fails closed on duplicate question ids", () => {
    const pkg = makePackage();
    pkg.questions[1].question_id = pkg.questions[0].question_id;
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.duplicate_id",
    );
  });

  test("fails closed on duplicate question content", () => {
    const pkg = makePackage();
    pkg.questions[1].question_id = "f_q_duplicate";
    pkg.questions[1].prompt = pkg.questions[0].prompt;
    pkg.questions[1].options = [...pkg.questions[0].options!];
    pkg.questions[1].correct_option = pkg.questions[0].correct_option;
    pkg.questions[1].provenance = { ...pkg.questions[0].provenance };
    pkg.questions[1].question_hash = canonicalQuestionHash(pkg.questions[1]);
    pkg.answer_key["f_q_duplicate"] = pkg.questions[1].correct_option!;
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.duplicate_content",
    );
  });

  test("fails closed on a missing answer-key entry", () => {
    const pkg = makePackage();
    delete pkg.answer_key[pkg.questions[0].question_id];
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "answer_key.mismatch",
    );
  });

  test("fails closed when an essay has no rubric", () => {
    const pkg = makePackage();
    delete pkg.rubrics[pkg.questions[2].question_id];
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "rubric.mismatch",
    );
  });

  test("fails closed when a rubric provenance does not match its question", () => {
    const pkg = makePackage();
    pkg.rubrics[pkg.questions[2].question_id].provenance.page_number = 99;
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "rubric.provenance.mismatch",
    );
  });

  test("fails closed when a declared week has no question", () => {
    const pkg = makePackage({
      semester_weeks: ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"],
    });
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "semester.missing_week",
    );
  });

  test("fails closed when a question is outside the declared semester scope", () => {
    const pkg = makePackage();
    pkg.questions[0].week = "Week 9";
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "question.week.out_of_scope",
    );
  });

  test("fails closed on recency bias in the last week", () => {
    const pkg = makePackage({
      questions: questionsFor([0, 0, 1, 3, 3, 3, 3, 3, 3, 3, 3, 3]),
    });
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "scope.recency_bias",
    );
  });

  test("fails closed on an incomplete semester versus the resolved weeks", () => {
    const pkg = makePackage({
      semester_weeks: ["Week 1", "Week 2", "Week 3"],
      questions: questionsFor([0, 0, 0, 1, 1, 1, 2, 2, 2, 2]),
    });
    const result = validateFinalPackage(pkg, approvedBlueprint, [
      "Week 1",
      "Week 2",
      "Week 3",
      "Week 4",
    ]);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "semester.incomplete",
    );
  });

  test("fails closed on an out-of-scope week versus the resolved weeks", () => {
    const pkg = makePackage({
      semester_weeks: ["Week 1", "Week 2", "Week 3", "Week 4", "Week 5"],
    });
    const result = validateFinalPackage(pkg, approvedBlueprint, [
      "Week 1",
      "Week 2",
      "Week 3",
      "Week 4",
    ]);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "semester.out_of_scope",
    );
  });

  test("fails closed when an approved source book is not resolved", () => {
    const result = validateFinalPackage(
      makePackage({
        books: [
          { document_id: "doc_other_book", document_title: "Other Book" },
        ],
      }),
      approvedBlueprint,
    );

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "source.missing_book",
    );
  });

  test("fails closed on incomplete cumulative source coverage", () => {
    const blueprint = {
      ...approvedBlueprint,
      source_coverage: [
        {
          document_id: DOCUMENT_ID,
          document_title: DOCUMENT_TITLE,
          sections: [
            ...WEEKS.map((entry) => entry.section),
            "Week 4: Capstone",
          ],
          page_ranges: [{ start: 1, end: 40 }],
        },
      ],
    };
    const result = validateFinalPackage(makePackage(), blueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain(
      "scope.incomplete_coverage",
    );
  });

  test("fails closed on a paper that drops the required format mix", () => {
    const pkg = makePackage();
    ["f_q3", "f_q6", "f_q9"].forEach((questionId) => convertToMcq(pkg, questionId));
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain("format.mix");
  });

  test("fails closed when a mixed paper spans a single difficulty band", () => {
    const pkg = makePackage();
    pkg.questions.forEach((question) => {
      question.difficulty = "easy";
    });
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.map((defect) => defect.code)).toContain("difficulty.mix");
  });

  test("rejects a paper that does not reach the minimum bank size", () => {
    const pkg = makePackage({
      questions: questionsFor([0, 0, 0, 1, 1, 1, 2, 2, 2]),
    });
    const result = validateFinalPackage(pkg, approvedBlueprint);

    expect(result.valid).toBe(false);
    expect(result.defects.every((defect) => defect.code === "schema.invalid")).toBe(
      true,
    );
  });
});

describe("publishFinalPackage persistence and idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    modelMocks.findProvenance.mockReturnValue(leanProvenance([]));
    modelMocks.insertProvenance.mockImplementation(async (docs) => docs);
    vi.spyOn(mongoose, "startSession").mockResolvedValue(transactionSession as never);
  });

  test("persists an accepted package with the full publication trace", async () => {
    const receipt = await publishFinalPackage(
      makePackage(),
      approvedBlueprint,
      { curriculumId, resolvedSemesterWeeks: WEEKS.map((entry) => entry.week) },
    );

    expect(receipt.status).toBe("accepted");
    expect(receipt.defects).toEqual([]);
    expect(receipt.published_ids).toHaveLength(12);
    expect(receipt.mcq_count).toBe(8);
    expect(receipt.essay_count).toBe(4);
    expect(receipt.idempotent).toBe(false);
    expect(modelMocks.insertProvenance).toHaveBeenCalledTimes(1);

    const docs = modelMocks.insertProvenance.mock.calls[0][0];
    expect(docs[0]).toMatchObject({
      blueprint_id: new mongoose.Types.ObjectId(blueprintId),
      curriculum_id: new mongoose.Types.ObjectId(curriculumId),
      learner_id: "S-2026-000042",
      package_id: "pkg-cs301-final-0001",
      generator_prompt_id: "prompt-cs301-final",
      generator_prompt_version: "2026-v1",
      week: "Week 1",
      approved: true,
    });
    expect(docs[0].question_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(docs[2].rubric).toMatchObject({
      criteria: ["Accuracy", "Completeness", "Use of evidence"],
      provenance: {
        document_id: DOCUMENT_ID,
        section: "Week 1: Foundations",
      },
    });
  });

  test("a rejected package is never persisted", async () => {
    const pkg = makePackage();
    pkg.questions[0].provenance.page_number = 99;

    const receipt = await publishFinalPackage(pkg, approvedBlueprint);

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
        defaultQuestions().map((question) => ({
          question_id: question.question_id,
          package_id: "pkg-cs301-final-0001",
        })),
      ),
    );

    const receipt = await publishFinalPackage(makePackage(), approvedBlueprint);

    expect(receipt.status).toBe("accepted");
    expect(receipt.idempotent).toBe(true);
    expect(receipt.published_ids).toHaveLength(12);
    expect(modelMocks.insertProvenance).not.toHaveBeenCalled();
  });

  test("a different package reusing published question ids is rejected", async () => {
    modelMocks.findProvenance.mockReturnValue(
      leanProvenance([
        { question_id: "f_q1", package_id: "pkg-cs301-final-0000" },
      ]),
    );

    const receipt = await publishFinalPackage(makePackage(), approvedBlueprint);

    expect(receipt.status).toBe("rejected");
    expect(receipt.defects.map((defect) => defect.code)).toContain(
      "question.duplicate_id",
    );
    expect(modelMocks.insertProvenance).not.toHaveBeenCalled();
  });
});
