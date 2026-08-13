import { createHash, createHmac } from "node:crypto";
import mongoose from "mongoose";

/* ────────────────────────────────────────────
   Configuration
   ──────────────────────────────────────────── */
// Legacy manual diagnostic. Defaults are deliberately isolated from integrated data.
const BASE = process.env.BASE_URL || "http://localhost:3200";
const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://127.0.0.1:27018/univai_exams_standalone";
const AGENT_TOKEN = process.env.UNIVAI_AGENT_SECRET || "";

/* ────────────────────────────────────────────
   Stats
   ──────────────────────────────────────────── */
let passed = 0;
let failed = 0;

/* ────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────── */
function header(text) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  ${text}`);
  console.log(`${"=".repeat(60)}`);
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)])
    );
  }
  return value;
}

function hashValue(value) {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

async function seedPublishedQuestionBanks(
  chapterIds,
  blueprintId,
  curriculumId,
  learnerId,
  planVersion
) {
  const collection = mongoose.connection.collection("questionprovenances");
  const now = new Date();
  for (const [chapterIndex, chapterId] of chapterIds.entries()) {
    const questions = Array.from({ length: 5 }, (_, questionIndex) => ({
      blueprint_id: new mongoose.Types.ObjectId(blueprintId),
      chapter_id: new mongoose.Types.ObjectId(chapterId),
      learner_id: learnerId,
      package_id: `ci-quiz-package-${chapterIndex + 1}`,
      schema_version: "question-provenance-v1",
      question_id: `ci-quiz-${chapterIndex + 1}-${questionIndex + 1}`,
      prompt: `Agent supplied question ${chapterIndex + 1}-${questionIndex + 1}`,
      type: "mcq",
      options: ["A", "B", "C", "D"],
      correct_option: "A",
      plan_version: planVersion,
      approved: true,
      provenance: {
        document_id: "ci-course-notes-v1",
        document_title: "CI Course Notes",
        page_number: chapterIndex + 1,
        section: `Week ${chapterIndex + 1}`,
      },
      createdAt: now,
      updatedAt: now,
    }));
    await collection.insertMany(questions);
  }

  await collection.insertMany(
    Array.from({ length: 20 }, (_, index) => ({
      blueprint_id: new mongoose.Types.ObjectId(blueprintId),
      curriculum_id: new mongoose.Types.ObjectId(curriculumId),
      learner_id: learnerId,
      package_id: index < 10 ? "ci-final-primary-v1" : "ci-final-reserve-v1",
      schema_version: "question-provenance-v1",
      question_id: `ci-final-${index + 1}`,
      prompt: `Grounded cumulative final question ${index + 1}`,
      type: "mcq",
      options: ["A", "B", "C", "D"],
      correct_option: "A",
      plan_version: planVersion,
      approved: true,
      provenance: {
        document_id: "ci-course-notes-v1",
        document_title: "CI Course Notes",
        page_number: index + 1,
        section: `Week ${(index % chapterIds.length) + 1}`,
      },
      createdAt: now,
      updatedAt: now,
    }))
  );
}

function buildMidtermPackage({ blueprintId, curriculumId, chapterIds, planVersion }) {
  const documentId = "ci-course-notes-v1";
  const documentTitle = "CI Course Notes";
  const promptVersion = "ci-midterm-prompt-v1";
  const outcomes = chapterIds.map((_, index) => `week-${index + 1}-objective`);
  const completedChapters = chapterIds.map((chapterId, index) => ({
    chapter_id: chapterId,
    week: index + 1,
    objectives:
      index < outcomes.length - 1
        ? [outcomes[index], outcomes[index + 1]]
        : [outcomes[index]],
  }));
  const difficulty = [
    "easy",
    "medium",
    "hard",
    "easy",
    "medium",
    "hard",
    "easy",
    "medium",
    "hard",
    "easy",
  ];
  const questions = Array.from({ length: 10 }, (_, index) => {
    const week = Math.floor(index / 2) + 1;
    const objectiveIds = index < 2
      ? [outcomes[0], outcomes[1]]
      : [outcomes[week - 1]];
    const question = {
      schema_version: "question-provenance-v1",
      question_id: `ci-midterm-q-${index + 1}`,
      prompt: `Grounded midterm question ${index + 1}`,
      type: "mcq",
      options: ["A", "B", "C", "D"],
      correct_option: "A",
      plan_version: planVersion,
      provenance: {
        document_id: documentId,
        document_title: documentTitle,
        page_number: week * 10,
        section: `Week ${week}`,
        excerpt: `Evidence for grounded question ${index + 1}`,
      },
      source_ids: [documentId],
      chapter_id: chapterIds[week - 1],
      week,
      objective_ids: objectiveIds,
      difficulty: difficulty[index],
      integration: index < 2,
      generator_prompt_version: promptVersion,
    };
    return { ...question, question_hash: hashValue(question) };
  });
  const packageWithoutHash = {
    schema_version: "midterm-package-v1",
    package_id: "ci-grounded-midterm-v1",
    package_version: "1.0.0",
    publication_key: "ci-grounded-midterm-publication-v1",
    blueprint_id: blueprintId,
    blueprint_version: 0,
    plan_version: planVersion,
    curriculum_id: curriculumId,
    completed_scope: {
      start_week: 1,
      end_week: chapterIds.length,
      chapters: completedChapters,
    },
    balance: {
      question_count: questions.length,
      difficulty_counts: { easy: 4, medium: 3, hard: 3 },
      maximum_questions_per_week: 2,
      minimum_integration_questions: 2,
    },
    prompt_trace: {
      generator_name: "UnivAI-Agent",
      generator_version: "ci-agent-v1",
      prompt_id: "ci-balanced-grounded-midterm",
      prompt_version: promptVersion,
      generated_at: new Date().toISOString(),
    },
    answer_key: Object.fromEntries(
      questions.map((question) => [question.question_id, question.correct_option])
    ),
    questions,
  };
  return {
    ...packageWithoutHash,
    package_hash: hashValue(packageWithoutHash),
  };
}

async function test(label, method, url, body = undefined, headers = {}) {
  const fullUrl = `${BASE}${url}`;
  const options = {
    method,
    headers: { "Content-Type": "application/json", ...headers },
  };
  if (body !== undefined) options.body = JSON.stringify(body);

  let status, responseBody, error;
  try {
    const res = await fetch(fullUrl, options);
    status = res.status;
    responseBody = await res.json().catch(() => null);
  } catch (err) {
    error = err.message;
  }

  const ok = status >= 200 && status < 300;

  console.log(`\n--- ${label} ---`);
  console.log(`> ${method} ${url}`);
  if (body !== undefined) console.log(`> Body: ${JSON.stringify(body, null, 4)}`);
  console.log(`< ${status || "ERR"}: ${JSON.stringify(responseBody || error, null, 4)}`);
  console.log(ok ? "  ✅ PASS" : "  ❌ FAIL");

  if (ok) passed++;
  else failed++;

  return { ok, status, body: responseBody };
}

function examHeaders(attemptToken) {
  return { Authorization: `Bearer ${attemptToken}` };
}

async function answerAllQuestions(label, examId, launch, examDocument) {
  const attemptToken = launch?.attempt_token;
  if (!attemptToken) {
    console.log(`    Missing attempt token for ${label}`);
    failed++;
    return null;
  }

  const sourceQuestions = new Map(
    (examDocument?.generated_questions || []).map((question) => [
      String(question.question_id),
      question,
    ])
  );
  let view = launch;
  let questionNumber = 0;

  while (view?.current_question) {
    const question = view.current_question;
    const source = sourceQuestions.get(String(question.question_id));
    const answer =
      question.type === "mcq"
        ? source?.correct_option
        : "This is a placeholder essay answer for testing purposes.";

    if (!answer) {
      console.log(`    Missing test answer for question ${question.question_id}`);
      failed++;
      return null;
    }

    questionNumber++;
    const response = await test(
      `${label} question ${questionNumber}`,
      "POST",
      `/api/exams/${examId}/answer`,
      {
        question_id: question.question_id,
        answer,
        action: "answer",
        revision: view.answer_revision,
        idempotency_key: `api-test-${examId}-${view.answer_revision}`,
      },
      examHeaders(attemptToken)
    );
    if (!response.ok) return null;
    view = response.body;
  }

  return view?.can_submit ? attemptToken : null;
}

/* ────────────────────────────────────────────
   Inline lightweight schemas for seed queries
   ──────────────────────────────────────────── */
const studentSchema = new mongoose.Schema(
  { name: String },
  { timestamps: true }
);
const Student =
  mongoose.models.Student || mongoose.model("Student", studentSchema);

const curriculumSchema = new mongoose.Schema(
  {
    title: String,
    description: String,
    book_id: mongoose.Schema.Types.ObjectId,
    owner_student_id: mongoose.Schema.Types.ObjectId,
  },
  { timestamps: true }
);
const Curriculum =
  mongoose.models.Curriculum ||
  mongoose.model("Curriculum", curriculumSchema);

const chapterSchema = new mongoose.Schema(
  {
    curriculum_id: mongoose.Schema.Types.ObjectId,
    title: String,
    number: Number,
  },
  { timestamps: true }
);
const Chapter =
  mongoose.models.Chapter || mongoose.model("Chapter", chapterSchema);

const examSchema = new mongoose.Schema(
  {
    type: String,
    title: String,
    student_id: mongoose.Schema.Types.ObjectId,
    curriculum_id: mongoose.Schema.Types.ObjectId,
    chapter_id: mongoose.Schema.Types.ObjectId,
    attempt_number: Number,
    generated_questions: [mongoose.Schema.Types.Mixed],
    student_answers: [mongoose.Schema.Types.Mixed],
    taken: Boolean,
    mark: Number,
    passing_mark: Number,
    passed: Boolean,
    grading_status: String,
    integrity_status: { type: String, default: "clean" },
    invalidated_at: Date,
    invalidation_notified_at: Date,
  },
  { timestamps: true }
);
const Exam = mongoose.models.Exam || mongoose.model("Exam", examSchema);

/* ────────────────────────────────────────────
   Main
   ──────────────────────────────────────────── */
async function main() {
  console.log(`MongoDB  → ${MONGODB_URI}`);
  console.log(`API Base → ${BASE}`);
  console.log(`Waiting for server at ${BASE} …`);

  /* wait for the API server to be reachable */
  let up = false;
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      const res = await fetch(BASE, { signal: AbortSignal.timeout(2000) });
      if (res.ok || res.status === 404) {
        up = true;
        break;
      }
    } catch {
      /* retry */
    }
    process.stdout.write(".");
    await new Promise((r) => setTimeout(r, 1500));
  }
  if (!up) {
    console.log("\n❌ Server not reachable – start `npm run dev` first");
    process.exit(1);
  }
  console.log("  reachable ✅\n");

  await mongoose.connect(MONGODB_URI);
  console.log("MongoDB connected\n");

  /* ────────── SEED ────────── */
  header("SEED PHASE");

  const ts = Date.now();
  const alice = await Student.create({ name: `Alice_${ts}` });
  const bob = await Student.create({ name: `Bob_${ts}` });
  const aliceId = alice._id.toString();
  const bobId = bob._id.toString();
  console.log(`  Student Alice → ${aliceId}`);
  console.log(`  Student Bob   → ${bobId}`);

  /* ────────── API TESTS ────────── */
  header("API TEST PHASE");

  /* 1 ─ POST /api/books ──────────────────── */
  const r1 = await test("1. Create book", "POST", "/api/books", {
    title: "Introduction to Computer Science",
    original_filename: "intro_cs.pdf",
    storage_path: "/uploads/intro_cs.pdf",
    student_id: aliceId,
  });
  const bookId = r1.ok ? r1.body?._id : null;
  console.log(`    bookId → ${bookId || "N/A"}`);

  /* 2 ─ GET /api/books/:id ──────────────── */
  if (bookId) {
    await test("2. Get book by ID", "GET", `/api/books/${bookId}`);
  }

  /* resolve curriculum + chapters from DB
     (created by processBook inside the POST /api/books handler) */
  let curriculumId = null;
  let chapterIds = [];

  if (bookId) {
    const curric = await Curriculum.findOne({
      book_id: new mongoose.Types.ObjectId(bookId),
    }).lean();
    if (curric) {
      curriculumId = curric._id.toString();
      console.log(`    curriculumId → ${curriculumId}`);

      const chapters = await Chapter.find({
        curriculum_id: curric._id,
      })
        .sort({ number: 1 })
        .lean();
      chapterIds = chapters.map((c) => c._id.toString());
      console.log(`    chapters (${chapterIds.length}) → ${chapterIds.join(", ")}`);
    }
  }

  /* 3 ─ GET /api/curricula/:id/chapters ──── */
  if (curriculumId) {
    await test("3. Get curriculum chapters", "GET", `/api/curricula/${curriculumId}/chapters`);
  }

  /* 4 ─ POST /api/enrollments (enroll Bob) ─ */
  if (curriculumId) {
    await test("4. Enroll Bob", "POST", "/api/enrollments", {
      student_id: bobId,
      curriculum_id: curriculumId,
      enrolled_at: new Date().toISOString(),
      status: "active",
    });
  }

  /* 5–6 ─ For each chapter: start + submit quiz ── */
  let midtermBlueprintId = null;
  let midtermPlanVersion = null;
  if (curriculumId && chapterIds.length > 0) {
    midtermBlueprintId = new mongoose.Types.ObjectId().toString();
    midtermPlanVersion = `ci-plan-${ts}`;
    const outcomes = chapterIds.map((_, index) => `week-${index + 1}-objective`);
    const now = new Date();
    await mongoose.connection.collection("assessmentblueprints").insertOne({
      _id: new mongoose.Types.ObjectId(midtermBlueprintId),
      schema_version: "assessment-blueprint-v1",
      programme: "Computer Science",
      semester: "CI",
      course_id: curriculumId,
      title: "CI grounded midterm blueprint",
      outcomes,
      difficulty: "mixed",
      source_coverage: chapterIds.map((_, index) => ({
        document_id: "ci-course-notes-v1",
        document_title: "CI Course Notes",
        sections: [`Week ${index + 1}`],
        page_ranges: [{ start: 1, end: 100 }],
      })),
      plan_version: midtermPlanVersion,
      approved: true,
      approved_by: "ci-fixture",
      approved_at: now,
      __v: 0,
      createdAt: now,
      updatedAt: now,
    });
    await seedPublishedQuestionBanks(
      chapterIds,
      midtermBlueprintId,
      curriculumId,
      aliceId,
      midtermPlanVersion
    );
    console.log("    Published quiz/final fixtures and approved blueprint seeded");
  }

  const submittedQuizzes = [];

  for (let i = 0; i < chapterIds.length; i++) {
    const cid = chapterIds[i];
    const r5 = await test(
      `5. Start quiz – chapter ${i + 1}`,
      "POST",
      "/api/exams/quiz/start",
      { student_id: aliceId, chapter_id: cid }
    );

    if (!r5.ok) continue;

    const exam = r5.body;
    const eid = exam?._id;
    if (!eid) continue;

    /* Read answers from DB while exercising the public one-question-at-a-time API. */
    const doc = await Exam.findById(eid).lean();
    const attemptToken = await answerAllQuestions(
      `6. Answer quiz – chapter ${i + 1}`,
      eid,
      r5.body,
      doc
    );
    if (!attemptToken) continue;

    const r6 = await test(
      `6. Submit quiz – chapter ${i + 1}`,
      "POST",
      `/api/exams/${eid}/submit`,
      undefined,
      examHeaders(attemptToken)
    );
    if (r6.ok) submittedQuizzes.push({ examId: eid, attemptToken });
  }

  /* 7 ─ GET /api/exams/:id ────────────────── */
  if (submittedQuizzes.length > 0) {
    const lastQuiz = submittedQuizzes[submittedQuizzes.length - 1];
    await test(
      "7. Get exam details (last submitted quiz)",
      "GET",
      `/api/exams/${lastQuiz.examId}`,
      undefined,
      examHeaders(lastQuiz.attemptToken)
    );
  }

  /* 8 ─ POST /api/exams/mid ───────────────── */
  let createdMidIds = [];

  if (curriculumId && chapterIds.length > 0) {
    const r8 = await test("8. Create mid exams (admin)", "POST", "/api/exams/mid", {
      curriculum_id: curriculumId,
      title: "Mid Term Exam - CS",
      chapter_ids: chapterIds,
      passing_mark: 3,
    });

    if (r8.ok) {
      const mids = await Exam.find({
        type: "mid",
        student_id: new mongoose.Types.ObjectId(aliceId),
      })
        .lean()
        .sort({ createdAt: -1 })
        .limit(1);
      createdMidIds = mids.map((e) => e._id.toString());
      console.log(`    mid examIds for Alice → ${createdMidIds.join(", ")}`);
    }
  }

  /* 9 ─ POST /api/exams/mid/:id/start ────── */
  if (createdMidIds.length > 0 && midtermBlueprintId && midtermPlanVersion) {
    if (!AGENT_TOKEN) {
      throw new Error("UNIVAI_AGENT_SECRET is required for CI midterm publication");
    }
    await test(
      "8a. Publish grounded midterm package (Agent)",
      "POST",
      "/api/assessments/midterm/publish",
      buildMidtermPackage({
        blueprintId: midtermBlueprintId,
        curriculumId,
        chapterIds,
        planVersion: midtermPlanVersion,
      }),
      { "x-univai-agent-token": AGENT_TOKEN }
    );
  }

  let startedMidId = null;
  let startedMidToken = null;

  for (const midId of createdMidIds) {
    const r9 = await test(
      `9. Start mid exam`,
      "POST",
      `/api/exams/mid/${midId}/start`,
      { student_id: aliceId }
    );
    if (r9.ok) {
      startedMidId = midId;
      startedMidToken = r9.body?.attempt_token;
      break;
    }
  }

  /* 10 ─ POST /api/exams/:id/proctoring-event ── */
  if (startedMidId) {
    await test(
      '10a. Proctoring – tab_switch',
      "POST",
      `/api/exams/${startedMidId}/proctoring-event`,
      { type: "tab_switch", student_id: aliceId, metadata: { to: "youtube" } },
      examHeaders(startedMidToken)
    );
    await test(
      '10b. Proctoring – copy_paste',
      "POST",
      `/api/exams/${startedMidId}/proctoring-event`,
      { type: "copy_paste", student_id: aliceId },
      examHeaders(startedMidToken)
    );
    await test(
      '10c. Proctoring – devtools_open',
      "POST",
      `/api/exams/${startedMidId}/proctoring-event`,
      { type: "devtools_open", student_id: aliceId },
      examHeaders(startedMidToken)
    );
    await test(
      '10d. Proctoring – no_face (camera)',
      "POST",
      `/api/exams/${startedMidId}/proctoring-event`,
      { type: "no_face", student_id: aliceId, detected: true },
      examHeaders(startedMidToken)
    );
  }

  /* 11 ─ POST /api/appeals (only if mid was invalidated) ── */
  if (startedMidId) {
    const mDoc = await Exam.findById(startedMidId).lean();
    if (mDoc?.integrity_status === "invalidated") {
      await test("11. Resolve integrity appeal", "POST", "/api/appeals", {
        exam_id: startedMidId,
        resolution: "cleared",
        resolved_by: "admin",
        note: "False positive – student was using a calculator",
        allow_retake: true,
      });
    } else {
      console.log("\n--- 11. Resolve integrity appeal ---");
      console.log(
        `  ⚠️ Skipped – exam integrity_status = "${mDoc?.integrity_status}" (not invalidated)`
      );
    }
  }

  /* 12 ─ POST /api/exams/final/start ──────── */
  let finalExamId = null;
  let finalExamToken = null;
  let finalExamLaunch = null;

  if (curriculumId) {
    const authorizedAt = new Date();
    const finalStartBody = {
      student_id: aliceId,
      curriculum_id: curriculumId,
      final_form: "primary",
      authorized_at: authorizedAt.toISOString(),
      access_opens_at: new Date(authorizedAt.getTime() - 60_000).toISOString(),
      access_expires_at: new Date(authorizedAt.getTime() + 24 * 60 * 60_000).toISOString(),
    };
    const finalStartRaw = JSON.stringify(finalStartBody);
    const finalStartHeaders = process.env.UNIVAI_MODE === "standalone"
      ? {}
      : {
          "X-UnivAI-App-Signature": createHmac(
            "sha256",
            process.env.EXAM_CALLBACK_SECRET || "",
          ).update(finalStartRaw).digest("hex"),
        };
    const r12 = await test(
      "12. Start final exam",
      "POST",
      "/api/exams/final/start",
      finalStartBody,
      finalStartHeaders,
    );
    if (r12.ok) {
      finalExamId = r12.body?._id;
      finalExamToken = r12.body?.attempt_token;
      finalExamLaunch = r12.body;
      console.log(`    finalExamId → ${finalExamId}`);
    }
  }

  /* proctoring events during final session */
  if (finalExamId) {
    await test(
      '12a. Proctoring (final) – fullscreen_exit',
      "POST",
      `/api/exams/${finalExamId}/proctoring-event`,
      { type: "fullscreen_exit", student_id: aliceId },
      examHeaders(finalExamToken)
    );
  }

  /* 13 ─ POST /api/exams/:id/submit (final) ─ */
  if (finalExamId) {
    const doc = await Exam.findById(finalExamId).lean();
    finalExamToken = await answerAllQuestions(
      "13. Answer final exam",
      finalExamId,
      finalExamLaunch,
      doc
    );
    if (finalExamToken) {
      await test(
        "13. Submit final exam",
        "POST",
        `/api/exams/${finalExamId}/submit`,
        undefined,
        examHeaders(finalExamToken)
      );
    }
  }

  /* 14 ─ POST /api/exams/:id/grade ────────── */
  if (finalExamId) {
    const doc = await Exam.findById(finalExamId).lean();
    if (doc?.grading_status === "pending_review") {
      await test("14. Grade final exam", "POST", `/api/exams/${finalExamId}/grade`, {
        mark: 85,
        graded_by: "teacher1",
        reason: "Well done – comprehensive answers",
      });
    } else {
      console.log(
        `  ⚠️ Skipped grade – status = "${doc?.grading_status}"`
      );
    }
  }

  /* 15 ─ GET /api/exams/:id/download ──────── */
  if (finalExamId) {
    await test("15. Download exam", "GET", `/api/exams/${finalExamId}/download`);
  }

  /* ────────── SUMMARY ────────── */
  const total = passed + failed;
  console.log(`\n${"=".repeat(60)}`);
  console.log(`  RESULTS: ${passed}/${total} passed, ${failed}/${total} failed`);
  console.log(`${"=".repeat(60)}`);

  await mongoose.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("\n❌ FATAL:", err.message);
  process.exit(1);
});
