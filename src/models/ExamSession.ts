import mongoose, { Schema, Model, Document } from "mongoose";

export type SessionStatus = "in_progress" | "completed" | "terminated";
export type TerminatedReason =
  | "suspicion_threshold"
  | "manual_admin_stop"
  | "student_submitted"
  | "timeout";

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
      ],
    },
  },
  { timestamps: true }
);

export const ExamSession: Model<IExamSession> =
  mongoose.models.ExamSession ||
  mongoose.model<IExamSession>("ExamSession", examSessionSchema);
