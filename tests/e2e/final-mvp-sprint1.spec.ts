import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const BASE_URL = process.env.BASE_URL ?? "http://127.0.0.1:3200";
const DEFAULT_STANDALONE_SECRET = "univai-exam-local-development-only";

interface SeedState {
  student: { _id: string; name: string };
  gate_student: { _id: string; name: string };
  curriculum: { _id: string };
  chapters: Array<{ _id: string; title: string; number: number }>;
  scenario_exams: Record<string, { _id: string; chapter_id?: string }>;
}

type Question = {
  question_id: string;
  type: "mcq" | "essay";
  correct_option?: string;
};

function loadSeed(): SeedState {
  const path = resolve(__dirname, "fixtures", "seed-state.json");
  return (JSON.parse(readFileSync(path, "utf8")) as { seeds: SeedState }).seeds;
}

function standaloneToken(studentId: string): string {
  if (process.env.DEV_TOKEN) return process.env.DEV_TOKEN;
  const secret = process.env.UNIVAI_STANDALONE_SECRET ?? DEFAULT_STANDALONE_SECRET;
  return createHmac("sha256", secret).update(studentId).digest("hex");
}

test.describe.serial("Sprint 1 exam-facing black-box acceptance", () => {
  const seed = loadSeed();
  const headers = {
    "x-univai-dev-token": standaloneToken(seed.student._id),
  };

  test("G1: standalone health is ready with all seeded scenarios", async ({ request }) => {
    const response = await request.get(`${BASE_URL}/api/health`);
    expect(response.status()).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      ok: true,
      ready: true,
      mode: "standalone",
      mongo: "ready",
      seededScenarios: 5,
    });
  });

  test("G2: book ingestion reaches ready state", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/books`, {
      data: {
        title: "E2E Computer Science Fundamentals",
        original_filename: `e2e-cs-${process.pid}.pdf`,
        storage_path: `/uploads/e2e-cs-${process.pid}.pdf`,
        student_id: seed.student._id,
      },
      headers,
    });

    expect(response.status()).toBe(201);
    const book = await response.json();
    expect(book._id).toMatch(/^[a-f0-9]{24}$/);
    expect(book.status).toBe("ready");
    expect(book.requested_by_student_id).toBe(seed.student._id);
  });

  test("G3: quiz opens without leaking correct answers", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/exams/quiz/start`, {
      data: {
        student_id: seed.student._id,
        chapter_id: seed.chapters[0]._id,
      },
      headers,
    });

    expect(response.ok()).toBeTruthy();
    const exam = await response.json();
    expect(exam.type).toBe("quiz");
    expect(exam.generated_questions.length).toBeGreaterThan(0);
    for (const question of exam.generated_questions as Question[]) {
      expect(question.correct_option).toBeUndefined();
    }
  });

  test("G4: quiz submission is accepted and graded", async ({ request }) => {
    const startResponse = await request.post(`${BASE_URL}/api/exams/quiz/start`, {
      data: {
        student_id: seed.student._id,
        chapter_id: seed.chapters[0]._id,
      },
      headers,
    });
    expect(startResponse.ok()).toBeTruthy();

    const exam = await startResponse.json();
    const answers = (exam.generated_questions as Question[]).map((question) => ({
      question_id: question.question_id,
      answer: question.type === "mcq" ? "A" : "Evidence-based response",
    }));
    expect(answers.length).toBeGreaterThan(0);

    const submitResponse = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/submit`,
      { data: { student_answers: answers }, headers },
    );
    expect(submitResponse.ok()).toBeTruthy();

    const result = await submitResponse.json();
    expect(result.taken).toBe(true);
    expect(["auto_graded", "pending_review"]).toContain(result.grading_status);
  });

  test("G5: a proctoring observation is recorded for an active session", async ({
    request,
  }) => {
    const examId = seed.scenario_exams.quiz_active._id;
    const response = await request.post(
      `${BASE_URL}/api/exams/${examId}/proctoring-event`,
      {
        data: {
          type: "devtools_open",
          student_id: seed.student._id,
          metadata: { source: "sprint1-acceptance" },
        },
        headers,
      },
    );

    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
  });

  test("G6: final exam remains locked until every quiz is passed", async ({
    request,
  }) => {
    const enrollmentResponse = await request.post(`${BASE_URL}/api/enrollments`, {
      data: {
        student_id: seed.gate_student._id,
        curriculum_id: seed.curriculum._id,
        enrolled_at: "2026-07-30T00:00:00.000Z",
        status: "active",
      },
      headers,
    });
    expect([201, 409]).toContain(enrollmentResponse.status());

    const response = await request.post(`${BASE_URL}/api/exams/final/start`, {
      data: {
        student_id: seed.gate_student._id,
        curriculum_id: seed.curriculum._id,
      },
      headers,
    });

    expect(response.status()).toBe(403);
    const body = await response.json();
    expect(body.error).toMatch(/pass|quiz|chapter/i);
  });

  test("G7: submission produces a trusted-result webhook capture", async ({
    request,
  }) => {
    let capture: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 20 && !capture; attempt += 1) {
      const response = await request.get(`${BASE_URL}/api/dev/webhooks`, { headers });
      expect(response.ok()).toBeTruthy();
      const body = (await response.json()) as {
        captures: Array<{ payload?: Record<string, unknown> }>;
      };
      capture = body.captures
        .map((item) => item.payload)
        .find((payload) => payload?.student_id === seed.student._id);
      if (!capture) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }

    expect(capture).toBeDefined();
    expect(capture).toMatchObject({
      type: "quiz",
      student_id: seed.student._id,
      integrity_status: expect.stringMatching(/^(clean|invalidated)$/),
      grading_status: expect.stringMatching(/^(auto_graded|pending_review|graded)$/),
    });
    expect(capture?.report).toBeDefined();
  });
});
