import mongoose, { Schema, Model, Document } from "mongoose";

export interface ICurriculum extends Document {
  _id: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  book_id?: mongoose.Types.ObjectId;
  owner_student_id?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const curriculumSchema = new Schema<ICurriculum>(
  {
    title: { type: String, required: true },
    description: { type: String },
    book_id: { type: Schema.Types.ObjectId, ref: "Book" },
    owner_student_id: { type: Schema.Types.ObjectId, ref: "Student" },
  },
  { timestamps: true }
);

curriculumSchema.index({ owner_student_id: 1 });

export const Curriculum: Model<ICurriculum> =
  mongoose.models.Curriculum ||
  mongoose.model<ICurriculum>("Curriculum", curriculumSchema);
