import mongoose, { Schema, Model } from "mongoose";

export interface IExamChapter {
  _id: mongoose.Types.ObjectId;
  chapter_id: mongoose.Types.ObjectId;
  exam_id: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const examChapterSchema = new Schema<IExamChapter>(
  {
    chapter_id: { type: Schema.Types.ObjectId, ref: "Chapter", required: true },
    exam_id: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
  },
  { timestamps: true }
);

examChapterSchema.index({ chapter_id: 1, exam_id: 1 }, { unique: true });

export const ExamChapter: Model<IExamChapter> =
  mongoose.models.ExamChapter || mongoose.model<IExamChapter>("ExamChapter", examChapterSchema);
