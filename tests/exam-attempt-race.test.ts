import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import mongoose from "mongoose";
import { Exam } from "../src/models/Exam";
import { ExamSession } from "../src/models/ExamSession";
import { ExamAttemptRecord } from "../src/models/ExamAttemptRecord";
import { Chapter } from "../src/models/Chapter";
import { QuestionProvenance } from "../src/models/QuestionProvenance";
import {
  issueAttemptRecord,
  getAttemptHistory,
  getAttemptPolicySnapshot,
} from "../src/lib/exam-attempt-policy";
import { startQuiz } from "../src/lib/business-logic";
import { AttemptPolicyError } from "../src/lib/exam-attempt-policy";

/**
 * Concurrent-start atomicity proof against a real MongoDB.
 *
 * Cooldown boundaries are always proven with the injected server clock (the
 * `now` parameter of `startQuiz`) — never with real sleep. This suite requires
 * a configured test MongoDB; without one every test is reported SKIPPED with
 * the exact blocker.
 */

const TEST_URI =
  process.env.UNIVAI_EXAM_POLICY_TEST_MONGODB_URI ??
  "mongodb://127.0.0.1:27017/exam_system_attempt_policy_test";

const T0 = new Date("2026-08-01T00:00:00.000Z");
const QUIZ_COOLDOWN_MS = 3 * 60 * 60 * 1000;

async function dbBlocker(): Promise<string | null> {
  if (mongoose.connection.readyState === 1) return null;
  try {
    await mongoose.connect(TEST_URI, { serverSelectionTimeoutMS: 2000 });
    await ExamAttemptRecord.createIndexes();
    await Exam.init();
    await ExamSession.init();
    await QuestionProvenance.init();
    return null;
  } catch (error) {
    await mongoose.disconnect().catch(() => undefined);
    return `MongoDB not reachable at ${TEST_URI}: ${error instanceof Error ? error.message : String(error)}`;
  }
}

async function cleanCollections(): Promise<void> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("test database is not connected");
  await Promise.all([
    db.collection("examattemptrecords").deleteMany({}),
    db.collection("exams").deleteMany({}),
    db.collection("examsessions").deleteMany({}),
    db.collection("chapters").deleteMany({}),
    db.collection("questionprovenances").deleteMany({}),
    db.collection("audit_logs").deleteMany({}),
  ]);
}

async function seedChapter(id: string, learnerId?: string): Promise<void> {
  const chapterId = new mongoose.Types.ObjectId(id);
  await Chapter.create({
    _id: chapterId,
    curriculum_id: new mongoose.Types.ObjectId("64b000000000000000000021"),
    title: `Chapter ${id}`,
    number: 1,
  });

  if (!learnerId) return;

  await QuestionProvenance.insertMany(
    Array.from({ length: 5 }, (_, index) => ({
      blueprint_id: chapterId,
      schema_version: "question-provenance-v1",
      question_id: `attempt-policy-${id}-${index + 1}`,
      prompt: `Attempt policy fixture question ${index + 1}?`,
      type: "mcq",
      options: ["Option A", "Option B", "Option C", "Option D"],
      correct_option: "Option A",
      plan_version: "attempt-policy-fixture-v1",
      package_id: `attempt-policy-${id}`,
      chapter_id: chapterId,
      learner_id: learnerId,
      approved: true,
      provenance: {
        document_id: `attempt-policy-source-${id}`,
        document_title: `Attempt policy source ${id}`,
        page_number: index + 1,
        section: "Published quiz fixture",
      },
    })),
  );
}

/**
 * Every test exercises a different learner so that session state (keyed by
 * student_id) can never leak across tests.
 */
const studentFor = (suffix: string) => `64b0000000000000000000${suffix}`;

let blocker: string | null = null;

before(async () => {
  blocker = await dbBlocker();
  if (!blocker) await cleanCollections();
});

after(async () => {
  const db = mongoose.connection.db;
  if (db) await db.dropDatabase().catch(() => undefined);
  await mongoose.disconnect();
});

test("concurrent start requests issue exactly one attempt and one deterministic outcome", async (t) => {
  if (blocker) return t.skip(blocker);
  await seedChapter("64b000000000000000000011", studentFor("01"));
  const results = await Promise.allSettled([
    startQuiz(studentFor("01"), "64b000000000000000000011", undefined, undefined, T0),
    startQuiz(studentFor("01"), "64b000000000000000000011", undefined, undefined, T0),
  ]);

  const winners = results.filter(
    (r) => r.status === "fulfilled" && r.value.created === true,
  );
  assert.equal(winners.length, 1, "exactly one request may create the attempt");

  const history = await getAttemptHistory(
    studentFor("01"),
    "quiz",
    "64b000000000000000000011",
  );
  assert.equal(history.length, 1, "only one attempt record may exist");
  assert.equal(history[0].attempt_number, 1);
  assert.equal(history[0].status, "active");

  assert.equal(
    await Exam.countDocuments({ student_id: studentFor("01"), type: "quiz" }),
    1,
    "only one quiz exam container may exist",
  );
  assert.equal(
    await ExamSession.countDocuments({ student_id: studentFor("01") }),
    1,
    "only one exam session may exist",
  );
});

test("concurrent ledger inserts create exactly one record", async (t) => {
  if (blocker) return t.skip(blocker);
  await seedChapter("64b000000000000000000012");
  const results = await Promise.all(
    Array.from({ length: 10 }, () =>
      issueAttemptRecord({
        learnerId: studentFor("02"),
        type: "quiz",
        assessmentId: "64b000000000000000000012",
        sourceExamId: new mongoose.Types.ObjectId(),
        now: T0,
        basedOnAttemptNumber: 0,
      }),
    ),
  );
  const created = results.filter((r) => r.created);
  assert.equal(created.length, 1, "exactly one concurrent insert may create the record");
  const history = await getAttemptHistory(
    studentFor("02"),
    "quiz",
    "64b000000000000000000012",
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].attempt_number, 1);
});

test("resume of an active attempt issues no new attempt", async (t) => {
  if (blocker) return t.skip(blocker);
  await seedChapter("64b000000000000000000013", studentFor("03"));
  const first = await startQuiz(studentFor("03"), "64b000000000000000000013", undefined, undefined, T0);
  assert.equal(first.created, true);

  const resumed = await startQuiz(studentFor("03"), "64b000000000000000000013", undefined, undefined, T0);
  assert.equal(resumed.created, false);
  assert.equal(resumed.resumed, true);

  const history = await getAttemptHistory(studentFor("03"), "quiz", "64b000000000000000000013");
  assert.equal(history.length, 1, "refresh/resume must not consume another attempt");
  assert.equal(history[0].attempt_number, 1);
});

test("three-hour cooldown enforced by the injected server clock", async (t) => {
  if (blocker) return t.skip(blocker);
  await seedChapter("64b000000000000000000014", studentFor("04"));
  await startQuiz(studentFor("04"), "64b000000000000000000014", undefined, undefined, T0);

  // Simulate the server terminalizing the session (browser close + timeout).
  await ExamSession.updateOne(
    { student_id: studentFor("04") },
    {
      $set: {
        status: "terminated",
        terminated_reason: "heartbeat_failure",
        ended_at: T0,
      },
    },
  );

  const oneMsBefore = await startQuiz(studentFor("04"), "64b000000000000000000014", undefined, undefined, new Date(T0.getTime() + QUIZ_COOLDOWN_MS - 1)).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(oneMsBefore instanceof AttemptPolicyError);
  assert.equal(oneMsBefore.status, 429);
  assert.equal(oneMsBefore.reason_code, "cooldown");

  const exactlyAt = await startQuiz(studentFor("04"), "64b000000000000000000014", undefined, undefined, new Date(T0.getTime() + QUIZ_COOLDOWN_MS));
  assert.equal(exactlyAt.created, false);
  assert.equal(exactlyAt.exam.attempt_number, 2);

  const history = await getAttemptHistory(studentFor("04"), "quiz", "64b000000000000000000014");
  assert.equal(history.length, 2);
  assert.equal(history[0].status, "timed_out", "browser close is never a refund");
  assert.equal(history[1].attempt_number, 2);
  assert.equal(history[1].status, "active");
});

test("exhaustion rejects a third quiz attempt", async (t) => {
  if (blocker) return t.skip(blocker);
  await seedChapter("64b000000000000000000015", studentFor("05"));
  await startQuiz(studentFor("05"), "64b000000000000000000015", undefined, undefined, T0);
  await ExamSession.updateOne(
    { student_id: studentFor("05") },
    {
      $set: {
        status: "terminated",
        terminated_reason: "heartbeat_failure",
        ended_at: T0,
      },
    },
  );
  await startQuiz(studentFor("05"), "64b000000000000000000015", undefined, undefined, new Date(T0.getTime() + QUIZ_COOLDOWN_MS));
  await ExamSession.updateOne(
    { student_id: studentFor("05") },
    {
      $set: {
        status: "terminated",
        terminated_reason: "heartbeat_failure",
        ended_at: new Date(T0.getTime() + QUIZ_COOLDOWN_MS),
      },
    },
  );

  const third = await startQuiz(studentFor("05"), "64b000000000000000000015", undefined, undefined, new Date(T0.getTime() + 2 * QUIZ_COOLDOWN_MS)).then(
    () => null,
    (error: unknown) => error,
  );
  assert.ok(third instanceof AttemptPolicyError);
  assert.equal(third.status, 403);
  assert.equal(third.reason_code, "exhausted");

  const history = await getAttemptHistory(studentFor("05"), "quiz", "64b000000000000000000015");
  assert.equal(history.length, 2);
});

test("browser close never refunds an attempt", async (t) => {
  if (blocker) return t.skip(blocker);
  await seedChapter("64b000000000000000000016", studentFor("06"));
  const student = studentFor("06");
  const first = await startQuiz(student, "64b000000000000000000016", undefined, undefined, T0);
  assert.equal(first.created, true);

  // Simulate the server terminalizing the session (browser close).
  await ExamSession.updateOne(
    { student_id: student },
    {
      $set: {
        status: "terminated",
        terminated_reason: "heartbeat_failure",
        ended_at: T0,
      },
    },
  );

  // One hour before the cooldown clears, the interrupted attempt is NOT
  // refunded: it still consumes slot 1, so only one slot remains.
  const snapshot = await getAttemptPolicySnapshot(
    first.exam,
    new Date(T0.getTime() + 2 * 60 * 60 * 1000),
  );
  assert.equal(snapshot.reason_code, "cooldown", "a timed-out attempt still enters cooldown");
  assert.equal(snapshot.attempts_used, 1, "the interrupted attempt is never refunded");
  assert.equal(snapshot.attempts_remaining, 1);

  // After the full cooldown the learner may start attempt 2 — still only one
  // used slot, proving the timed-out attempt was not refunded.
  const exactlyAt = await startQuiz(
    student,
    "64b000000000000000000016",
    undefined,
    undefined,
    new Date(T0.getTime() + QUIZ_COOLDOWN_MS),
  );
  assert.equal(exactlyAt.exam.attempt_number, 2);
  const after = await getAttemptPolicySnapshot(exactlyAt.exam, new Date(T0.getTime() + QUIZ_COOLDOWN_MS));
  assert.equal(after.attempts_used, 2, "attempt 2 consumed the final quiz slot");
  assert.equal(after.attempts_remaining, 0);

  const history = await getAttemptHistory(student, "quiz", "64b000000000000000000016");
  assert.equal(history.length, 2);
  assert.equal(history[0].status, "timed_out", "browser close is never a refund");
  assert.equal(history[1].status, "active");
});

test("unique ledger index exists", async (t) => {
  if (blocker) return t.skip(blocker);
  const indexes = await ExamAttemptRecord.collection.indexes();
  const unique = indexes.some(
    (index) =>
      index.key &&
      index.unique === true &&
      "learner_id" in index.key &&
      "assessment_type" in index.key &&
      "assessment_id" in index.key &&
      "previous_attempt_number" in index.key,
  );
  assert.equal(unique, true, "compound unique index must exist for atomic issuance");
});
