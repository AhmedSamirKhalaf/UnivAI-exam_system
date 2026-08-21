import { Exam, type IExam } from "@/models/Exam";
import { ExamSession } from "@/models/ExamSession";
import { ProctoringEvent } from "@/models/ProctoringEvent";
import { IntegrityEvent } from "@/models/IntegrityEvent";
import { resultWebhookSchema } from "@/lib/contracts";
import { isStandalone } from "@/lib/runtime";
import { signResultWebhook } from "@/lib/webhook-signature";

const RETRY_INTERVAL_MS = 30_000;
const DELIVERY_LOCK_MS = 30_000;
const MAX_RETRY_DELAY_MS = 15 * 60_000;
const RETRY_BATCH_SIZE = 20;

export function resultMaximumScore(
  exam: Pick<IExam, "type" | "generated_questions" | "grading_status">,
): number {
  const questions = exam.generated_questions ?? [];
  const requiresManualFinalGrade =
    exam.type === "final" &&
    (exam.grading_status === "pending_review" ||
      exam.grading_status === "graded" ||
      questions.some((question) => question.type !== "mcq"));
  return requiresManualFinalGrade ? 100 : questions.length;
}

function retryDelayMs(attempts: number): number {
  return Math.min(
    RETRY_INTERVAL_MS * 2 ** Math.max(0, attempts - 1),
    MAX_RETRY_DELAY_MS,
  );
}

async function buildPayload(exam: IExam) {
  const session = await ExamSession.findOne({ exam_id: exam._id });
  const [events, integrityEvents] = await Promise.all([
    ProctoringEvent.find({
      exam_id: exam._id,
      ...(session?.started_at ? { createdAt: { $gte: session.started_at } } : {}),
    }).sort({ createdAt: 1 }),
    IntegrityEvent.find({
      exam_id: exam._id,
      ...(session?.started_at ? { received_at: { $gte: session.started_at } } : {}),
    })
      .sort({ occurred_at: 1 })
      .limit(1_000)
      .select({ event_type: 1, occurred_at: 1, evidence_value: 1, details: 1 })
      .lean(),
  ]);

  return resultWebhookSchema.parse({
    exam_id: exam._id.toString(),
    type: exam.type,
    title: exam.title,
    student_id: exam.student_id.toString(),
    student_sid: exam.student_sid ?? null,
    chapter_id: exam.chapter_id?.toString() ?? null,
    attempt_number: exam.attempt_number,
    final_form: exam.type === "final" ? (exam.final_form ?? "primary") : null,
    mark: exam.mark ?? null,
    total_questions: (exam.generated_questions ?? []).length,
    max_score: resultMaximumScore(exam),
    passing_mark: exam.passing_mark ?? null,
    passed: exam.passed,
    grading_status: exam.grading_status,
    integrity_status: exam.integrity_status,
    policy_action: exam.policy_action ?? "none",
    review_status: exam.review_status ?? "not_required",
    report: {
      suspicion_score: session?.suspicion_score ?? 0,
      flagged: session?.flagged ?? false,
      raw_score: exam.raw_mark ?? exam.mark ?? null,
      integrity_penalty_applied: exam.integrity_penalty_applied ?? false,
      risk_band: session?.risk_band ?? "observe",
      risk_explanation: session?.risk_explanation ?? null,
      session_status: session?.status ?? "unknown",
      started_at: session?.started_at ?? null,
      ended_at: session?.ended_at ?? null,
      events: events.map((event) => ({
        type: event.type,
        weight: event.weight,
        occurrences: event.occurrences,
        at: event.last_seen_at,
      })),
      integrity_events: integrityEvents.map((event) => ({
        type: event.event_type,
        at: event.occurred_at,
        evidence_value: event.evidence_value,
        details: event.details ?? {},
      })),
    },
  });
}

async function ensurePendingVersion(exam: IExam): Promise<number> {
  const version = exam.result_webhook_version ?? 0;
  const deliveredVersion = exam.result_webhook_delivered_version ?? 0;
  if (version > deliveredVersion) return version;

  // Compatibility for an older persisted exam that predates the durable
  // callback fields. New submissions and manual grades queue in the same save
  // as the result change, so this fallback is normally unnecessary.
  const queued = await Exam.findOneAndUpdate(
    { _id: exam._id },
    {
      $inc: { result_webhook_version: 1 },
      $set: {
        result_webhook_attempts: 0,
        result_webhook_next_attempt_at: new Date(),
      },
      $unset: {
        result_webhook_locked_until: "",
        result_webhook_last_error: "",
      },
    },
    { returnDocument: "after" },
  );
  return queued?.result_webhook_version ?? version + 1;
}

async function claimDelivery(
  examId: IExam["_id"],
  version: number,
): Promise<IExam | null> {
  const now = new Date();
  return Exam.findOneAndUpdate(
    {
      _id: examId,
      result_webhook_version: version,
      $expr: {
        $gt: [
          "$result_webhook_version",
          { $ifNull: ["$result_webhook_delivered_version", 0] },
        ],
      },
      $and: [
        {
          $or: [
            { result_webhook_next_attempt_at: { $exists: false } },
            { result_webhook_next_attempt_at: { $lte: now } },
          ],
        },
        {
          $or: [
            { result_webhook_locked_until: { $exists: false } },
            { result_webhook_locked_until: { $lte: now } },
          ],
        },
      ],
    },
    {
      $inc: { result_webhook_attempts: 1 },
      $set: {
        result_webhook_locked_until: new Date(now.getTime() + DELIVERY_LOCK_MS),
      },
    },
    { returnDocument: "after" },
  );
}

async function markDelivered(exam: IExam, version: number): Promise<void> {
  await Exam.updateOne(
    { _id: exam._id, result_webhook_version: version },
    {
      $max: { result_webhook_delivered_version: version },
      $unset: {
        result_webhook_locked_until: "",
        result_webhook_next_attempt_at: "",
        result_webhook_last_error: "",
      },
    },
  );
}

async function markForRetry(
  exam: IExam,
  version: number,
  error: unknown,
): Promise<void> {
  const attempts = exam.result_webhook_attempts ?? 1;
  const message =
    error instanceof Error ? error.message : "Unknown result webhook error";
  await Exam.updateOne(
    { _id: exam._id, result_webhook_version: version },
    {
      $set: {
        result_webhook_last_error: message.slice(0, 1_000),
        result_webhook_next_attempt_at: new Date(
          Date.now() + retryDelayMs(attempts),
        ),
      },
      $unset: { result_webhook_locked_until: "" },
    },
  );
  console.error("[webhook] failed to deliver result:", message);
}

async function deliverVersion(
  examId: IExam["_id"],
  version: number,
): Promise<void> {
  const exam = await claimDelivery(examId, version);
  if (!exam) return;

  try {
    const payload = await buildPayload(exam);
    const deliveryKey = `exam-result-${exam._id.toString()}-${version}`;

    if (isStandalone()) {
      await Exam.db.collection("webhook_captures").updateOne(
        { delivery_key: deliveryKey },
        {
          $setOnInsert: {
            delivery_key: deliveryKey,
            captured_at: new Date(),
            payload,
          },
        },
        { upsert: true },
      );
      await markDelivered(exam, version);
      return;
    }

    const url = process.env.RESULT_WEBHOOK_URL;
    if (!url) return;
    const rawBody = JSON.stringify(payload);
    const signature = signResultWebhook(
      rawBody,
      process.env.EXAM_CALLBACK_SECRET ?? "",
    );
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": deliveryKey,
        "X-Exam-Signature": signature,
      },
      body: rawBody,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`Result webhook returned HTTP ${response.status}`);
    }
    await markDelivered(exam, version);
  } catch (error) {
    await markForRetry(exam, version, error);
  }
}

/**
 * Send the current result revision once. The result-changing Exam save queues
 * the revision durably first; delivery failure only schedules another attempt
 * and never rolls back a student's submission or an instructor's grade.
 */
export async function sendResultWebhook(exam: IExam): Promise<void> {
  if (exam.type === "practice") return;
  if (!process.env.RESULT_WEBHOOK_URL && !isStandalone()) return;

  try {
    const version = await ensurePendingVersion(exam);
    await deliverVersion(exam._id, version);
  } catch (error) {
    console.error("[webhook] failed to queue result:", error);
  }
}

export async function retryPendingResultWebhooks(): Promise<void> {
  if (!process.env.RESULT_WEBHOOK_URL && !isStandalone()) return;

  const now = new Date();
  const candidates = await Exam.find({
    type: { $ne: "practice" },
    $expr: {
      $gt: [
        "$result_webhook_version",
        { $ifNull: ["$result_webhook_delivered_version", 0] },
      ],
    },
    $and: [
      {
        $or: [
          { result_webhook_next_attempt_at: { $exists: false } },
          { result_webhook_next_attempt_at: { $lte: now } },
        ],
      },
      {
        $or: [
          { result_webhook_locked_until: { $exists: false } },
          { result_webhook_locked_until: { $lte: now } },
        ],
      },
    ],
  })
    .select({ _id: 1, result_webhook_version: 1 })
    .limit(RETRY_BATCH_SIZE);

  await Promise.allSettled(
    candidates.map((exam) =>
      deliverVersion(exam._id, exam.result_webhook_version),
    ),
  );
}

/** Start the process-local dispatcher for the Mongo-backed result outbox. */
export function startResultWebhookRetryWorker(): () => void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const { connectDB } = await import("@/lib/db");
      await connectDB();
      await retryPendingResultWebhooks();
    } catch (error) {
      console.error("[webhook] retry worker failed:", error);
    } finally {
      running = false;
    }
  };

  void tick();
  const timer = setInterval(() => void tick(), RETRY_INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
