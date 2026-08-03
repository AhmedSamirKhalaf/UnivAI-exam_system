import {
  assessmentBlueprintSchema,
  type AssessmentBlueprintInput,
} from "../schemas/assessment-blueprint";
import {
  proposedQuestionProvenanceSchema,
  questionProvenanceSchema,
  type QuestionProvenanceInput,
} from "../schemas/question-provenance";

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  validatedQuestion?: QuestionProvenanceInput;
}

export interface BatchValidationResult {
  valid: boolean;
  errors: string[];
  validatedQuestions: QuestionProvenanceInput[];
}

function schemaErrors(prefix: string, issues: { path: PropertyKey[]; message: string }[]) {
  return issues.map((issue) => {
    const path = issue.path.length ? issue.path.join(".") : "root";
    return `${prefix}.${path}: ${issue.message}`;
  });
}

function pageIsCovered(
  pageNumber: number,
  ranges: AssessmentBlueprintInput["source_coverage"][number]["page_ranges"],
): boolean {
  return ranges.some(
    (range) => pageNumber >= range.start && pageNumber <= range.end,
  );
}

/**
 * Validates one untrusted proposed question against a separately approved
 * blueprint. The question cannot approve itself: successful publication is
 * what changes approved to true in the returned immutable snapshot.
 */
export function validateQuestionProvenance(
  question: unknown,
  approvedBlueprint: unknown,
): ValidationResult {
  const proposedResult = proposedQuestionProvenanceSchema.safeParse(question);
  if (!proposedResult.success) {
    return {
      valid: false,
      errors: schemaErrors("question", proposedResult.error.issues),
    };
  }

  if (proposedResult.data.approved) {
    return {
      valid: false,
      errors: ["question.approved: proposed questions cannot approve themselves"],
    };
  }

  const blueprintResult = assessmentBlueprintSchema.safeParse(approvedBlueprint);
  if (!blueprintResult.success) {
    return {
      valid: false,
      errors: schemaErrors("blueprint", blueprintResult.error.issues),
    };
  }

  const blueprint = blueprintResult.data;
  const proposed = proposedResult.data;
  const errors: string[] = [];

  if (!blueprint.approved) {
    errors.push("blueprint.approved: assessment blueprint is not approved");
  }

  if (proposed.plan_version !== blueprint.plan_version) {
    errors.push(
      `question.plan_version: "${proposed.plan_version}" does not match approved blueprint version "${blueprint.plan_version}"`,
    );
  }

  const sourceCoverage = blueprint.source_coverage.find(
    (coverage) =>
      coverage.document_id === proposed.provenance.document_id &&
      coverage.document_title === proposed.provenance.document_title &&
      (coverage.sections.includes("*") ||
        coverage.sections.includes(proposed.provenance.section)),
  );

  if (!sourceCoverage) {
    errors.push(
      `question.provenance: document "${proposed.provenance.document_id}", title "${proposed.provenance.document_title}", and section "${proposed.provenance.section}" are not covered by the approved blueprint`,
    );
  } else if (
    !pageIsCovered(proposed.provenance.page_number, sourceCoverage.page_ranges)
  ) {
    errors.push(
      `question.provenance.page_number: page ${proposed.provenance.page_number} is outside the approved source ranges`,
    );
  }

  if (errors.length) {
    return { valid: false, errors };
  }

  const publishedResult = questionProvenanceSchema.safeParse({
    ...proposed,
    approved: true,
  });
  if (!publishedResult.success) {
    return {
      valid: false,
      errors: schemaErrors("published_question", publishedResult.error.issues),
    };
  }

  return {
    valid: true,
    errors: [],
    validatedQuestion: publishedResult.data,
  };
}

export function validateProposedQuestions(
  questions: unknown,
  approvedBlueprint: unknown,
): BatchValidationResult {
  if (!Array.isArray(questions) || questions.length === 0) {
    return {
      valid: false,
      errors: ["questions: proposed question list must be a non-empty array"],
      validatedQuestions: [],
    };
  }

  const errors: string[] = [];
  const validatedQuestions: QuestionProvenanceInput[] = [];
  const seenIds = new Set<string>();

  questions.forEach((question, index) => {
    const result = validateQuestionProvenance(question, approvedBlueprint);
    const questionId =
      typeof question === "object" &&
      question !== null &&
      typeof (question as Record<string, unknown>).question_id === "string"
        ? String((question as Record<string, unknown>).question_id)
        : String(index);

    if (seenIds.has(questionId)) {
      errors.push(
        `questions[${index}].question_id: duplicate question ID "${questionId}"`,
      );
      return;
    }
    seenIds.add(questionId);

    if (!result.valid || !result.validatedQuestion) {
      errors.push(
        ...result.errors.map((error) => `questions[${index}]: ${error}`),
      );
      return;
    }
    validatedQuestions.push(result.validatedQuestion);
  });

  return {
    valid: errors.length === 0,
    errors,
    validatedQuestions: errors.length === 0 ? validatedQuestions : [],
  };
}

export function publishQuestions(
  questions: unknown,
  approvedBlueprint: unknown,
): QuestionProvenanceInput[] {
  const result = validateProposedQuestions(questions, approvedBlueprint);
  if (!result.valid) {
    throw new Error(`Question publication refused: ${result.errors.join(" | ")}`);
  }
  return result.validatedQuestions;
}
