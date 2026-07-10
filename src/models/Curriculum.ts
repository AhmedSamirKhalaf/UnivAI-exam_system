import mongoose, { Schema, Model } from "mongoose";

export interface ICurriculum {
  _id: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  createdAt: Date;
  updatedAt: Date;
}

const curriculumSchema = new Schema<ICurriculum>(
  {
    title: { type: String, required: true },
    description: { type: String },
  },
  { timestamps: true }
);

export const Curriculum: Model<ICurriculum> =
  mongoose.models.Curriculum || mongoose.model<ICurriculum>("Curriculum", curriculumSchema);
