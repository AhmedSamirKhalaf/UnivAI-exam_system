import { describe, expect, it } from "vitest";
import {
  signResultWebhook,
  verifyAppRequestSignature,
} from "../../src/lib/webhook-signature";

describe("result webhook signing", () => {
  it("signs the exact raw body and fails closed without a secret", () => {
    const secret = "integration-only-secret";
    const raw = '{"exam_id":"64b000000000000000000023","mark":4}';

    expect(signResultWebhook(raw, secret)).toBe(
      "770e0f433d8fbf47b37e7ec420d9a2326874ed9b8f6e1fe0e2f2c371c9aca5c5",
    );
    expect(signResultWebhook(`${raw} `, secret)).not.toBe(
      signResultWebhook(raw, secret),
    );
    expect(() => signResultWebhook(raw, "")).toThrow(
      "EXAM_CALLBACK_SECRET is required",
    );
  });

  it("accepts only an exact raw-body signature for trusted final launches", () => {
    const secret = "trusted-app-launch-secret";
    const raw = '{"student_id":"64b000000000000000000001","final_form":"retake"}';
    const signature = signResultWebhook(raw, secret);
    expect(verifyAppRequestSignature(raw, signature, secret)).toBe(true);
    expect(verifyAppRequestSignature(`${raw} `, signature, secret)).toBe(false);
    expect(verifyAppRequestSignature(raw, null, secret)).toBe(false);
    expect(verifyAppRequestSignature(raw, signature, "")).toBe(false);
  });
});
