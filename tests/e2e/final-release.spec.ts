import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test, type APIRequestContext } from "@playwright/test";

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

type PublicQuestion = {
  question_id: string;
  type: "mcq" | "essay";
  correct_option?: string;
};

type LaunchView = {
  _id: string;
  type: "quiz" | "mid" | "final";
  title: string;
  taken: boolean;
  student_sid?: string;
  chapter_id?: string;
  current_question: PublicQuestion | null;
  progress: { position: number; total: number; answered: number };
  answer_revision: number;
  can_submit: boolean;
  idempotent?: boolean;
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

async function answerCurrentQuestion(
  request: APIRequestContext,
  baseUrl: string,
  headers: Record<string, string>,
  examId: string,
  view: LaunchView,
  idempotencyKey: string,
  answer = "A",
): Promise<LaunchView> {
  const current = view.current_question;
  expect(current).not.toBeNull();
  const response = await request.post(`${baseUrl}/api/exams/${examId}/answer`, {
    data: {
      question_id: current!.question_id,
      answer,
      action: "answer",
      revision: view.answer_revision,
      idempotency_key: idempotencyKey,
    },
    headers,
  });
  expect(response.ok()).toBeTruthy();
  return (await response.json()) as LaunchView;
}

async function answerUntilSubmittable(
  request: APIRequestContext,
  baseUrl: string,
  headers: Record<string, string>,
  examId: string,
  startView: LaunchView,
  keyPrefix: string,
): Promise<LaunchView> {
  let view = startView;
  let guard = 0;
  while (view.current_question && guard < 100) {
    view = await answerCurrentQuestion(
      request,
      baseUrl,
      headers,
      examId,
      view,
      `${keyPrefix}-${guard}`,
    );
    guard += 1;
  }
  expect(view.can_submit).toBe(true);
  return view;
}

test.describe.serial("Sprint 2 final-release exam UAT", () => {
  const seed = loadSeed();
  const headers = {
    "x-univai-dev-token": standaloneToken(seed.student._id),
  };

  test("FR1: standalone release is healthy with all seeded scenarios", async ({
    request,
  }) => {
    const response = await request.get(`${BASE_URL}/api/health`);
    expect(response.status()).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      ready: true,
      mode: "standalone",
      mongo: "ready",
      seededScenarios: 5,
      webhook: "local capture",
    });
  });

  test("FR2: book ingestion reaches ready state", async ({ request }) => {
    const response = await request.post(`${BASE_URL}/api/books`, {
      data: {
        title: "Final Release Computer Science Fundamentals",
        original_filename: `final-release-cs-${process.pid}.pdf`,
        storage_path: `/uploads/final-release-cs-${process.pid}.pdf`,
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

  test("FR3: quiz opens one question at a time without leaking correct answers", async ({
    request,
  }) => {
    const exam = await startQuiz(
      request,
      BASE_URL,
      headers,
      seed.student._id,
      seed.chapters[0]._id,
    );

    expect(exam.type).toBe("quiz");
    expect(exam.taken).toBe(false);
    expect(exam.progress.total).toBeGreaterThan(0);
    expect(exam.current_question).not.toBeNull();
    expect(exam.current_question!.correct_option).toBeUndefined();
    expect(exam.can_submit).toBe(false);
  });

  test("FR4: the one-question-at-a-time answer flow is accepted and idempotent", async ({
    request,
  }) => {
    const exam = await startQuiz(
      request,
      BASE_URL,
      headers,
      seed.student._id,
      seed.chapters[1]._id,
    );
    const first = exam.current_question;
    expect(first).not.toBeNull();

    const key = `final-release-${process.pid}-${exam._id}-1`;
    const accepted = await answerCurrentQuestion(
      request,
      BASE_URL,
      headers,
      exam._id,
      exam,
      key,
    );
    expect(accepted.progress.answered).toBe(exam.progress.answered + 1);
    expect(accepted.idempotent).toBe(false);

    const replayed = await answerCurrentQuestion(
      request,
      BASE_URL,
      headers,
      exam._id,
      exam,
      key,
    );
    expect(replayed.idempotent).toBe(true);
    expect(replayed.progress.answered).toBe(accepted.progress.answered);
  });

  test("FR5: the current-question contract keeps future answers server-side", async ({
    request,
  }) => {
    const exam = await startQuiz(
      request,
      BASE_URL,
      headers,
      seed.student._id,
      seed.chapters[2]._id,
    );
    const first = exam.current_question;
    expect(first).not.toBeNull();

    const accepted = await answerCurrentQuestion(
      request,
      BASE_URL,
      headers,
      exam._id,
      exam,
      `final-release-${process.pid}-${exam._id}-2`,
    );
    expect(accepted.progress.answered).toBe(exam.progress.answered + 1);

    const details = await request.get(`${BASE_URL}/api/exams/${exam._id}`, {
      headers,
    });
    expect(details.ok()).toBeTruthy();
    const view = (await details.json()) as LaunchView;

    expect(view.current_question!.question_id).not.toBe(first!.question_id);
    expect(view.progress.answered).toBe(accepted.progress.answered);
    expect(view.answer_revision).toBe(accepted.answer_revision);
  });

  test("FR6: submission is accepted, graded, and produces a trusted-result webhook capture", async ({
    request,
  }) => {
    const exam = await startQuiz(
      request,
      BASE_URL,
      headers,
      seed.student._id,
      seed.chapters[0]._id,
    );
    const ready = await answerUntilSubmittable(
      request,
      BASE_URL,
      headers,
      exam._id,
      exam,
      `final-release-submit-${process.pid}-${exam._id}`,
    );
    expect(ready.can_submit).toBe(true);

    const submitResponse = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/submit`,
      { headers },
    );
    expect(submitResponse.ok()).toBeTruthy();

    const result = (await submitResponse.json()) as LaunchView & {
      result?: { grading_status: string };
    };
    expect(result.taken).toBe(true);
    expect(result.result?.grading_status).toBeDefined();
    expect(["auto_graded", "pending_review"]).toContain(result.result?.grading_status);

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
      if (!capture) await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
    }

    expect(capture).toBeDefined();
    expect(capture).toMatchObject({
      exam_id: exam._id,
      student_id: seed.student._id,
      type: "quiz",
      integrity_status: expect.stringMatching(/^(clean|invalidated)$/),
      grading_status: expect.stringMatching(/^(auto_graded|pending_review|graded)$/),
    });
    expect(capture?.report).toBeDefined();
  });

  test("FR7: final exam remains locked until every quiz is passed", async ({
    request,
  }) => {
    const enrollmentResponse = await request.post(`${BASE_URL}/api/enrollments`, {
      data: {
        student_id: seed.gate_student._id,
        curriculum_id: seed.curriculum._id,
        enrolled_at: "2026-08-01T00:00:00.000Z",
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

  test("FR8: recorded upstream journey crosses the real Exam boundary end to end", async ({
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
      data: {
        student_id: seed.student._id,
        student_sid: upstream.exam_handoff.student_sid,
        chapter_id: upstream.exam_handoff.chapter_id,
      },
      headers,
    });
    expect(startResponse.ok()).toBeTruthy();

    const exam = (await startResponse.json()) as LaunchView;
    expect(exam.type).toBe("quiz");
    expect(exam.current_question).not.toBeNull();
    expect(exam.current_question!.correct_option).toBeUndefined();

    const ready = await answerUntilSubmittable(
      request,
      BASE_URL,
      headers,
      exam._id,
      exam,
      `final-release-upstream-${process.pid}-${exam._id}`,
    );
    expect(ready.can_submit).toBe(true);

    const submitResponse = await request.post(
      `${BASE_URL}/api/exams/${exam._id}/submit`,
      { headers },
    );
    expect(submitResponse.ok()).toBeTruthy();

    const result = (await submitResponse.json()) as LaunchView & {
      result?: { integrity_status: string; grading_status: string };
    };
    expect(result).toMatchObject({
      _id: exam._id,
      taken: true,
      integrity_status: expect.stringMatching(/^(clean|invalidated)$/),
    });
    expect(result.result).toMatchObject({
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
      student_id: seed.student._id,
      student_sid: upstream.exam_handoff.student_sid,
      chapter_id: upstream.exam_handoff.chapter_id,
      type: "quiz",
      integrity_status: expect.stringMatching(/^(clean|invalidated)$/),
      grading_status: expect.stringMatching(
        /^(auto_graded|pending_review|graded)$/,
      ),
    });
    expect(capture?.report).toBeDefined();
  });
});
