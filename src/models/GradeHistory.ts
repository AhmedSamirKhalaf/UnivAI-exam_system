import mongoose, { Schema, Model, Document } from "mongoose";

export interface IGradeHistory extends Document {
  _id: mongoose.Types.ObjectId;
  exam_id: mongoose.Types.ObjectId;
  mark: number;
  graded_by: string;
  graded_at: Date;
  is_regrade: boolean;
  reason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const gradeHistorySchema = new Schema<IGradeHistory>(
  {
    exam_id: {
      type: Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
    },
    mark: { type: Number, required: true },
    graded_by: { type: String, required: true },
    graded_at: { type: Date, required: true },
    is_regrade: { type: Boolean, required: true, default: false },
    reason: { type: String },
  },
  { timestamps: true }
);

gradeHistorySchema.index({ exam_id: 1, graded_at: 1 });

export const GradeHistory: Model<IGradeHistory> =
  mongoose.models.GradeHistory ||
  mongoose.model<IGradeHistory>("GradeHistory", gradeHistorySchema);
