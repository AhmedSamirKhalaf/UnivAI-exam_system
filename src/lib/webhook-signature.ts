import { createHmac, timingSafeEqual } from "node:crypto";

/** Sign the exact UTF-8 request body consumed by the UnivAI App callback. */
export function signResultWebhook(rawBody: string, secret: string): string {
  if (!secret) {
    throw new Error("EXAM_CALLBACK_SECRET is required when RESULT_WEBHOOK_URL is configured");
  }
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

/** Verify a trusted UnivAI App request using the same raw-body HMAC contract. */
export function verifyAppRequestSignature(
  rawBody: string,
  signature: string | null,
  secret: string,
): boolean {
  if (!secret || !signature || !/^[0-9a-fA-F]{64}$/.test(signature.trim())) return false;
  const expected = Buffer.from(
    createHmac("sha256", secret).update(rawBody).digest("hex"),
    "hex",
  );
  const supplied = Buffer.from(signature.trim(), "hex");
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
}
