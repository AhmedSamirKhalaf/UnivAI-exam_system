import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import {
  answerCurrentQuestionSchema,
  buildExamAttemptView,
} from "../src/lib/exam-attempt";

const exam = {
  _id: new mongoose.Types.ObjectId("64b000000000000000000099"),
  type: "quiz" as const,
  title: "Current question contract",
  taken: false,
  integrity_status: "clean" as const,
  generated_questions: [
    {
      question_id: "q_1",
      prompt: "First question",
      type: "mcq",
      options: ["A) One", "B) Two"],
      correct_option: "A",
      provenance: { page: 1 },
    },
    {
      question_id: "q_2",
      prompt: "Future question must stay server-side",
      type: "essay",
      correct_option: "hidden",
    },
  ],
};

test("attempt view exposes only the current public question", () => {
  const view = buildExamAttemptView(exam, {
    current_question_index: 0,
    answer_revision: 0,
    answers: [],
    status: "in_progress",
  });

  assert.equal(view.current_question?.question_id, "q_1");
  assert.equal(JSON.stringify(view).includes("Future question"), false);
  assert.equal(JSON.stringify(view).includes("correct_option"), false);
  assert.equal(JSON.stringify(view).includes("provenance"), false);
  assert.deepEqual(view.progress, { position: 1, total: 2, answered: 0 });
});

test("attempt view advances by server session state", () => {
  const view = buildExamAttemptView(exam, {
    current_question_index: 1,
    answer_revision: 1,
    answers: [{ question_id: "q_1", answer: "A" }],
    status: "in_progress",
  });

  assert.equal(view.current_question?.question_id, "q_2");
  assert.equal(view.answer_revision, 1);
  assert.equal(view.progress.answered, 1);
});

test("answer contract rejects unknown fields and oversized answers", () => {
  const valid = {
    question_id: "q_1",
    answer: "A",
    action: "answer",
    revision: 0,
    idempotency_key: "answer-0001",
  };
  assert.equal(answerCurrentQuestionSchema.safeParse(valid).success, true);
  assert.equal(
    answerCurrentQuestionSchema.safeParse({ ...valid, current_index: 99 }).success,
    false,
  );
  assert.equal(
    answerCurrentQuestionSchema.safeParse({ ...valid, answer: "x".repeat(10_001) }).success,
    false,
  );
});
