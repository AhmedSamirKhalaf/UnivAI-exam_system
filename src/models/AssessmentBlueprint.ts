import mongoose, { Document, Model, Schema } from "mongoose";

export interface ISourcePageRange {
  start: number;
  end: number;
}

export interface ISourceCoverage {
  document_id: string;
  document_title: string;
  sections: string[];
  page_ranges: ISourcePageRange[];
}

export interface IAssessmentBlueprint extends Document {
  _id: mongoose.Types.ObjectId;
  schema_version: "assessment-blueprint-v1";
  programme: string;
  semester: string;
  course_id: string;
  title: string;
  outcomes: string[];
  difficulty: "easy" | "medium" | "hard" | "mixed";
  source_coverage: ISourceCoverage[];
  plan_version: string;
  approved: boolean;
  approved_by?: string;
  approved_at?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const assessmentBlueprintSchema = new Schema<IAssessmentBlueprint>(
  {
    schema_version: {
      type: String,
      enum: ["assessment-blueprint-v1"],
      required: true,
      immutable: true,
    },
    programme: { type: String, required: true, trim: true, immutable: true },
    semester: { type: String, required: true, trim: true, immutable: true },
    course_id: { type: String, required: true, trim: true, immutable: true },
    title: { type: String, required: true, trim: true },
    outcomes: [{ type: String, required: true }],
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard", "mixed"],
      required: true,
    },
    source_coverage: [
      {
        document_id: { type: String, required: true, immutable: true },
        document_title: { type: String, required: true, immutable: true },
        sections: [{ type: String, required: true, immutable: true }],
        page_ranges: [
          {
            start: { type: Number, required: true, min: 1, immutable: true },
            end: { type: Number, required: true, min: 1, immutable: true },
          },
        ],
      },
    ],
    plan_version: { type: String, required: true, immutable: true },
    approved: { type: Boolean, required: true, default: false },
    approved_by: { type: String },
    approved_at: { type: Date },
  },
  {
    timestamps: true,
    optimisticConcurrency: true,
  },
);

assessmentBlueprintSchema.index(
  { programme: 1, semester: 1, course_id: 1, plan_version: 1 },
  { unique: true },
);

export const AssessmentBlueprint: Model<IAssessmentBlueprint> =
  mongoose.models.AssessmentBlueprint ||
  mongoose.model<IAssessmentBlueprint>(
    "AssessmentBlueprint",
    assessmentBlueprintSchema,
  );
