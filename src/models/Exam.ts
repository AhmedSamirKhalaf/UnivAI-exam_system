import mongoose, { Schema, Model } from "mongoose";

export type ExamType = "quiz" | "mid" | "final";
export type GradingStatus = "auto_graded" | "pending_review" | "graded";

export interface IExam {
  _id: mongoose.Types.ObjectId;
  type: ExamType;
  title: string;
  student_id: mongoose.Types.ObjectId;
  curriculum_id?: mongoose.Types.ObjectId;
  attempt_number: number;
  taken: boolean;
  mark?: number;
  passing_mark?: number;
  passed: boolean;
  grading_status: GradingStatus;
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
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    curriculum_id: { type: Schema.Types.ObjectId, ref: "Curriculum", required: false },
    attempt_number: { type: Number, required: true, default: 1 },
    taken: { type: Boolean, required: true, default: false },
    mark: { type: Number, required: false },
    passing_mark: { type: Number, required: false },
    passed: { type: Boolean, required: true, default: false },
    grading_status: {
      type: String,
      enum: ["auto_graded", "pending_review", "graded"],
      required: true,
      default: "auto_graded",
    },
  },
  { timestamps: true }
);

examSchema.index({ student_id: 1, type: 1, attempt_number: 1 });

export const Exam: Model<IExam> =
  mongoose.models.Exam || mongoose.model<IExam>("Exam", examSchema);
