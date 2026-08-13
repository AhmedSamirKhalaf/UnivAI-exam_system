import mongoose, { Schema, Model, Document } from "mongoose";

export interface ICurriculum extends Document {
  _id: mongoose.Types.ObjectId;
  title: string;
  description?: string;
  book_id?: mongoose.Types.ObjectId;
  owner_student_id?: mongoose.Types.ObjectId;
  source_book_id?: number;
  source_sha256?: string;
  createdAt: Date;
  updatedAt: Date;
}

const curriculumSchema = new Schema<ICurriculum>(
  {
    title: { type: String, required: true },
    description: { type: String },
    book_id: { type: Schema.Types.ObjectId, ref: "Book" },
    owner_student_id: { type: Schema.Types.ObjectId, ref: "Student" },
    source_book_id: { type: Number },
    source_sha256: { type: String },
  },
  { timestamps: true }
);

curriculumSchema.index({ owner_student_id: 1 });
curriculumSchema.index(
  { owner_student_id: 1, source_book_id: 1, source_sha256: 1 },
  {
    unique: true,
    partialFilterExpression: {
      owner_student_id: { $exists: true },
      source_book_id: { $exists: true },
    },
  },
);

export const Curriculum: Model<ICurriculum> =
  mongoose.models.Curriculum ||
  mongoose.model<ICurriculum>("Curriculum", curriculumSchema, "curricula");
