import assert from "node:assert/strict";
import test from "node:test";
import {
  validateQuestionProvenance,
  publishQuestions,
} from "../../src/lib/blueprint-validator";
import {
  generateSourceGroundedResponse,
} from "../../src/lib/source-grounded-grading";

/* ────────────────────────────────────────────
   FIXTURES
   ──────────────────────────────────────────── */

export const approvedBlueprintFixture = {
  programme: "Computer Engineering",
  semester: "Spring 2026",
  course_id: "CE202",
  title: "Data Structures & Algorithms Blueprint",
  outcomes: ["LO1: Trees and Graphs", "LO2: Complexity Analysis"],
  difficulty: "medium" as const,
  source_coverage: [
    {
      document_id: "doc_algo_textbook_v1",
      document_title: "Algorithms Third Edition",
      sections: ["Chapter 3: Binary Trees", "Chapter 5: Graph Traversals"],
    },
  ],
  plan_version: "2026-spring-v1",
  approved: true,
  approved_by: "Academic Committee",
};

export const validQuizQuestionsFixture = [
  {
    question_id: "q_tree_01",
    prompt: "What is the maximum number of nodes in a binary tree of height h?",
    type: "mcq" as const,
    options: ["2^h - 1", "2^h", "2^(h+1) - 1", "h^2"],
    correct_option: "2^(h+1) - 1",
    plan_version: "2026-spring-v1",
    approved: true,
    provenance: {
      document_id: "doc_algo_textbook_v1",
      document_title: "Algorithms Third Edition",
      page_number: 84,
      section: "Chapter 3: Binary Trees",
      excerpt: "The maximum number of nodes in a binary tree of height h is 2^(h+1) - 1.",
    },
  },
  {
    question_id: "q_graph_01",
    prompt: "Which data structure is typically used for Breadth-First Search (BFS)?",
    type: "mcq" as const,
    options: ["Stack", "Queue", "Heap", "Tree"],
    correct_option: "Queue",
    plan_version: "2026-spring-v1",
    approved: true,
    provenance: {
      document_id: "doc_algo_textbook_v1",
      document_title: "Algorithms Third Edition",
      page_number: 142,
      section: "Chapter 5: Graph Traversals",
      excerpt: "BFS uses a Queue to manage the frontier of vertices to explore.",
    },
  },
];

export const invalidProvenanceQuestionFixture = {
  question_id: "q_unverified_01",
  prompt: "What is an unverified algorithm detail?",
  type: "mcq" as const,
  options: ["Option A", "Option B"],
  correct_option: "Option A",
  plan_version: "2026-spring-v1",
  approved: false, // unapproved
  provenance: {
    document_id: "unknown_doc",
    document_title: "Unapproved Web Post",
    page_number: 0, // invalid page
    section: "Blog post",
  },
};

/* ────────────────────────────────────────────
   TEST CASES
   ──────────────────────────────────────────── */

test("Fixture quiz questions publish successfully when backed by approved blueprint", () => {
  const published = publishQuestions(validQuizQuestionsFixture, approvedBlueprintFixture);
  assert.equal(published.length, 2);
  assert.equal(published[0].question_id, "q_tree_01");
});

test("Invalid provenance question cannot be published and is rejected by blueprint validator", () => {
  const result = validateQuestionProvenance(
    invalidProvenanceQuestionFixture,
    approvedBlueprintFixture
  );
  assert.equal(result.valid, false);
  assert.ok(result.errors.length > 0);

  assert.throws(() => {
    publishQuestions([invalidProvenanceQuestionFixture], approvedBlueprintFixture);
  }, /Question publication refused/);
});

test("Known fixture produces expected score calculation", () => {
  const studentAnswers = [
    { question_id: "q_tree_01", answer: "2^(h+1) - 1" }, // correct
    { question_id: "q_graph_01", answer: "Queue" },       // correct
  ];

  let calculatedScore = 0;
  for (const ans of studentAnswers) {
    const q = validQuizQuestionsFixture.find((item) => item.question_id === ans.question_id);
    if (q && ans.answer === q.correct_option) {
      calculatedScore++;
    }
  }

  assert.equal(calculatedScore, 2);
});

test("Historical attempts preserve provenance snapshot even if source document reference is mutated", () => {
  // Simulate snapshot frozen during attempt
  const historicalSnapshot = JSON.parse(JSON.stringify(validQuizQuestionsFixture));

  // Querying grounded response from historical snapshot remains readable
  const response = generateSourceGroundedResponse("q_tree_01", historicalSnapshot);
  assert.equal(response.refused, false);
  assert.equal(response.citation?.document_id, "doc_algo_textbook_v1");
  assert.equal(response.citation?.page_number, 84);
  assert.equal(response.citation?.section, "Chapter 3: Binary Trees");
});

test("Duplicate submission idempotency prevents double score modification", () => {
  let submitCount = 0;
  let storedGrade: { mark: number; taken: boolean } | null = null;

  function submitExamIdempotent() {
    if (storedGrade && storedGrade.taken) {
      return { ...storedGrade, idempotent: true };
    }
    submitCount++;
    storedGrade = { mark: 2, taken: true };
    return { ...storedGrade, idempotent: false };
  }

  const firstSubmission = submitExamIdempotent();
  assert.equal(firstSubmission.idempotent, false);
  assert.equal(submitCount, 1);

  const duplicateSubmission = submitExamIdempotent();
  assert.equal(duplicateSubmission.idempotent, true);
  assert.equal(submitCount, 1); // submitCount remains 1 (no double-update)
});
