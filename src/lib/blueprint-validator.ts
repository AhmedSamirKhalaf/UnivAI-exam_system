import { questionProvenanceSchema, type QuestionProvenanceInput } from "@/schemas/question-provenance";
import type { IAssessmentBlueprint } from "@/models/AssessmentBlueprint";

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

/**
 * Validates a single question against schema, approved plan_version, and document/page/section provenance.
 */
export function validateQuestionProvenance(
  question: unknown,
  approvedBlueprint?: Partial<IAssessmentBlueprint> | null
): ValidationResult {
  const errors: string[] = [];

  const parseResult = questionProvenanceSchema.safeParse(question);
  if (!parseResult.success) {
    const fieldErrors = parseResult.error.issues.map(
      (issue) => `${issue.path.join(".")}: ${issue.message}`
    );
    return {
      valid: false,
      errors: [`Schema validation failed: ${fieldErrors.join("; ")}`],
    };
  }

  const q = parseResult.data;

  if (!q.approved) {
    errors.push("Question is marked as unapproved");
  }

  if (!q.provenance || !q.provenance.document_id || !q.provenance.section || q.provenance.page_number < 1) {
    errors.push("Question missing valid document, page, or section provenance");
  }

  if (approvedBlueprint) {
    if (approvedBlueprint.approved === false) {
      errors.push("Assessment blueprint is not approved");
    }

    if (approvedBlueprint.plan_version && q.plan_version !== approvedBlueprint.plan_version) {
      errors.push(
        `Plan version mismatch: question version "${q.plan_version}" does not match approved blueprint version "${approvedBlueprint.plan_version}"`
      );
    }

    if (approvedBlueprint.source_coverage && approvedBlueprint.source_coverage.length > 0) {
      const isCovered = approvedBlueprint.source_coverage.some((cov) => {
        const docMatches = cov.document_id === q.provenance.document_id;
        const sectionMatches =
          cov.sections.includes("*") || cov.sections.includes(q.provenance.section);
        return docMatches && sectionMatches;
      });

      if (!isCovered) {
        errors.push(
          `Provenance document "${q.provenance.document_id}" / section "${q.provenance.section}" is not covered by approved course blueprint`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
    validatedQuestion: errors.length === 0 ? q : undefined,
  };
}

/**
 * Validates an array of proposed questions before publication.
 */
export function validateProposedQuestions(
  questions: unknown[],
  approvedBlueprint?: Partial<IAssessmentBlueprint> | null
): BatchValidationResult {
  if (!Array.isArray(questions) || questions.length === 0) {
    return {
      valid: false,
      errors: ["Proposed questions list must be a non-empty array"],
      validatedQuestions: [],
    };
  }

  const allErrors: string[] = [];
  const validatedQuestions: QuestionProvenanceInput[] = [];

  for (let i = 0; i < questions.length; i++) {
    const res = validateQuestionProvenance(questions[i], approvedBlueprint);
    if (!res.valid) {
      const qObj = questions[i] as Record<string, unknown> | null;
      allErrors.push(`[Question ${i + 1} (${qObj?.question_id ?? i})]: ${res.errors.join(", ")}`);
    } else if (res.validatedQuestion) {
      validatedQuestions.push(res.validatedQuestion);
    }
  }

  return {
    valid: allErrors.length === 0,
    errors: allErrors,
    validatedQuestions,
  };
}

/**
 * Ensures questions are valid before allowing publication. Throws explicit refusal error if invalid.
 */
export function publishQuestions(
  questions: unknown[],
  approvedBlueprint?: Partial<IAssessmentBlueprint> | null
): QuestionProvenanceInput[] {
  const result = validateProposedQuestions(questions, approvedBlueprint);
  if (!result.valid) {
    throw new Error(
      `Question publication refused: ${result.errors.join(" | ")}`
    );
  }
  return result.validatedQuestions;
}
