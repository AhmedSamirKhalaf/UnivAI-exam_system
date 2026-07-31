import mongoose, { Document, Model, Schema } from "mongoose";

export interface IProvenanceSource {
  document_id: string;
  document_title: string;
  page_number: number;
  section: string;
  excerpt?: string;
}

export interface IQuestionProvenance extends Document {
  _id: mongoose.Types.ObjectId;
  blueprint_id: mongoose.Types.ObjectId;
  schema_version: "question-provenance-v1";
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
    blueprint_id: {
      type: Schema.Types.ObjectId,
      ref: "AssessmentBlueprint",
      required: true,
      immutable: true,
    },
    schema_version: {
      type: String,
      enum: ["question-provenance-v1"],
      required: true,
      immutable: true,
    },
    question_id: { type: String, required: true, immutable: true },
    prompt: { type: String, required: true, immutable: true },
    type: {
      type: String,
      enum: ["mcq", "essay"],
      required: true,
      immutable: true,
    },
    options: [{ type: String, immutable: true }],
    correct_option: { type: String, immutable: true },
    plan_version: { type: String, required: true, immutable: true },
    approved: {
      type: Boolean,
      required: true,
      immutable: true,
      validate: {
        validator: (value: boolean) => value === true,
        message: "Published question provenance must be approved",
      },
    },
    provenance: {
      document_id: { type: String, required: true, immutable: true },
      document_title: { type: String, required: true, immutable: true },
      page_number: { type: Number, required: true, min: 1, immutable: true },
      section: { type: String, required: true, immutable: true },
      excerpt: { type: String, immutable: true },
    },
  },
  { timestamps: true, versionKey: false },
);

questionProvenanceSchema.index(
  { blueprint_id: 1, question_id: 1 },
  { unique: true },
);

export const QuestionProvenance: Model<IQuestionProvenance> =
  mongoose.models.QuestionProvenance ||
  mongoose.model<IQuestionProvenance>(
    "QuestionProvenance",
    questionProvenanceSchema,
  );
