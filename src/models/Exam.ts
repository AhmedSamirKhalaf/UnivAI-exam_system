import mongoose, { Schema, Model, Document } from "mongoose";

export type ExamType = "quiz" | "mid" | "final";
export type GradingStatus = "auto_graded" | "pending_review" | "graded";
export type IntegrityStatus = "clean" | "invalidated";

export interface IExam extends Document {
  _id: mongoose.Types.ObjectId;
  type: ExamType;
  title: string;
  student_id: mongoose.Types.ObjectId;
  curriculum_id?: mongoose.Types.ObjectId;
  chapter_id?: mongoose.Types.ObjectId;
  attempt_number: number;
  generated_questions?: Record<string, unknown>[];
  student_answers?: Record<string, unknown>[];
  taken: boolean;
  mark?: number;
  passing_mark?: number;
  passed: boolean;
  grading_status: GradingStatus;
  integrity_status: IntegrityStatus;
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
    curriculum_id: {
      type: Schema.Types.ObjectId,
      ref: "Curriculum",
    },
    chapter_id: {
      type: Schema.Types.ObjectId,
      ref: "Chapter",
    },
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
    invalidated_at: { type: Date },
    invalidation_notified_at: { type: Date },
  },
  { timestamps: true }
);

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
