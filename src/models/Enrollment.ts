import mongoose, { Schema, Model } from "mongoose";

export type EnrollmentStatus = "active" | "completed" | "withdrawn";

export interface IEnrollment {
  _id: mongoose.Types.ObjectId;
  student_id: mongoose.Types.ObjectId;
  curriculum_id: mongoose.Types.ObjectId;
  enrolled_at: Date;
  status: EnrollmentStatus;
  createdAt: Date;
  updatedAt: Date;
}

const enrollmentSchema = new Schema<IEnrollment>(
  {
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    curriculum_id: { type: Schema.Types.ObjectId, ref: "Curriculum", required: true },
    enrolled_at: { type: Date, required: true },
    status: {
      type: String,
      enum: ["active", "completed", "withdrawn"],
      required: true,
      default: "active",
    },
  },
  { timestamps: true }
);

enrollmentSchema.index({ student_id: 1, curriculum_id: 1 }, { unique: true });

export const Enrollment: Model<IEnrollment> =
  mongoose.models.Enrollment || mongoose.model<IEnrollment>("Enrollment", enrollmentSchema);
