import { createHmac } from "node:crypto";

/** Sign the exact UTF-8 request body consumed by the UnivAI App callback. */
export function signResultWebhook(rawBody: string, secret: string): string {
  if (!secret) {
    throw new Error("EXAM_CALLBACK_SECRET is required when RESULT_WEBHOOK_URL is configured");
  }
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}
