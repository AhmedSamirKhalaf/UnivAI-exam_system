import mongoose, { Schema, Model, Document } from "mongoose";

export interface IProvenanceSource {
  document_id: string;
  document_title: string;
  page_number: number;
  section: string;
  excerpt?: string;
}

export interface IQuestionProvenance extends Document {
  _id: mongoose.Types.ObjectId;
  question_id: string;
  prompt: string;
  type: "mcq" | "essay";
  options?: string[];
  correct_option?: string;
  plan_version: string;
  approved: boolean;
  provenance: IProvenanceSource;
  createdAt: Date;
  updatedAt: Date;
}

const questionProvenanceSchema = new Schema<IQuestionProvenance>(
  {
    question_id: { type: String, required: true, unique: true },
    prompt: { type: String, required: true },
    type: { type: String, enum: ["mcq", "essay"], required: true },
    options: [{ type: String }],
    correct_option: { type: String },
    plan_version: { type: String, required: true },
    approved: { type: Boolean, required: true, default: true },
    provenance: {
      document_id: { type: String, required: true },
      document_title: { type: String, required: true },
      page_number: { type: Number, required: true },
      section: { type: String, required: true },
      excerpt: { type: String },
    },
  },
  { timestamps: true, versionKey: false }
);

export const QuestionProvenance: Model<IQuestionProvenance> =
  mongoose.models.QuestionProvenance ||
  mongoose.model<IQuestionProvenance>(
    "QuestionProvenance",
    questionProvenanceSchema
  );
