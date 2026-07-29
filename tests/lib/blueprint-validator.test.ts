import assert from "node:assert/strict";
import test from "node:test";
import {
  validateQuestionProvenance,
  validateProposedQuestions,
  publishQuestions,
} from "../../src/lib/blueprint-validator";

const mockApprovedBlueprint = {
  programme: "Computer Science",
  semester: "Fall 2026",
  course_id: "CS101",
  title: "Introduction to CS Blueprint",
  outcomes: ["LO1: Programming Basics"],
  difficulty: "medium" as const,
  plan_version: "2026-v1",
  approved: true,
  source_coverage: [
    {
      document_id: "doc_cs101_textbook",
      document_title: "CS101 Fundamentals",
      sections: ["Chapter 1: Intro", "Chapter 2: Variables"],
    },
  ],
};

const validQuestion = {
  question_id: "q_cs101_1",
  prompt: "What is a variable in programming?",
  type: "mcq" as const,
  options: ["A memory location", "A function", "A loop", "A compiler"],
  correct_option: "A memory location",
  plan_version: "2026-v1",
  approved: true,
  provenance: {
    document_id: "doc_cs101_textbook",
    document_title: "CS101 Fundamentals",
    page_number: 14,
    section: "Chapter 2: Variables",
    excerpt: "A variable stores data values in memory locations.",
  },
};

test("blueprint validator accepts question with valid provenance and matching plan version", () => {
  const result = validateQuestionProvenance(validQuestion, mockApprovedBlueprint);
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
  assert.equal(result.validatedQuestion?.question_id, "q_cs101_1");
});

test("validateProposedQuestions returns batch validation result", () => {
  const batchResult = validateProposedQuestions([validQuestion], mockApprovedBlueprint);
  assert.equal(batchResult.valid, true);
  assert.equal(batchResult.validatedQuestions.length, 1);
});

test("blueprint validator rejects question without valid provenance (missing section/page)", () => {
  const invalidProvenanceQuestion = {
    ...validQuestion,
    provenance: {
      document_id: "doc_cs101_textbook",
      document_title: "CS101 Fundamentals",
      page_number: 0, // invalid page
      section: "", // missing section
    },
  };

  const result = validateQuestionProvenance(invalidProvenanceQuestion, mockApprovedBlueprint);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Schema validation failed") || e.includes("missing valid document")));
});

test("blueprint validator rejects question with plan version mismatch", () => {
  const mismatchedVersionQuestion = {
    ...validQuestion,
    plan_version: "2024-v2", // mismatched
  };

  const result = validateQuestionProvenance(mismatchedVersionQuestion, mockApprovedBlueprint);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("Plan version mismatch")));
});

test("blueprint validator rejects question if source section is not covered by blueprint", () => {
  const uncoveredSectionQuestion = {
    ...validQuestion,
    provenance: {
      ...validQuestion.provenance,
      section: "Chapter 99: Unknown Section",
    },
  };

  const result = validateQuestionProvenance(uncoveredSectionQuestion, mockApprovedBlueprint);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes("not covered by approved course blueprint")));
});

test("publishQuestions throws refusal error when proposed questions contain invalid provenance", () => {
  const invalidQuestionList = [
    validQuestion,
    {
      question_id: "q_bad",
      prompt: "Unprovenanced question",
      type: "mcq",
      plan_version: "2026-v1",
      approved: false, // unapproved
      provenance: {
        document_id: "",
        document_title: "",
        page_number: -1,
        section: "",
      },
    },
  ];

  assert.throws(() => {
    publishQuestions(invalidQuestionList, mockApprovedBlueprint);
  }, /Question publication refused/);
});
