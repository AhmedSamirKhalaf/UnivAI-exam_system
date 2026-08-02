import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { z } from "zod";
import { QuestionProvenance } from "../models/QuestionProvenance";
import type { AssessmentBlueprintInput } from "../schemas/assessment-blueprint";
import { assessmentBlueprintSchema } from "../schemas/assessment-blueprint";
import {
  provenanceSourceSchema,
  questionProvenanceSchema,
  type QuestionProvenanceInput,
} from "../schemas/question-provenance";

/**
 * QuizPackageV1 — the versioned weekly quiz package produced by UnivAI-Agent.
 *
 * The Exam system does not generate questions. It accepts an agent package,
 * deterministically validates it against a separately approved assessment
 * blueprint, and either publishes the whole package or returns a
 * machine-readable rejection. A question without valid provenance cannot be
 * published.
 */

export const QUIZ_PACKAGE_SCHEMA_VERSION = "quiz-package-v1";
export const PUBLICATION_RECEIPT_SCHEMA_VERSION = "publication-receipt-v1";
export const QUIZ_PACKAGE_MIN_QUESTIONS = 3;
export const QUIZ_PACKAGE_MAX_QUESTIONS = 30;
export const QUIZ_PACKAGE_OPTION_COUNT = 4;
export const QUIZ_PACKAGE_FORMAT = "mcq" as const;

const requiredText = z.string().trim().min(1);
const objectIdString = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Expected a 24-character ObjectId");
const packageIdString = z
  .string()
  .regex(/^[A-Za-z0-9._-]{8,128}$/, "package_id must be 8-128 chars of [A-Za-z0-9._-]");

export interface QuizPackageQuestion {
  question_id: string;
  prompt: string;
  type: "mcq";
  options: string[];
  correct_option: string;
  provenance: {
    document_id: string;
    document_title: string;
    page_number: number;
    section: string;
    excerpt?: string;
  };
  question_hash: string;
}

export interface QuizPackageV1 {
  schema_version: "quiz-package-v1";
  package_id: string;
  learner_id: string;
  programme: string;
  course_id: string;
  week: string;
  plan_version: string;
  blueprint_id: string;
  blueprint_version: string;
  generator_prompt_id: string;
  generator_prompt_version: string;
  difficulty: "easy" | "medium" | "hard" | "mixed";
  chapter_id: string;
  answer_key: Record<string, string>;
  questions: QuizPackageQuestion[];
}

const quizQuestionSchema = z
  .object({
    question_id: requiredText.max(120),
    prompt: requiredText.max(2000),
    type: z.literal("mcq"),
    options: z.array(requiredText).length(QUIZ_PACKAGE_OPTION_COUNT),
    correct_option: requiredText,
    provenance: provenanceSourceSchema,
    question_hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .superRefine((question, context) => {
    const uniqueOptions = new Set(question.options.map((option) => option.trim()));
    if (uniqueOptions.size !== question.options.length) {
      context.addIssue({
        code: "custom",
        path: ["options"],
        message: "MCQ options must be unique",
      });
    }
    if (!question.options.includes(question.correct_option)) {
      context.addIssue({
        code: "custom",
        path: ["correct_option"],
        message: "correct_option must match one supplied option",
      });
    }
  });

export const quizPackageV1Schema = z
  .object({
    schema_version: z.literal(QUIZ_PACKAGE_SCHEMA_VERSION),
    package_id: packageIdString,
    learner_id: requiredText.max(120),
    programme: requiredText,
    course_id: requiredText,
    week: requiredText,
    plan_version: requiredText,
    blueprint_id: objectIdString,
    blueprint_version: requiredText,
    generator_prompt_id: requiredText,
    generator_prompt_version: requiredText,
    difficulty: z.enum(["easy", "medium", "hard", "mixed"]),
    chapter_id: objectIdString,
    answer_key: z.record(z.string(), requiredText),
    questions: z
      .array(quizQuestionSchema)
      .min(QUIZ_PACKAGE_MIN_QUESTIONS)
      .max(QUIZ_PACKAGE_MAX_QUESTIONS),
  })
  .strict();

export interface PublicationDefect {
  code: string;
  path: string;
  message: string;
}

export interface QuizPackageValidationResult {
  valid: boolean;
  defects: PublicationDefect[];
  publishedQuestions: QuestionProvenanceInput[];
}

export interface PublicationReceipt {
  schema_version: typeof PUBLICATION_RECEIPT_SCHEMA_VERSION;
  package_id: string;
  status: "accepted" | "rejected";
  blueprint_id: string;
  plan_version: string;
  chapter_id: string;
  learner_id: string;
  generator_prompt_id: string;
  generator_prompt_version: string;
  question_count: number;
  published_ids: string[];
  defects: PublicationDefect[];
  published_at: string;
  idempotent: boolean;
}

export function canonicalQuestionHash(
  question: Pick<
    QuizPackageQuestion,
    "question_id" | "prompt" | "type" | "options" | "correct_option" | "provenance"
  >,
): string {
  const canonical = JSON.stringify({
    question_id: question.question_id,
    prompt: question.prompt,
    type: question.type,
    options: question.options,
    correct_option: question.correct_option,
    provenance: question.provenance,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Content-only fingerprint used to reject two distinct IDs carrying the same item. */
function questionContentHash(
  question: Pick<
    QuizPackageQuestion,
    "prompt" | "type" | "options" | "correct_option" | "provenance"
  >,
): string {
  const canonical = JSON.stringify({
    prompt: question.prompt,
    type: question.type,
    options: question.options,
    correct_option: question.correct_option,
    provenance: question.provenance,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

function schemaDefects(prefix: string, error: z.ZodError): PublicationDefect[] {
  return error.issues.map((issue) => ({
    code: "schema.invalid",
    path: issue.path.length ? `${prefix}.${issue.path.join(".")}` : prefix,
    message: issue.message,
  }));
}

function pageIsCovered(
  pageNumber: number,
  ranges: AssessmentBlueprintInput["source_coverage"][number]["page_ranges"],
): boolean {
  return ranges.some(
    (range) => pageNumber >= range.start && pageNumber <= range.end,
  );
}

function coverageDefect(
  path: string,
  code: string,
  message: string,
): PublicationDefect {
  return { code, path, message };
}

function rawIdOf(value: unknown): string | null {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record._id === "string") return record._id;
    if (
      record._id &&
      typeof record._id === "object" &&
      "toString" in (record._id as object)
    ) {
      return String(record._id);
    }
  }
  return null;
}

export function validateQuizPackage(
  packageInput: unknown,
  blueprintInput: unknown,
): QuizPackageValidationResult {
  const defects: PublicationDefect[] = [];

  const packageResult = quizPackageV1Schema.safeParse(packageInput);
  if (!packageResult.success) {
    return {
      valid: false,
      defects: schemaDefects("package", packageResult.error),
      publishedQuestions: [],
    };
  }
  const pkg = packageResult.data;

  const blueprintResult = assessmentBlueprintSchema.safeParse(blueprintInput);
  if (!blueprintResult.success) {
    return {
      valid: false,
      defects: schemaDefects("blueprint", blueprintResult.error),
      publishedQuestions: [],
    };
  }
  const blueprint = blueprintResult.data;

  if (!blueprint.approved) {
    defects.push(
      coverageDefect(
        "blueprint.approved",
        "blueprint.not_approved",
        "Assessment blueprint is not approved",
      ),
    );
  }

  if (pkg.plan_version !== blueprint.plan_version) {
    defects.push(
      coverageDefect(
        "package.plan_version",
        "plan_version.mismatch",
        `Package plan_version "${pkg.plan_version}" does not match approved blueprint version "${blueprint.plan_version}"`,
      ),
    );
  }
  if (pkg.blueprint_version !== blueprint.plan_version) {
    defects.push(
      coverageDefect(
        "package.blueprint_version",
        "plan_version.mismatch",
        `Package blueprint_version "${pkg.blueprint_version}" does not match approved blueprint version "${blueprint.plan_version}"`,
      ),
    );
  }

  if (pkg.programme !== blueprint.programme) {
    defects.push(
      coverageDefect(
        "package.programme",
        "programme.mismatch",
        `Package programme "${pkg.programme}" does not match approved blueprint programme "${blueprint.programme}"`,
      ),
    );
  }
  if (pkg.course_id !== blueprint.course_id) {
    defects.push(
      coverageDefect(
        "package.course_id",
        "course.mismatch",
        `Package course_id "${pkg.course_id}" does not match approved blueprint course_id "${blueprint.course_id}"`,
      ),
    );
  }

  if (blueprint.difficulty !== "mixed" && pkg.difficulty !== blueprint.difficulty) {
    defects.push(
      coverageDefect(
        "package.difficulty",
        "difficulty.mismatch",
        `Package difficulty "${pkg.difficulty}" does not match approved blueprint difficulty "${blueprint.difficulty}"`,
      ),
    );
  }

  const questionIds = new Set<string>();
  const questionHashes = new Set<string>();
  const answerKeyIds = Object.keys(pkg.answer_key);
  const answerKeyIdSet = new Set(answerKeyIds);
  const packageQuestionIds = pkg.questions.map((question) => question.question_id);

  for (const questionId of packageQuestionIds) {
    if (!answerKeyIdSet.has(questionId)) {
      defects.push(
        coverageDefect(
          `package.answer_key`,
          "answer_key.mismatch",
          `answer_key is missing question_id "${questionId}"`,
        ),
      );
    }
  }
  for (const answerKeyId of answerKeyIds) {
    if (!packageQuestionIds.includes(answerKeyId)) {
      defects.push(
        coverageDefect(
          `package.answer_key.${answerKeyId}`,
          "answer_key.mismatch",
          `answer_key references unknown question_id "${answerKeyId}"`,
        ),
      );
    }
  }

  const publishedQuestions: QuestionProvenanceInput[] = [];
  pkg.questions.forEach((question, index) => {
    const path = `package.questions[${index}]`;

    if (questionIds.has(question.question_id)) {
      defects.push(
        coverageDefect(
          `${path}.question_id`,
          "question.duplicate_id",
          `duplicate question_id "${question.question_id}"`,
        ),
      );
      return;
    }
    questionIds.add(question.question_id);

    if (pkg.answer_key[question.question_id] !== question.correct_option) {
      defects.push(
        coverageDefect(
          `${path}.correct_option`,
          "answer_key.mismatch",
          `answer_key "${pkg.answer_key[question.question_id]}" does not match the question correct_option "${question.correct_option}"`,
        ),
      );
    }

    const canonicalHash = canonicalQuestionHash(question);
    if (canonicalHash !== question.question_hash) {
      defects.push(
        coverageDefect(
          `${path}.question_hash`,
          "question.hash.mismatch",
          `question hash "${question.question_hash}" does not match the canonical content hash "${canonicalHash}"`,
        ),
      );
    }
    if (questionHashes.has(questionContentHash(question))) {
      defects.push(
        coverageDefect(
          `${path}.question_hash`,
          "question.duplicate_content",
          `duplicate question content across question_ids`,
        ),
      );
    }
    questionHashes.add(questionContentHash(question));

    const sourceCoverage = blueprint.source_coverage.find(
      (coverage) =>
        coverage.document_id === question.provenance.document_id &&
        (coverage.sections.includes("*") ||
          coverage.sections.includes(question.provenance.section)),
    );

    if (!sourceCoverage) {
      defects.push(
        coverageDefect(
          `${path}.provenance`,
          "question.provenance.uncovered",
          `document "${question.provenance.document_id}" and section "${question.provenance.section}" are not covered by the approved blueprint`,
        ),
      );
    } else if (
      !pageIsCovered(question.provenance.page_number, sourceCoverage.page_ranges)
    ) {
      defects.push(
        coverageDefect(
          `${path}.provenance.page_number`,
          "question.page.out_of_range",
          `page ${question.provenance.page_number} is outside the approved source ranges`,
        ),
      );
    }

    if (!questionIds.has(question.question_id)) return;

    const publishedResult = questionProvenanceSchema.safeParse({
      ...question,
      schema_version: "question-provenance-v1",
      approved: true,
      plan_version: pkg.plan_version,
    });
    if (!publishedResult.success) {
      defects.push(
        ...schemaDefects(`${path}.published_question`, publishedResult.error),
      );
      return;
    }
    publishedQuestions.push(publishedResult.data);
  });

  return {
    valid: defects.length === 0,
    defects,
    publishedQuestions,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 11000
  );
}

export interface PublishQuizPackageOptions {
  /** Explicit override; defaults to the package chapter_id. */
  chapterId?: string | mongoose.Types.ObjectId;
}

export async function publishQuizPackage(
  packageInput: unknown,
  blueprintInput: unknown,
  options: PublishQuizPackageOptions = {},
): Promise<PublicationReceipt> {
  const now = new Date();
  const validation = validateQuizPackage(packageInput, blueprintInput);

  const blueprintResult = assessmentBlueprintSchema.safeParse(blueprintInput);
  const blueprint = blueprintResult.success ? blueprintResult.data : null;
  const packageResult = quizPackageV1Schema.safeParse(packageInput);
  const pkg = packageResult.success ? packageResult.data : null;
  const blueprintId = rawIdOf(blueprintInput) ?? pkg?.blueprint_id ?? "";

  const base: {
    schema_version: typeof PUBLICATION_RECEIPT_SCHEMA_VERSION;
    package_id: string;
    blueprint_id: string;
    plan_version: string;
    chapter_id: string;
    learner_id: string;
    generator_prompt_id: string;
    generator_prompt_version: string;
    question_count: number;
    published_ids: string[];
    published_at: string;
    idempotent: boolean;
  } = {
    schema_version: PUBLICATION_RECEIPT_SCHEMA_VERSION,
    package_id: pkg?.package_id ?? "",
    blueprint_id: blueprintId,
    plan_version: blueprint?.plan_version ?? pkg?.plan_version ?? "",
    chapter_id: pkg?.chapter_id ?? "",
    learner_id: pkg?.learner_id ?? "",
    generator_prompt_id: pkg?.generator_prompt_id ?? "",
    generator_prompt_version: pkg?.generator_prompt_version ?? "",
    question_count: pkg?.questions.length ?? 0,
    published_ids: [],
    published_at: now.toISOString(),
    idempotent: false,
  };

  if (!validation.valid) {
    return {
      ...base,
      status: "rejected",
      defects: validation.defects,
    };
  }
  if (!pkg || !blueprint) {
    return {
      ...base,
      status: "rejected",
      defects: [
        {
          code: "schema.invalid",
          path: "package",
          message: "Quiz package or blueprint could not be parsed",
        },
      ],
    };
  }

  const chapterId = options.chapterId?.toString() ?? pkg.chapter_id;

  const existing = await QuestionProvenance.find({
    blueprint_id: blueprintId,
    question_id: { $in: validation.publishedQuestions.map((q) => q.question_id) },
  }).lean();

  if (existing.length > 0) {
    const allFromSamePackage = existing.every(
      (doc) => doc.package_id === pkg.package_id,
    );
    if (!allFromSamePackage) {
      const ids = existing
        .filter((doc) => doc.package_id !== pkg.package_id)
        .map((doc) => doc.question_id);
      return {
        ...base,
        status: "rejected",
        defects: [
          {
            code: "question.duplicate_id",
            path: "package.questions",
            message: `One or more question IDs are already published for this blueprint: ${ids.join(", ")}`,
          },
        ],
      };
    }
    return {
      ...base,
      status: "accepted",
      defects: [],
      published_ids: existing.map((doc) => doc.question_id),
      idempotent: true,
    };
  }

  const docs = validation.publishedQuestions.map((question) => ({
    blueprint_id: new mongoose.Types.ObjectId(blueprintId),
    chapter_id: new mongoose.Types.ObjectId(chapterId),
    learner_id: pkg.learner_id,
    package_id: pkg.package_id,
    generator_prompt_id: pkg.generator_prompt_id,
    generator_prompt_version: pkg.generator_prompt_version,
    question_hash: canonicalQuestionHash({
      question_id: question.question_id,
      prompt: question.prompt,
      type: "mcq",
      options: question.options ?? [],
      correct_option: question.correct_option ?? "",
      provenance: question.provenance,
    }),
    ...question,
  }));

  try {
    const inserted = await QuestionProvenance.insertMany(docs, { ordered: true });
    return {
      ...base,
      status: "accepted",
      defects: [],
      published_ids: inserted.map((doc) => doc.question_id),
    };
  } catch (error: unknown) {
    if (isDuplicateKeyError(error)) {
      const stored = await QuestionProvenance.find({
        blueprint_id: blueprintId,
        question_id: { $in: validation.publishedQuestions.map((q) => q.question_id) },
      }).lean();
      const allFromSamePackage =
        stored.length > 0 &&
        stored.every((doc) => doc.package_id === pkg.package_id);
      if (allFromSamePackage) {
        return {
          ...base,
          status: "accepted",
          defects: [],
          published_ids: stored.map((doc) => doc.question_id),
          idempotent: true,
        };
      }
      return {
        ...base,
        status: "rejected",
        defects: [
          {
            code: "question.duplicate_id",
            path: "package.questions",
            message:
              "One or more question IDs are already published for this blueprint",
          },
        ],
      };
    }
    throw error;
  }
}
