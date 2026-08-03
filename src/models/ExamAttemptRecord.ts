import mongoose, { Schema, Model, Document } from "mongoose";

/**
 * Durable, authoritative attempt ledger for the exam attempt policy.
 *
 * Each successfully issued attempt appends exactly one immutable record keyed
 * by (learner_id, assessment_type, assessment_id, previous_attempt_number) —
 * the attempt number the issuer based its decision on (0 for a first attempt).
 * Two concurrent start requests evaluate eligibility from the same ledger
 * state and therefore share the same `previous_attempt_number`; the unique
 * compound index lets exactly one of them create the next attempt, so a race
 * can never mint a phantom higher-numbered attempt. Records transition from
 * `active` to a terminal status exactly once via a guarded conditional
 * update; nothing is ever deleted.
 *
 * The mutable `Exam.attempt_number` counter is only a mirror for
 * compatibility; this collection is the source of truth for eligibility.
 */
export type AttemptTerminalStatus =
  | "active"
  | "submitted"
  | "timed_out"
  | "invalidated"
  | "admin_closed";

export interface IAttemptFinalEvidence {
  answers: Record<string, unknown>[];
  question_count?: number;
  mark?: number;
  passing_mark?: number;
  passed?: boolean;
  grading_status?: "auto_graded" | "pending_review" | "graded";
  integrity_status?: "clean" | "invalidated";
  policy_action?: string;
  review_status?: string;
  submitted_at?: Date;
  invalidated_at?: Date;
}

export interface IExamAttemptRecord extends Document {
  _id: mongoose.Types.ObjectId;
  learner_id: mongoose.Types.ObjectId;
  assessment_type: "quiz" | "mid" | "final";
  assessment_id: mongoose.Types.ObjectId;
  source_exam_id: mongoose.Types.ObjectId;
  attempt_number: number;
  previous_attempt_number: number;
  status: AttemptTerminalStatus;
  issued_at: Date;
  terminal_at?: Date;
  terminal_reason?: string;
  session_id?: mongoose.Types.ObjectId;
  previous_attempt_id?: mongoose.Types.ObjectId;
  policy_version: string;
  final_evidence?: IAttemptFinalEvidence;
  createdAt: Date;
  updatedAt: Date;
}

const finalEvidenceSchema = new Schema<IAttemptFinalEvidence>(
  {
    answers: { type: Schema.Types.Mixed, required: true, default: [] },
    question_count: { type: Number },
    mark: { type: Number },
    passing_mark: { type: Number },
    passed: { type: Boolean },
    grading_status: { type: String },
    integrity_status: { type: String },
    policy_action: { type: String },
    review_status: { type: String },
    submitted_at: { type: Date },
    invalidated_at: { type: Date },
  },
  { _id: false }
);

const examAttemptRecordSchema = new Schema<IExamAttemptRecord>(
  {
    learner_id: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    assessment_type: {
      type: String,
      enum: ["quiz", "mid", "final"],
      required: true,
    },
    assessment_id: {
      type: Schema.Types.ObjectId,
      required: true,
    },
    source_exam_id: {
      type: Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
    },
    attempt_number: { type: Number, required: true, min: 1 },
    previous_attempt_number: { type: Number, required: true, min: 0, default: 0 },
    status: {
      type: String,
      enum: ["active", "submitted", "timed_out", "invalidated", "admin_closed"],
      required: true,
      default: "active",
    },
    issued_at: { type: Date, required: true },
    terminal_at: { type: Date },
    terminal_reason: { type: String },
    session_id: { type: Schema.Types.ObjectId },
    previous_attempt_id: { type: Schema.Types.ObjectId },
    policy_version: { type: String, required: true },
    final_evidence: { type: finalEvidenceSchema },
  },
  { timestamps: true, versionKey: false }
);

/**
 * At most one record may be issued from a given ledger state (a given
 * `previous_attempt_number`). Concurrent starts share the same basis, so only
 * one of them can create the next attempt — this is the atomic gate that makes
 * concurrent starts safe.
 */
examAttemptRecordSchema.index(
  {
    learner_id: 1,
    assessment_type: 1,
    assessment_id: 1,
    previous_attempt_number: 1,
  },
  { unique: true }
);

examAttemptRecordSchema.index({ learner_id: 1, assessment_type: 1, assessment_id: 1, attempt_number: 1 });
examAttemptRecordSchema.index({ source_exam_id: 1 });
examAttemptRecordSchema.index({ learner_id: 1, assessment_type: 1 });

export const ExamAttemptRecord: Model<IExamAttemptRecord> =
  mongoose.models.ExamAttemptRecord ||
  mongoose.model<IExamAttemptRecord>("ExamAttemptRecord", examAttemptRecordSchema);
