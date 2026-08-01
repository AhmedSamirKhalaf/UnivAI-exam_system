import mongoose, { Schema, Model, Document } from "mongoose";

export type SessionStatus = "in_progress" | "completed" | "terminated";
export type TerminatedReason =
  | "suspicion_threshold"
  | "manual_admin_stop"
  | "student_submitted"
  | "timeout"
  | "heartbeat_failure"
  | "protocol_failure"
  | "duplicate_session";
export type IntegritySessionState =
  | "active"
  | "reconnecting"
  | "grace"
  | "integrity_locked"
  | "submitted";

export interface IExamSession extends Document {
  _id: mongoose.Types.ObjectId;
  exam_id: mongoose.Types.ObjectId;
  student_id: mongoose.Types.ObjectId;
  started_at: Date;
  ended_at?: Date;
  suspicion_score: number;
  flagged: boolean;
  status: SessionStatus;
  terminated_reason?: TerminatedReason;
  current_question_index: number;
  answer_revision: number;
  answers: Record<string, unknown>[];
  access_token_hash?: string;
  access_token_issued_at?: Date;
  last_action_id?: string;
  last_action_question_id?: string;
  last_action_revision?: number;
  integrity_state: IntegritySessionState;
  integrity_lock_reason?: string;
  active_connection_id?: string;
  last_integrity_sequence: number;
  heartbeat_last_seen_at?: Date;
  heartbeat_consecutive_misses: number;
  heartbeat_grace_until?: Date;
  heartbeat_registry_version?: string;
  heartbeat_registry_digest?: string;
  heartbeat_client_build?: string;
  createdAt: Date;
  updatedAt: Date;
}

const examSessionSchema = new Schema<IExamSession>(
  {
    exam_id: {
      type: Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
      unique: true,
    },
    student_id: {
      type: Schema.Types.ObjectId,
      ref: "Student",
      required: true,
    },
    started_at: { type: Date, required: true },
    ended_at: { type: Date },
    suspicion_score: { type: Number, required: true, default: 0 },
    flagged: { type: Boolean, required: true, default: false },
    status: {
      type: String,
      enum: ["in_progress", "completed", "terminated"],
      required: true,
    },
    terminated_reason: {
      type: String,
      enum: [
        "suspicion_threshold",
        "manual_admin_stop",
        "student_submitted",
        "timeout",
        "heartbeat_failure",
        "protocol_failure",
        "duplicate_session",
      ],
    },
    current_question_index: { type: Number, required: true, default: 0 },
    answer_revision: { type: Number, required: true, default: 0 },
    answers: { type: Schema.Types.Mixed, required: true, default: [] },
    access_token_hash: { type: String, select: false },
    access_token_issued_at: { type: Date },
    last_action_id: { type: String },
    last_action_question_id: { type: String },
    last_action_revision: { type: Number },
    integrity_state: {
      type: String,
      enum: ["active", "reconnecting", "grace", "integrity_locked", "submitted"],
      required: true,
      default: "active",
    },
    integrity_lock_reason: { type: String },
    active_connection_id: { type: String },
    last_integrity_sequence: { type: Number, required: true, default: 0 },
    heartbeat_last_seen_at: { type: Date },
    heartbeat_consecutive_misses: { type: Number, required: true, default: 0 },
    heartbeat_grace_until: { type: Date },
    heartbeat_registry_version: { type: String },
    heartbeat_registry_digest: { type: String },
    heartbeat_client_build: { type: String },
  },
  { timestamps: true }
);

export const ExamSession: Model<IExamSession> =
  mongoose.models.ExamSession ||
  mongoose.model<IExamSession>("ExamSession", examSessionSchema);
