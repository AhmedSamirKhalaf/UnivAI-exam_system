import mongoose, { Schema, Model, Document } from "mongoose";

export interface ISourceCoverage {
  document_id: string;
  document_title?: string;
  sections: string[];
}

export interface IAssessmentBlueprint extends Document {
  _id: mongoose.Types.ObjectId;
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
  createdAt: Date;
  updatedAt: Date;
}

const assessmentBlueprintSchema = new Schema<IAssessmentBlueprint>(
  {
    programme: { type: String, required: true },
    semester: { type: String, required: true },
    course_id: { type: String, required: true },
    title: { type: String, required: true },
    outcomes: [{ type: String, required: true }],
    difficulty: {
      type: String,
      enum: ["easy", "medium", "hard", "mixed"],
      required: true,
    },
    source_coverage: [
      {
        document_id: { type: String, required: true },
        document_title: { type: String },
        sections: [{ type: String, required: true }],
      },
    ],
    plan_version: { type: String, required: true },
    approved: { type: Boolean, required: true, default: true },
    approved_by: { type: String },
  },
  { timestamps: true, versionKey: false }
);

assessmentBlueprintSchema.index({ course_id: 1, plan_version: 1 });

export const AssessmentBlueprint: Model<IAssessmentBlueprint> =
  mongoose.models.AssessmentBlueprint ||
  mongoose.model<IAssessmentBlueprint>(
    "AssessmentBlueprint",
    assessmentBlueprintSchema
  );
