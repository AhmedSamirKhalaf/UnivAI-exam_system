import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";
import mongoose from "mongoose";

import {
  Book,
  Chapter,
  Curriculum,
  Enrollment,
  Exam,
  ExamSession,
  IntegrityAppeal,
  ProctoringEvent,
  Student,
} from "../src/models";
import {
  STANDALONE_SEED_VERSION,
  STANDALONE_STUDENT_ID,
} from "../src/lib/runtime";

process.env.UNIVAI_MODE = "standalone";
const command = process.argv[2] ?? "dev";
const integrationSeed = command === "seed-integration";
process.env.MONGODB_URI ??=
  integrationSeed
    ? "mongodb://127.0.0.1:27017/univai_exams"
    : "mongodb://127.0.0.1:27018/univai_exams_standalone";

const IDS = {
  student: STANDALONE_STUDENT_ID,
  book: "64b000000000000000000002",
  curriculum: "64b000000000000000000003",
  chapters: [
    "64b000000000000000000011",
    "64b000000000000000000012",
    "64b000000000000000000013",
    "64b000000000000000000014",
  ],
  exams: {
    notStarted: "64b000000000000000000021",
    active: "64b000000000000000000022",
    submitted: "64b000000000000000000023",
    pending: "64b000000000000000000024",
    flagged: "64b000000000000000000025",
  },
};
const FIXED_NOW = new Date("2026-07-27T09:00:00.000Z");
const compose = ["compose", "-f", "docker-compose.standalone.yml"];

function localMongoUri(): string {
  const uri = process.env.MONGODB_URI!;
  const parsed = new URL(uri);
  if (!["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)) {
    throw new Error(`Refusing standalone mutation for non-loopback MongoDB: ${parsed.hostname}`);
  }
  if (integrationSeed && parsed.pathname !== "/univai_exams") {
    throw new Error("Integration seed requires the local 'univai_exams' database");
  }
  if (!integrationSeed && !parsed.pathname.includes("standalone")) {
    throw new Error("Standalone Mongo database name must include 'standalone'");
  }
  return uri;
}

async function connect(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  await mongoose.connect(localMongoUri(), { serverSelectionTimeoutMS: 1500 });
}

function question(index: number, source: "lecture" | "self_study") {
  return {
    prompt: `Standalone question ${index + 1}: which choice follows the learning material?`,
    type: "mcq",
    options: ["A) Use explicit evidence", "B) Guess", "C) Share tenant data", "D) Hide mode"],
    correct_option: "A",
    source,
  };
}

async function seed(): Promise<void> {
  await connect();
  await Student.findByIdAndUpdate(
    IDS.student,
    { name: "Standalone Learner" },
    { upsert: true, returnDocument: "after" }
  );
  await Book.findByIdAndUpdate(
    IDS.book,
    {
      title: "Project-authored Standalone Course",
      original_filename: "standalone-course.md",
      storage_path: "fixtures/standalone-course.md",
      status: "ready",
      requested_by_student_id: IDS.student,
    },
    { upsert: true }
  );
  await Curriculum.findByIdAndUpdate(
    IDS.curriculum,
    {
      title: "Standalone Evidence Course",
      description: "Deterministic local exam scenarios",
      book_id: IDS.book,
      owner_student_id: IDS.student,
    },
    { upsert: true }
  );
  await Enrollment.findOneAndUpdate(
    { student_id: IDS.student, curriculum_id: IDS.curriculum },
    {
      enrolled_at: FIXED_NOW,
      status: "active",
    },
    { upsert: true }
  );

  for (let index = 0; index < IDS.chapters.length; index += 1) {
    await Chapter.findByIdAndUpdate(
      IDS.chapters[index],
      {
        curriculum_id: IDS.curriculum,
        title: `Week ${index + 1}`,
        number: index + 1,
      },
      { upsert: true }
    );
    await mongoose.connection.collection("question_banks").updateOne(
      { chapter_id: IDS.chapters[index] },
      {
        $set: {
          seed_version: STANDALONE_SEED_VERSION,
          questions: [
            ...Array.from({ length: 18 }, (_, item) => question(item, "lecture")),
            ...Array.from({ length: 2 }, (_, item) => question(item + 18, "self_study")),
          ],
        },
      },
      { upsert: true }
    );
  }

  const baseQuestions = Array.from({ length: 5 }, (_, index) => ({
    question_id: `q_${index + 1}`,
    ...question(index, "lecture"),
  }));
  const scenarios = [
    {
      _id: IDS.exams.notStarted,
      type: "quiz",
      title: "Not-started quiz",
      chapter_id: IDS.chapters[0],
      taken: false,
      grading_status: "auto_graded",
      integrity_status: "clean",
      policy_action: "none",
      review_status: "not_required",
    },
    {
      _id: IDS.exams.active,
      type: "mid",
      title: "Active midterm",
      taken: false,
      grading_status: "auto_graded",
      integrity_status: "clean",
      policy_action: "none",
      review_status: "not_required",
    },
    {
      _id: IDS.exams.submitted,
      type: "quiz",
      title: "Completed quiz",
      chapter_id: IDS.chapters[1],
      taken: true,
      mark: 5,
      passed: true,
      grading_status: "auto_graded",
      integrity_status: "clean",
      policy_action: "none",
      review_status: "not_required",
    },
    {
      _id: IDS.exams.pending,
      type: "final",
      title: "Final pending manual review",
      taken: true,
      grading_status: "pending_review",
      integrity_status: "clean",
      policy_action: "none",
      review_status: "not_required",
      generated_questions: [
        ...baseQuestions,
        { question_id: "essay_1", prompt: "Explain tenant isolation.", type: "essay" },
      ],
    },
    {
      _id: IDS.exams.flagged,
      type: "mid",
      title: "Session flagged for review",
      taken: true,
      mark: 4,
      passed: false,
      grading_status: "auto_graded",
      integrity_status: "invalidated",
      policy_action: "session_invalidated",
      review_status: "pending",
      invalidated_at: FIXED_NOW,
    },
  ];

  for (const scenario of scenarios) {
    const { _id, ...scenarioData } = scenario;
    await Exam.findByIdAndUpdate(
      _id,
      {
        student_id: IDS.student,
        student_sid: "S-2026-000042",
        curriculum_id: IDS.curriculum,
        attempt_number: 1,
        generated_questions: scenario.generated_questions ?? baseQuestions,
        student_answers: scenario.taken ? [] : undefined,
        passing_mark: 3,
        passed: scenario.passed ?? false,
        ...scenarioData,
      },
      { upsert: true, returnDocument: "after" }
    );
  }

  await ExamSession.findOneAndUpdate(
    { exam_id: IDS.exams.active },
    {
      student_id: IDS.student,
      started_at: FIXED_NOW,
      suspicion_score: 0,
      flagged: false,
      status: "in_progress",
    },
    { upsert: true }
  );
  await ExamSession.findOneAndUpdate(
    { exam_id: IDS.exams.flagged },
    {
      student_id: IDS.student,
      started_at: FIXED_NOW,
      ended_at: FIXED_NOW,
      suspicion_score: 55,
      flagged: true,
      status: "completed",
      terminated_reason: "student_submitted",
    },
    { upsert: true }
  );
  await ProctoringEvent.deleteMany({ exam_id: IDS.exams.flagged });
  await ProctoringEvent.create({
    exam_id: IDS.exams.flagged,
    student_id: IDS.student,
    type: "tab_switch",
    weight: 25,
    score_at_event: 25,
    occurrences: 1,
    last_seen_at: FIXED_NOW,
    metadata: { synthetic: true },
  });
  await IntegrityAppeal.deleteMany({ exam_id: IDS.exams.flagged });
  await IntegrityAppeal.create({
    exam_id: IDS.exams.flagged,
    submitted_note: "Synthetic review scenario",
    resolved_by: "standalone-reviewer",
    resolution: "upheld",
    allow_retake: false,
    resolved_at: FIXED_NOW,
  });
  console.log(JSON.stringify({ ok: true, seed: STANDALONE_SEED_VERSION, ids: IDS }, null, 2));
}

async function reset(): Promise<void> {
  await connect();
  const examIds = Object.values(IDS.exams);
  await Promise.all([
    Exam.deleteMany({ _id: { $in: examIds } }),
    ExamSession.deleteMany({ exam_id: { $in: examIds } }),
    ProctoringEvent.deleteMany({ exam_id: { $in: examIds } }),
    IntegrityAppeal.deleteMany({ exam_id: { $in: examIds } }),
    Enrollment.deleteMany({ student_id: IDS.student }),
    Chapter.deleteMany({ _id: { $in: IDS.chapters } }),
    Curriculum.deleteMany({ _id: IDS.curriculum }),
    Book.deleteMany({ _id: IDS.book }),
    Student.deleteMany({ _id: IDS.student }),
    mongoose.connection.collection("question_banks").deleteMany({
      seed_version: STANDALONE_SEED_VERSION,
    }),
    mongoose.connection.collection("webhook_captures").deleteMany({}),
  ]);
  console.log("Standalone Exam data reset.");
}

function docker(action: "up" | "down"): void {
  const args = action === "up" ? [...compose, "up", "-d", "--wait"] : [...compose, "down"];
  const result = spawnSync("docker", args, { stdio: "inherit", shell: false });
  if (result.status !== 0) throw new Error(`docker compose ${action} failed`);
}

async function smoke(): Promise<void> {
  docker("up");
  await seed();
  const first = await Exam.countDocuments({ _id: { $in: Object.values(IDS.exams) } });
  await seed();
  const second = await Exam.countDocuments({ _id: { $in: Object.values(IDS.exams) } });
  if (first !== 5 || second !== 5) throw new Error("seed is not idempotent");
  const bank = await mongoose.connection.collection("question_banks").findOne({
    chapter_id: IDS.chapters[0],
  });
  const sources = (bank?.questions ?? []).map((item: { source: string }) => item.source);
  if (sources.filter((item: string) => item === "self_study").length !== 2) {
    throw new Error("canonical question bank source ratio is invalid");
  }
  console.log(JSON.stringify({ ok: true, scenarios: second, seed: STANDALONE_SEED_VERSION }));
}

async function main(): Promise<void> {
  if (command === "up" || command === "down") {
    docker(command);
    return;
  }
  if (command === "seed" || command === "seed-integration") await seed();
  else if (command === "reset") await reset();
  else if (command === "smoke") await smoke();
  else if (command === "dev") {
    docker("up");
    await seed();
    await mongoose.disconnect();
    const child = spawn(
      process.execPath,
      [path.resolve("node_modules", "next", "dist", "bin", "next"), "dev", "-p", "3200"],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          UNIVAI_MODE: "standalone",
          MONGODB_URI: localMongoUri(),
        },
      }
    );
    child.on("exit", (code) => process.exit(code ?? 0));
    return;
  } else {
    throw new Error(`Unknown standalone command: ${command}`);
  }
  await mongoose.disconnect();
}

main().catch(async (error) => {
  console.error(error instanceof Error ? error.message : error);
  await mongoose.disconnect();
  process.exit(1);
});
