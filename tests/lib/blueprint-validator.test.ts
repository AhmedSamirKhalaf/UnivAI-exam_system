// @ts-expect-error Vitest is supplied by the issue's mandatory npx command.
import { describe, expect, test } from "vitest";
import {
  publishQuestions,
  validateProposedQuestions,
  validateQuestionProvenance,
} from "../../src/lib/blueprint-validator";

const approvedBlueprint = {
  schema_version: "assessment-blueprint-v1",
  programme: "Computer Science",
  semester: "Fall 2026",
  course_id: "CS101",
  title: "Introduction to CS Blueprint",
  outcomes: ["Explain variables"],
  difficulty: "medium",
  plan_version: "2026-v1",
  approved: true,
  approved_by: "Academic Committee",
  approved_at: "2026-07-30T00:00:00.000Z",
  source_coverage: [
    {
      document_id: "doc_cs101_textbook",
      document_title: "CS101 Fundamentals",
      sections: ["Chapter 2: Variables"],
      page_ranges: [{ start: 10, end: 30 }],
    },
  ],
};

const proposedQuestion = {
  schema_version: "question-provenance-v1",
  question_id: "q_cs101_1",
  prompt: "What is a variable in programming?",
  type: "mcq",
  options: ["A memory location", "A function", "A loop", "A compiler"],
  correct_option: "A memory location",
  plan_version: "2026-v1",
  provenance: {
    document_id: "doc_cs101_textbook",
    document_title: "CS101 Fundamentals",
    page_number: 14,
    section: "Chapter 2: Variables",
    excerpt: "A variable stores a value in a named memory location.",
  },
};

describe("blueprint question publication", () => {
  test("publishes a valid proposed question through the approved blueprint", () => {
    const result = validateQuestionProvenance(
      proposedQuestion,
      approvedBlueprint,
    );

    expect(result).toMatchObject({ valid: true, errors: [] });
    expect(result.validatedQuestion).toMatchObject({
      question_id: "q_cs101_1",
      approved: true,
      plan_version: "2026-v1",
    });
  });

  test("refuses an unapproved blueprint", () => {
    const result = validateQuestionProvenance(proposedQuestion, {
      ...approvedBlueprint,
      approved: false,
      approved_by: undefined,
      approved_at: undefined,
    });

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("not approved");
  });

  test("does not trust a proposed question that marks itself approved", () => {
    const result = validateQuestionProvenance(
      { ...proposedQuestion, approved: true },
      approvedBlueprint,
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("cannot approve themselves");
  });

  test("refuses a plan-version mismatch", () => {
    const result = validateQuestionProvenance(
      { ...proposedQuestion, plan_version: "2025-v2" },
      approvedBlueprint,
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("does not match");
  });

  test("refuses a page outside the approved source ranges", () => {
    const result = validateQuestionProvenance(
      {
        ...proposedQuestion,
        provenance: { ...proposedQuestion.provenance, page_number: 99 },
      },
      approvedBlueprint,
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("outside the approved");
  });

  test("refuses a document or section absent from source coverage", () => {
    const result = validateQuestionProvenance(
      {
        ...proposedQuestion,
        provenance: {
          ...proposedQuestion.provenance,
          section: "Chapter 99: Invented Material",
        },
      },
      approvedBlueprint,
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("not covered");
  });

  test("rejects duplicate question IDs as a batch", () => {
    const result = validateProposedQuestions(
      [proposedQuestion, proposedQuestion],
      approvedBlueprint,
    );

    expect(result.valid).toBe(false);
    expect(result.errors.join(" ")).toContain("duplicate question ID");
    expect(result.validatedQuestions).toEqual([]);
  });

  test("publication throws instead of returning partial valid questions", () => {
    expect(() =>
      publishQuestions(
        [
          proposedQuestion,
          {
            ...proposedQuestion,
            question_id: "q_bad",
            provenance: { ...proposedQuestion.provenance, page_number: 500 },
          },
        ],
        approvedBlueprint,
      ),
    ).toThrow(/Question publication refused/);
  });
});
