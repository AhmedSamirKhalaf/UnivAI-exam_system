interface ResultWebhookState {
  result_webhook_version?: number;
  result_webhook_attempts?: number;
  result_webhook_next_attempt_at?: Date;
  result_webhook_locked_until?: Date;
  result_webhook_last_error?: string;
}

/** Queue a result revision in the same document save as the changed grade. */
export function queueResultWebhookRevision(
  exam: ResultWebhookState,
  now: Date = new Date(),
): void {
  exam.result_webhook_version = (exam.result_webhook_version ?? 0) + 1;
  exam.result_webhook_attempts = 0;
  exam.result_webhook_next_attempt_at = now;
  exam.result_webhook_locked_until = undefined;
  exam.result_webhook_last_error = undefined;
}
