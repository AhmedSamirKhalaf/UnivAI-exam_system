import mongoose, { Schema, Model, Document } from "mongoose";

export type AppealResolution = "upheld" | "cleared";

export interface IIntegrityAppeal extends Document {
  _id: mongoose.Types.ObjectId;
  exam_id: mongoose.Types.ObjectId;
  submitted_note?: string;
  resolved_by: string;
  resolution: AppealResolution;
  allow_retake: boolean;
  resolved_at: Date;
  createdAt: Date;
  updatedAt: Date;
}

const integrityAppealSchema = new Schema<IIntegrityAppeal>(
  {
    exam_id: {
      type: Schema.Types.ObjectId,
      ref: "Exam",
      required: true,
    },
    submitted_note: { type: String },
    resolved_by: { type: String, required: true },
    resolution: {
      type: String,
      enum: ["upheld", "cleared"],
      required: true,
    },
    allow_retake: {
      type: Boolean,
      required: true,
      default: false,
    },
    resolved_at: { type: Date, required: true },
  },
  { timestamps: true }
);

export const IntegrityAppeal: Model<IIntegrityAppeal> =
  mongoose.models.IntegrityAppeal ||
  mongoose.model<IIntegrityAppeal>(
    "IntegrityAppeal",
    integrityAppealSchema
  );
