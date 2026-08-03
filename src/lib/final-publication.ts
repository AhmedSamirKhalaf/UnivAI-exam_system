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
 * FinalPackageV1 — the cumulative final package produced by UnivAI-Agent for a
 * COMPLETED approved semester.
 *
 * The Exam system does not generate questions. It accepts an agent package,
 * deterministically validates it against a separately approved assessment
 * blueprint AND the resolved semester scope (the full chapter set of the
 * curriculum), and either publishes the whole package atomically or returns a
 * machine-readable rejection. A question without valid provenance cannot be
 * published, and an incomplete, stale, or out-of-scope package cannot publish.
 */

export const FINAL_PACKAGE_SCHEMA_VERSION = "final-package-v1";
export const PUBLICATION_RECEIPT_SCHEMA_VERSION = "publication-receipt-v1";

export const FINAL_PACKAGE_MIN_QUESTIONS = 10;
export const FINAL_PACKAGE_MAX_QUESTIONS = 60;
export const FINAL_PACKAGE_MIN_WEEKS = 3;
export const FINAL_PACKAGE_MIN_QUESTIONS_PER_WEEK = 1;
export const FINAL_PACKAGE_MIN_ESSAYS = 2;
/** No single week may exceed this share of the paper (anti-recency cap). */
export const FINAL_PACKAGE_MAX_WEEK_CONCENTRATION = 0.4;
/** A "mixed" paper must span at least two difficulty bands. */
export const FINAL_PACKAGE_MIN_DIFFICULTY_BANDS = 2;

const requiredText = z.string().trim().min(1);
const objectIdString = z
  .string()
  .regex(/^[0-9a-fA-F]{24}$/, "Expected a 24-character ObjectId");
const packageIdString = z
  .string()
  .regex(/^[A-Za-z0-9._-]{8,128}$/, "package_id must be 8-128 chars of [A-Za-z0-9._-]");

export type FinalQuestionDifficulty = "easy" | "medium" | "hard";

export interface FinalPackageQuestion {
  question_id: string;
  prompt: string;
  type: "mcq" | "essay";
  week: string;
  difficulty: FinalQuestionDifficulty;
  options?: string[];
  correct_option?: string;
  provenance: {
    document_id: string;
    document_title: string;
    page_number: number;
    section: string;
    excerpt?: string;
  };
  question_hash: string;
}

export interface FinalPackageRubric {
  criteria: string[];
  model_answer_excerpt: string;
  marks_breakdown: Record<string, number>;
  provenance: {
    document_id: string;
    document_title: string;
    page_number: number;
    section: string;
    excerpt?: string;
  };
}

export interface FinalPackageBook {
  document_id: string;
  document_title: string;
}

export interface FinalPackageV1 {
  schema_version: "final-package-v1";
  package_id: string;
  learner_id: string;
  programme: string;
  semester: string;
  course_id: string;
  plan_version: string;
  blueprint_id: string;
  blueprint_version: string;
  generator_prompt_id: string;
  generator_prompt_version: string;
  difficulty: "easy" | "medium" | "hard" | "mixed";
  curriculum_id: string;
  semester_weeks: string[];
  books: FinalPackageBook[];
  answer_key: Record<string, string>;
  rubrics: Record<string, FinalPackageRubric>;
  questions: FinalPackageQuestion[];
}

const finalQuestionSchema = z
  .object({
    question_id: requiredText.max(120),
    prompt: requiredText.max(4000),
    type: z.enum(["mcq", "essay"]),
    week: requiredText,
    difficulty: z.enum(["easy", "medium", "hard"]),
    options: z.array(requiredText).optional(),
    correct_option: requiredText.optional(),
    provenance: provenanceSourceSchema,
    question_hash: z.string().regex(/^[0-9a-f]{64}$/),
  })
  .superRefine((question, context) => {
    if (question.type === "mcq") {
      if (!question.options || question.options.length < 2) {
        context.addIssue({
          code: "custom",
          path: ["options"],
          message: "MCQ questions require at least two options",
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
    }
    if (
      question.type === "essay" &&
      (question.options !== undefined || question.correct_option !== undefined)
    ) {
      context.addIssue({
        code: "custom",
        path: ["type"],
        message: "Essay questions cannot contain MCQ options or a correct_option",
      });
    }
  });

export const finalRubricSchema = z
  .object({
    criteria: z.array(requiredText).min(1),
    model_answer_excerpt: requiredText,
    marks_breakdown: z
      .record(z.string(), z.number().positive())
      .refine((marks) => Object.keys(marks).length >= 1, {
        message: "marks_breakdown must not be empty",
      }),
    provenance: provenanceSourceSchema,
  })
  .strict();

export const finalPackageBookSchema = z
  .object({
    document_id: requiredText,
    document_title: requiredText,
  })
  .strict();

export const finalPackageV1Schema = z
  .object({
    schema_version: z.literal(FINAL_PACKAGE_SCHEMA_VERSION),
    package_id: packageIdString,
    learner_id: requiredText.max(120),
    programme: requiredText,
    semester: requiredText,
    course_id: requiredText,
    plan_version: requiredText,
    blueprint_id: objectIdString,
    blueprint_version: requiredText,
    generator_prompt_id: requiredText,
    generator_prompt_version: requiredText,
    difficulty: z.enum(["easy", "medium", "hard", "mixed"]),
    curriculum_id: objectIdString,
    semester_weeks: z
      .array(requiredText)
      .min(FINAL_PACKAGE_MIN_WEEKS)
      .max(30),
    books: z.array(finalPackageBookSchema).min(1).max(50),
    answer_key: z.record(z.string(), requiredText),
    rubrics: z.record(z.string(), finalRubricSchema),
    questions: z
      .array(finalQuestionSchema)
      .min(FINAL_PACKAGE_MIN_QUESTIONS)
      .max(FINAL_PACKAGE_MAX_QUESTIONS),
  })
  .strict();

export interface PublicationDefect {
  code: string;
  path: string;
  message: string;
}

export interface FinalPackageValidationResult {
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
  curriculum_id: string;
  learner_id: string;
  generator_prompt_id: string;
  generator_prompt_version: string;
  semester_weeks: string[];
  question_count: number;
  mcq_count: number;
  essay_count: number;
  week_distribution: Record<string, number>;
  published_ids: string[];
  defects: PublicationDefect[];
  published_at: string;
  idempotent: boolean;
}

/**
 * Canonical content hash. Every final item is re-hashed from its content and
 * must match the hash the agent stamped on the package, otherwise the item is
 * rejected. Key order is fixed so the agent can reproduce it deterministically.
 */
export function canonicalQuestionHash(
  question: Pick<
    FinalPackageQuestion,
    "question_id" | "prompt" | "type" | "options" | "correct_option" | "provenance"
  >,
): string {
  const canonical = JSON.stringify({
    question_id: question.question_id,
    prompt: question.prompt,
    type: question.type,
    options: question.options ?? undefined,
    correct_option: question.correct_option ?? undefined,
    provenance: question.provenance,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

/** Content-only fingerprint used to reject two distinct IDs carrying the same item. */
function questionContentHash(
  question: Pick<
    FinalPackageQuestion,
    "prompt" | "type" | "options" | "correct_option" | "provenance"
  >,
): string {
  const canonical = JSON.stringify({
    prompt: question.prompt,
    type: question.type,
    options: question.options ?? undefined,
    correct_option: question.correct_option ?? undefined,
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

function defect(code: string, path: string, message: string): PublicationDefect {
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

/**
 * Deterministic validation of an untrusted FinalPackageV1 against a separately
 * approved blueprint and, optionally, the resolved semester weeks of the
 * curriculum. `resolvedSemesterWeeks` is the external truth used to reject an
 * incomplete semester (fewer weeks than the curriculum) or an out-of-scope one
 * (weeks the curriculum does not have). When it is omitted the internal
 * coverage checks still run.
 */
export function validateFinalPackage(
  packageInput: unknown,
  blueprintInput: unknown,
  resolvedSemesterWeeks?: string[],
): FinalPackageValidationResult {
  const defects: PublicationDefect[] = [];

  const packageResult = finalPackageV1Schema.safeParse(packageInput);
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
      defect(
        "blueprint.not_approved",
        "blueprint.approved",
        "Assessment blueprint is not approved",
      ),
    );
  }

  if (pkg.plan_version !== blueprint.plan_version) {
    defects.push(
      defect(
        "plan_version.mismatch",
        "package.plan_version",
        `Package plan_version "${pkg.plan_version}" does not match approved blueprint version "${blueprint.plan_version}"`,
      ),
    );
  }
  if (pkg.blueprint_version !== blueprint.plan_version) {
    defects.push(
      defect(
        "plan_version.mismatch",
        "package.blueprint_version",
        `Package blueprint_version "${pkg.blueprint_version}" does not match approved blueprint version "${blueprint.plan_version}"`,
      ),
    );
  }

  if (pkg.programme !== blueprint.programme) {
    defects.push(
      defect(
        "programme.mismatch",
        "package.programme",
        `Package programme "${pkg.programme}" does not match approved blueprint programme "${blueprint.programme}"`,
      ),
    );
  }
  if (pkg.course_id !== blueprint.course_id) {
    defects.push(
      defect(
        "course.mismatch",
        "package.course_id",
        `Package course_id "${pkg.course_id}" does not match approved blueprint course_id "${blueprint.course_id}"`,
      ),
    );
  }
  if (pkg.semester !== blueprint.semester) {
    defects.push(
      defect(
        "semester.mismatch",
        "package.semester",
        `Package semester "${pkg.semester}" does not match approved blueprint semester "${blueprint.semester}"`,
      ),
    );
  }

  if (blueprint.difficulty === "mixed") {
    if (pkg.difficulty !== "mixed") {
      defects.push(
        defect(
          "difficulty.mismatch",
          "package.difficulty",
          `Package difficulty "${pkg.difficulty}" does not match the approved "mixed" blueprint difficulty`,
        ),
      );
    }
  } else if (pkg.difficulty !== blueprint.difficulty) {
    defects.push(
      defect(
        "difficulty.mismatch",
        "package.difficulty",
        `Package difficulty "${pkg.difficulty}" does not match approved blueprint difficulty "${blueprint.difficulty}"`,
      ),
    );
  }

  /* ---- semester scope: completeness, missing weeks, recency bias --------- */

  const uniqueWeeks = new Set(pkg.semester_weeks);
  if (uniqueWeeks.size !== pkg.semester_weeks.length) {
    defects.push(
      defect(
        "semester.duplicate_week",
        "package.semester_weeks",
        "semester_weeks contains duplicate week identifiers",
      ),
    );
  }

  if (resolvedSemesterWeeks) {
    const resolvedSet = new Set(resolvedSemesterWeeks);
    const missingWeeks = resolvedSemesterWeeks.filter(
      (week) => !pkg.semester_weeks.includes(week),
    );
    if (missingWeeks.length > 0) {
      defects.push(
        defect(
          "semester.incomplete",
          "package.semester_weeks",
          `Final package omits completed-semester week(s): ${missingWeeks.join(", ")}`,
        ),
      );
    }
    const extraWeeks = pkg.semester_weeks.filter((week) => !resolvedSet.has(week));
    if (extraWeeks.length > 0) {
      defects.push(
        defect(
          "semester.out_of_scope",
          "package.semester_weeks",
          `Final package claims week(s) outside the curriculum: ${extraWeeks.join(", ")}`,
        ),
      );
    }
  }

  /* ---- source resolution: books must cover the approved scope ------------- */

  const bookDocuments = new Set(pkg.books.map((book) => book.document_id));
  for (const coverage of blueprint.source_coverage) {
    if (!bookDocuments.has(coverage.document_id)) {
      defects.push(
        defect(
          "source.missing_book",
          `package.books`,
          `Blueprint source document "${coverage.document_id}" is not resolved in package.books`,
        ),
      );
    }
  }

  /* ---- per-question provenance, content, keys, and rubrics ---------------- */

  const questionIds = new Set<string>();
  const contentHashes = new Set<string>();
  const coveredSourceKeys = new Set<string>();
  const weekQuestionCounts = new Map<string, number>();
  const difficultyCounts = new Map<string, number>();
  const answerKeyIds = Object.keys(pkg.answer_key);
  const answerKeyIdSet = new Set(answerKeyIds);
  const rubricIds = Object.keys(pkg.rubrics);

  for (const question of pkg.questions) {
    if (question.type === "mcq" && !answerKeyIdSet.has(question.question_id)) {
      defects.push(
        defect(
          "answer_key.mismatch",
          "package.answer_key",
          `answer_key is missing MCQ question_id "${question.question_id}"`,
        ),
      );
    }
  }
  for (const answerKeyId of answerKeyIds) {
    const answeredQuestion = pkg.questions.find(
      (question) => question.question_id === answerKeyId,
    );
    if (!answeredQuestion) {
      defects.push(
        defect(
          "answer_key.mismatch",
          `package.answer_key.${answerKeyId}`,
          `answer_key references unknown question_id "${answerKeyId}"`,
        ),
      );
    } else if (answeredQuestion.type === "essay") {
      defects.push(
        defect(
          "answer_key.mismatch",
          `package.answer_key.${answerKeyId}`,
          `answer_key must not carry essay question_id "${answerKeyId}" (use rubrics)`,
        ),
      );
    }
  }
  for (const rubricId of rubricIds) {
    if (!pkg.questions.some((question) => question.question_id === rubricId)) {
      defects.push(
        defect(
          "rubric.mismatch",
          `package.rubrics.${rubricId}`,
          `rubrics references unknown question_id "${rubricId}"`,
        ),
      );
    }
  }

  const publishedQuestions: QuestionProvenanceInput[] = [];
  pkg.questions.forEach((question, index) => {
    const path = `package.questions[${index}]`;

    if (questionIds.has(question.question_id)) {
      defects.push(
        defect(
          "question.duplicate_id",
          `${path}.question_id`,
          `duplicate question_id "${question.question_id}"`,
        ),
      );
      return;
    }
    questionIds.add(question.question_id);

    if (question.type === "mcq" &&
        pkg.answer_key[question.question_id] !== question.correct_option) {
      defects.push(
        defect(
          "answer_key.mismatch",
          `${path}.correct_option`,
          `answer_key "${pkg.answer_key[question.question_id]}" does not match the question correct_option "${question.correct_option}"`,
        ),
      );
    }

    if (question.type === "essay") {
      const rubric = pkg.rubrics[question.question_id];
      if (!rubric) {
        defects.push(
          defect(
            "rubric.mismatch",
            `${path}.rubric`,
            `Essay question "${question.question_id}" has no rubric in package.rubrics`,
          ),
        );
      } else {
        const rubricMatchesQuestion =
          rubric.provenance.document_id === question.provenance.document_id &&
          rubric.provenance.section === question.provenance.section &&
          rubric.provenance.page_number === question.provenance.page_number;
        if (!rubricMatchesQuestion) {
          defects.push(
            defect(
              "rubric.provenance.mismatch",
              `${path}.rubric.provenance`,
              `Rubric provenance for "${question.question_id}" does not match the question provenance`,
            ),
          );
        }
      }
    }

    const canonicalHash = canonicalQuestionHash(question);
    if (canonicalHash !== question.question_hash) {
      defects.push(
        defect(
          "question.hash.mismatch",
          `${path}.question_hash`,
          `question hash "${question.question_hash}" does not match the canonical content hash "${canonicalHash}"`,
        ),
      );
    }
    const contentHash = questionContentHash(question);
    if (contentHashes.has(contentHash)) {
      defects.push(
        defect(
          "question.duplicate_content",
          `${path}.question_hash`,
          `duplicate question content across question_ids`,
        ),
      );
    }
    contentHashes.add(contentHash);

    const sourceCoverage = blueprint.source_coverage.find(
      (coverage) =>
        coverage.document_id === question.provenance.document_id &&
        (coverage.sections.includes("*") ||
          coverage.sections.includes(question.provenance.section)),
    );

    if (!sourceCoverage) {
      defects.push(
        defect(
          "question.provenance.uncovered",
          `${path}.provenance`,
          `document "${question.provenance.document_id}" and section "${question.provenance.section}" are not covered by the approved blueprint`,
        ),
      );
    } else {
      if (
        !pageIsCovered(question.provenance.page_number, sourceCoverage.page_ranges)
      ) {
        defects.push(
          defect(
            "question.page.out_of_range",
            `${path}.provenance.page_number`,
            `page ${question.provenance.page_number} is outside the approved source ranges`,
          ),
        );
      }
      const coveredSourceKeysForQuestion = sourceCoverage.sections.includes("*")
        ? [sourceCoverage.document_id]
        : [question.provenance.document_id, question.provenance.section];
      coveredSourceKeys.add(coveredSourceKeysForQuestion.join("::"));
    }

    weekQuestionCounts.set(
      question.week,
      (weekQuestionCounts.get(question.week) ?? 0) + 1,
    );
    difficultyCounts.set(
      question.difficulty,
      (difficultyCounts.get(question.difficulty) ?? 0) + 1,
    );

    const publishedResult = questionProvenanceSchema.safeParse({
      schema_version: "question-provenance-v1",
      question_id: question.question_id,
      prompt: question.prompt,
      type: question.type,
      options: question.options,
      correct_option: question.correct_option,
      plan_version: pkg.plan_version,
      approved: true,
      provenance: question.provenance,
    });
    if (!publishedResult.success) {
      defects.push(
        ...schemaDefects(`${path}.published_question`, publishedResult.error),
      );
      return;
    }
    publishedQuestions.push(publishedResult.data);
  });

  /* ---- cumulative coverage: every approved source section represented ------ */

  for (const coverage of blueprint.source_coverage) {
    const sections = coverage.sections.includes("*")
      ? ["*"]
      : coverage.sections;
    for (const section of sections) {
      const key = section === "*" ? coverage.document_id : `${coverage.document_id}::${section}`;
      if (!coveredSourceKeys.has(key)) {
        defects.push(
          defect(
            "scope.incomplete_coverage",
            "package.questions",
            `Approved source "${coverage.document_id}"${section === "*" ? "" : ` section "${section}"`} has no question in the final package`,
          ),
        );
      }
    }
  }

  /* ---- week coverage, integration minimum, and anti-recency cap ----------- */

  for (const week of pkg.semester_weeks) {
    const count = weekQuestionCounts.get(week) ?? 0;
    if (count < FINAL_PACKAGE_MIN_QUESTIONS_PER_WEEK) {
      defects.push(
        defect(
          "semester.missing_week",
          "package.questions",
          `Week "${week}" has no question in the final package`,
        ),
      );
    }
  }
  for (const week of weekQuestionCounts.keys()) {
    if (!pkg.semester_weeks.includes(week)) {
      defects.push(
        defect(
          "question.week.out_of_scope",
          "package.questions",
          `Question week "${week}" is outside the declared semester scope`,
        ),
      );
    }
  }

  const maxPerWeek = Math.ceil(
    pkg.questions.length * FINAL_PACKAGE_MAX_WEEK_CONCENTRATION,
  );
  const lastWeek = pkg.semester_weeks[pkg.semester_weeks.length - 1];
  for (const [week, count] of weekQuestionCounts) {
    if (count > maxPerWeek) {
      defects.push(
        defect(
          week === lastWeek ? "scope.recency_bias" : "scope.week_concentration",
          "package.questions",
          `Week "${week}" supplies ${count} of ${pkg.questions.length} questions; maximum allowed is ${maxPerWeek}`,
        ),
      );
    }
  }

  /* ---- difficulty / format mix -------------------------------------------- */

  const essayCount = pkg.questions.filter((question) => question.type === "essay").length;
  if (essayCount < FINAL_PACKAGE_MIN_ESSAYS) {
    defects.push(
      defect(
        "format.mix",
        "package.questions",
        `Final package requires at least ${FINAL_PACKAGE_MIN_ESSAYS} essay items with rubrics, got ${essayCount}`,
      ),
    );
  }

  if (pkg.difficulty === "mixed") {
    if (difficultyCounts.size < FINAL_PACKAGE_MIN_DIFFICULTY_BANDS) {
      defects.push(
        defect(
          "difficulty.mix",
          "package.questions",
          `A "mixed" final must span at least ${FINAL_PACKAGE_MIN_DIFFICULTY_BANDS} difficulty bands`,
        ),
      );
    }
  } else {
    for (const difficulty of difficultyCounts.keys()) {
      if (difficulty !== pkg.difficulty) {
        defects.push(
          defect(
            "difficulty.mismatch",
            "package.questions",
            `Question difficulty "${difficulty}" does not match package difficulty "${pkg.difficulty}"`,
          ),
        );
      }
    }
  }

  if (publishedQuestions.length < FINAL_PACKAGE_MIN_QUESTIONS) {
    defects.push(
      defect(
        "bank.insufficient",
        "package.questions",
        `Final package does not reach the ${FINAL_PACKAGE_MIN_QUESTIONS} minimum published questions`,
      ),
    );
  }

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

export interface PublishFinalPackageOptions {
  /** Explicit override; defaults to the package curriculum_id. */
  curriculumId?: string | mongoose.Types.ObjectId;
  /** External truth for the completed-semester check (curriculum chapter weeks). */
  resolvedSemesterWeeks?: string[];
}

export async function publishFinalPackage(
  packageInput: unknown,
  blueprintInput: unknown,
  options: PublishFinalPackageOptions = {},
): Promise<PublicationReceipt> {
  const now = new Date();
  const validation = validateFinalPackage(
    packageInput,
    blueprintInput,
    options.resolvedSemesterWeeks,
  );

  const blueprintResult = assessmentBlueprintSchema.safeParse(blueprintInput);
  const blueprint = blueprintResult.success ? blueprintResult.data : null;
  const packageResult = finalPackageV1Schema.safeParse(packageInput);
  const pkg = packageResult.success ? packageResult.data : null;
  const blueprintId = rawIdOf(blueprintInput) ?? pkg?.blueprint_id ?? "";

  const weekDistribution: Record<string, number> = {};
  if (pkg) {
    for (const question of pkg.questions) {
      weekDistribution[question.week] =
        (weekDistribution[question.week] ?? 0) + 1;
    }
  }

  const base: Omit<PublicationReceipt, "status" | "defects"> = {
    schema_version: PUBLICATION_RECEIPT_SCHEMA_VERSION,
    package_id: pkg?.package_id ?? "",
    blueprint_id: blueprintId,
    plan_version: blueprint?.plan_version ?? pkg?.plan_version ?? "",
    curriculum_id: pkg?.curriculum_id ?? "",
    learner_id: pkg?.learner_id ?? "",
    generator_prompt_id: pkg?.generator_prompt_id ?? "",
    generator_prompt_version: pkg?.generator_prompt_version ?? "",
    semester_weeks: pkg?.semester_weeks ?? [],
    question_count: pkg?.questions.length ?? 0,
    mcq_count: pkg?.questions.filter((question) => question.type === "mcq").length ?? 0,
    essay_count: pkg?.questions.filter((question) => question.type === "essay").length ?? 0,
    week_distribution: weekDistribution,
    published_ids: [] as string[],
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
        defect(
          "schema.invalid",
          "package",
          "Final package or blueprint could not be parsed",
        ),
      ],
    };
  }

  const curriculumId = options.curriculumId?.toString() ?? pkg.curriculum_id;

  const existing = await QuestionProvenance.find({
    blueprint_id: blueprintId,
    question_id: {
      $in: validation.publishedQuestions.map((question) => question.question_id),
    },
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
          defect(
            "question.duplicate_id",
            "package.questions",
            `One or more question IDs are already published for this blueprint: ${ids.join(", ")}`,
          ),
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

  const sourceByQuestionId = new Map(
    pkg.questions.map((question) => [question.question_id, question]),
  );
  const docs = validation.publishedQuestions.map((question) => {
    const source = sourceByQuestionId.get(question.question_id);
    const rubric =
      source?.type === "essay" ? pkg.rubrics[question.question_id] : undefined;
    return {
      blueprint_id: new mongoose.Types.ObjectId(blueprintId),
      curriculum_id: new mongoose.Types.ObjectId(curriculumId),
      learner_id: pkg.learner_id,
      package_id: pkg.package_id,
      generator_prompt_id: pkg.generator_prompt_id,
      generator_prompt_version: pkg.generator_prompt_version,
      question_hash: canonicalQuestionHash({
        question_id: question.question_id,
        prompt: question.prompt,
        type: question.type,
        options: question.options ?? [],
        correct_option: question.correct_option ?? "",
        provenance: question.provenance,
      }),
      week: source?.week,
      difficulty: source?.difficulty,
      rubric,
      ...question,
    };
  });

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
        question_id: {
          $in: validation.publishedQuestions.map((question) => question.question_id),
        },
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
          defect(
            "question.duplicate_id",
            "package.questions",
            "One or more question IDs are already published for this blueprint",
          ),
        ],
      };
    }
    throw error;
  }
}
