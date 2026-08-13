import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { Exam } from "../src/models/Exam";
import {
  generateQuestions,
  hasLearnerOwnedMidtermSnapshot,
  learnerQuestionBankFilter,
  legacyQuestionToPublished,
} from "../src/lib/business-logic";

test("legacy generated questions become valid immutable quiz snapshots", () => {
  const chapterId = new mongoose.Types.ObjectId("64b000000000000000000099");
  const published = legacyQuestionToPublished(
    {
      prompt: "Which property keeps a system working after a fault?",
      type: "mcq",
      options: ["A) Reliability", "B) Latency", "C) Throughput", "D) Elasticity"],
      correct_option: "A",
      source: "lecture",
    },
    0,
    chapterId,
    "Reliable Systems",
    "S-2026-000014",
  );

  assert.ok(published);
  assert.equal(published.correct_option, "A) Reliability");
  assert.equal(published.blueprint_id, chapterId);
  assert.equal(published.plan_version, "legacy-question-bank-v1");
  assert.equal(published.learner_id, "S-2026-000014");
  assert.deepEqual(published.provenance, {
    document_id: `legacy-question-bank:${chapterId}`,
    document_title: "Reliable Systems",
    page_number: 1,
    section: "Legacy generated quiz bank",
  });
});

test("legacy compatibility rejects malformed questions", () => {
  const chapterId = new mongoose.Types.ObjectId("64b000000000000000000099");
  const published = legacyQuestionToPublished(
    {
      prompt: "Broken question",
      type: "mcq",
      options: ["A) One", "B) Two"],
      correct_option: "D",
    },
    0,
    chapterId,
    "Reliable Systems",
    "S-2026-000014",
  );

  assert.equal(published, null);
});

test("legacy final compatibility accepts native six-option questions", () => {
  const chapterId = new mongoose.Types.ObjectId("64b000000000000000000099");
  const published = legacyQuestionToPublished(
    {
      prompt: "Which answer is grounded?",
      type: "mcq",
      options: ["A) One", "B) Two", "C) Three", "D) Four", "E) Five", "F) Six"],
      correct_option: "F",
    },
    0,
    chapterId,
    "Reliable Systems",
    "S-2026-000014",
    6,
  );

  assert.ok(published);
  assert.equal(published.correct_option, "F) Six");
  assert.equal((published.options as string[]).length, 6);
});

test("legacy final compatibility safely expands an old four-option bank", () => {
  const chapterId = new mongoose.Types.ObjectId("64b000000000000000000099");
  const published = legacyQuestionToPublished(
    {
      prompt: "Which property keeps a system working after a fault?",
      type: "mcq",
      options: ["A) Reliability", "B) Latency", "C) Throughput", "D) Elasticity"],
      correct_option: "A",
    },
    0,
    chapterId,
    "Reliable Systems",
    "S-2026-000014",
    6,
  );

  assert.ok(published);
  assert.equal(published.correct_option, "A) Reliability");
  assert.deepEqual((published.options as string[]).slice(4), [
    "E) None of the other answers is correct",
    "F) More than one of the other answers is correct",
  ]);
});

test("fallback generation uses four quiz options and six midterm/final options", async () => {
  const chapterId = new mongoose.Types.ObjectId("64b000000000000000000099");
  const quiz = await generateQuestions(chapterId, 2, "quiz");
  const midterm = await generateQuestions(chapterId, 2, "mid");
  const final = await generateQuestions(chapterId, 4, "final");

  for (const question of quiz) {
    assert.equal((question.options as string[]).length, 4);
    assert.ok((question.options as string[]).includes(question.correct_option as string));
  }
  for (const question of midterm) {
    assert.equal((question.options as string[]).length, 6);
    assert.ok((question.options as string[]).includes(question.correct_option as string));
  }
  for (const question of final.filter((item) => item.type === "mcq")) {
    assert.equal((question.options as string[]).length, 6);
    assert.ok((question.options as string[]).includes(question.correct_option as string));
  }
});

test("fallback bank reads require the complete learner and curriculum binding", () => {
  const chapterId = new mongoose.Types.ObjectId("64b000000000000000000099");
  const curriculumId = new mongoose.Types.ObjectId("64c000000000000000000099");
  const firstStudent = new mongoose.Types.ObjectId("64d000000000000000000001");
  const secondStudent = new mongoose.Types.ObjectId("64d000000000000000000002");

  const first = learnerQuestionBankFilter(chapterId, {
    studentId: firstStudent,
    studentSid: "S-2026-000001",
    curriculumId,
  });
  const second = learnerQuestionBankFilter(chapterId, {
    studentId: secondStudent,
    studentSid: "S-2026-000002",
    curriculumId,
  });

  assert.equal(first.owner_sid, "S-2026-000001");
  assert.equal(second.owner_sid, "S-2026-000002");
  assert.notDeepEqual(first.student_id, second.student_id);
  assert.deepEqual(first.curriculum_id, {
    $in: [curriculumId, curriculumId.toString()],
  });
  assert.equal("$or" in first, false);
});

test("only a complete learner-owned immutable midterm package is startable", () => {
  const packageHash = "a".repeat(64);
  assert.equal(
    hasLearnerOwnedMidtermSnapshot({
      student_sid: "S-2026-000014",
      package_id: "learner-mid.student.hash",
      package_version: "learner-midterm-package-v1",
      package_hash: packageHash,
      publication_key: "learner-mid:student:curriculum:title",
      questions_snapshot: Array.from({ length: 12 }, (_, index) => ({ index })),
    }),
    true,
  );
  assert.equal(
    hasLearnerOwnedMidtermSnapshot({
      student_sid: "S-2026-000014",
      package_id: "learner-mid.student.hash",
      package_version: "learner-midterm-package-v1",
      package_hash: packageHash,
      publication_key: "learner-mid:student:curriculum:title",
      questions_snapshot: [],
    }),
    false,
  );
});

test("midterm identity has a unique learner/course/title index", () => {
  const index = Exam.schema.indexes().find(([keys, options]) =>
    keys.student_id === 1 &&
    keys.curriculum_id === 1 &&
    keys.type === 1 &&
    keys.title === 1 &&
    options.unique === true,
  );
  assert.ok(index, "concurrent midterm materialization must converge on one exam");
});
