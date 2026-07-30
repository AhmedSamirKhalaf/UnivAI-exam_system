// @ts-expect-error Vitest is supplied by the issue's mandatory npx command.
import { describe, expect, test } from "vitest";
import mongoose from "mongoose";
import {
  generateSourceGroundedResponse,
  gradeQuestionSnapshot,
} from "../../src/lib/source-grounded-grading";
import { Exam } from "../../src/models/Exam";

const publishedQuestions = [
  {
    schema_version: "question-provenance-v1",
    question_id: "q_tree_01",
    prompt: "What is the maximum node count at height h?",
    type: "mcq",
    options: ["2^h", "2^(h+1) - 1", "h^2"],
    correct_option: "2^(h+1) - 1",
    plan_version: "2026-v1",
    approved: true,
    provenance: {
      document_id: "doc_algorithms",
      document_title: "Algorithms",
      page_number: 84,
      section: "Binary Trees",
      excerpt: "The maximum is 2^(h+1) - 1 nodes.",
    },
  },
  {
    schema_version: "question-provenance-v1",
    question_id: "q_bfs_01",
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

describe("source-grounded grading", () => {
  test("known fixture produces the expected trusted score", () => {
    const grade = gradeQuestionSnapshot(
      publishedQuestions,
      [
        { question_id: "q_tree_01", answer: "2^(h+1) - 1" },
        { question_id: "q_bfs_01", answer: "Queue" },
      ],
      2,
      "clean",
    );

    expect(grade).toEqual({
      mark: 2,
      passing_mark: 2,
      passed: true,
      grading_status: "auto_graded",
    });
  });

  test("duplicate answer IDs cannot increase the score", () => {
    expect(() =>
      gradeQuestionSnapshot(
        publishedQuestions,
        [
          { question_id: "q_bfs_01", answer: "Queue" },
          { question_id: "q_bfs_01", answer: "Queue" },
        ],
        2,
        "clean",
      ),
    ).toThrow(/duplicate question IDs/);
  });

  test("the exam model rejects duplicate answers on submission", async () => {
    const exam = new Exam({
      type: "quiz",
      title: "Grounded quiz",
      student_id: new mongoose.Types.ObjectId(),
      blueprint_id: new mongoose.Types.ObjectId(),
      plan_version: "2026-v1",
      questions_snapshot: publishedQuestions,
      student_answers: [
        { question_id: "q_bfs_01", answer: "Queue" },
        { question_id: "q_bfs_01", answer: "Queue" },
      ],
      taken: true,
    });

    await expect(exam.validate()).rejects.toThrow(/duplicate question IDs/);
  });

  test("the exam model replaces a client-supplied mark with trusted grading", async () => {
    const exam = new Exam({
      type: "quiz",
      title: "Grounded quiz",
      student_id: new mongoose.Types.ObjectId(),
      blueprint_id: new mongoose.Types.ObjectId(),
      plan_version: "2026-v1",
      questions_snapshot: publishedQuestions,
      student_answers: [
        { question_id: "q_tree_01", answer: "wrong" },
        { question_id: "q_bfs_01", answer: "Queue" },
      ],
      taken: true,
      mark: 99,
      passing_mark: 2,
      passed: true,
    });

    await exam.validate();

    expect(exam.mark).toBe(1);
    expect(exam.passed).toBe(false);
  });

  test("unknown question IDs are rejected", () => {
    expect(() =>
      gradeQuestionSnapshot(
        publishedQuestions,
        [{ question_id: "q_unknown", answer: "Queue" }],
        1,
        "clean",
      ),
    ).toThrow(/unknown question/);
  });

  test("an invalidated attempt cannot pass", () => {
    const grade = gradeQuestionSnapshot(
      publishedQuestions,
      [
        { question_id: "q_tree_01", answer: "2^(h+1) - 1" },
        { question_id: "q_bfs_01", answer: "Queue" },
      ],
      2,
      "invalidated",
    );

    expect(grade.mark).toBe(2);
    expect(grade.passed).toBe(false);
  });

  test("essay snapshots remain pending for trusted manual grading", () => {
    const essay = {
      schema_version: "question-provenance-v1",
      question_id: "q_essay",
      prompt: "Explain BFS.",
      type: "essay",
      plan_version: "2026-v1",
      approved: true,
      provenance: {
        document_id: "doc_algorithms",
        document_title: "Algorithms",
        page_number: 143,
        section: "Graph Traversals",
        excerpt: "BFS explores a graph level by level using a queue.",
      },
    };
    const grade = gradeQuestionSnapshot(
      [essay],
      [{ question_id: "q_essay", answer: "It explores level by level." }],
      1,
      "clean",
    );

    expect(grade).toMatchObject({
      mark: 0,
      passed: false,
      grading_status: "pending_review",
    });
  });

  test("returns the exact stored answer and citation for a grounded MCQ", () => {
    const result = generateSourceGroundedResponse(
      "q_bfs_01",
      publishedQuestions,
    );

    expect(result).toMatchObject({
      refused: false,
      answer: "Queue",
      citation: {
        document_id: "doc_algorithms",
        page_number: 142,
        section: "Graph Traversals",
      },
    });
  });

  test("explicitly refuses invalid or absent provenance", () => {
    const invalid = structuredClone(publishedQuestions);
    invalid[0].provenance.page_number = 0;

    expect(
      generateSourceGroundedResponse("q_tree_01", invalid),
    ).toMatchObject({ refused: true });
    expect(
      generateSourceGroundedResponse("q_missing", publishedQuestions),
    ).toMatchObject({ refused: true });
  });
});
