import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { APIRequestContext, expect, test } from "@playwright/test";
import { canonicalQuestionHash } from "../../src/lib/quiz-publication";

/**
 * Grounded weekly quiz publication + delivery (exam-system side).
 *
 * Prerequisites (same as tests/e2e/exam-ui.spec.ts): a running standalone Exam
 * server (BASE_URL) and a seeded standalone database (`npm run standalone:seed`
 * against mongodb://127.0.0.1:27018/univai_exams_standalone). The demo drives
 * everything over HTTP:
 *   1. create an approved blueprint,
 *   2. publish a valid QuizPackageV1 -> accepted receipt,
 *   3. start and take the quiz via the attempt API (no leak of answers,
 *      provenance, or future items),
 *   4. corrupt a page/source id -> rejected receipt, and the quiz cannot start.
 */

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3200";
const studentId = "64b000000000000000000001";
const studentSid = "S-2026-000042";
const devToken = createHmac(
  "sha256",
  process.env.UNIVAI_STANDALONE_SECRET ?? "univai-exam-local-development-only",
)
  .update(studentId)
  .digest("hex");

const chapterValid = "64b000000000000000000011"; // Week 1, seeded
const chapterCorrupt = "64b000000000000000000013"; // Week 3, no published bank
const courseId = "CS-GQ-001";
const planVersion = "2026-v1";

const blueprint = {
  schema_version: "assessment-blueprint-v1",
  programme: "Computer Science",
  semester: "Fall 2026",
  course_id: courseId,
  title: "Grounded weekly quiz blueprint",
  outcomes: ["Explain variables", "Trace simple programs"],
  difficulty: "medium",
  plan_version: planVersion,
  approved: true,
  approved_by: "Academic Committee",
  approved_at: "2026-07-30T00:00:00.000Z",
  source_coverage: [
    {
      document_id: "doc_gq_textbook",
      document_title: "GQ Fundamentals",
      sections: ["Lecture 1: Variables", "Lecture 2: Control flow"],
      page_ranges: [{ start: 1, end: 40 }],
    },
  ],
};

function makeQuestion(index: number, section: string, page: number) {
  const question = {
    question_id: `gq_q${index}`,
    prompt: `Grounded item ${index}: which statement about the lecture is correct?`,
    type: "mcq" as const,
    options: ["Option Alpha", "Option Beta", "Option Gamma", "Option Delta"],
    correct_option: "Option Alpha",
    provenance: {
      document_id: "doc_gq_textbook",
      document_title: "GQ Fundamentals",
      page_number: page,
      section,
      excerpt: "The lecture states the answer on this page.",
    },
  };
  return { ...question, question_hash: canonicalQuestionHash(question) };
}

function makePackage(
  chapterId: string,
  packageId: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  const questions = [
    makeQuestion(1, "Lecture 1: Variables", 10),
    makeQuestion(2, "Lecture 1: Variables", 12),
    makeQuestion(3, "Lecture 2: Control flow", 20),
    makeQuestion(4, "Lecture 2: Control flow", 22),
    makeQuestion(5, "Lecture 2: Control flow", 24),
  ];
  return {
    schema_version: "quiz-package-v1",
    package_id: packageId,
    learner_id: studentSid,
    programme: "Computer Science",
    course_id: courseId,
    week: "Week 1",
    plan_version: planVersion,
    blueprint_version: planVersion,
    generator_prompt_id: "prompt-gq-w1",
    generator_prompt_version: "2026-v1",
    difficulty: "medium",
    chapter_id: chapterId,
    answer_key: Object.fromEntries(
      questions.map((question) => [question.question_id, question.correct_option]),
    ),
    questions,
    ...overrides,
  };
}

async function saveArtifact(name: string, content: unknown): Promise<void> {
  const dir = path.join(process.cwd(), "evidence", "grounded-quiz");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), JSON.stringify(content, null, 2), "utf8");
}

async function startQuiz(
  api: APIRequestContext,
  chapterId: string,
): Promise<{ examId: string; attemptToken: string; launch: Record<string, unknown> }> {
  const response = await api.post(`${baseUrl}/api/exams/quiz/start`, {
    data: {
      student_id: studentId,
      chapter_id: chapterId,
      student_sid: studentSid,
    },
  });
  const launch = (await response.json()) as Record<string, unknown>;
  return {
    examId: String(launch._id),
    attemptToken: String(launch.attempt_token),
    launch,
  };
}

async function getView(api: APIRequestContext, examId: string) {
  const response = await api.get(`${baseUrl}/api/exams/${examId}`, {
    headers: { "x-univai-dev-token": devToken },
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

test.describe.serial("grounded weekly quiz publication and delivery", () => {
  test("publish a valid package, take it, and reject a corrupted package", async ({ request }) => {
    const api = request;
    const blueprintResponse = await api.post(`${baseUrl}/api/assessment-blueprints`, {
      data: blueprint,
    });
    let blueprintId: string;
    if (blueprintResponse.status() === 409) {
      const listResponse = await api.get(
        `${baseUrl}/api/assessment-blueprints?course_id=${courseId}&plan_version=${planVersion}`,
      );
      const { blueprints } = (await listResponse.json()) as {
        blueprints: { _id: string }[];
      };
      expect(blueprints.length).toBeGreaterThan(0);
      blueprintId = blueprints[0]._id;
    } else {
      expect(blueprintResponse.status()).toBe(201);
      const created = (await blueprintResponse.json()) as {
        blueprint: { _id: string };
      };
      blueprintId = created.blueprint._id;
    }
    expect(blueprintId).toMatch(/^[0-9a-f]{24}$/);

    const headers = { "x-univai-dev-token": devToken };

    // 1. Publish the valid weekly package -> accepted receipt.
    const validPkg = makePackage(chapterValid, "pkg-gq-week1-0001");
    const publishResponse = await api.post(`${baseUrl}/api/assessments/quiz/publish`, {
      headers,
      data: { ...validPkg, blueprint_id: blueprintId },
    });
    expect(publishResponse.status()).toBe(201);
    const receipt = (await publishResponse.json()) as {
      status: string;
      defects: unknown[];
      published_ids: string[];
      generator_prompt_id: string;
      generator_prompt_version: string;
    };
    expect(receipt.status).toBe("accepted");
    expect(receipt.defects).toEqual([]);
    expect(receipt.published_ids).toHaveLength(5);
    expect(receipt.generator_prompt_id).toBe("prompt-gq-w1");
    expect(receipt.generator_prompt_version).toBe("2026-v1");
    await saveArtifact("publication-accepted.json", {
      blueprint_id: blueprintId,
      ...receipt,
    });

    // Republishing the same package is idempotent (no duplicate inserts).
    const replayResponse = await api.post(`${baseUrl}/api/assessments/quiz/publish`, {
      headers,
      data: { ...validPkg, blueprint_id: blueprintId },
    });
    expect(replayResponse.ok()).toBe(true);
    const replay = (await replayResponse.json()) as { status: string; idempotent: boolean };
    expect(replay.status).toBe("accepted");
    expect(replay.idempotent).toBe(true);

    // 2. Start and take the quiz.
    const { examId, attemptToken, launch } = await startQuiz(api, chapterValid);
    expect(examId).toMatch(/^[0-9a-f]{24}$/);
    expect(attemptToken.length).toBeGreaterThan(32);
    expect(launch.current_question).not.toBeNull();

    const takeHeaders = { "x-univai-dev-token": devToken };

    let view = await getView(api, examId);
    let revision = 0;
    let answered = 0;
    const total = Number((view.progress as { total: number }).total);
    const promptFor = (item: number) =>
      `Grounded item ${item}: which statement about the lecture is correct?`;

    while ((view.can_submit as boolean) !== true) {
      const question = view.current_question as {
        question_id: string;
        prompt: string;
        options: string[];
      };
      expect(question).not.toBeNull();
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain("correct_option");
      expect(serialized).not.toContain("provenance");
      // No other item (future or answered) may leak into the current-question payload.
      const allPrompts = [1, 2, 3, 4, 5].map(promptFor);
      for (const otherPrompt of allPrompts.filter((prompt) => prompt !== question.prompt)) {
        expect(serialized).not.toContain(otherPrompt);
      }
      expect(question.options).toHaveLength(4);

      const answerResponse = await api.post(`${baseUrl}/api/exams/${examId}/answer`, {
        headers: takeHeaders,
        data: {
          question_id: question.question_id,
          answer: "Option Alpha",
          action: "answer",
          revision,
          idempotency_key: `gq-answer-${examId}-${revision}`,
        },
      });
      expect(answerResponse.ok()).toBe(true);
      revision += 1;
      answered += 1;
      view = await getView(api, examId);
    }
    expect(answered).toBe(total);
    expect(total).toBeGreaterThanOrEqual(3);

    const submitResponse = await api.post(`${baseUrl}/api/exams/${examId}/submit`, {
      headers: takeHeaders,
      data: {},
    });
    expect(submitResponse.ok()).toBe(true);
    const submitted = (await submitResponse.json()) as {
      result: { grading_status: string; mark: number; passed: boolean };
    };
    expect(submitted.result.grading_status).toBe("auto_graded");
    expect(submitted.result.mark).toBe(total);
    expect(submitted.result.passed).toBe(true);
    await saveArtifact("attempt-graded.json", submitted);

    // 3. Corrupt the source page -> the package is rejected before persistence.
    const corruptPkg = makePackage(chapterCorrupt, "pkg-gq-week3-corrupt", {
      questions: [
        makeQuestion(1, "Lecture 1: Variables", 10),
        makeQuestion(2, "Lecture 1: Variables", 99),
        makeQuestion(3, "Lecture 2: Control flow", 20),
        makeQuestion(4, "Lecture 2: Control flow", 22),
        makeQuestion(5, "Lecture 2: Control flow", 24),
      ],
    });
    const corruptResponse = await api.post(`${baseUrl}/api/assessments/quiz/publish`, {
      headers,
      data: { ...corruptPkg, blueprint_id: blueprintId },
    });
    expect(corruptResponse.status()).toBe(422);
    const rejection = (await corruptResponse.json()) as {
      status: string;
      defects: { code: string; path: string; message: string }[];
      published_ids: string[];
    };
    expect(rejection.status).toBe("rejected");
    expect(rejection.published_ids).toEqual([]);
    expect(rejection.defects.map((defect) => defect.code)).toContain(
      "question.page.out_of_range",
    );
    await saveArtifact("publication-rejected.json", {
      blueprint_id: blueprintId,
      ...rejection,
    });

    // 4. A corrupted/unpublished package cannot start a quiz: it fails clearly.
    const corruptStart = await api.post(`${baseUrl}/api/exams/quiz/start`, {
      data: {
        student_id: studentId,
        chapter_id: chapterCorrupt,
        student_sid: studentSid,
      },
    });
    expect(corruptStart.status()).toBe(500);
    const failure = (await corruptStart.json()) as { error: string };
    expect(failure.error).toMatch(/No published quiz questions/);
  });
});
