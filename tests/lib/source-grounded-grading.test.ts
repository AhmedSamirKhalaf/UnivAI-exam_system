import assert from "node:assert/strict";
import test from "node:test";
import {
  generateSourceGroundedResponse,
} from "../../src/lib/source-grounded-grading";

const sampleSnapshotQuestions = [
  {
    question_id: "q_1",
    prompt: "What is 2+2?",
    type: "mcq",
    options: ["2", "3", "4", "5"],
    correct_option: "4",
    plan_version: "v1.0",
    approved: true,
    provenance: {
      document_id: "math_101_book",
      document_title: "Basic Math",
      page_number: 12,
      section: "Section 1: Addition",
      excerpt: "2 + 2 equals 4.",
    },
  },
  {
    question_id: "q_unprovenanced",
    prompt: "What is an unknown concept?",
    type: "mcq",
    plan_version: "v1.0",
    approved: false, // unapproved / invalid
    provenance: null,
  },
];

test("generateSourceGroundedResponse returns explicit source citation for valid grounded question", () => {
  const result = generateSourceGroundedResponse("q_1", sampleSnapshotQuestions);
  assert.equal(result.refused, false);
  assert.equal(result.question_id, "q_1");
  assert.equal(result.citation?.document_id, "math_101_book");
  assert.equal(result.citation?.page_number, 12);
  assert.equal(result.citation?.section, "Section 1: Addition");
});

test("generateSourceGroundedResponse returns explicit refusal when source provenance is missing or unapproved", () => {
  const result = generateSourceGroundedResponse("q_unprovenanced", sampleSnapshotQuestions);
  assert.equal(result.refused, true);
  assert.ok(result.reason?.includes("Insufficient evidence") || result.reason?.includes("unapproved"));
});

test("generateSourceGroundedResponse returns refusal for non-existent question ID", () => {
  const result = generateSourceGroundedResponse("q_non_existent", sampleSnapshotQuestions);
  assert.equal(result.refused, true);
  assert.ok(result.reason?.includes("Insufficient evidence"));
});
