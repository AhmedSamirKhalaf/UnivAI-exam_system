import mongoose, { Schema, Model, Document } from "mongoose";

export type BookStatus = "uploaded" | "processing" | "ready" | "failed";

export interface IBook extends Document {
  _id: mongoose.Types.ObjectId;
  title: string;
  original_filename: string;
  storage_path: string;
  status: BookStatus;
  requested_by_student_id?: mongoose.Types.ObjectId;
  error_message?: string;
  createdAt: Date;
  updatedAt: Date;
}

const bookSchema = new Schema<IBook>(
  {
    title: { type: String, required: true },
    original_filename: { type: String, required: true },
    storage_path: { type: String, required: true },
    status: {
      type: String,
      enum: ["uploaded", "processing", "ready", "failed"],
      required: true,
      default: "uploaded",
    },
    requested_by_student_id: {
      type: Schema.Types.ObjectId,
      ref: "Student",
    },
    error_message: { type: String },
  },
  { timestamps: true }
);

export const Book: Model<IBook> =
  mongoose.models.Book || mongoose.model<IBook>("Book", bookSchema);
