import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  computeMidtermPackageHash,
  computeQuestionContentHash,
  type MidtermPackageV1,
  validateMidtermPackage,
} from "../../src/lib/midterm-publication";

const blueprintId = "64b000000000000000000101";
const curriculumId = "64b000000000000000000102";
const chapterOneId = "64b000000000000000000103";
const chapterTwoId = "64b000000000000000000104";
const futureChapterId = "64b000000000000000000105";

const blueprint = {
  _id: blueprintId,
  __v: 3,
  schema_version: "assessment-blueprint-v1",
  programme: "Computer Science",
  semester: "2026-S1",
  course_id: curriculumId,
  title: "Completed weeks 1-2 midterm",
  outcomes: ["w1-search", "w1-cost", "w2-sort", "w2-stability"],
  difficulty: "mixed",
  source_coverage: [
    {
      document_id: "course-notes-v4",
      document_title: "Algorithms Course Notes",
      sections: ["Week 1", "Week 2"],
      page_ranges: [{ start: 1, end: 40 }],
    },
  ],
  plan_version: "plan-2026-v4",
  approved: true,
  approved_by: "course-owner",
  approved_at: new Date("2026-08-01T09:00:00.000Z"),
};

const authorizedChapters = [
  { chapter_id: chapterOneId, number: 1 },
  { chapter_id: chapterTwoId, number: 2 },
];

function question(
  questionId: string,
  week: number,
  difficulty: "easy" | "medium" | "hard",
  objectiveIds: string[],
  integration = false,
) {
  const value = {
    schema_version: "question-provenance-v1" as const,
    question_id: questionId,
    prompt: `Grounded prompt ${questionId}`,
    type: "mcq" as const,
    options: [
      "Correct",
      "Incorrect one",
      "Incorrect two",
      "Incorrect three",
      "Incorrect four",
      "Incorrect five",
    ],
    correct_option: "Correct",
    plan_version: "plan-2026-v4",
    provenance: {
      document_id: "course-notes-v4",
      document_title: "Algorithms Course Notes",
      page_number: week === 1 ? 10 : 30,
      section: `Week ${week}`,
      excerpt: `Evidence for ${questionId}`,
    },
    source_ids: ["course-notes-v4"],
    chapter_id: week === 1 ? chapterOneId : chapterTwoId,
    week,
    objective_ids: objectiveIds,
    difficulty,
    integration,
    generator_prompt_version: "midterm-prompt-v7",
  };
  return { ...value, question_hash: computeQuestionContentHash(value) };
}

function validPackage(): MidtermPackageV1 {
  const questions = [
    question("q-1", 1, "easy", ["w1-search"]),
    question("q-2", 1, "medium", ["w1-cost"]),
    question("q-3", 1, "hard", ["w1-search", "w1-cost"], true),
    question("q-4", 2, "easy", ["w2-sort"]),
    question("q-5", 2, "medium", ["w2-stability"]),
    question("q-6", 2, "hard", ["w2-sort"]),
  ];
  const withoutHash = {
    schema_version: "midterm-package-v1" as const,
    package_id: "algorithms-midterm-2026-s1",
    package_version: "1.0.0",
    publication_key: "publish-algorithms-midterm-v1",
    blueprint_id: blueprintId,
    blueprint_version: 3,
    plan_version: "plan-2026-v4",
    curriculum_id: curriculumId,
    completed_scope: {
      start_week: 1,
      end_week: 2,
      chapters: [
        {
          chapter_id: chapterOneId,
          week: 1,
          objectives: ["w1-search", "w1-cost"],
        },
        {
          chapter_id: chapterTwoId,
          week: 2,
          objectives: ["w2-sort", "w2-stability"],
        },
      ],
    },
    balance: {
      question_count: 6,
      difficulty_counts: { easy: 2, medium: 2, hard: 2 },
      maximum_questions_per_week: 3,
      minimum_integration_questions: 1,
    },
    prompt_trace: {
      generator_name: "UnivAI-Agent",
      generator_version: "agent-2026.08",
      prompt_id: "balanced-grounded-midterm",
      prompt_version: "midterm-prompt-v7",
      generated_at: "2026-08-02T10:00:00.000Z",
    },
    answer_key: {
      "q-1": "Correct",
      "q-2": "Correct",
      "q-3": "Correct",
      "q-4": "Correct",
      "q-5": "Correct",
      "q-6": "Correct",
    },
    questions,
  };
  return {
    ...withoutHash,
    package_hash: computeMidtermPackageHash(withoutHash),
  };
}

function rehash(value: MidtermPackageV1): MidtermPackageV1 {
  const copy = structuredClone(value);
  copy.questions = copy.questions.map((item) => ({
    ...item,
    question_hash: computeQuestionContentHash(item),
  }));
  copy.package_hash = computeMidtermPackageHash(copy);
  return copy;
}

function defectCodes(value: MidtermPackageV1): string[] {
  return validateMidtermPackage(value, blueprint, authorizedChapters).defects.map(
    (item) => item.code,
  );
}

describe("grounded midterm package publication", () => {
  test("accepts exact completed scope with deterministic week and difficulty balance", () => {
    const result = validateMidtermPackage(
      validPackage(),
      blueprint,
      authorizedChapters,
    );

    assert.equal(result.valid, true);
    assert.deepEqual(result.defects, []);
    assert.equal(result.package?.questions.length, 6);
  });

  test("rejects an over-weighted week without rewriting the package", () => {
    const value = validPackage();
    value.questions[3].week = 1;
    value.questions[3].chapter_id = chapterOneId;
    value.questions[3].objective_ids = ["w1-search"];

    assert.ok(defectCodes(rehash(value)).includes("WEEK_COVERAGE_MISMATCH"));
  });

  test("rejects future or excluded chapters", () => {
    const value = validPackage();
    value.questions[5].week = 3;
    value.questions[5].chapter_id = futureChapterId;

    assert.ok(defectCodes(rehash(value)).includes("QUESTION_OUT_OF_SCOPE"));
  });

  for (const [label, corrupt] of [
    ["document ID", (value: MidtermPackageV1) => { value.questions[0].provenance.document_id = "missing-document"; }],
    ["document title", (value: MidtermPackageV1) => { value.questions[0].provenance.document_title = "Wrong title"; }],
    ["page", (value: MidtermPackageV1) => { value.questions[0].provenance.page_number = 99; }],
    ["section", (value: MidtermPackageV1) => { value.questions[0].provenance.section = "Future week"; }],
  ] as const) {
    test(`rejects an unresolvable citation ${label}`, () => {
      const value = validPackage();
      corrupt(value);

      assert.ok(defectCodes(rehash(value)).includes("PROVENANCE_INVALID"));
    });
  }

  test("rejects stale plan and blueprint versions", () => {
    const stalePlan = validPackage();
    stalePlan.plan_version = "old-plan";
    const staleBlueprint = validPackage();
    staleBlueprint.blueprint_version = 2;

    assert.ok(defectCodes(rehash(stalePlan)).includes("STALE_PLAN_VERSION"));
    assert.ok(
      defectCodes(rehash(staleBlueprint)).includes("STALE_BLUEPRINT_VERSION"),
    );
  });

  test("rejects prompt trace and answer-key corruption", () => {
    const stalePrompt = validPackage();
    stalePrompt.questions[0].generator_prompt_version = "unknown-prompt";
    const invalidKey = validPackage();
    invalidKey.answer_key["q-1"] = "Incorrect";

    assert.ok(
      defectCodes(rehash(stalePrompt)).includes("PROMPT_VERSION_MISMATCH"),
    );
    assert.ok(defectCodes(rehash(invalidKey)).includes("ANSWER_KEY_MISMATCH"));
  });

  test("rejects independently corrupted question and package hashes", () => {
    const badQuestionHash = validPackage();
    badQuestionHash.questions[0].question_hash = "0".repeat(64);
    badQuestionHash.package_hash = computeMidtermPackageHash(badQuestionHash);
    const badPackageHash = validPackage();
    badPackageHash.package_hash = "0".repeat(64);

    assert.ok(defectCodes(badQuestionHash).includes("QUESTION_HASH_MISMATCH"));
    assert.ok(defectCodes(badPackageHash).includes("PACKAGE_HASH_MISMATCH"));
  });

  test("rejects duplicate content and missing objective coverage", () => {
    const duplicate = validPackage();
    duplicate.questions[1].prompt = duplicate.questions[0].prompt;
    const uncovered = validPackage();
    uncovered.questions[4].objective_ids = ["w2-sort"];

    assert.ok(
      defectCodes(rehash(duplicate)).includes("DUPLICATE_QUESTION_CONTENT"),
    );
    assert.ok(
      defectCodes(rehash(uncovered)).includes("OBJECTIVE_COVERAGE_MISSING"),
    );
  });

  test("rejects omitted blueprint objectives and unresolved source IDs", () => {
    const omittedObjective = validPackage();
    omittedObjective.completed_scope.chapters[1].objectives = ["w2-sort"];
    const unresolvedSource = validPackage();
    unresolvedSource.questions[0].source_ids.push("unknown-source");

    assert.ok(
      defectCodes(rehash(omittedObjective)).includes(
        "SCOPE_OBJECTIVES_BLUEPRINT_MISMATCH",
      ),
    );
    assert.ok(
      defectCodes(rehash(unresolvedSource)).includes("SOURCE_IDS_INVALID"),
    );
  });
});
