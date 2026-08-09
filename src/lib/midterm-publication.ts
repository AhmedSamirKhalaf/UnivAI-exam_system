import { createHash } from "node:crypto";
import mongoose, { Model, Schema } from "mongoose";
import { z } from "zod";
import {
  AUDIT_SCHEMA_VERSION,
  INTEGRITY_POLICY_VERSION,
  auditEntrySchema,
} from "./audit-log";
import { validateQuestionProvenance } from "./blueprint-validator";
import { AssessmentBlueprint } from "../models/AssessmentBlueprint";
import { Chapter } from "../models/Chapter";
import { Exam } from "../models/Exam";
import { ExamChapter } from "../models/ExamChapter";
import { QuestionProvenance } from "../models/QuestionProvenance";
import { assessmentBlueprintSchema } from "../schemas/assessment-blueprint";

const requiredText = z.string().trim().min(1).max(500);
const objectIdText = z
  .string()
  .refine((value) => mongoose.isValidObjectId(value), "Expected a Mongo ObjectId");
const sha256Text = z.string().regex(/^[a-f0-9]{64}$/, "Expected a lowercase SHA-256 hash");
export const MIDTERM_PACKAGE_OPTION_COUNT = 6;

const scopedChapterSchema = z
  .object({
    chapter_id: objectIdText,
    week: z.number().int().min(1),
    objectives: z.array(requiredText).min(1).max(100),
  })
  .strict();

export const midtermPackageQuestionV1Schema = z
  .object({
    schema_version: z.literal("question-provenance-v1"),
    question_id: requiredText,
    prompt: requiredText,
    type: z.enum(["mcq", "essay"]),
    options: z.array(requiredText).length(MIDTERM_PACKAGE_OPTION_COUNT).optional(),
    correct_option: requiredText.optional(),
    plan_version: requiredText,
    provenance: z
      .object({
        document_id: requiredText,
        document_title: requiredText,
        page_number: z.number().int().min(1),
        section: requiredText,
        excerpt: requiredText,
      })
      .strict(),
    source_ids: z.array(requiredText).min(1).max(20),
    chapter_id: objectIdText,
    week: z.number().int().min(1),
    objective_ids: z.array(requiredText).min(1).max(20),
    difficulty: z.enum(["easy", "medium", "hard"]),
    integration: z.boolean(),
    generator_prompt_version: requiredText,
    question_hash: sha256Text,
  })
  .strict()
  .superRefine((question, context) => {
    if (question.type === "mcq") {
      if (!question.options) {
        context.addIssue({
          code: "custom",
          path: ["options"],
          message: `Midterm MCQs require exactly ${MIDTERM_PACKAGE_OPTION_COUNT} options`,
        });
      } else if (new Set(question.options).size !== question.options.length) {
        context.addIssue({
          code: "custom",
          path: ["options"],
          message: "Midterm MCQ options must be unique",
        });
      } else if (
        !question.correct_option ||
        !question.options.includes(question.correct_option)
      ) {
        context.addIssue({
          code: "custom",
          path: ["correct_option"],
          message: "MCQ correct_option must match one supplied option",
        });
      }
    } else if (
      question.options !== undefined ||
      question.correct_option !== undefined
    ) {
      context.addIssue({
        code: "custom",
        path: ["type"],
        message: "Essay questions cannot contain options or a correct_option",
      });
    }
  });

export const midtermPackageV1Schema = z
  .object({
    schema_version: z.literal("midterm-package-v1"),
    package_id: requiredText,
    package_version: requiredText,
    publication_key: z.string().trim().min(8).max(200),
    package_hash: sha256Text,
    blueprint_id: objectIdText,
    blueprint_version: z.number().int().min(0),
    plan_version: requiredText,
    curriculum_id: objectIdText,
    completed_scope: z
      .object({
        start_week: z.number().int().min(1),
        end_week: z.number().int().min(1),
        chapters: z.array(scopedChapterSchema).min(1).max(100),
      })
      .strict(),
    balance: z
      .object({
        question_count: z.number().int().min(5).max(60),
        difficulty_counts: z
          .object({
            easy: z.number().int().min(0),
            medium: z.number().int().min(0),
            hard: z.number().int().min(0),
          })
          .strict(),
        maximum_questions_per_week: z.number().int().min(1),
        minimum_integration_questions: z.number().int().min(0),
      })
      .strict(),
    prompt_trace: z
      .object({
        generator_name: requiredText,
        generator_version: requiredText,
        prompt_id: requiredText,
        prompt_version: requiredText,
        generated_at: z.string().datetime({ offset: true }),
      })
      .strict(),
    answer_key: z.record(z.string(), requiredText),
    questions: z.array(midtermPackageQuestionV1Schema).min(5).max(60),
  })
  .strict();

export type MidtermPackageQuestionV1 = z.infer<
  typeof midtermPackageQuestionV1Schema
>;
export type MidtermPackageV1 = z.infer<typeof midtermPackageV1Schema>;

export interface PublicationDefect {
  code: string;
  path: string;
  message: string;
}

export interface AuthorizedChapter {
  chapter_id: string;
  number: number;
}

export interface MidtermPackageValidationResult {
  valid: boolean;
  defects: PublicationDefect[];
  package?: MidtermPackageV1;
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonicalValue(nested)]),
    );
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalValue(value)))
    .digest("hex");
}

export function computeQuestionContentHash(
  question: Omit<MidtermPackageQuestionV1, "question_hash"> | MidtermPackageQuestionV1,
): string {
  const content: Record<string, unknown> = { ...question };
  delete content.question_hash;
  return sha256(content);
}

export function computeMidtermPackageHash(
  midtermPackage: Omit<MidtermPackageV1, "package_hash"> | MidtermPackageV1,
): string {
  const content: Record<string, unknown> = { ...midtermPackage };
  delete content.package_hash;
  return sha256(content);
}

function defect(
  defects: PublicationDefect[],
  code: string,
  path: string,
  message: string,
): void {
  defects.push({ code, path, message });
}

function expectedDifficultyCounts(
  questionCount: number,
  blueprintDifficulty: "easy" | "medium" | "hard" | "mixed",
): Record<"easy" | "medium" | "hard", number> {
  if (blueprintDifficulty !== "mixed") {
    return {
      easy: blueprintDifficulty === "easy" ? questionCount : 0,
      medium: blueprintDifficulty === "medium" ? questionCount : 0,
      hard: blueprintDifficulty === "hard" ? questionCount : 0,
    };
  }

  const base = Math.floor(questionCount / 3);
  const remainder = questionCount % 3;
  return {
    easy: base + (remainder >= 1 ? 1 : 0),
    medium: base + (remainder >= 2 ? 1 : 0),
    hard: base,
  };
}

function schemaDefects(error: z.ZodError): PublicationDefect[] {
  return error.issues.map((issue) => ({
    code: "SCHEMA_INVALID",
    path: issue.path.length ? issue.path.join(".") : "root",
    message: issue.message,
  }));
}

export function validateMidtermPackage(
  input: unknown,
  approvedBlueprint: unknown,
  authorizedChapters: AuthorizedChapter[],
): MidtermPackageValidationResult {
  const packageResult = midtermPackageV1Schema.safeParse(input);
  if (!packageResult.success) {
    return { valid: false, defects: schemaDefects(packageResult.error) };
  }

  const blueprintResult = assessmentBlueprintSchema.safeParse(approvedBlueprint);
  if (!blueprintResult.success) {
    return {
      valid: false,
      defects: blueprintResult.error.issues.map((issue) => ({
        code: "BLUEPRINT_INVALID",
        path: `blueprint.${issue.path.join(".") || "root"}`,
        message: issue.message,
      })),
    };
  }

  const midtermPackage = packageResult.data;
  const blueprint = blueprintResult.data;
  const blueprintRecord = approvedBlueprint as {
    _id?: unknown;
    __v?: unknown;
  };
  const defects: PublicationDefect[] = [];

  if (!blueprint.approved) {
    defect(defects, "BLUEPRINT_NOT_APPROVED", "blueprint.approved", "Blueprint is not approved");
  }
  if (String(blueprintRecord._id ?? "") !== midtermPackage.blueprint_id) {
    defect(defects, "BLUEPRINT_ID_MISMATCH", "blueprint_id", "Package blueprint_id does not match the approved blueprint");
  }
  if (blueprintRecord.__v !== midtermPackage.blueprint_version) {
    defect(defects, "STALE_BLUEPRINT_VERSION", "blueprint_version", `Expected blueprint version ${String(blueprintRecord.__v)}`);
  }
  if (blueprint.plan_version !== midtermPackage.plan_version) {
    defect(defects, "STALE_PLAN_VERSION", "plan_version", `Expected approved plan version ${blueprint.plan_version}`);
  }
  if (blueprint.course_id !== midtermPackage.curriculum_id) {
    defect(defects, "COURSE_ID_MISMATCH", "curriculum_id", "Package curriculum_id does not match blueprint course_id");
  }
  if (midtermPackage.completed_scope.end_week < midtermPackage.completed_scope.start_week) {
    defect(defects, "SCOPE_INTERVAL_INVALID", "completed_scope.end_week", "Completed scope end_week must be at least start_week");
  }

  const scopedChapters = midtermPackage.completed_scope.chapters;
  const scopedIds = scopedChapters.map((chapter) => chapter.chapter_id);
  const authorizedIds = authorizedChapters.map((chapter) => chapter.chapter_id);
  if (new Set(scopedIds).size !== scopedIds.length) {
    defect(defects, "DUPLICATE_CHAPTER", "completed_scope.chapters", "Completed scope contains duplicate chapter IDs");
  }
  if (
    scopedIds.length !== authorizedIds.length ||
    scopedIds.some((id) => !authorizedIds.includes(id))
  ) {
    defect(defects, "SCOPE_NOT_AUTHORIZED", "completed_scope.chapters", "Completed scope must exactly match the configured midterm chapters");
  }

  const authorizedById = new Map(
    authorizedChapters.map((chapter) => [chapter.chapter_id, chapter]),
  );
  const weeks = scopedChapters.map((chapter) => chapter.week).sort((a, b) => a - b);
  const expectedWeeks = Array.from(
    {
      length:
        midtermPackage.completed_scope.end_week -
        midtermPackage.completed_scope.start_week +
        1,
    },
    (_, index) => midtermPackage.completed_scope.start_week + index,
  );
  if (
    weeks.length !== expectedWeeks.length ||
    weeks.some((week, index) => week !== expectedWeeks[index])
  ) {
    defect(defects, "SCOPE_INTERVAL_INCOMPLETE", "completed_scope", "Completed scope must contain every week in the configured interval exactly once");
  }

  const scopedObjectiveIds = new Set<string>();
  scopedChapters.forEach((chapter, index) => {
    const authorized = authorizedById.get(chapter.chapter_id);
    if (authorized && authorized.number !== chapter.week) {
      defect(defects, "CHAPTER_WEEK_MISMATCH", `completed_scope.chapters.${index}.week`, `Chapter is configured as week ${authorized.number}`);
    }
    if (new Set(chapter.objectives).size !== chapter.objectives.length) {
      defect(defects, "DUPLICATE_OBJECTIVE", `completed_scope.chapters.${index}.objectives`, "Chapter scope contains duplicate objectives");
    }
    for (const objective of chapter.objectives) {
      scopedObjectiveIds.add(objective);
      if (!blueprint.outcomes.includes(objective)) {
        defect(defects, "OBJECTIVE_NOT_AUTHORIZED", `completed_scope.chapters.${index}.objectives`, `Objective "${objective}" is not in the approved blueprint`);
      }
    }
  });
  if (
    scopedObjectiveIds.size !== blueprint.outcomes.length ||
    blueprint.outcomes.some((objective) => !scopedObjectiveIds.has(objective))
  ) {
    defect(
      defects,
      "SCOPE_OBJECTIVES_BLUEPRINT_MISMATCH",
      "completed_scope.chapters.objectives",
      "Completed objective scope must exactly match the approved blueprint outcomes",
    );
  }

  if (midtermPackage.questions.length !== midtermPackage.balance.question_count) {
    defect(defects, "QUESTION_COUNT_MISMATCH", "balance.question_count", "Declared question count does not match package questions");
  }
  if (midtermPackage.questions.length < scopedChapters.length) {
    defect(defects, "INSUFFICIENT_QUESTION_COUNT", "questions", "At least one question is required for every completed week");
  }

  const expectedDifficulties = expectedDifficultyCounts(
    midtermPackage.questions.length,
    blueprint.difficulty,
  );
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    if (midtermPackage.balance.difficulty_counts[difficulty] !== expectedDifficulties[difficulty]) {
      defect(defects, "DIFFICULTY_BLUEPRINT_MISMATCH", `balance.difficulty_counts.${difficulty}`, `Expected ${expectedDifficulties[difficulty]} ${difficulty} questions`);
    }
  }

  const weekCount = scopedChapters.length;
  const maximumPerWeek = Math.ceil(midtermPackage.questions.length / weekCount);
  if (midtermPackage.balance.maximum_questions_per_week !== maximumPerWeek) {
    defect(defects, "WEEK_BALANCE_CONFIG_INVALID", "balance.maximum_questions_per_week", `Expected deterministic maximum ${maximumPerWeek}`);
  }
  const minimumIntegration =
    weekCount > 1 ? Math.max(1, Math.floor(midtermPackage.questions.length * 0.2)) : 0;
  if (midtermPackage.balance.minimum_integration_questions !== minimumIntegration) {
    defect(defects, "INTEGRATION_CONFIG_INVALID", "balance.minimum_integration_questions", `Expected deterministic minimum ${minimumIntegration}`);
  }

  const chapterScope = new Map(scopedChapters.map((chapter) => [chapter.chapter_id, chapter]));
  const questionIds = new Set<string>();
  const questionHashes = new Set<string>();
  const normalizedPrompts = new Set<string>();
  const coveredObjectives = new Set<string>();
  const countsByWeek = new Map<number, number>();
  const countsByDifficulty = { easy: 0, medium: 0, hard: 0 };
  let integrationCount = 0;

  midtermPackage.questions.forEach((question, index) => {
    const path = `questions.${index}`;
    if (questionIds.has(question.question_id)) {
      defect(defects, "DUPLICATE_QUESTION_ID", `${path}.question_id`, `Duplicate question ID "${question.question_id}"`);
    }
    questionIds.add(question.question_id);

    if (questionHashes.has(question.question_hash)) {
      defect(defects, "DUPLICATE_QUESTION_HASH", `${path}.question_hash`, "Duplicate question content hash");
    }
    questionHashes.add(question.question_hash);
    const expectedHash = computeQuestionContentHash(question);
    if (expectedHash !== question.question_hash) {
      defect(defects, "QUESTION_HASH_MISMATCH", `${path}.question_hash`, `Expected ${expectedHash}`);
    }

    const normalizedPrompt = question.prompt.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
    if (normalizedPrompts.has(normalizedPrompt)) {
      defect(defects, "DUPLICATE_QUESTION_CONTENT", `${path}.prompt`, "Duplicate normalized question prompt");
    }
    normalizedPrompts.add(normalizedPrompt);

    const scope = chapterScope.get(question.chapter_id);
    if (!scope || scope.week !== question.week) {
      defect(defects, "QUESTION_OUT_OF_SCOPE", `${path}.chapter_id`, "Question chapter/week is outside completed authorized scope");
    }
    if (question.generator_prompt_version !== midtermPackage.prompt_trace.prompt_version) {
      defect(defects, "PROMPT_VERSION_MISMATCH", `${path}.generator_prompt_version`, "Question prompt version does not match package prompt trace");
    }
    if (
      question.source_ids.length !== 1 ||
      question.source_ids[0] !== question.provenance.document_id
    ) {
      defect(
        defects,
        "SOURCE_IDS_INVALID",
        `${path}.source_ids`,
        "Every source ID must resolve to the question's validated provenance",
      );
    }
    if (new Set(question.objective_ids).size !== question.objective_ids.length) {
      defect(defects, "DUPLICATE_QUESTION_OBJECTIVE", `${path}.objective_ids`, "Question objective IDs must be unique");
    }
    for (const objective of question.objective_ids) {
      coveredObjectives.add(objective);
      if (!scope?.objectives.includes(objective)) {
        defect(defects, "QUESTION_OBJECTIVE_OUT_OF_SCOPE", `${path}.objective_ids`, `Objective "${objective}" is outside the question chapter scope`);
      }
    }
    if (question.integration && question.objective_ids.length < 2) {
      defect(
        defects,
        "INTEGRATION_CONTENT_INVALID",
        `${path}.objective_ids`,
        "Integration questions must connect at least two authorized objectives",
      );
    }
    if (
      question.type === "mcq" &&
      new Set(question.options ?? []).size !== (question.options ?? []).length
    ) {
      defect(defects, "DUPLICATE_OPTION", `${path}.options`, "MCQ options must be unique");
    }

    const provenanceResult = validateQuestionProvenance(
      {
        schema_version: question.schema_version,
        question_id: question.question_id,
        prompt: question.prompt,
        type: question.type,
        options: question.options,
        correct_option: question.correct_option,
        plan_version: question.plan_version,
        approved: false,
        provenance: question.provenance,
      },
      blueprint,
    );
    provenanceResult.errors.forEach((message) => {
      defect(defects, "PROVENANCE_INVALID", `${path}.provenance`, message);
    });

    countsByWeek.set(question.week, (countsByWeek.get(question.week) ?? 0) + 1);
    countsByDifficulty[question.difficulty] += 1;
    if (question.integration) integrationCount += 1;
  });

  expectedWeeks.forEach((week, index) => {
    const base = Math.floor(midtermPackage.questions.length / expectedWeeks.length);
    const remainder = midtermPackage.questions.length % expectedWeeks.length;
    const expected = base + (index < remainder ? 1 : 0);
    if ((countsByWeek.get(week) ?? 0) !== expected) {
      defect(defects, "WEEK_COVERAGE_MISMATCH", `questions.week.${week}`, `Expected exactly ${expected} questions for week ${week}`);
    }
  });
  for (const difficulty of ["easy", "medium", "hard"] as const) {
    if (countsByDifficulty[difficulty] !== expectedDifficulties[difficulty]) {
      defect(defects, "DIFFICULTY_COVERAGE_MISMATCH", `questions.difficulty.${difficulty}`, `Expected exactly ${expectedDifficulties[difficulty]} ${difficulty} questions`);
    }
  }
  if (integrationCount < minimumIntegration) {
    defect(defects, "INTEGRATION_MINIMUM_MISSING", "questions.integration", `Expected at least ${minimumIntegration} integration questions`);
  }
  scopedObjectiveIds.forEach((objective) => {
    if (!coveredObjectives.has(objective)) {
      defect(defects, "OBJECTIVE_COVERAGE_MISSING", "questions.objective_ids", `No question covers objective "${objective}"`);
    }
  });

  const keyedQuestionIds = new Set(
    midtermPackage.questions
      .filter((question) => question.type === "mcq")
      .map((question) => question.question_id),
  );
  for (const question of midtermPackage.questions) {
    if (
      question.type === "mcq" &&
      midtermPackage.answer_key[question.question_id] !== question.correct_option
    ) {
      defect(
        defects,
        "ANSWER_KEY_MISMATCH",
        `answer_key.${question.question_id}`,
        "Answer key must exactly match the validated MCQ correct_option",
      );
    }
  }
  for (const questionId of Object.keys(midtermPackage.answer_key)) {
    if (!keyedQuestionIds.has(questionId)) {
      defect(
        defects,
        "ANSWER_KEY_EXTRA_ENTRY",
        `answer_key.${questionId}`,
        "Answer key contains an unknown or non-MCQ question ID",
      );
    }
  }

  const expectedPackageHash = computeMidtermPackageHash(midtermPackage);
  if (expectedPackageHash !== midtermPackage.package_hash) {
    defect(defects, "PACKAGE_HASH_MISMATCH", "package_hash", `Expected ${expectedPackageHash}`);
  }

  return {
    valid: defects.length === 0,
    defects,
    ...(defects.length === 0 ? { package: midtermPackage } : {}),
  };
}

interface MidtermPublicationDocument extends mongoose.Document {
  package_id: string;
  package_version: string;
  publication_key: string;
  package_hash: string;
  blueprint_id: mongoose.Types.ObjectId;
  blueprint_version: number;
  plan_version: string;
  curriculum_id: mongoose.Types.ObjectId;
  package_payload: MidtermPackageV1;
  exam_ids: mongoose.Types.ObjectId[];
  audit_id: mongoose.Types.ObjectId;
  published_at: Date;
}

const midtermPublicationSchema = new Schema<MidtermPublicationDocument>(
  {
    package_id: { type: String, required: true, unique: true, immutable: true },
    package_version: { type: String, required: true, immutable: true },
    publication_key: { type: String, required: true, unique: true, immutable: true },
    package_hash: { type: String, required: true, unique: true, immutable: true },
    blueprint_id: { type: Schema.Types.ObjectId, ref: "AssessmentBlueprint", required: true, immutable: true },
    blueprint_version: { type: Number, required: true, immutable: true },
    plan_version: { type: String, required: true, immutable: true },
    curriculum_id: { type: Schema.Types.ObjectId, ref: "Curriculum", required: true, immutable: true },
    package_payload: { type: Schema.Types.Mixed, required: true, immutable: true },
    exam_ids: [{ type: Schema.Types.ObjectId, ref: "Exam", required: true, immutable: true }],
    audit_id: { type: Schema.Types.ObjectId, required: true, immutable: true },
    published_at: { type: Date, required: true, immutable: true },
  },
  { timestamps: true, versionKey: false },
);
midtermPublicationSchema.index(
  { blueprint_id: 1, package_version: 1 },
  { unique: true },
);

export const MidtermPublication: Model<MidtermPublicationDocument> =
  (mongoose.models.MidtermPublication as Model<MidtermPublicationDocument>) ||
  mongoose.model<MidtermPublicationDocument>(
    "MidtermPublication",
    midtermPublicationSchema,
  );

export class MidtermPublicationError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly defects: PublicationDefect[] = [],
  ) {
    super(message);
    this.name = "MidtermPublicationError";
  }
}

export interface MidtermPublicationReceipt {
  schema_version: "midterm-publication-receipt-v1";
  publication_id: string;
  package_id: string;
  package_version: string;
  package_hash: string;
  question_count: number;
  exams_bound: number;
  audit_id: string;
  idempotent: boolean;
}

function receiptFromPublication(
  publication: MidtermPublicationDocument,
  idempotent: boolean,
): MidtermPublicationReceipt {
  return {
    schema_version: "midterm-publication-receipt-v1",
    publication_id: publication._id.toString(),
    package_id: publication.package_id,
    package_version: publication.package_version,
    package_hash: publication.package_hash,
    question_count: publication.package_payload.questions.length,
    exams_bound: publication.exam_ids.length,
    audit_id: publication.audit_id.toString(),
    idempotent,
  };
}

function sameStringSet(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

export async function publishMidtermPackage(
  input: unknown,
  actorId: string,
): Promise<MidtermPublicationReceipt> {
  const parsed = midtermPackageV1Schema.safeParse(input);
  if (!parsed.success) {
    throw new MidtermPublicationError(
      "Midterm package schema is invalid",
      422,
      schemaDefects(parsed.error),
    );
  }
  const midtermPackage = parsed.data;

  const existing = await MidtermPublication.findOne({
    $or: [
      { package_id: midtermPackage.package_id },
      { publication_key: midtermPackage.publication_key },
      { package_hash: midtermPackage.package_hash },
      {
        blueprint_id: midtermPackage.blueprint_id,
        package_version: midtermPackage.package_version,
      },
    ],
  });
  if (existing) {
    if (
      existing.package_id === midtermPackage.package_id &&
      existing.publication_key === midtermPackage.publication_key &&
      existing.package_hash === midtermPackage.package_hash
    ) {
      return receiptFromPublication(existing, true);
    }
    throw new MidtermPublicationError(
      "Publication identity is already bound to different content",
      409,
      [{ code: "PUBLICATION_IDENTITY_CONFLICT", path: "publication_key", message: "Package ID, version, key, or hash has already been used" }],
    );
  }

  const blueprint = await AssessmentBlueprint.findById(
    midtermPackage.blueprint_id,
  ).lean();
  if (!blueprint) {
    throw new MidtermPublicationError("Assessment blueprint not found", 404);
  }

  const configuredExams = await Exam.find({
    type: "mid",
    published_midterm_id: { $exists: false },
    taken: false,
  })
    .select("_id passing_mark")
    .lean();
  if (configuredExams.length === 0) {
    throw new MidtermPublicationError(
      "No unpublished configured midterm exists for this curriculum",
      409,
      [{ code: "MIDTERM_NOT_CONFIGURED", path: "curriculum_id", message: "Configure the midterm scope before publication" }],
    );
  }

  const configuredExamIds = configuredExams.map((exam) => exam._id);
  const links = await ExamChapter.find({ exam_id: { $in: configuredExamIds } })
    .select("exam_id chapter_id")
    .lean();
  const linksByExam = new Map<string, string[]>();
  for (const link of links) {
    const examId = link.exam_id.toString();
    linksByExam.set(examId, [
      ...(linksByExam.get(examId) ?? []),
      link.chapter_id.toString(),
    ]);
  }
  const requestedChapterIds = midtermPackage.completed_scope.chapters.map(
    (chapter) => chapter.chapter_id,
  );
  const matchingExamIds = configuredExamIds.filter((examId) =>
    sameStringSet(linksByExam.get(examId.toString()) ?? [], requestedChapterIds),
  );
  if (matchingExamIds.length === 0) {
    throw new MidtermPublicationError(
      "Package scope does not match any configured midterm",
      422,
      [{ code: "SCOPE_NOT_CONFIGURED", path: "completed_scope.chapters", message: "Package chapters must exactly match a configured midterm scope" }],
    );
  }
  const matchingIdSet = new Set(matchingExamIds.map((id) => id.toString()));
  const invalidPassingMark = configuredExams.find(
    (exam) =>
      matchingIdSet.has(exam._id.toString()) &&
      (exam.passing_mark === undefined ||
        exam.passing_mark < 0 ||
        exam.passing_mark > midtermPackage.questions.length),
  );
  if (invalidPassingMark) {
    throw new MidtermPublicationError(
      "Configured passing mark is invalid for this package",
      422,
      [
        {
          code: "PASSING_MARK_INVALID",
          path: "balance.question_count",
          message: "Every bound exam passing mark must be within the published question count",
        },
      ],
    );
  }

  const chapterDocuments = await Chapter.find({
    _id: { $in: requestedChapterIds },
    curriculum_id: midtermPackage.curriculum_id,
  })
    .select("_id number")
    .lean();
  const authorizedChapters = chapterDocuments.map((chapter) => ({
    chapter_id: chapter._id.toString(),
    number: chapter.number,
  }));
  const validation = validateMidtermPackage(
    midtermPackage,
    blueprint,
    authorizedChapters,
  );
  if (!validation.valid || !validation.package) {
    throw new MidtermPublicationError(
      "Midterm publication refused",
      422,
      validation.defects,
    );
  }

  const session = await mongoose.startSession();
  let receipt: MidtermPublicationReceipt | undefined;
  try {
    await session.withTransaction(async () => {
      const collision = await MidtermPublication.findOne({
        $or: [
          { package_id: midtermPackage.package_id },
          { publication_key: midtermPackage.publication_key },
          { package_hash: midtermPackage.package_hash },
          {
            blueprint_id: midtermPackage.blueprint_id,
            package_version: midtermPackage.package_version,
          },
        ],
      }).session(session);
      if (collision) {
        if (
          collision.package_id === midtermPackage.package_id &&
          collision.publication_key === midtermPackage.publication_key &&
          collision.package_hash === midtermPackage.package_hash
        ) {
          receipt = receiptFromPublication(collision, true);
          return;
        }
        throw new MidtermPublicationError("Publication identity conflict", 409);
      }

      const existingQuestions = await QuestionProvenance.find({
        blueprint_id: midtermPackage.blueprint_id,
        question_id: {
          $in: midtermPackage.questions.map((question) => question.question_id),
        },
      })
        .session(session)
        .lean();
      if (existingQuestions.length > 0) {
        throw new MidtermPublicationError(
          "One or more question IDs are already published for this blueprint",
          409,
          [{ code: "QUESTION_ID_ALREADY_PUBLISHED", path: "questions", message: "Question IDs must be new within the blueprint" }],
        );
      }

      await QuestionProvenance.insertMany(
        midtermPackage.questions.map((question) => ({
          blueprint_id: midtermPackage.blueprint_id,
          ...question,
          approved: true,
          package_id: midtermPackage.package_id,
          generator_prompt_id: midtermPackage.prompt_trace.prompt_id,
        })),
        { ordered: true, session },
      );

      const publicationId = new mongoose.Types.ObjectId();
      const auditId = new mongoose.Types.ObjectId();
      const publishedAt = new Date();
      const [publication] = await MidtermPublication.create(
        [
          {
            _id: publicationId,
            package_id: midtermPackage.package_id,
            package_version: midtermPackage.package_version,
            publication_key: midtermPackage.publication_key,
            package_hash: midtermPackage.package_hash,
            blueprint_id: midtermPackage.blueprint_id,
            blueprint_version: midtermPackage.blueprint_version,
            plan_version: midtermPackage.plan_version,
            curriculum_id: midtermPackage.curriculum_id,
            package_payload: midtermPackage,
            exam_ids: matchingExamIds,
            audit_id: auditId,
            published_at: publishedAt,
          },
        ],
        { session },
      );

      const publishedQuestions = midtermPackage.questions.map((question) => ({
        ...question,
        approved: true as const,
      }));
      const updateResult = await Exam.collection.updateMany(
        {
          _id: { $in: matchingExamIds },
          type: "mid",
          taken: false,
          published_midterm_id: { $exists: false },
        },
        {
          $set: {
            blueprint_id: new mongoose.Types.ObjectId(midtermPackage.blueprint_id),
            blueprint_version: midtermPackage.blueprint_version,
            plan_version: midtermPackage.plan_version,
            questions_snapshot: publishedQuestions,
            generated_questions: publishedQuestions,
            published_midterm_id: publicationId,
            package_id: midtermPackage.package_id,
            package_version: midtermPackage.package_version,
            package_hash: midtermPackage.package_hash,
            publication_key: midtermPackage.publication_key,
            published_at: publishedAt,
          },
        },
        { session },
      );
      if (updateResult.matchedCount !== matchingExamIds.length) {
        throw new MidtermPublicationError(
          "Configured midterm changed during publication",
          409,
          [{ code: "PUBLICATION_RACE", path: "curriculum_id", message: "Retry with a fresh package identity" }],
        );
      }

      const auditEntry = auditEntrySchema.parse({
        schema_version: AUDIT_SCHEMA_VERSION,
        occurred_at: publishedAt,
        actor: { type: "system", id: actorId },
        action: "midterm.published",
        resource: { type: "midterm_publication", id: publicationId.toString() },
        policy_version: INTEGRITY_POLICY_VERSION,
        metadata: {
          package_id: midtermPackage.package_id,
          package_version: midtermPackage.package_version,
          package_hash: midtermPackage.package_hash,
          plan_version: midtermPackage.plan_version,
          blueprint_version: midtermPackage.blueprint_version,
          question_count: midtermPackage.questions.length,
          exams_bound: matchingExamIds.length,
        },
      });
      await mongoose.connection.db!.collection("audit_logs").insertOne(
        { _id: auditId, ...auditEntry },
        { session },
      );

      receipt = receiptFromPublication(publication, false);
    });
  } catch (error) {
    if (error instanceof MidtermPublicationError) throw error;
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: number }).code === 11000
    ) {
      throw new MidtermPublicationError("Publication identity conflict", 409);
    }
    throw error;
  } finally {
    await session.endSession();
  }

  if (!receipt) {
    throw new MidtermPublicationError("Midterm publication did not commit", 500);
  }
  return receipt;
}
