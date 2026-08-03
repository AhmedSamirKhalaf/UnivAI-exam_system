import assert from "node:assert/strict";
import test from "node:test";
import {
  ATTEMPT_POLICY_VERSION,
  EXAM_ATTEMPT_POLICY,
  attemptPolicyStatement,
  evaluateAttemptPolicy,
  policyErrorForSnapshot,
  type AttemptPolicySnapshot,
  type AttemptRecordInput,
  type AttemptTerminalStatus,
} from "../src/lib/exam-attempt-policy";
import {
  startFinalSchema,
  startMidSchema,
  startQuizSchema,
} from "../src/lib/request-validation";

/**
 * Deterministic attempt-policy tests. Every cooldown boundary is proven with
 * an injected server clock — never with real sleep. Client clocks, forged
 * request timestamps and forged counters cannot influence eligibility.
 */

const T0 = new Date("2026-08-01T00:00:00.000Z");

function attempt(
  attempt_number: number,
  status: AttemptTerminalStatus,
  terminal_at?: Date,
): AttemptRecordInput {
  return { attempt_number, status, issued_at: T0, terminal_at };
}

function at(ms: number): Date {
  return new Date(T0.getTime() + ms);
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const COOLDOWN: Record<"quiz" | "mid" | "final", number> = {
  quiz: EXAM_ATTEMPT_POLICY.quiz.cooldown_seconds * 1000,
  mid: EXAM_ATTEMPT_POLICY.mid.cooldown_seconds * 1000,
  final: EXAM_ATTEMPT_POLICY.final.cooldown_seconds * 1000,
};

function assertPolicyMatchesProductTable() {
  assert.equal(EXAM_ATTEMPT_POLICY.quiz.max_attempts, 2);
  assert.equal(EXAM_ATTEMPT_POLICY.quiz.cooldown_seconds, 3 * 60 * 60);
  assert.equal(EXAM_ATTEMPT_POLICY.mid.max_attempts, 3);
  assert.equal(EXAM_ATTEMPT_POLICY.mid.cooldown_seconds, 5 * 60 * 60);
  assert.equal(EXAM_ATTEMPT_POLICY.final.max_attempts, 2);
  assert.equal(EXAM_ATTEMPT_POLICY.final.cooldown_seconds, 2 * 24 * 60 * 60);
}

test("product table is the exact source of truth (quiz 2/3h, mid 3/5h, final 2/48h)", () => {
  assertPolicyMatchesProductTable();
  assert.equal(attemptPolicyStatement("quiz"), "Quiz: 2 attempts, 3 hours between attempts");
  assert.equal(attemptPolicyStatement("mid"), "Midterm: 3 attempts, 5 hours");
  assert.equal(attemptPolicyStatement("final"), "Final: 2 attempts, 2 days");
});

test("a fresh assessment allows its first attempt", () => {
  for (const type of ["quiz", "mid", "final"] as const) {
    const snapshot = evaluateAttemptPolicy(type, at(0), []);
    assert.equal(snapshot.can_start, true);
    assert.equal(snapshot.reason_code, "ok");
    assert.equal(snapshot.attempts_used, 0);
    assert.equal(snapshot.attempts_remaining, EXAM_ATTEMPT_POLICY[type].max_attempts);
    assert.equal(snapshot.next_attempt_at, null);
  }
});

test("quiz: attempt 2 needs exactly 3 hours; attempt 3 is rejected", () => {
  const first = attempt(1, "submitted", at(0));

  const before = evaluateAttemptPolicy("quiz", at(COOLDOWN.quiz - 1), [first]);
  assert.equal(before.can_start, false);
  assert.equal(before.reason_code, "cooldown");
  assert.equal(before.attempts_remaining, 1);
  assert.equal(before.next_attempt_at, new Date(T0.getTime() + COOLDOWN.quiz).toISOString());

  const exact = evaluateAttemptPolicy("quiz", at(COOLDOWN.quiz), [first]);
  assert.equal(exact.can_start, true);
  assert.equal(exact.reason_code, "ok");
  assert.equal(exact.attempts_remaining, 1);

  const second = attempt(2, "submitted", at(COOLDOWN.quiz));
  const exhausted = evaluateAttemptPolicy("quiz", at(2 * COOLDOWN.quiz), [first, second]);
  assert.equal(exhausted.can_start, false);
  assert.equal(exhausted.reason_code, "exhausted");
  assert.equal(exhausted.attempts_remaining, 0);
  assert.equal(exhausted.next_attempt_at, null);
});

test("midterm: attempts 1-3 allowed with 5 hours between each; attempt 4 is rejected", () => {
  let history: AttemptRecordInput[] = [];
  for (let n = 1; n <= 3; n++) {
    if (n > 1) {
      const before = evaluateAttemptPolicy("mid", at((n - 1) * COOLDOWN.mid + COOLDOWN.mid - 1), history);
      assert.equal(before.can_start, false, `mid attempt ${n} must wait`);
      assert.equal(before.reason_code, "cooldown");
    }

    const exact = evaluateAttemptPolicy("mid", at((n - 1) * COOLDOWN.mid + COOLDOWN.mid), history);
    assert.equal(exact.can_start, true, `mid attempt ${n} eligible exactly at boundary`);
    assert.equal(exact.attempts_remaining, 3 - (n - 1));

    history = [...history, attempt(n, "submitted", at((n - 1) * COOLDOWN.mid + COOLDOWN.mid))];
  }
  const fourth = evaluateAttemptPolicy("mid", at(4 * COOLDOWN.mid), history);
  assert.equal(fourth.can_start, false);
  assert.equal(fourth.reason_code, "exhausted");
  assert.equal(fourth.attempts_remaining, 0);
});

test("final: attempts 1 and 2 allowed with 48 hours between them; attempt 3 is rejected", () => {
  const first = attempt(1, "submitted", at(0));

  const before = evaluateAttemptPolicy("final", at(COOLDOWN.final - 1), [first]);
  assert.equal(before.can_start, false);
  assert.equal(before.reason_code, "cooldown");

  const exact = evaluateAttemptPolicy("final", at(COOLDOWN.final), [first]);
  assert.equal(exact.can_start, true);
  assert.equal(exact.attempts_remaining, 1);

  const second = attempt(2, "submitted", at(COOLDOWN.final));
  const third = evaluateAttemptPolicy("final", at(2 * COOLDOWN.final), [first, second]);
  assert.equal(third.can_start, false);
  assert.equal(third.reason_code, "exhausted");
  assert.equal(third.attempts_remaining, 0);
});

test("one millisecond before and exactly at every cooldown boundary (3h/5h/48h)", () => {
  const cases: Array<[string, number, number]> = [
    ["quiz", 3 * HOUR, 2],
    ["mid", 5 * HOUR, 3],
    ["final", 2 * DAY, 2],
  ];
  for (const [type, cooldownMs, maxAttempts] of cases) {
    for (let n = 1; n < maxAttempts; n++) {
      const history = [attempt(1, "submitted", at(0))];
      const boundary = at(cooldownMs);
      const oneMsBefore = evaluateAttemptPolicy(type, new Date(boundary.getTime() - 1), history);
      assert.equal(oneMsBefore.can_start, false, `${type}: blocked 1ms before boundary`);
      assert.equal(oneMsBefore.reason_code, "cooldown");
      const exactBoundary = evaluateAttemptPolicy(type, boundary, history);
      assert.equal(exactBoundary.can_start, true, `${type}: allowed exactly at boundary`);
    }
  }
});

test("refresh/resume of an active attempt never issues a new attempt", () => {
  const active = attempt(1, "active");
  const snapshot = evaluateAttemptPolicy("quiz", at(COOLDOWN.quiz), [active]);
  assert.equal(snapshot.can_start, false);
  assert.equal(snapshot.reason_code, "attempt_active");
  assert.equal(snapshot.attempts_used, 1);
  assert.equal(snapshot.attempts_remaining, 1);
});

test("closing the browser is not a refund: a timed-out attempt still consumes it", () => {
  const timedOut = attempt(1, "timed_out", at(0));
  const before = evaluateAttemptPolicy("quiz", at(COOLDOWN.quiz - 1), [timedOut]);
  assert.equal(before.can_start, false);
  assert.equal(before.reason_code, "cooldown");
  assert.equal(before.attempts_used, 1);
  const exact = evaluateAttemptPolicy("quiz", at(COOLDOWN.quiz), [timedOut]);
  assert.equal(exact.can_start, true);
});

test("all terminal states calculate cooldown from their server terminal time", () => {
  const terminalStates: AttemptTerminalStatus[] = [
    "submitted",
    "timed_out",
    "invalidated",
    "admin_closed",
  ];
  for (const status of terminalStates) {
    const record = attempt(1, status, at(1000));
    const snapshot = evaluateAttemptPolicy("quiz", at(1000 + COOLDOWN.quiz - 1), [record]);
    assert.equal(snapshot.reason_code, "cooldown", `${status} must enter cooldown`);
    assert.equal(
      snapshot.next_attempt_at,
      new Date(1000 + COOLDOWN.quiz + T0.getTime()).toISOString(),
    );
    const eligible = evaluateAttemptPolicy("quiz", at(1000 + COOLDOWN.quiz), [record]);
    assert.equal(eligible.can_start, true, `${status} attempt is replaceable after cooldown`);
  }
});

test("unknown assessment types fail closed with no default", () => {
  const snapshot = evaluateAttemptPolicy("surprise", at(0), []);
  assert.equal(snapshot.can_start, false);
  assert.equal(snapshot.reason_code, "unknown_assessment_type");
  assert.equal(snapshot.max_attempts, 0);
  assert.equal(snapshot.cooldown_seconds, 0);
});

test("attempt decisions are isolated per learner and per assessment", () => {
  const studentA = [attempt(1, "submitted", at(0)), attempt(2, "submitted", at(COOLDOWN.quiz))];
  const quizSnapshot = evaluateAttemptPolicy("quiz", at(2 * COOLDOWN.quiz), studentA);
  assert.equal(quizSnapshot.reason_code, "exhausted");

  const freshMid = evaluateAttemptPolicy("mid", at(0), []);
  assert.equal(freshMid.can_start, true, "a quiz history must never affect a midterm");

  const freshFinal = evaluateAttemptPolicy("final", at(0), []);
  assert.equal(freshFinal.can_start, true, "a quiz history must never affect a final");

  const anotherQuiz = evaluateAttemptPolicy("quiz", at(0), []);
  assert.equal(anotherQuiz.can_start, true, "another learner or assessment starts fresh");
});

test("clock tampering and forged timestamps in a request cannot grant eligibility", () => {
  const forgedFuture = attempt(1, "submitted", at(COOLDOWN.quiz));
  const snapshot = evaluateAttemptPolicy("quiz", at(0), [forgedFuture]);
  assert.equal(snapshot.can_start, false, "a future terminal timestamp is still cooldown");
  assert.equal(
    snapshot.next_attempt_at,
    new Date(COOLDOWN.quiz + COOLDOWN.quiz + T0.getTime()).toISOString(),
  );
});

test("request bodies cannot carry attempt numbers, issued times, or next-attempt times", () => {
  const quizBody = {
    student_id: "64b000000000000000000001",
    chapter_id: "64b000000000000000000011",
  };
  assert.equal(startQuizSchema.safeParse(quizBody).success, true);
  assert.equal(
    startQuizSchema.safeParse({ ...quizBody, attempt_number: 5 }).success,
    false,
  );
  assert.equal(
    startQuizSchema.safeParse({ ...quizBody, issued_at: T0.toISOString() }).success,
    false,
  );
  assert.equal(
    startQuizSchema.safeParse({ ...quizBody, next_attempt_at: T0.toISOString() }).success,
    false,
  );

  const midBody = { student_id: "64b000000000000000000001" };
  assert.equal(startMidSchema.safeParse(midBody).success, true);
  assert.equal(startMidSchema.safeParse({ ...midBody, attempt_number: 2 }).success, false);

  const finalBody = {
    student_id: "64b000000000000000000001",
    curriculum_id: "64b000000000000000000021",
  };
  assert.equal(startFinalSchema.safeParse(finalBody).success, true);
  assert.equal(startFinalSchema.safeParse({ ...finalBody, attempt_number: 3 }).success, false);
});

test("policy errors map to the exact failure contract statuses", () => {
  const activeSnapshot = evaluateAttemptPolicy("quiz", at(0), [attempt(1, "active")]);
  assert.equal(policyErrorForSnapshot(activeSnapshot, at(0)).status, 409);

  const cooldownSnapshot = evaluateAttemptPolicy("quiz", at(COOLDOWN.quiz - 1), [
    attempt(1, "submitted", at(0)),
  ]);
  const cooldownError = policyErrorForSnapshot(cooldownSnapshot, at(COOLDOWN.quiz - 1));
  assert.equal(cooldownError.status, 429);
  assert.ok(cooldownError.retryAfterMs !== undefined && cooldownError.retryAfterMs > 0);

  const exhaustedSnapshot = evaluateAttemptPolicy("quiz", at(2 * COOLDOWN.quiz), [
    attempt(1, "submitted", at(0)),
    attempt(2, "submitted", at(COOLDOWN.quiz)),
  ]);
  assert.equal(policyErrorForSnapshot(exhaustedSnapshot, at(2 * COOLDOWN.quiz)).status, 403);

  const unknownSnapshot = evaluateAttemptPolicy("nope", at(0), []);
  assert.equal(policyErrorForSnapshot(unknownSnapshot, at(0)).status, 400);
});

test("snapshots are versioned and typed", () => {
  const snapshot = evaluateAttemptPolicy("quiz", at(0), []);
  assert.equal((snapshot as AttemptPolicySnapshot).assessment_type, "quiz");
  assert.equal(snapshot.cooldown_seconds, 3 * 60 * 60);
  assert.equal(typeof ATTEMPT_POLICY_VERSION, "string");
  assert.ok(ATTEMPT_POLICY_VERSION.length > 0);
});
