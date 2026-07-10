import mongoose, { Schema, Model } from "mongoose";

export type ProctoringEventType =
  | "no_face"
  | "multiple_faces"
  | "fullscreen_exit"
  | "tab_switch"
  | "copy_paste"
  | "devtools_open";

export interface IProctoringEvent {
  _id: mongoose.Types.ObjectId;
  exam_id: mongoose.Types.ObjectId;
  student_id: mongoose.Types.ObjectId;
  type: ProctoringEventType;
  weight: number;
  score_at_event: number;
  occurrences: number;
  last_seen_at: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const proctoringEventSchema = new Schema<IProctoringEvent>(
  {
    exam_id: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    type: {
      type: String,
      enum: ["no_face", "multiple_faces", "fullscreen_exit", "tab_switch", "copy_paste", "devtools_open"],
      required: true,
    },
    weight: { type: Number, required: true },
    score_at_event: { type: Number, required: true },
    occurrences: { type: Number, required: true, default: 1 },
    last_seen_at: { type: Date, required: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
);

proctoringEventSchema.index({ exam_id: 1, student_id: 1 });
proctoringEventSchema.index({ exam_id: 1, createdAt: 1 });
proctoringEventSchema.index({ type: 1 });

export const ProctoringEvent: Model<IProctoringEvent> =
  mongoose.models.ProctoringEvent ||
  mongoose.model<IProctoringEvent>("ProctoringEvent", proctoringEventSchema);
