import mongoose, { Schema, Model } from "mongoose";

export interface IChapter {
  _id: mongoose.Types.ObjectId;
  curriculum_id: mongoose.Types.ObjectId;
  title: string;
  number: number;
  createdAt: Date;
  updatedAt: Date;
}

const chapterSchema = new Schema<IChapter>(
  {
    curriculum_id: { type: Schema.Types.ObjectId, ref: "Curriculum", required: true },
    title: { type: String, required: true },
    number: { type: Number, required: true },
  },
  { timestamps: true }
);

chapterSchema.index({ curriculum_id: 1, number: 1 });

export const Chapter: Model<IChapter> =
  mongoose.models.Chapter || mongoose.model<IChapter>("Chapter", chapterSchema);
