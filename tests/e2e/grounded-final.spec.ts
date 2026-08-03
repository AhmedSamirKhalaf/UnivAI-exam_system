import { createHmac } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { APIRequestContext, expect, test } from "@playwright/test";
import {
  canonicalQuestionHash,
  type FinalPackageQuestion,
  type FinalPackageV1,
} from "../../src/lib/final-publication";

/**
 * Grounded cumulative final publication + delivery (exam-system side).
 *
 * Prerequisites (same as tests/e2e/exam-ui.spec.ts): a running standalone Exam
 * server (BASE_URL) and a seeded standalone database (`npm run standalone:seed`
 * against mongodb://127.0.0.1:27018/univai_exams_standalone). The demo drives
 * everything over HTTP:
 *   1. enroll a fresh learner and pass the four weekly quizzes,
 *   2. prove a final cannot start before a package is published (no
 *      generation, no placeholders),
 *   3. publish a valid FinalPackageV1 -> accepted receipt,
 *   4. republish -> idempotent acceptance,
 *   5. start the final, take it (no answers / provenance / rubric leak),
 *      submit (pending manual review), grade it, and confirm the grade sticks,
 *   6. corrupt a source page -> rejected receipt, and the published bank is
 *      unchanged.
 */

const baseUrl = process.env.BASE_URL ?? "http://127.0.0.1:3200";
const seededStudentId = "64b000000000000000000001";
const learnerId = "64b000000000000000000041";
const learnerSid = "S-2026-000099";
const curriculumId = "64b000000000000000000003";
const chapterIds = [
  "64b000000000000000000011",
  "64b000000000000000000012",
  "64b000000000000000000013",
  "64b000000000000000000014",
];

const devToken = createHmac(
  "sha256",
  process.env.UNIVAI_STANDALONE_SECRET ?? "univai-exam-local-development-only",
)
  .update(seededStudentId)
  .digest("hex");
const takeHeaders = { "x-univai-dev-token": devToken };

const DOCUMENT_ID = "doc_final_textbook";
const DOCUMENT_TITLE = "Final Semester Textbook";
const MCQ_OPTIONS = [
  "Option Alpha",
  "Option Beta",
  "Option Gamma",
  "Option Delta",
];

const WEEKS = [
  { week: "Week 1", section: "Week 1: Foundations" },
  { week: "Week 2", section: "Week 2: Methods" },
  { week: "Week 3", section: "Week 3: Analysis" },
  { week: "Week 4", section: "Week 4: Applications" },
];

const blueprint = {
  schema_version: "assessment-blueprint-v1",
  programme: "Computer Science",
  semester: "Fall 2026",
  course_id: "CS-FIN-001",
  title: "Cumulative semester final blueprint",
  outcomes: ["Integrate course concepts", "Apply methods to problems"],
  difficulty: "mixed",
  plan_version: "2026-v1",
  approved: true,
  approved_by: "Academic Committee",
  approved_at: "2026-07-30T00:00:00.000Z",
  source_coverage: [
    {
      document_id: DOCUMENT_ID,
      document_title: DOCUMENT_TITLE,
      sections: WEEKS.map((entry) => entry.section),
      page_ranges: [{ start: 1, end: 40 }],
    },
  ],
};

function questionsFor(
  weekAssignments: number[],
): Array<Omit<FinalPackageQuestion, "question_hash">> {
  return weekAssignments.map((weekIndex, index) => {
    const week = WEEKS[weekIndex];
    const isEssay = index % 3 === 2;
    const base = {
      question_id: `gf_q${index + 1}`,
      prompt: `Grounded final item ${index + 1}: ${week.section}?`,
      week: week.week,
      difficulty: (index % 2 === 0 ? "easy" : "medium") as
        | "easy"
        | "medium"
        | "hard",
      provenance: {
        document_id: DOCUMENT_ID,
        document_title: DOCUMENT_TITLE,
        page_number: weekIndex * 10 + (index % 9) + 1,
        section: week.section,
        excerpt: "The textbook states the answer on this page.",
      },
    };
    if (isEssay) return { ...base, type: "essay" as const };
    return {
      ...base,
      type: "mcq" as const,
      options: [...MCQ_OPTIONS],
      correct_option: "Option Alpha",
    };
  });
}

function makePackage(packageId: string): FinalPackageV1 {
  const questions = questionsFor([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3]).map(
    (question) => ({ ...question, question_hash: canonicalQuestionHash(question) }),
  );
  const mcqs = questions.filter((question) => question.type === "mcq");
  const essays = questions.filter((question) => question.type === "essay");
  return {
    schema_version: "final-package-v1",
    package_id: packageId,
    learner_id: learnerSid,
    programme: "Computer Science",
    semester: "Fall 2026",
    course_id: "CS-FIN-001",
    plan_version: "2026-v1",
    blueprint_id: "000000000000000000000000",
    blueprint_version: "2026-v1",
    generator_prompt_id: "prompt-cs301-final",
    generator_prompt_version: "2026-v1",
    difficulty: "mixed",
    curriculum_id: curriculumId,
    semester_weeks: WEEKS.map((entry) => entry.week),
    books: [{ document_id: DOCUMENT_ID, document_title: DOCUMENT_TITLE }],
    answer_key: Object.fromEntries(
      mcqs.map((question) => [
        question.question_id,
        question.correct_option as string,
      ]),
    ),
    rubrics: Object.fromEntries(
      essays.map((question) => [
        question.question_id,
        {
          criteria: ["Accuracy", "Completeness", "Use of evidence"],
          model_answer_excerpt: `Model answer grounded on: ${question.provenance.excerpt}`,
          marks_breakdown: { accuracy: 4, completeness: 3, evidence: 3 },
          provenance: { ...question.provenance },
        },
      ]),
    ),
    questions,
  };
}

async function saveArtifact(name: string, content: unknown): Promise<void> {
  const dir = path.join(process.cwd(), "evidence", "grounded-final");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, name), JSON.stringify(content, null, 2), "utf8");
}

async function ensureBlueprint(api: APIRequestContext): Promise<string> {
  const response = await api.post(`${baseUrl}/api/assessment-blueprints`, {
    data: blueprint,
  });
  if (response.status() === 409) {
    const list = await api.get(
      `${baseUrl}/api/assessment-blueprints?course_id=CS-FIN-001&plan_version=2026-v1`,
    );
    const { blueprints } = (await list.json()) as {
      blueprints: { _id: string }[];
    };
    expect(blueprints.length).toBeGreaterThan(0);
    return blueprints[0]._id;
  }
  expect(response.status()).toBe(201);
  const created = (await response.json()) as { blueprint: { _id: string } };
  return created.blueprint._id;
}

async function passQuiz(api: APIRequestContext, chapterId: string): Promise<void> {
  const start = await api.post(`${baseUrl}/api/exams/quiz/start`, {
    data: {
      student_id: learnerId,
      chapter_id: chapterId,
      student_sid: learnerSid,
    },
  });
  expect(start.status()).toBe(201);
  const launch = (await start.json()) as Record<string, unknown>;
  const examId = String(launch._id);
  let revision = 0;
  let view = launch;
  let guard = 0;
  while ((view.can_submit as boolean) !== true) {
    const question = view.current_question as {
      question_id: string;
    };
    expect(question).not.toBeNull();
    const answer = await api.post(`${baseUrl}/api/exams/${examId}/answer`, {
      headers: takeHeaders,
      data: {
        question_id: question.question_id,
        answer: "A",
        action: "answer",
        revision,
        idempotency_key: `gf-quiz-pass-${examId}-${revision}`,
      },
    });
    expect(answer.ok()).toBe(true);
    revision += 1;
    const next = await api.get(`${baseUrl}/api/exams/${examId}`, {
      headers: takeHeaders,
    });
    expect(next.ok()).toBe(true);
    view = await next.json();
    guard += 1;
    expect(guard).toBeLessThan(50);
  }
  const submit = await api.post(`${baseUrl}/api/exams/${examId}/submit`, {
    headers: takeHeaders,
    data: {},
  });
  expect(submit.ok()).toBe(true);
  const submitted = (await submit.json()) as {
    result: { passed: boolean; grading_status: string };
  };
  expect(submitted.result.passed).toBe(true);
  expect(submitted.result.grading_status).toBe("auto_graded");
}

async function getView(api: APIRequestContext, examId: string) {
  const response = await api.get(`${baseUrl}/api/exams/${examId}`, {
    headers: takeHeaders,
  });
  expect(response.ok()).toBe(true);
  return (await response.json()) as Record<string, unknown>;
}

test.describe.serial("grounded cumulative final publication and delivery", () => {
  test("publish a valid final, take and grade it, and reject corruption", async ({
    request,
  }) => {
    const api = request;

    const enrollment = await api.post(`${baseUrl}/api/enrollments`, {
      data: {
        student_id: learnerId,
        curriculum_id: curriculumId,
        enrolled_at: "2026-07-27T09:00:00.000Z",
        status: "active",
      },
    });
    expect([201, 409]).toContain(enrollment.status());

    for (const chapterId of chapterIds) {
      await passQuiz(api, chapterId);
    }

    // 1. A final cannot start before a validated package is published: an empty
    //    bank is an explicit failure, never permission to fabricate questions.
    const earlyStart = await api.post(`${baseUrl}/api/exams/final/start`, {
      data: {
        student_id: learnerId,
        curriculum_id: curriculumId,
        student_sid: learnerSid,
      },
    });
    expect(earlyStart.status()).toBe(500);
    const earlyFailure = (await earlyStart.json()) as { error: string };
    expect(earlyFailure.error).toMatch(/No published final questions/);

    const blueprintId = await ensureBlueprint(api);

    // 2. Publish the valid cumulative package -> accepted receipt.
    const validPkg = makePackage("pkg-cs301-final-0001");
    const publishResponse = await api.post(
      `${baseUrl}/api/assessments/final/publish`,
      {
        headers: takeHeaders,
        data: { ...validPkg, blueprint_id: blueprintId },
      },
    );
    expect(publishResponse.status()).toBe(201);
    const receipt = (await publishResponse.json()) as {
      status: string;
      defects: unknown[];
      published_ids: string[];
      question_count: number;
      essay_count: number;
      generator_prompt_id: string;
      generator_prompt_version: string;
    };
    expect(receipt.status).toBe("accepted");
    expect(receipt.defects).toEqual([]);
    expect(receipt.published_ids).toHaveLength(12);
    expect(receipt.question_count).toBe(12);
    expect(receipt.essay_count).toBe(4);
    expect(receipt.generator_prompt_id).toBe("prompt-cs301-final");
    expect(receipt.generator_prompt_version).toBe("2026-v1");
    await saveArtifact("publication-accepted.json", {
      blueprint_id: blueprintId,
      ...receipt,
    });

    // Republishing the same package is idempotent (no duplicate inserts).
    const replayResponse = await api.post(
      `${baseUrl}/api/assessments/final/publish`,
      {
        headers: takeHeaders,
        data: { ...validPkg, blueprint_id: blueprintId },
      },
    );
    expect(replayResponse.ok()).toBe(true);
    const replay = (await replayResponse.json()) as {
      status: string;
      idempotent: boolean;
    };
    expect(replay.status).toBe("accepted");
    expect(replay.idempotent).toBe(true);

    // 3. Start the final and take it.
    const finalStart = await api.post(`${baseUrl}/api/exams/final/start`, {
      data: {
        student_id: learnerId,
        curriculum_id: curriculumId,
        student_sid: learnerSid,
      },
    });
    expect(finalStart.ok()).toBe(true);
    const launch = (await finalStart.json()) as Record<string, unknown>;
    const examId = String(launch._id);
    expect(examId).toMatch(/^[0-9a-f]{24}$/);
    expect(String(launch.attempt_token).length).toBeGreaterThan(32);
    expect(launch.current_question).not.toBeNull();

    let view = await getView(api, examId);
    const total = Number((view.progress as { total: number }).total);
    expect(total).toBe(12);

    let revision = 0;
    let answered = 0;
    const prompts = (view: Record<string, unknown>) => {
      const question = view.current_question as {
        question_id: string;
        prompt: string;
      };
      expect(question).not.toBeNull();
      const serialized = JSON.stringify(view);
      expect(serialized).not.toContain("correct_option");
      expect(serialized).not.toContain("provenance");
      expect(serialized).not.toContain("rubric");
      return question;
    };

    while ((view.can_submit as boolean) !== true) {
      const question = prompts(view);
      const answer =
        (view.current_question as { type: string }).type === "mcq"
          ? "Option Alpha"
          : "Model answer for the final essay.";
      const answerResponse = await api.post(
        `${baseUrl}/api/exams/${examId}/answer`,
        {
          headers: takeHeaders,
          data: {
            question_id: question.question_id,
            answer,
            action: "answer",
            revision,
            idempotency_key: `gf-final-${examId}-${revision}`,
          },
        },
      );
      expect(answerResponse.ok()).toBe(true);
      revision += 1;
      answered += 1;
      view = await getView(api, examId);
    }
    expect(answered).toBe(total);

    const submitResponse = await api.post(`${baseUrl}/api/exams/${examId}/submit`, {
      headers: takeHeaders,
      data: {},
    });
    expect(submitResponse.ok()).toBe(true);
    const submitted = (await submitResponse.json()) as {
      result: { grading_status: string; mark: number; passed: boolean };
    };
    expect(submitted.result.grading_status).toBe("pending_review");
    expect(submitted.result.mark).toBe(8);
    await saveArtifact("attempt-graded.json", submitted);

    // 4. Manual grading is one-shot, audited, and never recomputed away.
    const gradeResponse = await api.post(
      `${baseUrl}/api/exams/${examId}/grade`,
      {
        data: {
          mark: 85,
          graded_by: "instructor-gf",
          reason: "Manual final review",
          is_regrade: false,
        },
      },
    );
    expect(gradeResponse.ok()).toBe(true);
    const gradedView = await getView(api, examId);
    const result = gradedView.result as {
      grading_status: string;
      mark: number;
      passed: boolean;
    };
    expect(result.grading_status).toBe("graded");
    expect(result.mark).toBe(85);
    expect(result.passed).toBe(true);
    await saveArtifact("final-graded.json", gradedView);

    // 5. Corrupt a source page -> rejected before persistence; the published
    //    bank is unchanged (the valid package still replays idempotently).
    const corruptPkg = makePackage("pkg-cs301-final-corrupt");
    corruptPkg.questions[1].provenance.page_number = 99;
    const corruptResponse = await api.post(
      `${baseUrl}/api/assessments/final/publish`,
      {
        headers: takeHeaders,
        data: { ...corruptPkg, blueprint_id: blueprintId },
      },
    );
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

    const finalReplay = await api.post(
      `${baseUrl}/api/assessments/final/publish`,
      {
        headers: takeHeaders,
        data: { ...validPkg, blueprint_id: blueprintId },
      },
    );
    expect(finalReplay.ok()).toBe(true);
    const finalReplayBody = (await finalReplay.json()) as {
      status: string;
      idempotent: boolean;
      published_ids: string[];
    };
    expect(finalReplayBody.status).toBe("accepted");
    expect(finalReplayBody.idempotent).toBe(true);
    expect(finalReplayBody.published_ids).toHaveLength(12);
  });
});
