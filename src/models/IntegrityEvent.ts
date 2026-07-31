import mongoose, { Document, Model, Schema } from "mongoose";
import {
  integrityEventTypes,
  type IntegrityEventType,
} from "@/lib/integrity-protocol";

export interface IIntegrityEvent extends Document {
  exam_id: mongoose.Types.ObjectId;
  student_id: mongoose.Types.ObjectId;
  connection_id: string;
  event_id: string;
  sequence: number;
  event_type: IntegrityEventType;
  evidence_value: number;
  occurred_at: Date;
  received_at: Date;
  client_build: string;
  details: Record<string, string | number | boolean | null>;
  createdAt: Date;
  updatedAt: Date;
}

const integrityEventSchema = new Schema<IIntegrityEvent>(
  {
    exam_id: { type: Schema.Types.ObjectId, ref: "Exam", required: true },
    student_id: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    connection_id: { type: String, required: true },
    event_id: { type: String, required: true },
    sequence: { type: Number, required: true },
    event_type: { type: String, enum: integrityEventTypes, required: true },
    evidence_value: { type: Number, min: 0, max: 4, required: true },
    occurred_at: { type: Date, required: true },
    received_at: { type: Date, required: true },
    client_build: { type: String, required: true },
    details: { type: Schema.Types.Mixed, required: true, default: {} },
  },
  { timestamps: true },
);

integrityEventSchema.index({ exam_id: 1, event_id: 1 }, { unique: true });
integrityEventSchema.index({ exam_id: 1, connection_id: 1, sequence: 1 }, { unique: true });
integrityEventSchema.index({ exam_id: 1, occurred_at: 1 });

export const IntegrityEvent: Model<IIntegrityEvent> =
  mongoose.models.IntegrityEvent ||
  mongoose.model<IIntegrityEvent>("IntegrityEvent", integrityEventSchema);
