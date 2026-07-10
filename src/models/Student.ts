import mongoose, { Schema, Model, Document } from "mongoose";

export interface IStudent extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const studentSchema = new Schema<IStudent>(
  {
    name: { type: String, required: true },
  },
  { timestamps: true }
);

export const Student: Model<IStudent> =
  mongoose.models.Student ||
  mongoose.model<IStudent>("Student", studentSchema);
