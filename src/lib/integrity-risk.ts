import type { IntegrityEventType } from "@/lib/integrity-protocol";

export type TimelineEvent = {
  event_type: IntegrityEventType;
  occurred_at: Date | string;
};

export type MainEffect = {
  event: IntegrityEventType;
  perOccurrence: number;
  cap: number;
};

export type PairEffect = {
  left: IntegrityEventType;
  right: IntegrityEventType;
  withinSeconds: number;
  effect: number;
  cap: number;
};

export type CalibrationPoint = { input: number; output: number };

export type ExplainableRiskModel = {
  version: string;
  featureSchemaVersion: string;
  policyVersion: string;
  calibrationVersion: string | null;
  mode: "provisional_rules" | "calibrated_ebm";
  intercept: number;
  mainEffects: MainEffect[];
  pairEffects: PairEffect[];
  calibration?: CalibrationPoint[];
};

export type RiskContribution = {
  kind: "main" | "pair";
  feature: string;
  value: number;
  occurrences: number;
};

export type IntegrityFeatureSummary = {
  schemaVersion: string;
  eventCount: number;
  sessionDurationSeconds: number;
  counts: Partial<Record<IntegrityEventType, number>>;
  secondsSinceLastEvent: number;
  repeatedWithinThirtySeconds: number;
  recoveryCount: number;
  heartbeatMissCount: number;
};

export type IntegrityRiskResult = {
  modelVersion: string;
  featureSchemaVersion: string;
  policyVersion: string;
  calibrationVersion: string | null;
  mode: ExplainableRiskModel["mode"];
  rawLogit: number;
  reviewPriority: number;
  probability: number | null;
  band: "observe" | "review" | "high_review" | "protocol_lock";
  contributions: RiskContribution[];
  features: IntegrityFeatureSummary;
};

export const provisionalIntegrityModel: ExplainableRiskModel = {
  version: "univai-integrity-provisional-v2",
  featureSchemaVersion: "integrity-features-v1",
  policyVersion: "human-review-v2",
  calibrationVersion: null,
  mode: "provisional_rules",
  intercept: -3.2,
  mainEffects: [
    { event: "visibility_hidden", perOccurrence: 0.35, cap: 1.05 },
    { event: "window_blur", perOccurrence: 2.6, cap: 2.6 },
    { event: "fullscreen_exit", perOccurrence: 0.6, cap: 1.2 },
    { event: "restricted_shortcut", perOccurrence: 1.4, cap: 2.8 },
    { event: "context_menu_attempt", perOccurrence: 0.5, cap: 1 },
    { event: "clipboard_copy_attempt", perOccurrence: 1.1, cap: 2.2 },
    { event: "clipboard_cut_attempt", perOccurrence: 1.1, cap: 2.2 },
    { event: "clipboard_paste_attempt", perOccurrence: 1.1, cap: 2.2 },
    { event: "drag_start_attempt", perOccurrence: 0.15, cap: 0.3 },
    { event: "drop_attempt", perOccurrence: 0.5, cap: 1 },
    { event: "devtools_dimension_suspected", perOccurrence: 0, cap: 0 },
    { event: "duplicate_attempt_context", perOccurrence: 1.8, cap: 1.8 },
    { event: "print_attempt", perOccurrence: 1.2, cap: 2.4 },
    { event: "csp_violation", perOccurrence: 1.5, cap: 3 },
    { event: "heartbeat_missed", perOccurrence: 0.5, cap: 1.5 },
    { event: "heartbeat_invalid", perOccurrence: 4, cap: 4 },
    { event: "telemetry_gap", perOccurrence: 0.8, cap: 1.6 },
    { event: "channel_close", perOccurrence: 0.1, cap: 0.3 },
  ],
  pairEffects: [
    { left: "restricted_shortcut", right: "devtools_dimension_suspected", withinSeconds: 30, effect: 2, cap: 2 },
    { left: "fullscreen_exit", right: "visibility_hidden", withinSeconds: 30, effect: 1, cap: 2 },
    { left: "clipboard_copy_attempt", right: "duplicate_attempt_context", withinSeconds: 60, effect: 2.2, cap: 2.2 },
    { left: "clipboard_paste_attempt", right: "duplicate_attempt_context", withinSeconds: 60, effect: 2.2, cap: 2.2 },
    { left: "heartbeat_invalid", right: "telemetry_gap", withinSeconds: 60, effect: 4, cap: 4 },
    { left: "heartbeat_missed", right: "channel_close", withinSeconds: 30, effect: 1.5, cap: 3 },
    { left: "restricted_shortcut", right: "context_menu_attempt", withinSeconds: 30, effect: 1, cap: 2 },
  ],
};

function sigmoid(value: number): number {
  return 1 / (1 + Math.exp(-value));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function calibratedProbability(value: number, points: CalibrationPoint[]): number {
  const sorted = [...points].sort((left, right) => left.input - right.input);
  if (!sorted.length) throw new Error("Calibrated models require calibration points");
  if (value <= sorted[0].input) return sorted[0].output;
  if (value >= sorted[sorted.length - 1].input) return sorted[sorted.length - 1].output;
  for (let index = 1; index < sorted.length; index += 1) {
    const right = sorted[index];
    const left = sorted[index - 1];
    if (value <= right.input) {
      const distance = (value - left.input) / (right.input - left.input);
      return clamp(left.output + distance * (right.output - left.output), 0, 1);
    }
  }
  return value;
}

function pairOccurrences(
  events: TimelineEvent[],
  leftType: IntegrityEventType,
  rightType: IntegrityEventType,
  withinSeconds: number,
): number {
  const left = events.filter((event) => event.event_type === leftType);
  const right = events.filter((event) => event.event_type === rightType);
  const windowMs = withinSeconds * 1_000;
  let count = 0;
  for (const first of left) {
    const firstTime = new Date(first.occurred_at).getTime();
    if (right.some((second) => Math.abs(new Date(second.occurred_at).getTime() - firstTime) <= windowMs)) {
      count += 1;
    }
  }
  return count;
}

export function extractIntegrityFeatures(
  events: TimelineEvent[],
  now: Date | string = new Date(),
): IntegrityFeatureSummary {
  const ordered = [...events].sort(
    (left, right) => new Date(left.occurred_at).getTime() - new Date(right.occurred_at).getTime(),
  );
  const counts: Partial<Record<IntegrityEventType, number>> = {};
  let repeatedWithinThirtySeconds = 0;
  let recoveryCount = 0;
  const lastSeenByType = new Map<IntegrityEventType, number>();
  const openDepartures = new Set<IntegrityEventType>();
  const departureTypes = new Set<IntegrityEventType>([
    "visibility_hidden",
    "window_blur",
    "fullscreen_exit",
    "network_offline",
    "page_frozen",
  ]);
  const recoveryFor: Partial<Record<IntegrityEventType, IntegrityEventType>> = {
    visibility_visible: "visibility_hidden",
    window_focus: "window_blur",
    fullscreen_enter: "fullscreen_exit",
    network_online: "network_offline",
    page_resumed: "page_frozen",
  };

  for (const event of ordered) {
    const occurredAt = new Date(event.occurred_at).getTime();
    counts[event.event_type] = (counts[event.event_type] ?? 0) + 1;
    const previous = lastSeenByType.get(event.event_type);
    if (previous !== undefined && occurredAt - previous <= 30_000) repeatedWithinThirtySeconds += 1;
    lastSeenByType.set(event.event_type, occurredAt);

    if (departureTypes.has(event.event_type)) openDepartures.add(event.event_type);
    const departedType = recoveryFor[event.event_type];
    if (departedType && openDepartures.delete(departedType)) recoveryCount += 1;
  }

  const firstAt = ordered.length ? new Date(ordered[0].occurred_at).getTime() : 0;
  const lastAt = ordered.length ? new Date(ordered[ordered.length - 1].occurred_at).getTime() : 0;
  return {
    schemaVersion: "integrity-features-v1",
    eventCount: ordered.length,
    sessionDurationSeconds: ordered.length > 1 ? Math.max(0, (lastAt - firstAt) / 1_000) : 0,
    counts,
    secondsSinceLastEvent: ordered.length
      ? Math.max(0, (new Date(now).getTime() - lastAt) / 1_000)
      : 0,
    repeatedWithinThirtySeconds,
    recoveryCount,
    heartbeatMissCount: counts.heartbeat_missed ?? 0,
  };
}

export function scoreIntegrityTimeline(
  events: TimelineEvent[],
  model: ExplainableRiskModel = provisionalIntegrityModel,
): IntegrityRiskResult {
  const contributions: RiskContribution[] = [];
  let rawLogit = model.intercept;

  for (const effect of model.mainEffects) {
    const occurrences = events.filter((event) => event.event_type === effect.event).length;
    const value = Math.min(effect.cap, occurrences * effect.perOccurrence);
    if (value !== 0) contributions.push({ kind: "main", feature: effect.event, value, occurrences });
    rawLogit += value;
  }

  for (const effect of model.pairEffects) {
    const occurrences = pairOccurrences(events, effect.left, effect.right, effect.withinSeconds);
    const value = Math.min(effect.cap, occurrences * effect.effect);
    if (value !== 0) {
      contributions.push({
        kind: "pair",
        feature: `${effect.left} + ${effect.right}`,
        value,
        occurrences,
      });
    }
    rawLogit += value;
  }

  contributions.sort((left, right) => Math.abs(right.value) - Math.abs(left.value));
  const uncalibrated = sigmoid(rawLogit);
  const probability = model.mode === "calibrated_ebm"
    ? calibratedProbability(uncalibrated, model.calibration ?? [])
    : null;
  const reviewPriority = Math.round(100 * (probability ?? uncalibrated));
  const hasProtocolFailure = events.some((event) => event.event_type === "heartbeat_invalid");
  const band = hasProtocolFailure
    ? "protocol_lock"
    : reviewPriority >= 70
      ? "high_review"
      : reviewPriority >= 35
        ? "review"
        : "observe";

  return {
    modelVersion: model.version,
    featureSchemaVersion: model.featureSchemaVersion,
    policyVersion: model.policyVersion,
    calibrationVersion: model.calibrationVersion,
    mode: model.mode,
    rawLogit,
    reviewPriority,
    probability,
    band,
    contributions,
    features: extractIntegrityFeatures(events),
  };
}
