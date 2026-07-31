import mongoose, { Schema, Model, Document } from "mongoose";
import { z } from "zod";
import {
  questionProvenanceSchema,
  type QuestionProvenanceInput,
} from "../schemas/question-provenance";
import { gradeQuestionSnapshot } from "../lib/source-grounded-grading";

export type ExamType = "quiz" | "mid" | "final";
export type GradingStatus = "auto_graded" | "pending_review" | "graded";
export type IntegrityStatus = "clean" | "invalidated";
export type PolicyAction = "none" | "session_invalidated";
export type ReviewStatus = "not_required" | "pending" | "cleared" | "upheld";

export interface IExam extends Document {
  _id: mongoose.Types.ObjectId;
  type: ExamType;
  title: string;
  student_id: mongoose.Types.ObjectId;
  // The UnivAI app's tenant key (user.studentId). Echoed back in the result
  // webhook so the app routes the grade to the right owner (multi-tenant).
  student_sid?: string;
  curriculum_id?: mongoose.Types.ObjectId;
  chapter_id?: mongoose.Types.ObjectId;
  blueprint_id?: mongoose.Types.ObjectId;
  plan_version?: string;
  questions_snapshot?: QuestionProvenanceInput[];
  submitted_at?: Date;
  submission_idempotency_key?: string;
  integrity_metadata?: Record<string, unknown>;
  attempt_number: number;
  generated_questions?: Record<string, unknown>[];
  student_answers?: Record<string, unknown>[];
  taken: boolean;
  mark?: number;
  passing_mark?: number;
  passed: boolean;
  grading_status: GradingStatus;
  integrity_status: IntegrityStatus;
  policy_action: PolicyAction;
  review_status: ReviewStatus;
  invalidated_at?: Date;
  invalidation_notified_at?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const examSchema = new Schema<IExam>(
  {
    type: {
      type: String,
      enum: ["quiz", "mid", "final"],
      required: true,
    },
    title: { type: String, required: true },
    student_id: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    student_sid: { type: String },
    curriculum_id: {
      type: Schema.Types.ObjectId,
      ref: "Curriculum",
    },
    chapter_id: {
      type: Schema.Types.ObjectId,
      ref: "Chapter",
    },
    blueprint_id: {
      type: Schema.Types.ObjectId,
      ref: "AssessmentBlueprint",
    },
    plan_version: { type: String },
    questions_snapshot: { type: Schema.Types.Mixed, immutable: true },
    submitted_at: { type: Date },
    submission_idempotency_key: { type: String },
    integrity_metadata: { type: Schema.Types.Mixed },
    attempt_number: { type: Number, required: true, default: 1 },
    generated_questions: { type: Schema.Types.Mixed },
    student_answers: { type: Schema.Types.Mixed },
    taken: { type: Boolean, required: true, default: false },
    mark: { type: Number },
    passing_mark: { type: Number },
    passed: { type: Boolean, required: true, default: false },
    grading_status: {
      type: String,
      enum: ["auto_graded", "pending_review", "graded"],
      required: true,
      default: "auto_graded",
    },
    integrity_status: {
      type: String,
      enum: ["clean", "invalidated"],
      required: true,
      default: "clean",
    },
    policy_action: {
      type: String,
      enum: ["none", "session_invalidated"],
      required: true,
      default: "none",
    },
    review_status: {
      type: String,
      enum: ["not_required", "pending", "cleared", "upheld"],
      required: true,
      default: "not_required",
    },
    invalidated_at: { type: Date },
    invalidation_notified_at: { type: Date },
  },
  { timestamps: true, versionKey: false }
);

examSchema.pre("validate", function validateBlueprintSnapshot() {
  if (!this.blueprint_id) return;
  if (!this.plan_version) {
    this.invalidate(
      "plan_version",
      "Blueprint-backed exams require a plan_version",
    );
    return;
  }

  const snapshot = z
    .array(questionProvenanceSchema)
    .min(1)
    .safeParse(this.questions_snapshot);
  if (!snapshot.success) {
    this.invalidate(
      "questions_snapshot",
      `Blueprint-backed exams require a valid immutable question snapshot: ${snapshot.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; ")}`,
    );
    return;
  }

  if (
    snapshot.data.some(
      (question) => question.plan_version !== this.plan_version,
    )
  ) {
    this.invalidate(
      "questions_snapshot",
      "Question snapshot plan_version must match the exam plan_version",
    );
    return;
  }

  if (this.taken) {
    try {
      const passingMark =
        this.passing_mark ??
        Math.max(1, Math.ceil(snapshot.data.length * 0.6));
      const grade = gradeQuestionSnapshot(
        snapshot.data,
        this.student_answers,
        passingMark,
        this.integrity_status,
      );
      this.mark = grade.mark;
      this.passing_mark = grade.passing_mark;
      this.passed = grade.passed;
      this.grading_status = grade.grading_status;
    } catch (error) {
      this.invalidate(
        "student_answers",
        error instanceof Error ? error.message : "Student answers are invalid",
      );
    }
  }
});

examSchema.pre("save", function guardConcurrentSubmission() {
  if (!this.isNew && this.isModified("taken") && this.taken) {
    this.submitted_at ??= new Date();
    this.$where = { ...(this.$where ?? {}), taken: false };
  }
});

examSchema.index(
  { student_id: 1, chapter_id: 1 },
  {
    unique: true,
    partialFilterExpression: { type: "quiz" },
  }
);

examSchema.index({ student_id: 1, type: 1 });

export const Exam: Model<IExam> =
  mongoose.models.Exam || mongoose.model<IExam>("Exam", examSchema);
