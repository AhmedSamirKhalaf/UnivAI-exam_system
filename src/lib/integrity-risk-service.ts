import type { Types } from "mongoose";
import { IntegrityEvent } from "@/models/IntegrityEvent";
import { ExamSession } from "@/models/ExamSession";
import { scoreIntegrityTimeline } from "@/lib/integrity-risk";

const scheduled = new Map<string, NodeJS.Timeout>();

export async function refreshIntegrityRisk(examId: string | Types.ObjectId): Promise<void> {
  const events = await IntegrityEvent.find({ exam_id: examId })
    .sort({ occurred_at: 1 })
    .limit(1_000)
    .select({ event_type: 1, occurred_at: 1 })
    .lean();
  const result = scoreIntegrityTimeline(events);
  const riskFields: Record<string, unknown> = {
    suspicion_score: result.reviewPriority,
    flagged: result.band !== "observe",
    risk_score: result.reviewPriority,
    risk_band: result.band,
    risk_model_version: result.modelVersion,
    risk_explanation: {
      feature_schema_version: result.featureSchemaVersion,
      policy_version: result.policyVersion,
      calibration_version: result.calibrationVersion,
      mode: result.mode,
      probability: result.probability,
      raw_logit: result.rawLogit,
      features: result.features,
      contributions: result.contributions.slice(0, 10),
    },
    risk_updated_at: new Date(),
  };
  if (result.probability !== null) riskFields.risk_probability = result.probability;
  await ExamSession.updateOne(
    { exam_id: examId },
    {
      $set: riskFields,
      ...(result.probability === null ? { $unset: { risk_probability: "" } } : {}),
    },
  );
}

export function scheduleIntegrityRiskRefresh(
  examId: string | Types.ObjectId,
  delayMs = 250,
): void {
  const key = examId.toString();
  const previous = scheduled.get(key);
  if (previous) clearTimeout(previous);
  scheduled.set(key, setTimeout(() => {
    scheduled.delete(key);
    void refreshIntegrityRisk(key).catch((error: unknown) => {
      console.error("Integrity risk refresh failed", error instanceof Error ? error.message : error);
    });
  }, delayMs));
}
