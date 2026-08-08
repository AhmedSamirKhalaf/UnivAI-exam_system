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
  upstream_fixture: {
    schema_version: string;
    provider_mode: "recorded_fixture";
    source_collection: {
      id: string;
      student_sid: string;
      documents: Array<{
        id: string;
        filename: string;
        status: string;
        source_ids: string[];
      }>;
    };
    programme: {
      id: string;
      collection_id: string;
      status: string;
      plan_version: number;
      approved_at: string;
      courses: Array<{
        id: string;
        title: string;
        source_document_ids: string[];
      }>;
    };
    lecture_qa: {
      lecture_id: string;
      course_id: string;
      state: string;
      question: string;
      response: {
        answer: string;
        refused: boolean;
        sources: Array<{
          document_id: string;
          source_id: string;
          location: string;
        }>;
      };
    };
    exam_handoff: {
      student_id: string;
      student_sid: string;
      chapter_id: string;
    };
  };
}

type Question = {
  question_id: string;
  type: "mcq" | "essay";
  correct_option?: string;
};

function loadSeed(): SeedState {
  const path = resolve(__dirname, "fixtures", "seed-state.json");
  const fixture = JSON.parse(readFileSync(path, "utf8")) as {
    seeds: Omit<SeedState, "upstream_fixture">;
    upstream_fixture: SeedState["upstream_fixture"];
  };
  return {
    ...fixture.seeds,
    upstream_fixture: fixture.upstream_fixture,
  };
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

  test("G6: quiz results never gate final-exam eligibility", async ({
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

    expect(response.status()).not.toBe(403);
    if (!response.ok()) {
      const body = await response.json();
      expect(body.error).not.toMatch(/pass|quiz|chapter/i);
    }
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

  test("G8: recorded upstream journey crosses the real Exam boundary", async ({
    request,
  }) => {
    const upstream = seed.upstream_fixture;
    expect(upstream.provider_mode).toBe("recorded_fixture");
    expect(upstream.schema_version).toBe("programme-plan-v1");

    const documentIds = new Set(
      upstream.source_collection.documents.map((document) => document.id),
    );
    expect(upstream.source_collection.documents.length).toBeGreaterThanOrEqual(2);
    expect(documentIds.size).toBe(upstream.source_collection.documents.length);
    expect(
      upstream.source_collection.documents.every(
        (document) =>
          document.filename.toLowerCase().endsWith(".pdf") &&
          document.status === "ready" &&
          document.source_ids.length > 0,
      ),
    ).toBe(true);

    expect(upstream.programme.collection_id).toBe(upstream.source_collection.id);
    expect(upstream.programme.status).toBe("approved");
    expect(upstream.programme.plan_version).toBeGreaterThan(0);
    expect(Date.parse(upstream.programme.approved_at)).not.toBeNaN();
    expect(
      upstream.programme.courses.every(
        (course) =>
          course.source_document_ids.length > 0 &&
          course.source_document_ids.every((documentId) =>
            documentIds.has(documentId),
          ),
      ),
    ).toBe(true);

    const courseIds = new Set(
      upstream.programme.courses.map((course) => course.id),
    );
    expect(courseIds.has(upstream.lecture_qa.course_id)).toBe(true);
    expect(upstream.lecture_qa.state).toBe("completed");
    expect(upstream.lecture_qa.response.refused).toBe(false);
    expect(upstream.lecture_qa.response.answer).toMatch(/O\(log n\)|logarithmic/i);
    expect(upstream.lecture_qa.response.sources.length).toBeGreaterThan(0);
    expect(
      upstream.lecture_qa.response.sources.every((source) => {
        const document = upstream.source_collection.documents.find(
          (candidate) => candidate.id === source.document_id,
        );
        return (
          Boolean(document) &&
          document!.source_ids.includes(source.source_id) &&
          source.location.length > 0
        );
      }),
    ).toBe(true);

    expect(upstream.exam_handoff).toEqual({
      student_id: seed.student._id,
      student_sid: upstream.source_collection.student_sid,
      chapter_id: seed.chapters[0]._id,
    });

    const startResponse = await request.post(`${BASE_URL}/api/exams/quiz/start`, {
      data: upstream.exam_handoff,
      headers,
    });
    expect(startResponse.ok()).toBeTruthy();

    const exam = await startResponse.json();
    expect(exam.type).toBe("quiz");
    expect(exam.student_sid).toBe(upstream.exam_handoff.student_sid);
    expect(exam.chapter_id).toBe(upstream.exam_handoff.chapter_id);
    const questions = exam.generated_questions as Question[];
    expect(questions.length).toBeGreaterThan(0);
    expect(
      questions.every((question) => question.correct_option === undefined),
    ).toBe(true);

    const answers = questions.map((question) => ({
      question_id: question.question_id,
      answer: question.type === "mcq" ? "A" : "Evidence-based response",
    }));
    const submitResponse = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/submit`,
      { data: { student_answers: answers }, headers },
    );
    expect(submitResponse.ok()).toBeTruthy();

    const result = await submitResponse.json();
    expect(result).toMatchObject({
      _id: exam._id,
      student_sid: upstream.exam_handoff.student_sid,
      taken: true,
      integrity_status: expect.stringMatching(/^(clean|invalidated)$/),
      grading_status: expect.stringMatching(
        /^(auto_graded|pending_review|graded)$/,
      ),
    });

    let capture: Record<string, unknown> | undefined;
    for (let attempt = 0; attempt < 20 && !capture; attempt += 1) {
      const response = await request.get(`${BASE_URL}/api/dev/webhooks`, {
        headers,
      });
      expect(response.ok()).toBeTruthy();
      const body = (await response.json()) as {
        captures: Array<{ payload?: Record<string, unknown> }>;
      };
      capture = body.captures
        .map((item) => item.payload)
        .find((payload) => payload?.exam_id === exam._id);
      if (!capture) {
        await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
      }
    }

    expect(capture).toMatchObject({
      exam_id: exam._id,
      student_id: upstream.exam_handoff.student_id,
      student_sid: upstream.exam_handoff.student_sid,
      type: "quiz",
      integrity_status: expect.stringMatching(/^(clean|invalidated)$/),
      grading_status: expect.stringMatching(
        /^(auto_graded|pending_review|graded)$/,
      ),
    });
    expect(capture?.report).toBeDefined();
  });
});
