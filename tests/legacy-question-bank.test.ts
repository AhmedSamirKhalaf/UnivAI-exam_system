import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import { legacyQuestionToPublished } from "../src/lib/business-logic";

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
