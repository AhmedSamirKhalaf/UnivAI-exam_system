import { createHmac } from "node:crypto";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3200";
const DEFAULT_STANDALONE_SECRET = "univai-exam-local-development-only";

const SEED_PATH = resolve(__dirname, "..", "e2e", "fixtures", "seed-state.json");

const CHAPTERS = {
  one: "64b000000000000000000011",
  two: "64b000000000000000000012",
  three: "64b000000000000000000013",
  four: "64b000000000000000000014",
} as const;

const SCENARIO_EXAMS = {
  notStarted: "64b000000000000000000021",
  active: "64b000000000000000000022",
  submitted: "64b000000000000000000023",
  finalPending: "64b000000000000000000024",
  finalFlagged: "64b000000000000000000025",
} as const;

type LaunchView = {
  _id: string;
  type: "quiz" | "mid" | "final";
  title: string;
  taken: boolean;
  current_question: {
    question_id: string;
    type: "mcq" | "essay";
    correct_option?: string;
  } | null;
  progress: { position: number; total: number; answered: number };
  answer_revision: number;
  can_submit: boolean;
};

function loadSeed(): {
  student: { _id: string };
  gate_student: { _id: string };
  curriculum: { _id: string };
} {
  const fixture = JSON.parse(readFileSync(SEED_PATH, "utf8")) as {
    seeds: {
      student: { _id: string };
      gate_student: { _id: string };
      curriculum: { _id: string };
    };
  };
  return fixture.seeds;
}

function standaloneToken(studentId: string): string {
  if (process.env.DEV_TOKEN) return process.env.DEV_TOKEN;
  const secret = process.env.UNIVAI_STANDALONE_SECRET ?? DEFAULT_STANDALONE_SECRET;
  return createHmac("sha256", secret).update(studentId).digest("hex");
}

async function startQuiz(
  request: APIRequestContext,
  baseUrl: string,
  headers: Record<string, string>,
  studentId: string,
  chapterId: string,
): Promise<LaunchView> {
  const response = await request.post(`${baseUrl}/api/exams/quiz/start`, {
    data: { student_id: studentId, chapter_id: chapterId },
    headers,
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as LaunchView;
}

test.describe.serial("final-release public security checks", () => {
  const seed = loadSeed();
  const headers = {
    "x-univai-dev-token": standaloneToken(seed.student._id),
  };
  const badTokenHeaders = {
    "x-univai-dev-token": "invalid-development-token",
  };

  test("S1: protected capture and attempt routes reject a missing or invalid development identity", async ({
    request,
  }) => {
    const webhooksNoToken = await request.get(`${BASE_URL}/api/dev/webhooks`);
    expect(webhooksNoToken.status()).toBe(403);

    const webhooksBadToken = await request.get(`${BASE_URL}/api/dev/webhooks`, {
      headers: badTokenHeaders,
    });
    expect(webhooksBadToken.status()).toBe(403);

    const attemptNoToken = await request.get(
      `${BASE_URL}/api/exams/${SCENARIO_EXAMS.active}`,
    );
    expect(attemptNoToken.ok()).toBe(false);
  });

  test("S2: malformed start payloads are rejected with 400", async ({ request }) => {
    const missingFields = await request.post(`${BASE_URL}/api/exams/quiz/start`, {
      data: { student_id: seed.student._id },
      headers,
    });
    expect(missingFields.status()).toBe(400);

    const emptyStudent = await request.post(`${BASE_URL}/api/exams/quiz/start`, {
      data: { student_id: "", chapter_id: CHAPTERS.one },
      headers,
    });
    expect(emptyStudent.status()).toBe(400);

    const malformedEnrollment = await request.post(`${BASE_URL}/api/enrollments`, {
      data: { student_id: seed.student._id },
      headers,
    });
    expect(malformedEnrollment.status()).toBe(400);
  });

  test("S3: malformed answer payloads are rejected with 400 without advancing the attempt", async ({
    request,
  }) => {
    const exam = await startQuiz(
      request,
      BASE_URL,
      headers,
      seed.student._id,
      CHAPTERS.two,
    );

    const missingKey = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/answer`,
      {
        data: {
          question_id: "anything",
          answer: "A",
          action: "answer",
          revision: 0,
        },
        headers,
      },
    );
    expect(missingKey.status()).toBe(400);

    const badAction = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/answer`,
      {
        data: {
          question_id: "anything",
          answer: "A",
          action: "give_up",
          revision: 0,
          idempotency_key: "security-0001",
        },
        headers,
      },
    );
    expect(badAction.status()).toBe(400);

    const oversized = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/answer`,
      {
        data: {
          question_id: "x".repeat(121),
          answer: "A",
          action: "answer",
          revision: 0,
          idempotency_key: "security-0002",
        },
        headers,
      },
    );
    expect(oversized.status()).toBe(400);

    const view = await request.get(`${BASE_URL}/api/exams/${exam._id}`, {
      headers,
    });
    expect(view.ok()).toBeTruthy();
    const body = await view.json();
    expect(body.progress.answered).toBe(0);
    expect(body.answer_revision).toBe(0);
  });

  test("S4: answering a stale revision or a non-current question is rejected with 409", async ({
    request,
  }) => {
    const exam = await startQuiz(
      request,
      BASE_URL,
      headers,
      seed.student._id,
      CHAPTERS.three,
    );
    const first = exam.current_question;
    expect(first).not.toBeNull();
    expect(exam.progress.total).toBeGreaterThanOrEqual(2);

    const accepted = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/answer`,
      {
        data: {
          question_id: first.question_id,
          answer: "A",
          action: "answer",
          revision: 0,
          idempotency_key: "security-stale-1",
        },
        headers,
      },
    );
    expect(accepted.ok()).toBeTruthy();

    const staleRevision = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/answer`,
      {
        data: {
          question_id: "does-not-matter",
          answer: "A",
          action: "answer",
          revision: 0,
          idempotency_key: "security-stale-2",
        },
        headers,
      },
    );
    expect(staleRevision.status()).toBe(409);

    const wrongQuestion = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/answer`,
      {
        data: {
          question_id: first.question_id,
          answer: "A",
          action: "answer",
          revision: 1,
          idempotency_key: "security-stale-3",
        },
        headers,
      },
    );
    expect(wrongQuestion.status()).toBe(409);
  });

  test("S5: replaying an idempotency key does not double-advance the attempt", async ({
    request,
  }) => {
    const exam = await startQuiz(
      request,
      BASE_URL,
      headers,
      seed.student._id,
      CHAPTERS.four,
    );
    const first = exam.current_question;
    expect(first).not.toBeNull();

    const payload = {
      question_id: first.question_id,
      answer: "A",
      action: "answer",
      revision: 0,
      idempotency_key: `security-replay-${process.pid}-${exam._id}`,
    };

    const firstCall = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/answer`,
      { data: payload, headers },
    );
    expect(firstCall.ok()).toBeTruthy();
    const firstBody = await firstCall.json();
    expect(firstBody.idempotent).toBe(false);

    for (let i = 0; i < 3; i += 1) {
      const replay = await request.post(
        `${BASE_URL}/api/exams/${exam._id}/answer`,
        { data: payload, headers },
      );
      expect(replay.ok()).toBeTruthy();
      const replayBody = await replay.json();
      expect(replayBody.idempotent).toBe(true);
      expect(replayBody.progress.answered).toBe(firstBody.progress.answered);
    }
  });

  test("S6: submitting a taken exam again is rejected with 409", async ({ request }) => {
    const exam = await startQuiz(
      request,
      BASE_URL,
      headers,
      seed.student._id,
      CHAPTERS.one,
    );

    let view = exam;
    let guard = 0;
    while (view.current_question && guard < 100) {
      const current = view.current_question;
      const answered = await request.post(
        `${BASE_URL}/api/exams/${exam._id}/answer`,
        {
          data: {
            question_id: current.question_id,
            answer: "A",
            action: "answer",
            revision: view.answer_revision,
            idempotency_key: `security-submit-${process.pid}-${exam._id}-${guard}`,
          },
          headers,
        },
      );
      expect(answered.ok()).toBeTruthy();
      view = await answered.json();
      guard += 1;
    }
    expect(view.can_submit).toBe(true);

    const submitResponse = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/submit`,
      { headers },
    );
    expect(submitResponse.ok()).toBeTruthy();

    const resubmit = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/submit`,
      { headers },
    );
    expect(resubmit.status()).toBe(409);
  });

  test("S7: unknown proctoring event types are rejected with 400", async ({ request }) => {
    const response = await request.post(
      `${BASE_URL}/api/exams/${SCENARIO_EXAMS.active}/proctoring-event`,
      {
        data: {
          type: "not_a_real_event",
          student_id: seed.student._id,
          metadata: { source: "final-release-security" },
        },
        headers,
      },
    );
    expect(response.status()).toBe(400);
    const body = await response.json();
    expect(body.error).toMatch(/invalid proctoring event type/i);
  });

  test("S8: integrity messaging is non-accusatory in the public exam UI", async ({
    request,
  }) => {
    // The public exam page cannot be rendered in this dev environment: the custom
    // server (server.ts) + Turbopack dev client cannot establish the /_next/webpack-hmr
    // WebSocket, so client-side hydration stalls at the loading state and the
    // result card is never drawn. This gate therefore verifies the API contract
    // that drives the non-accusatory UI plus the rendered copy in the public UI
    // source, and records the browser limitation explicitly.
    const response = await request.get(
      `${BASE_URL}/api/exams/${SCENARIO_EXAMS.finalFlagged}`,
      { headers },
    );
    expect(response.ok()).toBeTruthy();
    const view = await response.json();
    expect(view.integrity_status).toBe("invalidated");
    expect(view.result.integrity_status).toBe("invalidated");
    expect(view.result.review_status).toBe("pending");

    const uiSource = readFileSync(
      resolve(
        __dirname,
        "..",
        "..",
        "src",
        "app",
        "exam",
        "[examId]",
        "ExamRunner.tsx",
      ),
      "utf8",
    );
    expect(uiSource).toContain("Result held for integrity review");
    expect(uiSource).toContain("This is a review state, not an automatic claim.");
    expect(uiSource).toContain("it does not declare a cheating verdict");
    const lowercase = uiSource.toLowerCase();
    expect(lowercase).not.toContain("you cheated");
    expect(lowercase).not.toContain("found cheating");
    expect(lowercase).not.toContain("cheating detected");
    expect(lowercase).not.toContain("marked as cheating");

    test.info().annotations.push({
      type: "environment-limitation",
      description:
        "Browser-rendered exam UI could not be exercised: dev HMR websocket (/_next/webpack-hmr) fails under the custom server and hydration stalls at the loading state. Verified the API contract and the rendered UI source copy instead. See Model_Context/submission/known-issues.md.",
    });
  });

  test("S9: no secrets are committed in tracked source or workflow files", () => {
    const tracked = execSync(
      "git ls-files 'src/**' 'scripts/**' 'server.ts' '.github/**' 'tests/**' 'Model_Context/**' 'evidence/**'",
      { encoding: "utf8", cwd: resolve(__dirname, "..", "..") },
    )
      .split("\n")
      .filter(Boolean);

    const suspicious = [
      /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
      /sk-[A-Za-z0-9]{20,}/,
      /gh[pousr]_[A-Za-z0-9]{20,}/,
      /AKIA[0-9A-Z]{16}/,
      /AIza[0-9A-Za-z_-]{20,}/,
      /password\s*[:=]\s*["'][^"']{6,}["']/i,
    ];

    const matches: string[] = [];
    for (const file of tracked) {
      const content = readFileSync(file, "utf8");
      for (const pattern of suspicious) {
        if (pattern.test(content)) {
          matches.push(`${file} matches ${pattern}`);
        }
      }
    }
    expect(matches).toEqual([]);
  });

  test("S10: rate-limit enforcement is NOT VERIFIED on this release line", async ({
    request,
  }) => {
    // Sprint 2 hardening (branch 11-uai-m2-s2-05, commit f122290) that adds
    // RateLimiter, audit-log, and request-validation is NOT merged into this
    // release line (main == branch 12 HEAD adb098c). The Exam API therefore has
    // no observable 429 throttling yet. This gate records the current behavior
    // and does not claim a limit exists. See evidence/final-release/acceptance-report.md
    // and Model_Context/submission/known-issues.md (defect against branch 11).
    let saw429 = false;
    for (let i = 0; i < 5; i += 1) {
      const response = await request.post(`${BASE_URL}/api/exams/quiz/start`, {
        data: { student_id: seed.student._id, chapter_id: CHAPTERS.one },
        headers,
      });
      if (response.status() === 429) {
        saw429 = true;
        break;
      }
    }
    test.info().annotations.push({
      type: "not-verified",
      description: "Rate limiting is not implemented on this release line (defect UAI-M2-S2-11-01).",
    });
    expect(saw429).toBe(false);
  });
});
